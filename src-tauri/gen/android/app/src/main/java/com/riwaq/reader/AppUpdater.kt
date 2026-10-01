package com.riwaq.reader

import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Build
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * In-app updates for sideloaded installs. Every member called from Rust over
 * JNI is @JvmStatic and kept by `-keep class com.riwaq.reader.AppUpdater { *; }`
 * in proguard-rules.pro — R8 sees no bytecode caller for any of them.
 *
 * The download lives here, in plain Kotlin on its own thread, kept alive by
 * [UpdateService] — not in the WebView, so it survives the app being swiped
 * away. Everything sits in cacheDir/updates/: the APK (`riwaq-<v>.apk`, or
 * `.apk.part` while it downloads) and `state.json`, the status the UI polls.
 * Never more than one pending APK.
 */
object AppUpdater {
    @JvmStatic
    fun installSource(ctx: Context): String {
        val pm = ctx.packageManager
        // Two different answers, kept apart on purpose:
        //  - the lookup returns null: nobody recorded an installer (a tapped
        //    APK on some ROMs, adb). That is a sideload, so "" -> in-app.
        //  - the lookup THROWS: we do not know who installed us. Not caught
        //    here: the exception crosses JNI, Rust drains it into an Err, and
        //    JS treats a failed install_source as null -> the "manual" channel
        //    (the release-page link). Guessing "in-app" could fight a store.
        val installer = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            pm.getInstallSourceInfo(ctx.packageName).installingPackageName
        } else {
            @Suppress("DEPRECATION") pm.getInstallerPackageName(ctx.packageName)
        } ?: ""
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

    private const val DIR = "updates"
    private const val STATE = "state.json"

    /** Guards state.json and the fields below. One explicit object, not
     *  @Synchronized: on an `object`, @Synchronized locks the class for a
     *  @JvmStatic method but INSTANCE for any other, so the two would not
     *  exclude each other. Reentrant, like any monitor. */
    private val lock = Any()

    /** The one download in flight, if any. */
    @Volatile private var worker: Thread? = null
    /** Set by [cancel]; the worker checks it between chunks and before every
     *  state write, so a cancelled download never writes "downloading" back
     *  over the "idle" that cancel left. */
    @Volatile private var cancelled = false
    /** A "wait for Wi-Fi" request parked with ConnectivityManager. */
    @Volatile private var netCallback: ConnectivityManager.NetworkCallback? = null

    private fun dir(ctx: Context) = File(ctx.cacheDir, DIR).apply { mkdirs() }
    private fun stateFile(ctx: Context) = File(dir(ctx), STATE)
    private fun cm(ctx: Context) =
        ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

    /** Persisted so a swiped-away app, or a process the system killed, still
     *  finds "ready" on next launch. The worker thread and UI calls both write
     *  it, so writes (and reads) hold [lock], and a write is a
     *  temp file renamed into place: a reader never sees half a file. */
    private fun write(ctx: Context, o: JSONObject): Unit = synchronized(lock) {
        val tmp = File(dir(ctx), "$STATE.tmp")
        tmp.writeText(o.toString())
        if (!tmp.renameTo(stateFile(ctx))) stateFile(ctx).writeText(o.toString())
    }

    /** [write], unless the download was cancelled meanwhile. */
    private fun writeLive(ctx: Context, o: JSONObject): Boolean = synchronized(lock) {
        if (cancelled) return false
        write(ctx, o)
        true
    }

    private fun read(ctx: Context): JSONObject = synchronized(lock) {
        try { JSONObject(stateFile(ctx).readText()) } catch (_: Exception) { JSONObject().put("state", "idle") }
    }

    /** `{"state", "version", "bytes", "total", "error"}` — parsed by
     *  parseNativeStatus() in src/store/updateFlow.ts. */
    @JvmStatic
    fun status(ctx: Context): String = synchronized(lock) {
        val app = ctx.applicationContext
        val o = read(app)
        // The process died mid-download (or while parked for Wi-Fi): the file
        // still says "downloading" but nothing is. Report it as an
        // interrupted download, so the UI offers a retry, which resumes.
        val state = o.optString("state")
        val stale = (state == "downloading" || state == "verifying") && worker?.isAlive != true ||
            state == "waiting" && netCallback == null
        if (stale) {
            o.put("state", "failed").put("error", "offline")
            write(app, o)
        }
        if (!o.has("error")) o.put("error", JSONObject.NULL)
        o.toString()
    }

    @JvmStatic
    fun isMetered(ctx: Context): Boolean = cm(ctx).isActiveNetworkMetered

    /** Download (resuming any `.part` left for the same version) and verify
     *  `url`. Ignored while a download is already running. */
    @JvmStatic
    fun start(ctx: Context, version: String, url: String, sha256: String, size: Long, waitForUnmetered: Boolean): Unit =
        synchronized(lock) { startLocked(ctx, version, url, sha256, size, waitForUnmetered) }

    private fun startLocked(ctx: Context, version: String, url: String, sha256: String, size: Long, waitForUnmetered: Boolean) {
        if (worker?.isAlive == true) return
        val app = ctx.applicationContext
        // A fresh request replaces a parked "wait for Wi-Fi" one (e.g. the
        // user chose to download on mobile data after all).
        unpark(app)
        val job = JSONObject().put("version", version).put("url", url).put("sha256", sha256)
            .put("total", size).put("bytes", File(dir(app), "riwaq-$version.apk.part").length())
            .put("error", JSONObject.NULL)
        cancelled = false
        if (waitForUnmetered && isMetered(app)) {
            write(app, job.put("state", "waiting"))
            val req = NetworkRequest.Builder()
                .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .addCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED).build()
            val cb = object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) {
                    if (netCallback !== this) return
                    start(app, version, url, sha256, size, false)
                }
            }
            netCallback = cb
            cm(app).registerNetworkCallback(req, cb)
            return
        }
        write(app, job.put("state", "downloading"))
        try {
            UpdateService.start(app)
        } catch (_: Exception) {
            // Android 12+ refuses a foreground service started from the
            // background (the Wi-Fi callback can fire there). Download anyway;
            // it just is not protected from the process being reclaimed.
        }
        worker = Thread({ run(app, job) }, "riwaq-update").apply { start() }
    }

    private fun unpark(ctx: Context): Unit = synchronized(lock) {
        netCallback?.let {
            netCallback = null
            try { cm(ctx).unregisterNetworkCallback(it) } catch (_: Exception) { /* already gone */ }
        }
    }

    /** Stop any download or Wi-Fi wait and drop every cached file. */
    @JvmStatic
    fun cancel(ctx: Context) {
        val app = ctx.applicationContext
        synchronized(lock) {
            cancelled = true
            unpark(app)
            dir(app).listFiles()?.forEach { it.delete() }
            write(app, JSONObject().put("state", "idle"))
        }
        UpdateService.stop(app)
    }

    private fun fail(ctx: Context, job: JSONObject, error: String) {
        writeLive(ctx, job.put("state", "failed").put("error", error))
        UpdateService.stop(ctx)
    }

    private fun run(ctx: Context, job: JSONObject) {
        try {
            download(ctx, job)
        } catch (e: Exception) {
            // Anything unforeseen (a SecurityException, a full disk on
            // rename) must end as a reported failure, not a dead thread with
            // the status stuck on "downloading".
            fail(ctx, job, if (e is IOException) "offline" else "storage")
        }
    }

    private fun download(ctx: Context, job: JSONObject) {
        val version = job.getString("version")
        val d = dir(ctx)
        val part = File(d, "riwaq-$version.apk.part")
        val apk = File(d, "riwaq-$version.apk")
        // Never more than one pending APK: anything for another version goes.
        d.listFiles()?.forEach {
            if (it != part && it != apk && !it.name.startsWith(STATE)) it.delete()
        }
        // Asked again for a version already downloaded: re-verify that copy
        // rather than fetch it a second time.
        if (apk.exists() && !apk.renameTo(part)) apk.delete()
        val total = job.getLong("total")
        if (d.usableSpace < total - part.length() + 5L * 1024 * 1024) return fail(ctx, job, "storage")
        if (total <= 0 || part.length() < total) {
            try {
                fetch(ctx, job, part, total)
            } catch (_: IOException) {
                return fail(ctx, job.put("bytes", part.length()), "offline")
            }
            if (cancelled) return
            // A short body (connection closed early without an exception) is
            // an interrupted download, not a checksum failure: keep the .part
            // so the retry resumes.
            if (total > 0 && part.length() < total) return fail(ctx, job.put("bytes", part.length()), "offline")
        }
        if (!writeLive(ctx, job.put("state", "verifying").put("bytes", part.length()))) return
        if (!sha256(part).equals(job.getString("sha256"), ignoreCase = true)) {
            part.delete()
            return fail(ctx, job.put("bytes", 0L), "checksum")
        }
        if (!sameAppNewerAndSameSigner(ctx, part)) {
            part.delete()
            return fail(ctx, job.put("bytes", 0L), "signature")
        }
        if (!part.renameTo(apk)) return fail(ctx, job, "storage")
        if (!writeLive(ctx, job.put("state", "ready").put("error", JSONObject.NULL))) {
            apk.delete()
            return
        }
        UpdateService.stop(ctx)
    }

    private fun fetch(ctx: Context, job: JSONObject, part: File, total: Long) {
        val version = job.getString("version")
        // Re-request the GitHub URL on every attempt: its redirect target is a
        // signed URL that expires after about an hour. GitHub redirects
        // https -> https, which HttpURLConnection follows.
        val conn = URL(job.getString("url")).openConnection() as HttpURLConnection
        try {
            conn.instanceFollowRedirects = true
            conn.connectTimeout = 15_000
            conn.readTimeout = 30_000
            if (part.length() > 0) conn.setRequestProperty("Range", "bytes=${part.length()}-")
            val code = conn.responseCode
            if (code != 200 && code != 206) throw IOException("HTTP $code")
            // 206: the server honoured the Range, append. 200: it sent the
            // whole file, start the .part over.
            val append = code == 206
            var bytes = if (append) part.length() else 0L
            var lastWrite = 0L
            FileOutputStream(part, append).use { out ->
                conn.inputStream.use { inp ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        if (cancelled) return
                        val n = inp.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                        bytes += n
                        val now = System.currentTimeMillis()
                        if (now - lastWrite > 250) {
                            lastWrite = now
                            if (!writeLive(ctx, job.put("state", "downloading").put("bytes", bytes))) return
                            UpdateService.progress(ctx, version, bytes, total)
                        }
                    }
                }
            }
        } finally {
            conn.disconnect()
        }
    }

    private fun sha256(f: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        f.inputStream().use { s ->
            val b = ByteArray(64 * 1024)
            while (true) {
                val n = s.read(b)
                if (n < 0) break
                md.update(b, 0, n)
            }
        }
        return md.digest().joinToString("") { "%02x".format(it) }
    }

    /** Android refuses a different signer anyway; checking first turns its
     *  opaque "App not installed" into an explained failure. */
    private fun sameAppNewerAndSameSigner(ctx: Context, f: File): Boolean {
        val pm = ctx.packageManager
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                val flags = PackageManager.GET_SIGNING_CERTIFICATES
                val archive = pm.getPackageArchiveInfo(f.path, flags) ?: return false
                val mine = pm.getPackageInfo(ctx.packageName, flags)
                val theirs = archive.signingInfo?.apkContentsSigners?.map { it.toCharsString() }?.toSet()
                val ours = mine.signingInfo?.apkContentsSigners?.map { it.toCharsString() }?.toSet()
                archive.packageName == ctx.packageName &&
                    archive.longVersionCode > mine.longVersionCode &&
                    !theirs.isNullOrEmpty() && theirs == ours
            } else {
                @Suppress("DEPRECATION") val flags = PackageManager.GET_SIGNATURES
                @Suppress("DEPRECATION") val archive = pm.getPackageArchiveInfo(f.path, flags) ?: return false
                @Suppress("DEPRECATION") val mine = pm.getPackageInfo(ctx.packageName, flags)
                @Suppress("DEPRECATION") val theirs = archive.signatures?.map { it.toCharsString() }?.toSet()
                @Suppress("DEPRECATION") val ours = mine.signatures?.map { it.toCharsString() }?.toSet()
                @Suppress("DEPRECATION")
                archive.packageName == ctx.packageName && archive.versionCode > mine.versionCode &&
                    !theirs.isNullOrEmpty() && theirs == ours
            }
        } catch (_: Exception) {
            false
        }
    }

    /** versionCode() in src/store/updateFlow.ts: major*1e6 + minor*1e3 + patch,
     *  -1 for anything else. */
    private fun code(v: String): Long =
        Regex("""^(\d+)\.(\d+)\.(\d+)$""").find(v)?.destructured?.let { (a, b, c) ->
            a.toLong() * 1_000_000 + b.toLong() * 1_000 + c.toLong()
        } ?: -1

    /** Mirrors cleanupDecision() in src/store/updateFlow.ts, which is the
     *  tested specification: once the running version is at or past the
     *  cached one — whoever did the update (us, Orion, Obtainium, F-Droid,
     *  adb) — every cached file goes. No cached version: keep.
     *  Off the main thread: never delay first paint. */
    @JvmStatic
    fun cleanupAsync(ctx: Context) {
        val app = ctx.applicationContext
        Thread({
            try {
                val cached = read(app).optString("version", "")
                val running = try {
                    app.packageManager.getPackageInfo(app.packageName, 0).versionName ?: ""
                } catch (_: Exception) {
                    ""
                }
                if (cached.isNotEmpty() && code(running) >= code(cached)) {
                    synchronized(lock) {
                        if (worker?.isAlive != true) dir(app).listFiles()?.forEach { it.delete() }
                    }
                }
            } catch (_: Exception) {
                // Housekeeping only; a failure here costs some cache space.
            }
        }, "riwaq-update-cleanup").start()
    }
}
