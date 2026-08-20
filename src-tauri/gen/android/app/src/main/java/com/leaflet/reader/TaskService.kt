package com.leaflet.reader

import android.app.Notification
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat

/**
 * Foreground service that keeps the app process — and therefore the
 * WebView JS loop that runs downloads/imports/conversions — alive while
 * background-eligible work is in flight. It owns notification id
 * [NOTIF_ID], the same id DownloadNotifier.update() writes to, so
 * progress flows through unchanged and no duplicate notification appears.
 *
 * Lifecycle is driven from JS via Rust (notify.rs). We intentionally do
 * NOT survive swipe-away (START_NOT_STICKY, no swipe-away handling).
 */
class TaskService : Service() {
    private var wakeLock: PowerManager.WakeLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            releaseWakeLock()
            // REMOVE, not DETACH: the terminal "all done" summary is a
            // separate notification id (1002), so removing 1001 here just
            // clears the stale progress bar.
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }
        DownloadNotifier.ensureChannelPublic(this)
        startInForeground(NOTIF_ID, buildPlaceholderNotification())
        acquireWakeLock()
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        releaseWakeLock()
        super.onDestroy()
    }

    private fun startInForeground(id: Int, notification: Notification) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(id, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(id, notification)
        }
    }

    private fun buildPlaceholderNotification(): Notification =
        NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("…")
            .setSmallIcon(R.mipmap.ic_launcher)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()

    private fun acquireWakeLock() {
        if (wakeLock?.isHeld == true) return
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "leaflet:tasks").apply {
            setReferenceCounted(false)
            acquire(30 * 60 * 1000L) // 30-min safety cap
        }
    }

    private fun releaseWakeLock() {
        wakeLock?.let { if (it.isHeld) it.release() }
        wakeLock = null
    }

    companion object {
        const val CHANNEL_ID = "leaflet-downloads"
        const val NOTIF_ID = 1001
        const val ACTION_STOP = "com.leaflet.reader.action.STOP_TASKS"

        @JvmStatic
        fun start(ctx: Context) {
            val intent = Intent(ctx, TaskService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ctx.startForegroundService(intent)
            } else {
                ctx.startService(intent)
            }
        }

        @JvmStatic
        fun stop(ctx: Context) {
            val intent = Intent(ctx, TaskService::class.java).apply { action = ACTION_STOP }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ctx.startForegroundService(intent)
            } else {
                ctx.startService(intent)
            }
        }
    }
}
