package app.nightwatch.recordingservice

import android.content.Intent
import android.util.Log
import androidx.core.content.ContextCompat
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.Callable
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class NightwatchRecordingServiceModule : Module() {
  private val context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  /** Every encoder call runs here, in the order JS made it, off the JS thread. */
  private val encoderThread: ExecutorService = Executors.newSingleThreadExecutor()

  /** The sound segment being written; only touched on encoderThread. */
  private var segment: AacSegmentWriter? = null

  override fun definition() = ModuleDefinition {
    Name("NightwatchRecordingService")

    /** Must be called while the app is visible (from the Start recording tap). */
    Function("start") { title: String, body: String ->
      val intent = Intent(context, RecordingForegroundService::class.java).apply {
        putExtra(RecordingForegroundService.EXTRA_TITLE, title)
        putExtra(RecordingForegroundService.EXTRA_BODY, body)
      }
      ContextCompat.startForegroundService(context, intent)
    }

    Function("stop") {
      context.stopService(Intent(context, RecordingForegroundService::class.java))
    }

    Function("isRunning") {
      RecordingForegroundService.isRunning
    }

    /** Starts a new AAC (.m4a) sound segment at a filesystem path. Returns at once; work is queued. */
    Function("beginSegment") { path: String, sampleRate: Int, bitrate: Int ->
      encoderThread.execute {
        segment?.abort()
        segment = try {
          AacSegmentWriter(path, sampleRate, bitrate)
        } catch (e: Exception) {
          Log.w(TAG, "Could not start a sound segment", e)
          null
        }
      }
    }

    /** Appends 16-bit little-endian mono PCM to the open segment. Returns at once; work is queued. */
    Function("appendPcm") { pcm: ByteArray ->
      encoderThread.execute {
        val writer = segment ?: return@execute
        try {
          writer.write(pcm)
        } catch (e: Exception) {
          Log.w(TAG, "Sound segment write failed; dropping it", e)
          writer.abort()
          segment = null
        }
      }
    }

    /** Closes the open segment once everything queued before it is encoded. Resolves its size in bytes (0 if none). */
    AsyncFunction("endSegment") {
      encoderThread.submit(
        Callable {
          val writer = segment
          segment = null
          try {
            writer?.finish() ?: 0
          } catch (e: Exception) {
            Log.w(TAG, "Could not finish a sound segment", e)
            writer?.abort()
            0
          }
        },
      ).get()
    }

    OnDestroy {
      encoderThread.execute {
        segment?.abort()
        segment = null
      }
      encoderThread.shutdown()
    }
  }

  private companion object {
    const val TAG = "NightwatchSound"
  }
}
