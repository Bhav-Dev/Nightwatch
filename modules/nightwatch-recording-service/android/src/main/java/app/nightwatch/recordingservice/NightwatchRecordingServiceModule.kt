package app.nightwatch.recordingservice

import android.app.AlarmManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.provider.AlarmClock
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

  private val noise = NoisePlayer()

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

    /** Sleep sounds: plays generated noise ("white", "pink", "brown") for durationS, fading out over the last fadeOutS. */
    Function("startNoise") { color: String, gain: Double, durationS: Double, fadeOutS: Double ->
      noise.start(color, gain.toFloat(), (durationS * 1000).toLong(), (fadeOutS * 1000).toLong())
    }

    AsyncFunction("stopNoise") {
      noise.stop()
    }

    Function("isNoisePlaying") {
      noise.isPlaying
    }

    /**
     * When the phone's next alarm rings (epoch milliseconds), whichever app set it, or null if none
     * is set. No permission needed: it is what the status bar's alarm icon shows.
     */
    Function("nextAlarmTime") {
      val alarms = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
      alarms.nextAlarmClock?.triggerTime?.toDouble()
    }

    /**
     * Adds a one-off alarm to the phone's own Clock app without opening it, so it rings whatever
     * happens to this app overnight. False when no Clock app accepts it.
     */
    Function("setClockAlarm") { hour: Int, minute: Int, label: String ->
      startClock(
        Intent(AlarmClock.ACTION_SET_ALARM).apply {
          putExtra(AlarmClock.EXTRA_HOUR, hour)
          putExtra(AlarmClock.EXTRA_MINUTES, minute)
          putExtra(AlarmClock.EXTRA_MESSAGE, label)
          putExtra(AlarmClock.EXTRA_SKIP_UI, true)
        },
      )
    }

    /** Opens the Clock app's list of alarms, to change one there. False when there is no Clock app. */
    Function("showClockAlarms") {
      startClock(Intent(AlarmClock.ACTION_SHOW_ALARMS))
    }

    OnDestroy {
      noise.stop()
      encoderThread.execute {
        segment?.abort()
        segment = null
      }
      encoderThread.shutdown()
    }
  }

  /** Starts a Clock app screen from the visible activity. False when no app handles it. */
  private fun startClock(intent: Intent): Boolean =
    try {
      val activity = appContext.currentActivity
      if (activity != null) {
        activity.startActivity(intent)
      } else {
        context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      }
      true
    } catch (e: ActivityNotFoundException) {
      Log.w(TAG, "No Clock app handles ${intent.action}", e)
      false
    } catch (e: SecurityException) {
      Log.w(TAG, "Not allowed to open the Clock app", e)
      false
    }

  private companion object {
    const val TAG = "NightwatchSound"
  }
}
