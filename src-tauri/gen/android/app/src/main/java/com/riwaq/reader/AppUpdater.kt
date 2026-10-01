package com.riwaq.reader

import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import org.json.JSONObject

/**
 * In-app updates for sideloaded installs. Every member called from Rust over
 * JNI is @JvmStatic and kept by `-keep class com.riwaq.reader.AppUpdater { *; }`
 * in proguard-rules.pro — R8 sees no bytecode caller for any of them.
 */
object AppUpdater {
    @JvmStatic
    fun installSource(ctx: Context): String {
        val pm = ctx.packageManager
        val installer = try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                pm.getInstallSourceInfo(ctx.packageName).installingPackageName
            } else {
                @Suppress("DEPRECATION") pm.getInstallerPackageName(ctx.packageName)
            }
        } catch (_: Exception) { null } ?: ""
        var label = ""
        var installed = false
        if (installer.isNotEmpty()) {
            try {
                val ai = pm.getApplicationInfo(installer, 0)
                label = pm.getApplicationLabel(ai).toString()
                installed = pm.getLaunchIntentForPackage(installer) != null
            } catch (_: PackageManager.NameNotFoundException) { /* store uninstalled */ }
        }
        return JSONObject().put("installer", installer).put("label", label)
            .put("storeInstalled", installed).toString()
    }

    @JvmStatic
    fun openStore(activity: Activity, pkg: String) {
        activity.packageManager.getLaunchIntentForPackage(pkg)?.let { activity.startActivity(it) }
    }
}
