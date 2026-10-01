package com.riwaq.reader

import android.app.Notification
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/**
 * Foreground service that keeps the process alive while AppUpdater downloads
 * an update APK. Same shape as [TaskService], with two differences:
 *
 *  - It owns notification id [NOTIF_ID] (1003). 1001/1002 belong to the book
 *    download notifier, and an app update must not overwrite — or be cleared
 *    by — a chapter download's progress.
 *  - It does NOT stop in [onTaskRemoved]. TaskService exists to keep the
 *    WebView's JS loop fed and is pointless once the task is gone; this
 *    download is plain Kotlin on its own thread and needs no WebView, so
 *    swiping the app away should not abort it.
 *
 * AppUpdater starts it when a download begins and stops it on every terminal
 * state (ready, failed, cancelled).
 */
class UpdateService : Service() {
    private var wakeLock: PowerManager.WakeLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        DownloadNotifier.ensureChannelPublic(this)
        startInForeground(NOTIF_ID, build(this, "Downloading Riwaq update", 0, true))
        acquireWakeLock()
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        releaseWakeLock()
        stopForeground(STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }

    private fun startInForeground(id: Int, notification: Notification) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(id, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(id, notification)
        }
    }

    private fun acquireWakeLock() {
        if (wakeLock?.isHeld == true) return
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "riwaq:update").apply {
            setReferenceCounted(false)
            acquire(30 * 60 * 1000L) // 30-min safety cap, as TaskService
        }
    }

    private fun releaseWakeLock() {
        wakeLock?.let { if (it.isHeld) it.release() }
        wakeLock = null
    }

    companion object {
        const val NOTIF_ID = 1003

        private fun build(ctx: Context, title: String, pct: Int, indeterminate: Boolean): Notification =
            NotificationCompat.Builder(ctx, TaskService.CHANNEL_ID)
                .setContentTitle(title)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setProgress(100, pct, indeterminate)
                .build()

        @JvmStatic
        fun start(ctx: Context) {
            val intent = Intent(ctx, UpdateService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ctx.startForegroundService(intent)
            } else {
                ctx.startService(intent)
            }
        }

        /** Safe to call when not running. Never routed through
         *  startForegroundService — see TaskService.stop. */
        @JvmStatic
        fun stop(ctx: Context) {
            ctx.stopService(Intent(ctx, UpdateService::class.java))
            DownloadNotifier.cancel(ctx, NOTIF_ID)
        }

        /** Determinate progress on the service's notification. */
        @JvmStatic
        fun progress(ctx: Context, version: String, bytes: Long, total: Long) {
            val pct = if (total > 0) ((bytes * 100) / total).toInt().coerceIn(0, 100) else 0
            DownloadNotifier.ensureChannelPublic(ctx)
            try {
                NotificationManagerCompat.from(ctx)
                    .notify(NOTIF_ID, build(ctx, "Downloading Riwaq $version", pct, total <= 0))
            } catch (_: SecurityException) {
                // POST_NOTIFICATIONS denied: the download carries on unseen.
            }
        }
    }
}
