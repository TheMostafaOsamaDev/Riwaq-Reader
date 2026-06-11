package com.leaflet.reader

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/**
 * Builds the in-progress / terminal download notification. Wraps
 * NotificationCompat.Builder + setProgress(max, progress, indeterminate)
 * for the real Android widget. Invoked from Rust over JNI; see
 * src-tauri/src/notify.rs.
 *
 * Channel id matches the existing TypeScript-side `leaflet-downloads`
 * channel so importance / vibration policy stays consistent.
 */
object DownloadNotifier {
    private const val CHANNEL_ID = "leaflet-downloads"
    private const val CHANNEL_NAME = "Downloads"
    private const val CHANNEL_DESC = "Chapter downloads and offline-book conversions"

    /** Static channel-ensure. Idempotent. */
    @JvmStatic
    private fun ensureChannel(ctx: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return
        val ch = NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_LOW).apply {
            description = CHANNEL_DESC
            enableLights(false)
            enableVibration(false)
            setShowBadge(false)
        }
        nm.createNotificationChannel(ch)
    }

    /**
     * Push or update a download-progress notification.
     *
     * @param ctx Application context (passed in from Rust via JNI).
     * @param id Stable notification id; reuse to update in place.
     * @param title Notification title (e.g., "Downloading Re:Zero — Ch. 234").
     * @param body Notification body (e.g., "Chapter 5 of 23").
     * @param progress 0..max current value.
     * @param max Progress widget maximum (typically 100 or queue total).
     * @param indeterminate If true, the bar shows the looping animation
     *   instead of a fixed value. Use when burst total isn't known yet.
     * @param ongoing If true, marks the notification as background work
     *   (suppresses heads-up + can't be swiped away).
     * @param tapsToQueue If true, attaches a PendingIntent that opens
     *   MainActivity with extra `leaflet.open=queue`. If false, no tap
     *   intent (notification is informational).
     */
    @JvmStatic
    fun update(
        ctx: Context,
        id: Int,
        title: String,
        body: String,
        progress: Int,
        max: Int,
        indeterminate: Boolean,
        ongoing: Boolean,
        tapsToQueue: Boolean,
    ) {
        ensureChannel(ctx)

        val builder = NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(body)
            // Re-use the launcher icon as the small icon. The mipmap
            // `ic_launcher` is what every Tauri 2 Android app ships
            // with; replace later with a dedicated monochrome icon.
            .setSmallIcon(R.mipmap.ic_launcher)
            .setOnlyAlertOnce(true)
            .setOngoing(ongoing)
            .setProgress(max, progress, indeterminate)
            .setPriority(NotificationCompat.PRIORITY_LOW)

        if (tapsToQueue) {
            val intent = Intent(ctx, MainActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                putExtra("leaflet.open", "queue")
            }
            // API 31+ requires FLAG_IMMUTABLE on PendingIntents.
            val piFlags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            val pi = PendingIntent.getActivity(ctx, id, intent, piFlags)
            builder.setContentIntent(pi)
        }

        NotificationManagerCompat.from(ctx).notify(id, builder.build())
    }

    /** Cancel the notification with the given id. */
    @JvmStatic
    fun cancel(ctx: Context, id: Int) {
        NotificationManagerCompat.from(ctx).cancel(id)
    }
}
