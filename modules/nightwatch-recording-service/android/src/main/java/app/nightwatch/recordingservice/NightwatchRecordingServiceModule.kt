package app.nightwatch.recordingservice

import android.content.Intent
import androidx.core.content.ContextCompat
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class NightwatchRecordingServiceModule : Module() {
  private val context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

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
  }
}
