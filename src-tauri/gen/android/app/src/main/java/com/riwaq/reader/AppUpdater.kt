package com.riwaq.reader

import android.app.Activity
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.Uri
import android.os.Build
import android.provider.Settings
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

    /** Guards state.json, every file the worker touches, and the fields below.
     *  One explicit object, not @Synchronized: on an `object`, @Synchronized
     *  locks the class for a @JvmStatic method but INSTANCE for any other, so
     *  the two would not exclude each other. Reentrant, like any monitor.
     *  Lock order: AppUpdater.lock, then UpdateService's — never the reverse. */
    private val lock = Any()

    /** The thread running the newest download, if any. */
    @Volatile private var worker: Thread? = null
    /** The job the worker is allowed to act for. A worker holds its own job
     *  object and acts (writes state, touches files, posts progress, stops the
     *  service) only while `active === job`, checked under [lock]. [cancel]
     *  clears it; [start] replaces it. So a cancelled worker — even one still
     *  blocked in the network — can never write over a newer state, delete a
     *  newer download's file, or stop a newer download's service. */
    @Volatile private var active: JSONObject? = null
    /** The worker's open connection, so [cancel] can disconnect it and unblock
     *  a read instead of waiting out the timeout. */
    @Volatile private var conn: HttpURLConnection? = null
    /** A "wait for Wi-Fi" request parked with ConnectivityManager. */
    @Volatile private var netCallback: ConnectivityManager.NetworkCallback? = null

    private fun dir(ctx: Context) = File(ctx.cacheDir, DIR).apply { mkdirs() }
    private fun stateFile(ctx: Context) = File(dir(ctx), STATE)
    private fun apkFile(ctx: Context, version: String) = File(dir(ctx), "riwaq-$version.apk")
    private fun partFile(ctx: Context, version: String) = File(dir(ctx), "riwaq-$version.apk.part")
    private fun cm(ctx: Context) =
        ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

    /** A download is running for the current job. Volatile reads only, no
     *  lock: UpdateService calls this while holding its own lock. */
    internal fun isWorking(): Boolean = active != null && worker?.isAlive == true

    /** Persisted so a swiped-away app, or a process the system killed, still
     *  finds "ready" on next launch. The worker thread and UI calls both write
     *  it, so writes (and reads) hold [lock], and a write is a temp file
     *  renamed into place: a reader never sees half a file. */
    private fun write(ctx: Context, o: JSONObject): Unit = synchronized(lock) {
        val tmp = File(dir(ctx), "$STATE.tmp")
        tmp.writeText(o.toString())
        if (!tmp.renameTo(stateFile(ctx))) stateFile(ctx).writeText(o.toString())
    }

    /** Run [f] under [lock] only if [job] is still the active one. */
    private inline fun ifLive(job: JSONObject, f: () -> Unit): Boolean = synchronized(lock) {
        if (active !== job) return false
        f()
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
        var o = read(app)
        // "installing" with no session behind it: Android's answer never
        // reached us (the process died while its dialog was up). The verified
        // APK is still here, so offer Install again.
        if (o.optString("state") == "installing" && !sessionAlive(app, o.optInt("session", -1))) {
            o.remove("session")
            o.put("state", "ready")
            write(app, o)
        }
        val state = o.optString("state")
        // The process died mid-download (or while parked for Wi-Fi): the file
        // still says "downloading" but nothing is. Report it as an
        // interrupted download, so the UI offers a retry, which resumes.
        val stale = (state == "downloading" || state == "verifying") && !isWorking() ||
            state == "waiting" && netCallback == null
        if (stale) {
            o.put("state", "failed").put("error", "offline")
            write(app, o)
        }
        // The system may purge cacheDir under storage pressure. A "ready" whose
        // APK is gone would offer an Install that cannot work: start over.
        if (state == "ready" && !apkFile(app, o.optString("version")).exists()) {
            o = JSONObject().put("state", "idle")
            write(app, o)
        }
        if (!o.has("error")) o.put("error", JSONObject.NULL)
        o.toString()
    }

    @JvmStatic
    fun isMetered(ctx: Context): Boolean = cm(ctx).isActiveNetworkMetered

    /** Download (resuming any `.part` left for the same version) and verify
     *  `url`. Ignored while a download is already running; a worker that was
     *  cancelled does not count, so cancel-then-start starts at once. */
    @JvmStatic
    fun start(ctx: Context, version: String, url: String, sha256: String, size: Long, waitForUnmetered: Boolean): Unit =
        synchronized(lock) { startLocked(ctx, version, url, sha256, size, waitForUnmetered) }

    private fun startLocked(ctx: Context, version: String, url: String, sha256: String, size: Long, waitForUnmetered: Boolean) {
        if (isWorking()) return
        val app = ctx.applicationContext
        // A fresh request replaces a parked "wait for Wi-Fi" one (e.g. the
        // user chose to download on mobile data after all).
        unpark(app)
        // A new download supersedes whatever was being installed.
        abandonSessions(app, keep = -1)
        val job = JSONObject().put("version", version).put("url", url).put("sha256", sha256)
            .put("total", size).put("bytes", partFile(app, version).length())
            .put("error", JSONObject.NULL)
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
        active = job
        // Worker first, service second: UpdateService.onStartCommand stops
        // itself when it finds no live worker, so the worker must already be
        // alive by the time that can run.
        worker = Thread({ run(app, job) }, "riwaq-update").apply { start() }
        try {
            UpdateService.start(app)
        } catch (_: Exception) {
            // Android 12+ refuses a foreground service started from the
            // background (the Wi-Fi callback can fire there). Download anyway;
            // it just is not protected from the process being reclaimed.
        }
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
        val open: HttpURLConnection?
        synchronized(lock) {
            active = null
            open = conn
            conn = null
            unpark(app)
            abandonSessions(app, keep = -1)
            dir(app).listFiles()?.forEach { it.delete() }
            write(app, JSONObject().put("state", "idle"))
            UpdateService.stop(app)
        }
        // Unblock a worker parked in connect/read; it then finds itself
        // inactive and exits without touching anything.
        try { open?.disconnect() } catch (_: Exception) { /* closing anyway */ }
    }

    /** Terminal: record [state] and stop the service — only if [job] is still
     *  the active one; a superseded worker must not stop a newer download. */
    private fun finish(ctx: Context, job: JSONObject, state: String, error: String?) {
        ifLive(job) {
            write(ctx, job.put("state", state).put("error", error ?: JSONObject.NULL))
            active = null
            UpdateService.stop(ctx)
        }
    }

    private fun fail(ctx: Context, job: JSONObject, error: String) = finish(ctx, job, "failed", error)

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
        val part = partFile(ctx, version)
        val apk = apkFile(ctx, version)
        val total = job.getLong("total")
        var lowSpace = false
        // File work happens under the lock and only while live: a cancelled
        // worker shares these paths with whatever download replaced it.
        val live = ifLive(job) {
            // Never more than one pending APK: anything for another version goes.
            d.listFiles()?.forEach {
                if (it != part && it != apk && !it.name.startsWith(STATE)) it.delete()
            }
            // Asked again for a version already downloaded: re-verify that
            // copy rather than fetch it a second time.
            if (apk.exists() && !apk.renameTo(part)) apk.delete()
            lowSpace = d.usableSpace < total - part.length() + 5L * 1024 * 1024
        }
        if (!live) return
        if (lowSpace) return fail(ctx, job, "storage")
        if (total <= 0 || part.length() < total) {
            try {
                fetch(ctx, job, part, total)
            } catch (_: IOException) {
                return fail(ctx, job.put("bytes", part.length()), "offline")
            }
            // A short body (connection closed early without an exception) is
            // an interrupted download, not a checksum failure: keep the .part
            // so the retry resumes.
            if (total > 0 && part.length() < total) return fail(ctx, job.put("bytes", part.length()), "offline")
        }
        if (!ifLive(job) { write(ctx, job.put("state", "verifying").put("bytes", part.length())) }) return
        val failure = when {
            !sha256(part).equals(job.getString("sha256"), ignoreCase = true) -> "checksum"
            !sameAppNewerAndSameSigner(ctx, part) -> "signature"
            else -> null
        }
        if (failure != null) {
            ifLive(job) {
                part.delete()
                job.put("bytes", 0L)
            }
            return fail(ctx, job, failure)
        }
        var renamed = false
        if (!ifLive(job) { renamed = part.renameTo(apk) }) return
        if (!renamed) return fail(ctx, job, "storage")
        finish(ctx, job, "ready", null)
    }

    private fun fetch(ctx: Context, job: JSONObject, part: File, total: Long) {
        val version = job.getString("version")
        // Re-request the GitHub URL on every attempt: its redirect target is a
        // signed URL that expires after about an hour. GitHub redirects
        // https -> https, which HttpURLConnection follows.
        val c = URL(job.getString("url")).openConnection() as HttpURLConnection
        // Publish the connection for cancel(); if cancel already ran, close it.
        if (!ifLive(job) { conn = c }) {
            c.disconnect()
            return
        }
        try {
            c.instanceFollowRedirects = true
            c.connectTimeout = 15_000
            c.readTimeout = 30_000
            if (part.length() > 0) c.setRequestProperty("Range", "bytes=${part.length()}-")
            val code = c.responseCode
            if (active !== job) return
            if (code != 200 && code != 206) throw IOException("HTTP $code")
            // 206: the server honoured the Range, append. 200: it sent the
            // whole file, start the .part over.
            val append = code == 206
            var bytes = if (append) part.length() else 0L
            var lastWrite = 0L
            FileOutputStream(part, append).use { out ->
                c.inputStream.use { inp ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        if (active !== job) return
                        val n = inp.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                        bytes += n
                        val now = System.currentTimeMillis()
                        if (now - lastWrite > 250) {
                            lastWrite = now
                            // State and notification in one critical section
                            // with the live check: cancel() cannot slip in
                            // between and have its stop() overtaken by a
                            // progress post that re-creates the notification.
                            val stillLive = ifLive(job) {
                                write(ctx, job.put("state", "downloading").put("bytes", bytes))
                                UpdateService.progress(ctx, version, bytes, total)
                            }
                            if (!stillLive) return
                        }
                    }
                }
            }
        } catch (e: IOException) {
            // A disconnect() from cancel() surfaces here; that is not a failure.
            if (active === job) throw e
        } finally {
            synchronized(lock) { if (conn === c) conn = null }
            c.disconnect()
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
     *  opaque "App not installed" into an explained failure. Fails closed:
     *  no readable signer set on either side means "signature". */
    private fun sameAppNewerAndSameSigner(ctx: Context, f: File): Boolean {
        val pm = ctx.packageManager
        return try {
            @Suppress("DEPRECATION") val legacy = PackageManager.GET_SIGNATURES
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                val flags = PackageManager.GET_SIGNING_CERTIFICATES
                val archive = pm.getPackageArchiveInfo(f.path, flags) ?: return false
                val mine = pm.getPackageInfo(ctx.packageName, flags)
                if (archive.packageName != ctx.packageName || archive.longVersionCode <= mine.longVersionCode) {
                    return false
                }
                val theirs = archive.signingInfo?.apkContentsSigners?.map { it.toCharsString() }?.toSet()
                if (theirs != null) {
                    val ours = mine.signingInfo?.apkContentsSigners?.map { it.toCharsString() }?.toSet()
                    return theirs.isNotEmpty() && theirs == ours
                }
                // Some API 28+ builds return a null signingInfo for an archive.
                // Compare the legacy signatures on BOTH sides instead.
                legacySigners(pm.getPackageArchiveInfo(f.path, legacy)).let { t ->
                    !t.isNullOrEmpty() && t == legacySigners(pm.getPackageInfo(ctx.packageName, legacy))
                }
            } else {
                val archive = pm.getPackageArchiveInfo(f.path, legacy) ?: return false
                val mine = pm.getPackageInfo(ctx.packageName, legacy)
                @Suppress("DEPRECATION")
                val newer = archive.versionCode > mine.versionCode
                val theirs = legacySigners(archive)
                archive.packageName == ctx.packageName && newer &&
                    !theirs.isNullOrEmpty() && theirs == legacySigners(mine)
            }
        } catch (_: Exception) {
            false
        }
    }

    @Suppress("DEPRECATION")
    private fun legacySigners(info: android.content.pm.PackageInfo?): Set<String>? =
        info?.signatures?.map { it.toCharsString() }?.toSet()

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
    fun cleanupAsync(ctx: Context, onDone: (() -> Unit)? = null) {
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
                        if (!isWorking()) dir(app).listFiles()?.forEach { it.delete() }
                    }
                }
            } catch (_: Exception) {
                // Housekeeping only; a failure here costs some cache space.
            }
            try {
                // Every session of ours but the one state.json says is being
                // installed right now holds a staged APK copy in system
                // storage that nothing will ever use. Read after the delete
                // above: once the update landed, state is idle and all go.
                synchronized(lock) {
                    val st = read(app)
                    val keep = if (st.optString("state") == "installing") st.optInt("session", -1) else -1
                    abandonSessions(app, keep)
                }
            } catch (_: Exception) {
                // As above.
            }
            onDone?.invoke()
        }, "riwaq-update-cleanup").start()
    }

    /** Abandon every PackageInstaller session this app owns except [keep]
     *  (-1: all). Each one is a staged copy of an APK in system storage. */
    private fun abandonSessions(ctx: Context, keep: Int) {
        val pi = ctx.packageManager.packageInstaller
        val mine = try { pi.mySessions } catch (_: Exception) { return }
        for (s in mine) {
            if (s.sessionId == keep) continue
            try { pi.abandonSession(s.sessionId) } catch (_: Exception) { /* already gone */ }
        }
    }

    private fun sessionAlive(ctx: Context, id: Int): Boolean =
        id >= 0 && try { ctx.packageManager.packageInstaller.getSessionInfo(id) != null } catch (_: Exception) { false }

    /** Whether Android will let us install packages. Below API 26 that is the
     *  global "Unknown sources" switch, which the system dialog handles. */
    @JvmStatic
    fun canInstall(ctx: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.O || ctx.packageManager.canRequestPackageInstalls()

    /** The one-time "Install unknown apps" switch for Riwaq. */
    @JvmStatic
    fun openInstallPermission(activity: Activity) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        activity.startActivity(
            Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}")),
        )
    }

    /** Hand the verified APK to Android in a PackageInstaller session. Only
     *  from "ready" — or "installing", so a second tap after the dialog was
     *  dismissed without an answer starts over with a fresh session. Android
     *  answers through [InstallResultReceiver]: confirm dialog, then success
     *  (this process is killed and replaced) or failure/abort
     *  ([onInstallResult]).
     *
     *  Storage: the session holds its own staged copy of the APK, so a
     *  session that does not commit is abandoned before this returns, and
     *  every older session of ours is abandoned before a new one is made.
     *
     *  All of it under [lock]: [cleanupAsync] must not abandon the session
     *  between its creation and state.json naming it. Never throws: a
     *  failure is recorded as `failed`/`install`, which the UI polls. */
    @JvmStatic
    fun install(activity: Activity): Unit = synchronized(lock) {
        val app = activity.applicationContext
        val st = read(app)
        val state = st.optString("state")
        val apk = apkFile(app, st.optString("version"))
        if ((state != "ready" && state != "installing") || !apk.exists()) return
        val pi = app.packageManager.packageInstaller
        abandonSessions(app, keep = -1)
        var id = -1
        var committed = false
        try {
            val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
            params.setAppPackageName(app.packageName)
            params.setSize(apk.length())
            id = pi.createSession(params)
            pi.openSession(id).use { s ->
                s.openWrite("base.apk", 0, apk.length()).use { out ->
                    apk.inputStream().use { it.copyTo(out, 64 * 1024) }
                    s.fsync(out)
                }
                // Mutable: the system fills in the status extras. Explicit
                // component, so API 34's ban on mutable implicit intents does
                // not apply. The session id as request code: never collides.
                val flags = PendingIntent.FLAG_UPDATE_CURRENT or
                    (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0)
                val cb = PendingIntent.getBroadcast(app, id, Intent(app, InstallResultReceiver::class.java), flags)
                write(app, st.put("state", "installing").put("session", id).put("error", JSONObject.NULL))
                s.commit(cb.intentSender)
                committed = true
            }
        } catch (_: Exception) {
            st.remove("session")
            write(app, st.put("state", "failed").put("error", "install"))
        } finally {
            if (!committed && id >= 0) {
                try { pi.abandonSession(id) } catch (_: Exception) { /* never opened */ }
            }
        }
    }

    /** Called by InstallResultReceiver with the session Android answered for.
     *  A failed or aborted session is abandoned at once (its staged copy goes).
     *  ABORTED = the user tapped Cancel on Android's dialog: back to "ready"
     *  with the verified APK kept. A result for a session that is no longer
     *  the current one (replaced by a second tap) changes no state. */
    internal fun onInstallResult(ctx: Context, session: Int, ok: Boolean, aborted: Boolean): Unit = synchronized(lock) {
        val app = ctx.applicationContext
        if (ok) return // the process is about to be replaced
        if (session >= 0) {
            try { app.packageManager.packageInstaller.abandonSession(session) } catch (_: Exception) { /* gone */ }
        }
        val st = read(app)
        if (st.optString("state") != "installing" || st.optInt("session", -1) != session) return
        st.remove("session")
        write(app, if (aborted) st.put("state", "ready").put("error", JSONObject.NULL) else st.put("state", "failed").put("error", "install"))
    }
}
