// Bridge from the frontend to the Android-side DownloadNotifier class.
// Two commands:
//
//   update_download_notification — set / update the running download
//     notification. Calls into Kotlin via JNI on Android. No-op on
//     other platforms (frontend's transport layer doesn't call this
//     command on non-Android anyway, so the no-op is just a safety
//     net).
//
//   consume_launch_intent — drain the launch-intent extra stashed by
//     MainActivity. Returns Some("queue") or None. Used by the
//     frontend's useLaunchIntent hook on mount.
//
// Both commands are infallible from the frontend's perspective in the
// sense that they always return a Result; the frontend can log a
// warning and continue.

use tauri::AppHandle;

#[cfg(target_os = "android")]
use jni::objects::{JObject, JValue};
#[cfg(target_os = "android")]
use jni::sys::{jboolean, jint, JNI_FALSE, JNI_TRUE};

/// Update the download-progress notification. Parameters mirror
/// `DownloadNotifier.update(...)` on the Android side.
#[tauri::command]
pub async fn update_download_notification(
    app: AppHandle,
    id: i32,
    title: String,
    body: String,
    progress: i32,
    max: i32,
    indeterminate: bool,
    ongoing: bool,
    taps_to_queue: bool,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        android_call_update(
            &app, id, title, body, progress, max, indeterminate, ongoing,
            taps_to_queue,
        )
        .map_err(|e| format!("android notify failed: {e}"))?;
        return Ok(());
    }
    #[cfg(not(target_os = "android"))]
    {
        // No-op on non-Android. The frontend's transport falls back to
        // the Tauri notification plugin before invoking this command,
        // so this branch should be unreachable in practice. Keep the
        // command registered for symmetric capability declarations.
        let _ = (
            app, id, title, body, progress, max, indeterminate, ongoing,
            taps_to_queue,
        );
        Ok(())
    }
}

/// Drain the pending launch-intent extra. Returns `Some(extra)` once,
/// then `None` until the next intent arrives. Used by the frontend
/// `useLaunchIntent` hook on mount.
#[tauri::command]
pub async fn consume_launch_intent(app: AppHandle) -> Result<Option<String>, String> {
    #[cfg(target_os = "android")]
    {
        return Ok(android_consume_intent(&app).ok());
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(None)
    }
}

/// Look up an app class via the activity's classloader. JNI-attached
/// Rust threads default to the **system** classloader, which only
/// resolves Android framework classes — `env.find_class("com/.../MainActivity")`
/// hits `ClassNotFoundException`. Going through the activity's loader
/// (which is the app's `PathClassLoader`) is the standard workaround.
///
/// `dot_name` must be dot-separated (e.g. `"com.leaflet.reader.MainActivity"`)
/// because `ClassLoader.loadClass` takes a binary name, not a JNI signature.
#[cfg(target_os = "android")]
fn find_app_class<'local>(
    env: &mut jni::JNIEnv<'local>,
    activity: &JObject<'local>,
    dot_name: &str,
) -> Result<jni::objects::JClass<'local>, Box<dyn std::error::Error>> {
    let loader = env
        .call_method(activity, "getClassLoader", "()Ljava/lang/ClassLoader;", &[])?
        .l()?;
    let name_j = env.new_string(dot_name)?;
    let class_obj = env
        .call_method(
            &loader,
            "loadClass",
            "(Ljava/lang/String;)Ljava/lang/Class;",
            &[JValue::Object(&name_j)],
        )?
        .l()?;
    Ok(jni::objects::JClass::from(class_obj))
}

#[cfg(target_os = "android")]
fn android_call_update(
    _app: &AppHandle,
    id: i32,
    title: String,
    body: String,
    progress: i32,
    max: i32,
    indeterminate: bool,
    ongoing: bool,
    taps_to_queue: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    let ctx = ndk_context::android_context();
    let vm = unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }?;
    let mut env = vm.attach_current_thread()?;
    let activity =
        unsafe { JObject::from_raw(ctx.context() as jni::sys::jobject) };

    let title_j = env.new_string(title)?;
    let body_j = env.new_string(body)?;

    let class = find_app_class(&mut env, &activity, "com.leaflet.reader.DownloadNotifier")?;

    env.call_static_method(
        &class,
        "update",
        "(Landroid/content/Context;ILjava/lang/String;Ljava/lang/String;IIZZZ)V",
        &[
            JValue::Object(&activity),
            JValue::Int(id as jint),
            JValue::Object(&title_j),
            JValue::Object(&body_j),
            JValue::Int(progress as jint),
            JValue::Int(max as jint),
            JValue::Bool(if indeterminate { JNI_TRUE } else { JNI_FALSE } as jboolean),
            JValue::Bool(if ongoing { JNI_TRUE } else { JNI_FALSE } as jboolean),
            JValue::Bool(if taps_to_queue { JNI_TRUE } else { JNI_FALSE } as jboolean),
        ],
    )?;
    Ok(())
}

#[cfg(target_os = "android")]
fn android_consume_intent(_app: &AppHandle) -> Result<String, Box<dyn std::error::Error>> {
    let ctx = ndk_context::android_context();
    let vm = unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }?;
    let mut env = vm.attach_current_thread()?;
    let activity =
        unsafe { JObject::from_raw(ctx.context() as jni::sys::jobject) };

    let class = find_app_class(&mut env, &activity, "com.leaflet.reader.MainActivity")?;
    let value = env.get_static_field(&class, "pendingLaunchIntent", "Ljava/lang/String;")?;
    let obj: JObject = value.l()?;

    if obj.is_null() {
        return Err("no pending intent".into());
    }

    let jstr: jni::objects::JString = obj.into();
    let rust_str: String = env.get_string(&jstr)?.into();

    // Clear so subsequent calls return None. `set_static_field` in jni
    // 0.21 expects a `JStaticFieldID`, not a (name, sig) tuple — look
    // up the field id explicitly here.
    let field_id =
        env.get_static_field_id(&class, "pendingLaunchIntent", "Ljava/lang/String;")?;
    env.set_static_field(&class, field_id, JValue::Object(&JObject::null()))?;

    Ok(rust_str)
}
