package app.nightwatch.recordingservice

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.SystemClock
import java.util.Random
import kotlin.math.max
import kotlin.math.min

/**
 * Sleep sounds: white, pink or brown noise generated live (so there is no loop and no seam),
 * played through the media stream. Fades in, then fades out over the last part of the timer and
 * stops by itself. Runs on its own thread; the recording service keeps the process alive.
 */
internal class NoisePlayer {
  @Volatile private var running = false
  @Volatile private var stopAtMs = 0L
  private var thread: Thread? = null

  val isPlaying: Boolean
    get() = running

  fun start(color: String, gain: Float, durationMs: Long, fadeOutMs: Long) {
    stop()
    running = true
    val startedAt = SystemClock.elapsedRealtime()
    stopAtMs = startedAt + max(0L, durationMs)
    thread = Thread({ play(color, gain.coerceIn(0f, 1f), startedAt, max(1L, fadeOutMs)) }, "NightwatchNoise").apply {
      isDaemon = true
      start()
    }
  }

  /** Ramps down over one buffer and stops; waits briefly for the thread to finish. */
  fun stop() {
    val t = thread ?: return
    running = false
    t.join(1500)
    thread = null
  }

  private fun play(color: String, gain: Float, startedAt: Long, fadeOutMs: Long) {
    val minBuffer = AudioTrack.getMinBufferSize(RATE, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)
    val track = AudioTrack.Builder()
      .setAudioAttributes(
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_MEDIA)
          .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
          .build(),
      )
      .setAudioFormat(
        AudioFormat.Builder()
          .setSampleRate(RATE)
          .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
          .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
          .build(),
      )
      .setBufferSizeInBytes(max(minBuffer, RATE)) // about half a second
      .setTransferMode(AudioTrack.MODE_STREAM)
      .build()
    val noise = NoiseSource(color)
    val chunk = ShortArray(RATE / 20) // 50 ms
    var lastGain = 0f
    try {
      track.play()
      while (true) {
        val now = SystemClock.elapsedRealtime()
        val remaining = stopAtMs - now
        val fadeIn = min(1f, (now - startedAt) / FADE_IN_MS.toFloat())
        val fadeOut = if (remaining < fadeOutMs) max(0f, remaining / fadeOutMs.toFloat()) else 1f
        val target = if (running) gain * fadeIn * fadeOut else 0f
        noise.fill(chunk, lastGain, target)
        track.write(chunk, 0, chunk.size) // blocks while the buffer is full, which paces the loop
        lastGain = target
        if (remaining <= 0 || !running) break
      }
    } finally {
      try {
        track.stop()
      } catch (ignored: IllegalStateException) {
        // Never started; release() below still frees it.
      }
      track.release()
      running = false
    }
  }

  private companion object {
    const val RATE = 22_050
    const val FADE_IN_MS = 3_000L
  }
}

/** White, pink (Paul Kellet's filter) or brown (leaky integrator) noise in about [-1, 1]. */
internal class NoiseSource(private val color: String) {
  private val random = Random()
  private var b0 = 0f
  private var b1 = 0f
  private var b2 = 0f
  private var b3 = 0f
  private var b4 = 0f
  private var b5 = 0f
  private var b6 = 0f
  private var brown = 0f

  /** Fills `out` with noise, the gain moving smoothly from `fromGain` to `toGain` (no clicks). */
  fun fill(out: ShortArray, fromGain: Float, toGain: Float) {
    val n = out.size
    for (i in 0 until n) {
      val white = random.nextFloat() * 2f - 1f
      val sample = when (color) {
        "pink" -> pink(white)
        "brown" -> brown(white)
        else -> white * 0.5f
      }
      val g = fromGain + (toGain - fromGain) * (i.toFloat() / n)
      out[i] = (sample * g * 32767f).coerceIn(-32768f, 32767f).toInt().toShort()
    }
  }

  private fun pink(white: Float): Float {
    b0 = 0.99886f * b0 + white * 0.0555179f
    b1 = 0.99332f * b1 + white * 0.0750759f
    b2 = 0.96900f * b2 + white * 0.1538520f
    b3 = 0.86650f * b3 + white * 0.3104856f
    b4 = 0.55000f * b4 + white * 0.5329522f
    b5 = -0.7616f * b5 - white * 0.0168980f
    val pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362f
    b6 = white * 0.115926f
    return pink * 0.11f
  }

  private fun brown(white: Float): Float {
    brown = (brown + 0.02f * white) / 1.02f
    return brown * 3.5f
  }
}
