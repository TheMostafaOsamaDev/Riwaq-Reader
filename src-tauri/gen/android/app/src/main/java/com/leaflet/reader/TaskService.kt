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
 * Lifecycle is driven from JS via Rust (notify.rs). On task removal
 * (the user swipes the app away) the WebView/JS engine that this service
 * exists to keep fed is gone, so [onTaskRemoved] stops the service
 * itself rather than lingering as a zombie holding a wake lock and a
 * stale notification. START_NOT_STICKY additionally means the system
 * won't pointlessly restart us after a memory-kill with no work to do.
 */
class TaskService : Service() {
    private var wakeLock: PowerManager.WakeLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        DownloadNotifier.ensureChannelPublic(this)
        startInForeground(NOTIF_ID, buildPlaceholderNotification())
        acquireWakeLock()
        return START_NOT_STICKY
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        super.onTaskRemoved(rootIntent)
        // The app's WebView/JS engine dies with the task, so there is no
        // more work for this service to keep alive for. Stop cleanly
        // instead of lingering as a zombie foreground service.
        stopSelf()
    }

    override fun onDestroy() {
        releaseWakeLock()
        // REMOVE, not DETACH: the terminal "all done" summary is a
        // separate notification id (1002), so removing 1001 here just
        // clears the stale progress bar. Runs on every teardown path
        // (stopService and task removal), so the notification never
        // outlives the service.
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
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "riwaq:tasks").apply {
            setReferenceCounted(false)
            acquire(30 * 60 * 1000L) // 30-min safety cap
        }
    }

    private fun releaseWakeLock() {
        wakeLock?.let { if (it.isHeld) it.release() }
        wakeLock = null
    }

    companion object {
        const val CHANNEL_ID = "riwaq-downloads"
        const val NOTIF_ID = 1001

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
            // stopService on a non-running service is a safe no-op, so
            // this is fine to call defensively (double-stop, or a stop
            // issued when no start ever happened). Never route a stop
            // through startForegroundService: if the service isn't
            // already running, Android would spin up a fresh instance
            // that must call startForeground() within the platform's
            // time limit — and onStartCommand has no such call for a
            // stop request, which throws
            // ForegroundServiceDidNotStartInTimeException on API 26+.
            ctx.stopService(Intent(ctx, TaskService::class.java))
            // Defensive fallback: if the stop is dropped or onDestroy's
            // teardown gets interrupted before stopForeground() runs,
            // this ensures the ongoing "Downloading…" notification can't
            // strand itself indefinitely.
            DownloadNotifier.cancel(ctx, NOTIF_ID)
        }
    }
}
