package app.nightwatch.recordingservice

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat

private const val TAG = "NightwatchRecording"

/**
 * Keeps the app process allowed to use the microphone while the screen is off.
 *
 * Android only lets a backgrounded app read the microphone if it is running a foreground
 * service of type "microphone" that was started while the app was visible. The audio itself
 * is captured by expo-audio's AudioStream in the same process; this service only holds the
 * foreground state, the ongoing notification and a partial wake lock.
 */
class RecordingForegroundService : Service() {
  private var wakeLock: PowerManager.WakeLock? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val title = intent?.getStringExtra(EXTRA_TITLE) ?: "Recording your night"
    val body = intent?.getStringExtra(EXTRA_BODY) ?: "Listening for snoring. Audio stays on this phone."

    createChannelIfNeeded()
    try {
      ServiceCompat.startForeground(
        this,
        NOTIFICATION_ID,
        buildNotification(title, body),
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE else 0
      )
    } catch (e: Exception) {
      // Android 14+ refuses if the app is not visible or RECORD_AUDIO is not granted.
      Log.e(TAG, "Could not start the foreground service", e)
      isRunning = false
      stopSelf()
      return START_NOT_STICKY
    }

    acquireWakeLock()
    isRunning = true
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    releaseWakeLock()
    isRunning = false
    super.onDestroy()
  }

  private fun acquireWakeLock() {
    if (wakeLock?.isHeld == true) return
    val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
    wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "nightwatch:recording").apply {
      setReferenceCounted(false)
      // A night is never longer than this; the timeout guards against a leaked lock.
      acquire(MAX_RECORDING_MS)
    }
  }

  private fun releaseWakeLock() {
    wakeLock?.let { if (it.isHeld) it.release() }
    wakeLock = null
  }

  private fun createChannelIfNeeded() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return
    val channel = NotificationChannel(CHANNEL_ID, "Overnight recording", NotificationManager.IMPORTANCE_LOW).apply {
      description = "Shown while Nightwatch is recording your night"
      setShowBadge(false)
      enableVibration(false)
      enableLights(false)
      setSound(null, null)
    }
    manager.createNotificationChannel(channel)
  }

  private fun buildNotification(title: String, body: String): Notification {
    val contentIntent = packageManager.getLaunchIntentForPackage(packageName)?.let {
      PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle(title)
      .setContentText(body)
      .setSmallIcon(android.R.drawable.ic_btn_speak_now)
      .setOngoing(true)
      .setSilent(true)
      .setShowWhen(false)
      .setContentIntent(contentIntent)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .build()
  }

  companion object {
    const val EXTRA_TITLE = "title"
    const val EXTRA_BODY = "body"
    private const val CHANNEL_ID = "nightwatch_recording"
    private const val NOTIFICATION_ID = 4101
    private const val MAX_RECORDING_MS = 14L * 60 * 60 * 1000

    @Volatile
    var isRunning = false
      private set
  }
}
