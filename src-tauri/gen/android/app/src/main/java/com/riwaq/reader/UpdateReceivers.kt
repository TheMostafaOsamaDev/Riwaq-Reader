package com.riwaq.reader

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import androidx.core.app.NotificationCompat

/** The PackageInstaller session's status callback (see AppUpdater.install).
 *  Kept in release builds by its manifest entry, like every component. */
class InstallResultReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val session = intent.getIntExtra(PackageInstaller.EXTRA_SESSION_ID, -1)
        when (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, -999)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                // Android's own "Do you want to update this app?" dialog. The
                // app is in the foreground (the user just tapped Install), so
                // starting it from here is allowed.
                val confirm = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
                } else {
                    @Suppress("DEPRECATION") intent.getParcelableExtra(Intent.EXTRA_INTENT)
                }
                if (confirm == null) {
                    AppUpdater.onInstallResult(ctx, session, ok = false, aborted = false)
                    return
                }
                try {
                    ctx.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                } catch (_: Exception) {
                    AppUpdater.onInstallResult(ctx, session, ok = false, aborted = false)
                }
            }
            PackageInstaller.STATUS_SUCCESS -> AppUpdater.onInstallResult(ctx, session, ok = true, aborted = false)
            PackageInstaller.STATUS_FAILURE_ABORTED -> AppUpdater.onInstallResult(ctx, session, ok = false, aborted = true)
            else -> AppUpdater.onInstallResult(ctx, session, ok = false, aborted = false)
        }
    }
}

/** Android kills the app to replace it and never relaunches it; background
 *  activity starts are blocked on 10+. So: one notification to reopen. Fires
 *  after ANY update of Riwaq (ours or a store's), which is fine — it says
 *  what is true. It also frees the update's storage at once: the running
 *  version is now at or past the cached one, so AppUpdater.cleanupAsync
 *  deletes cacheDir/updates/ and abandons any leftover install session.
 *  goAsync keeps this process alive until that cleanup has finished. */
class PackageReplacedReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        val pending = goAsync()
        AppUpdater.cleanupAsync(ctx) { pending.finish() }
        try {
            val version = ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName ?: ""
            val open = PendingIntent.getActivity(
                ctx,
                0,
                Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            DownloadNotifier.ensureChannelPublic(ctx)
            val n = NotificationCompat.Builder(ctx, TaskService.CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(ctx.getString(R.string.update_installed_title, version))
                .setContentText(ctx.getString(R.string.update_installed_body))
                .setContentIntent(open)
                .setAutoCancel(true)
                .build()
            (ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(NOTIF_ID, n)
        } catch (_: Exception) {
            // POST_NOTIFICATIONS denied, or no package info: nothing to show.
        }
    }

    companion object {
        /** 1001/1002: book downloads; 1003: UpdateService. */
        const val NOTIF_ID = 1004
    }
}
