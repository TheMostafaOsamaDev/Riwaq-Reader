//! Rust ⇄ Kotlin bridge for in-app updates (AppUpdater.kt). Same rules as
//! notify.rs: classes via the activity's classloader, every pending Java
//! exception drained so a missing member degrades to Err, never a dead
//! process. Desktop builds get stubs.
//!
//! The JNI descriptors below, the Kotlin signatures, the
//! `-keep class com.riwaq.reader.AppUpdater { *; }` rule in
//! gen/android/app/proguard-rules.pro and the EXPECTED list in
//! scripts/verify-jni-bridge.sh have to agree. When they drift, debug builds
//! keep working and release builds lose the member.

#[cfg(target_os = "android")]
use jni::objects::{JClass, JObject, JString, JValue};

#[cfg(target_os = "android")]
const CLASS: &str = "com.riwaq.reader.AppUpdater";

#[cfg(target_os = "android")]
type JniResult<T> = Result<T, Box<dyn std::error::Error>>;

/// Attach, resolve AppUpdater, run `f`, and drain any pending exception on
/// every exit path — including a failed class lookup.
#[cfg(target_os = "android")]
fn with_updater<T>(
    f: impl FnOnce(&mut jni::JNIEnv<'static>, &JObject<'static>, &JClass<'static>) -> JniResult<T>,
) -> Result<T, String> {
    let (vm, activity) = crate::notify::main_activity().map_err(|e| e.to_string())?;
    let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
    let res = match crate::notify::find_app_class(&mut env, activity, CLASS) {
        Ok(class) => f(&mut env, activity, &class),
        Err(e) => Err(e),
    };
    // A renamed or stripped AppUpdater member must not take the process down.
    crate::notify::drain_pending_exception(&mut env);
    res.map_err(|e| e.to_string())
}

#[cfg(target_os = "android")]
fn android_install_source() -> Result<String, String> {
    with_updater(|env, activity, class| {
        let v = env.call_static_method(
            class,
            "installSource",
            "(Landroid/content/Context;)Ljava/lang/String;",
            &[JValue::Object(activity)],
        )?;
        let obj: JObject = v.l()?;
        if obj.is_null() {
            return Err("installSource returned null".into());
        }
        let jstr: JString = obj.into();
        let s: String = env.get_string(&jstr)?.into();
        Ok(s)
    })
}

#[cfg(target_os = "android")]
fn android_open_store(pkg: String) -> Result<(), String> {
    with_updater(|env, activity, class| {
        let pkg_j = env.new_string(pkg)?;
        env.call_static_method(
            class,
            "openStore",
            "(Landroid/app/Activity;Ljava/lang/String;)V",
            &[JValue::Object(activity), JValue::Object(&pkg_j)],
        )?;
        Ok(())
    })
}

#[cfg(target_os = "android")]
fn android_update_start_impl(
    version: String,
    url: String,
    sha256: String,
    size: u64,
    wait_for_unmetered: bool,
) -> Result<(), String> {
    with_updater(|env, activity, class| {
        let version_j = env.new_string(version)?;
        let url_j = env.new_string(url)?;
        let sha_j = env.new_string(sha256)?;
        env.call_static_method(
            class,
            "start",
            "(Landroid/content/Context;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;JZ)V",
            &[
                JValue::Object(activity),
                JValue::Object(&version_j),
                JValue::Object(&url_j),
                JValue::Object(&sha_j),
                JValue::Long(size as i64),
                JValue::Bool(u8::from(wait_for_unmetered)),
            ],
        )?;
        Ok(())
    })
}

#[cfg(target_os = "android")]
fn android_update_status_impl() -> Result<String, String> {
    with_updater(|env, activity, class| {
        let v = env.call_static_method(
            class,
            "status",
            "(Landroid/content/Context;)Ljava/lang/String;",
            &[JValue::Object(activity)],
        )?;
        let obj: JObject = v.l()?;
        if obj.is_null() {
            return Err("status returned null".into());
        }
        let jstr: JString = obj.into();
        let s: String = env.get_string(&jstr)?.into();
        Ok(s)
    })
}

#[cfg(target_os = "android")]
fn android_update_cancel_impl() -> Result<(), String> {
    with_updater(|env, activity, class| {
        env.call_static_method(
            class,
            "cancel",
            "(Landroid/content/Context;)V",
            &[JValue::Object(activity)],
        )?;
        Ok(())
    })
}

#[cfg(target_os = "android")]
fn android_network_metered_impl() -> Result<bool, String> {
    with_updater(|env, activity, class| {
        let v = env.call_static_method(
            class,
            "isMetered",
            "(Landroid/content/Context;)Z",
            &[JValue::Object(activity)],
        )?;
        Ok(v.z()?)
    })
}

#[cfg(target_os = "android")]
fn android_update_can_install_impl() -> Result<bool, String> {
    with_updater(|env, activity, class| {
        let v = env.call_static_method(
            class,
            "canInstall",
            "(Landroid/content/Context;)Z",
            &[JValue::Object(activity)],
        )?;
        Ok(v.z()?)
    })
}

#[cfg(target_os = "android")]
fn android_update_open_permission_impl() -> Result<(), String> {
    with_updater(|env, activity, class| {
        env.call_static_method(
            class,
            "openInstallPermission",
            "(Landroid/app/Activity;)V",
            &[JValue::Object(activity)],
        )?;
        Ok(())
    })
}

#[cfg(target_os = "android")]
fn android_update_install_impl() -> Result<(), String> {
    with_updater(|env, activity, class| {
        env.call_static_method(
            class,
            "install",
            "(Landroid/app/Activity;)V",
            &[JValue::Object(activity)],
        )?;
        Ok(())
    })
}

/// Who installed this copy of Riwaq, as JSON:
/// `{"installer": "<pkg or empty>", "label": "<store label or empty>", "storeInstalled": bool}`.
/// Desktop has no installer to report.
#[tauri::command]
pub async fn install_source() -> Result<String, String> {
    #[cfg(target_os = "android")]
    {
        android_install_source()
    }
    #[cfg(not(target_os = "android"))]
    {
        Ok(r#"{"installer":"","label":"","storeInstalled":false}"#.into())
    }
}

/// Launch the store app `pkg`, so the user can update Riwaq from there.
#[tauri::command]
pub async fn open_store(pkg: String) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        android_open_store(pkg)
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = pkg;
        Err("android only".into())
    }
}

/// Start (or resume) downloading the update APK for `version` in Kotlin's
/// UpdateService. With `wait_for_unmetered`, a metered connection parks the
/// request until Wi-Fi. Ignored while a download is already running.
#[tauri::command]
pub async fn android_update_start(
    version: String,
    url: String,
    sha256: String,
    size: u64,
    wait_for_unmetered: bool,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        android_update_start_impl(version, url, sha256, size, wait_for_unmetered)
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (version, url, sha256, size, wait_for_unmetered);
        Err("android only".into())
    }
}

/// The download's status JSON; see parseNativeStatus in src/store/updateFlow.ts.
#[tauri::command]
pub async fn android_update_status() -> Result<String, String> {
    #[cfg(target_os = "android")]
    {
        android_update_status_impl()
    }
    #[cfg(not(target_os = "android"))]
    {
        Ok(r#"{"state":"idle"}"#.into())
    }
}

/// Stop any update download or Wi-Fi wait and drop the cached files.
#[tauri::command]
pub async fn android_update_cancel() -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        android_update_cancel_impl()
    }
    #[cfg(not(target_os = "android"))]
    {
        Err("android only".into())
    }
}

/// Whether the active network is metered (mobile data, a metered hotspot).
#[tauri::command]
pub async fn android_network_metered() -> Result<bool, String> {
    #[cfg(target_os = "android")]
    {
        android_network_metered_impl()
    }
    #[cfg(not(target_os = "android"))]
    {
        Err("android only".into())
    }
}

/// Whether Android lets Riwaq install packages ("Install unknown apps").
/// Always true below Android 8, where the system dialog asks instead.
#[tauri::command]
pub async fn android_update_can_install() -> Result<bool, String> {
    #[cfg(target_os = "android")]
    {
        android_update_can_install_impl()
    }
    #[cfg(not(target_os = "android"))]
    {
        Err("android only".into())
    }
}

/// Open Android's "Install unknown apps" setting for Riwaq.
#[tauri::command]
pub async fn android_update_open_permission() -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        android_update_open_permission_impl()
    }
    #[cfg(not(target_os = "android"))]
    {
        Err("android only".into())
    }
}

/// Install the verified APK through a PackageInstaller session. Only acts
/// from "ready" (or a stuck "installing"); the outcome shows up in
/// android_update_status ("installing", then "ready"/"failed", or the app is
/// replaced).
#[tauri::command]
pub async fn android_update_install() -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        android_update_install_impl()
    }
    #[cfg(not(target_os = "android"))]
    {
        Err("android only".into())
    }
}
