//! The human-readable name behind an Android content URI.
//!
//! The file picker hands the frontend a path, and for most sources that path
//! still carries the filename — a desktop path outright, and a Storage Access
//! Framework URI from the "Downloads" or "Documents" browser after decoding:
//!
//!     content://…/document/primary%3ADownload%2Fbook.pdf
//!       ->  …/document/primary:Download/book.pdf   ->  "book.pdf"
//!
//! But picking the same file from the picker's **Recent** list — the default
//! screen, so the common case — yields a provider row id instead:
//!
//!     content://com.android.providers.media.documents/document/document%3A32
//!       ->  …/document/document:32                 ->  "32"
//!
//! There is no name in that string to recover, and no amount of parsing will
//! produce one. The name lives in the provider, and `ContentResolver.query`
//! is the only way to ask for it.
//!
//! Done entirely through JNI rather than by adding a Kotlin helper: every
//! class and method called here is Android framework API, so there is no app
//! class for R8 to rename and no new entry to keep alive in
//! `proguard-rules.pro` — the trap that has broken release builds here before.

#[cfg(target_os = "android")]
use jni::objects::{JObject, JValue};

/// The filename a content URI stands for, or `None` when there isn't one.
///
/// `None` is an ordinary answer, not an error: desktop never calls the
/// provider, a path that already carries its name never gets here, and a
/// provider is free to expose no name at all. The frontend treats all three
/// the same way — it falls back to the localized "Untitled".
#[tauri::command]
pub fn display_name(path: String) -> Result<Option<String>, String> {
    #[cfg(target_os = "android")]
    {
        // Only content URIs have a provider to ask. A real filesystem path on
        // Android (a shared "Open with" file, say) already parses.
        if !path.starts_with("content://") {
            return Ok(None);
        }
        match android_display_name(&path) {
            Ok(name) => Ok(Some(name)),
            // A provider that refuses the query, a revoked permission, a row
            // that no longer exists: all mean "no name available", which is
            // exactly what `None` says. Failing the command instead would
            // turn a cosmetic gap into a failed import.
            Err(_) => Ok(None),
        }
    }
    #[cfg(not(target_os = "android"))]
    {
        // Desktop paths carry their own filename, so the frontend resolves
        // them without a round trip and never reaches this. Registered on
        // every platform so the capability set stays symmetric.
        let _ = path;
        Ok(None)
    }
}

/// `OpenableColumns.DISPLAY_NAME`. Inlined rather than read off the class,
/// because the constant's value is frozen API — reading it would cost two
/// more JNI calls to learn what is already known here.
#[cfg(target_os = "android")]
const DISPLAY_NAME_COLUMN: &str = "_display_name";

#[cfg(target_os = "android")]
fn android_display_name(path: &str) -> Result<String, Box<dyn std::error::Error>> {
    let ctx = ndk_context::android_context();
    let vm = unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }?;
    let mut env = vm.attach_current_thread()?;
    let activity = unsafe { JObject::from_raw(ctx.context() as jni::sys::jobject) };

    let res = query_display_name(&mut env, &activity, path);

    // A failed JNI call leaves its exception armed on this thread, and ART
    // kills the process when the thread detaches with one pending — a
    // recoverable miss would otherwise present as "the app just closed".
    // Same reasoning as `notify::drain_pending_exception`.
    if let Ok(true) = env.exception_check() {
        let _ = env.exception_describe();
        let _ = env.exception_clear();
    }

    res
}

/// The JNI half, split out so [`android_display_name`] can drain a pending
/// exception on every exit path, including the early `?` returns.
#[cfg(target_os = "android")]
fn query_display_name<'local>(
    env: &mut jni::JNIEnv<'local>,
    activity: &JObject<'local>,
    path: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    let path_j = env.new_string(path)?;
    let uri_class = env.find_class("android/net/Uri")?;
    let uri = env
        .call_static_method(
            &uri_class,
            "parse",
            "(Ljava/lang/String;)Landroid/net/Uri;",
            &[JValue::Object(&path_j)],
        )?
        .l()?;

    let resolver = env
        .call_method(
            activity,
            "getContentResolver",
            "()Landroid/content/ContentResolver;",
            &[],
        )?
        .l()?;

    // query(uri, projection, selection, selectionArgs, sortOrder) with a null
    // projection: asking for the one column by name fails on providers that
    // don't publish it, whereas a null projection returns whatever the row
    // has and `getColumnIndex` then reports -1 for a missing column.
    let null = JObject::null();
    let cursor = env
        .call_method(
            &resolver,
            "query",
            "(Landroid/net/Uri;[Ljava/lang/String;Ljava/lang/String;[Ljava/lang/String;Ljava/lang/String;)Landroid/database/Cursor;",
            &[
                JValue::Object(&uri),
                JValue::Object(&null),
                JValue::Object(&null),
                JValue::Object(&null),
                JValue::Object(&null),
            ],
        )?
        .l()?;

    if cursor.is_null() {
        return Err("content resolver returned no cursor".into());
    }

    let found = read_name_column(env, &cursor);

    // Close on both paths: a leaked cursor is a real leak on Android, and the
    // import loop runs this once per picked file.
    let _ = env.call_method(&cursor, "close", "()V", &[]);

    found
}

#[cfg(target_os = "android")]
fn read_name_column<'local>(
    env: &mut jni::JNIEnv<'local>,
    cursor: &JObject<'local>,
) -> Result<String, Box<dyn std::error::Error>> {
    if !env.call_method(cursor, "moveToFirst", "()Z", &[])?.z()? {
        return Err("empty cursor".into());
    }

    let column_j = env.new_string(DISPLAY_NAME_COLUMN)?;
    let index = env
        .call_method(
            cursor,
            "getColumnIndex",
            "(Ljava/lang/String;)I",
            &[JValue::Object(&column_j)],
        )?
        .i()?;
    if index < 0 {
        return Err("row has no _display_name column".into());
    }

    let value = env
        .call_method(
            cursor,
            "getString",
            "(I)Ljava/lang/String;",
            &[JValue::Int(index)],
        )?
        .l()?;
    if value.is_null() {
        return Err("_display_name is null".into());
    }

    let name: String = env.get_string(&value.into())?.into();
    Ok(name)
}
