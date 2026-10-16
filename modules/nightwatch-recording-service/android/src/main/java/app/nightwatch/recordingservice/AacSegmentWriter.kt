package app.nightwatch.recordingservice

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import java.io.File

/**
 * Encodes 16-bit little-endian mono PCM to AAC-LC in an .m4a file: one sound segment of the
 * night. Uses the platform encoder (MediaCodec) and MP4 muxer, so no codec ships with the app.
 * Not thread safe: the module only touches it from its single encoder thread.
 */
internal class AacSegmentWriter(private val path: String, private val sampleRate: Int, bitrate: Int) {
  private val codec: MediaCodec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC)
  private lateinit var muxer: MediaMuxer
  private val info = MediaCodec.BufferInfo()
  private var track = -1
  private var muxing = false
  private var wroteSamples = false
  private var samplesQueued = 0L
  private var released = false

  init {
    try {
      File(path).parentFile?.mkdirs()
      muxer = MediaMuxer(path, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
      val format = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, sampleRate, 1).apply {
        setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
        setInteger(MediaFormat.KEY_BIT_RATE, bitrate)
        setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, MAX_INPUT_BYTES)
      }
      codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
      codec.start()
    } catch (e: Exception) {
      codec.release()
      if (::muxer.isInitialized) muxer.release()
      File(path).delete()
      throw e
    }
  }

  fun write(pcm: ByteArray) {
    var offset = 0
    var stalled = 0
    while (offset < pcm.size) {
      val index = codec.dequeueInputBuffer(TIMEOUT_US)
      if (index < 0) {
        drain(false)
        if (++stalled > MAX_ATTEMPTS) throw IllegalStateException("AAC encoder stopped accepting input")
        continue
      }
      stalled = 0
      val buffer = codec.getInputBuffer(index) ?: throw IllegalStateException("AAC encoder gave no input buffer")
      buffer.clear()
      var length = minOf(buffer.remaining(), pcm.size - offset)
      length -= length % 2 // whole 16-bit samples only
      buffer.put(pcm, offset, length)
      codec.queueInputBuffer(index, 0, length, presentationUs(), 0)
      samplesQueued += length / 2
      offset += length
      drain(false)
    }
  }

  /** Flushes the encoder and closes the file. Returns its size in bytes, or 0 (file deleted) if nothing was encoded. */
  fun finish(): Int {
    try {
      var attempts = 0
      while (true) {
        val index = codec.dequeueInputBuffer(TIMEOUT_US)
        if (index >= 0) {
          codec.queueInputBuffer(index, 0, 0, presentationUs(), MediaCodec.BUFFER_FLAG_END_OF_STREAM)
          break
        }
        drain(false)
        if (++attempts > MAX_ATTEMPTS) throw IllegalStateException("AAC encoder did not take the end of stream")
      }
      drain(true)
    } finally {
      release()
    }
    val file = File(path)
    if (!wroteSamples) {
      file.delete()
      return 0
    }
    return file.length().toInt()
  }

  /** Gives up on this segment and deletes its file. */
  fun abort() {
    release()
    File(path).delete()
  }

  private fun presentationUs(): Long = samplesQueued * 1_000_000L / sampleRate

  private fun drain(endOfStream: Boolean) {
    var idle = 0
    while (true) {
      val index = codec.dequeueOutputBuffer(info, if (endOfStream) TIMEOUT_US else 0L)
      when {
        index == MediaCodec.INFO_TRY_AGAIN_LATER -> {
          if (!endOfStream || ++idle > MAX_ATTEMPTS) return
        }
        index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
          if (!muxing) {
            track = muxer.addTrack(codec.outputFormat)
            muxer.start()
            muxing = true
          }
        }
        index >= 0 -> {
          val data = codec.getOutputBuffer(index)
          val isConfig = (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0
          if (data != null && !isConfig && info.size > 0 && muxing) {
            data.position(info.offset)
            data.limit(info.offset + info.size)
            muxer.writeSampleData(track, data, info)
            wroteSamples = true
          }
          codec.releaseOutputBuffer(index, false)
          if ((info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) return
        }
      }
    }
  }

  private fun release() {
    if (released) return
    released = true
    try {
      codec.stop()
    } catch (ignored: Exception) {
      // Already stopped or in an error state; release() below frees it either way.
    }
    codec.release()
    if (muxing) {
      try {
        muxer.stop()
      } catch (ignored: Exception) {
        // stop() throws when no samples were written; the file is deleted in that case.
      }
    }
    muxer.release()
  }

  private companion object {
    const val TIMEOUT_US = 10_000L
    const val MAX_ATTEMPTS = 500 // about 5 seconds of 10 ms waits
    const val MAX_INPUT_BYTES = 16_384
  }
}
