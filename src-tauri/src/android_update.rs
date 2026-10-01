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
