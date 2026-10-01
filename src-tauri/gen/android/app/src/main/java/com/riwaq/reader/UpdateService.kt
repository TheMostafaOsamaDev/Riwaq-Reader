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
 *
 * Start/stop handshake. `startForegroundService` obliges the service to call
 * `startForeground` within seconds, and that only happens later, in
 * [onStartCommand] on the main thread. A `stopService` in between (a download
 * that fails at once: offline, no space, a re-verified copy) destroys the
 * service before it ever went foreground, and Android kills the app with
 * "Context.startForegroundService() did not then call
 * Service.startForeground()". So [stop] only calls `stopService` once the
 * service has confirmed foreground ([Phase.FOREGROUND]); while it is still
 * [Phase.STARTING] it records [stopRequested], and [onStartCommand] — which
 * always calls `startForeground` first — then stops itself. [onStartCommand]
 * also stops itself when AppUpdater has no live download, which covers a
 * worker that finished before the service started. All of it under [lock].
 */
class UpdateService : Service() {
    private var wakeLock: PowerManager.WakeLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        DownloadNotifier.ensureChannelPublic(this)
        // Always first, unconditionally: this is what the platform demands of
        // every startForegroundService, even one we are about to stop.
        startInForeground(NOTIF_ID, build(this, "Downloading Riwaq update", 0, true))
        val keep = synchronized(lock) {
            if (stopRequested || !AppUpdater.isWorking()) {
                stopRequested = false
                phase = Phase.NONE
                false
            } else {
                phase = Phase.FOREGROUND
                true
            }
        }
        if (keep) {
            acquireWakeLock()
        } else {
            // startId, not stopSelf(): a start() that raced in after this
            // decision has a newer id, and keeps the service alive.
            stopSelf(startId)
        }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        // Also covers the system tearing a running service down.
        synchronized(lock) { if (phase == Phase.FOREGROUND) phase = Phase.NONE }
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

    private enum class Phase { NONE, STARTING, FOREGROUND }

    companion object {
        const val NOTIF_ID = 1003

        private val lock = Any()
        @Volatile private var phase = Phase.NONE
        @Volatile private var stopRequested = false

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
        fun start(ctx: Context): Unit = synchronized(lock) {
            stopRequested = false
            // Already starting or running: that instance serves this download
            // too (onStartCommand re-checks AppUpdater when it runs).
            if (phase != Phase.NONE) return
            val intent = Intent(ctx, UpdateService::class.java)
            phase = Phase.STARTING
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    ctx.startForegroundService(intent)
                } else {
                    ctx.startService(intent)
                }
            } catch (e: Exception) {
                phase = Phase.NONE
                throw e
            }
        }

        /** Safe to call in any phase, any number of times. Never routed
         *  through startForegroundService — see TaskService.stop — and never
         *  a stopService before the service went foreground (see the class
         *  comment). */
        @JvmStatic
        fun stop(ctx: Context): Unit = synchronized(lock) {
            when (phase) {
                Phase.STARTING -> stopRequested = true
                Phase.FOREGROUND -> {
                    phase = Phase.NONE
                    ctx.stopService(Intent(ctx, UpdateService::class.java))
                }
                Phase.NONE -> {}
            }
            // No progress is posted after this point (see progress), so
            // nothing can bring the ongoing notification back.
            DownloadNotifier.cancel(ctx, NOTIF_ID)
        }

        /** Determinate progress on the service's notification — only while the
         *  service is foreground. Under [lock], so it cannot land after a
         *  [stop] cleared the notification and leave an ongoing one behind. */
        @JvmStatic
        fun progress(ctx: Context, version: String, bytes: Long, total: Long): Unit = synchronized(lock) {
            if (phase != Phase.FOREGROUND) return
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
