mod archive;
mod notify;
mod sources;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_os::init())
        .invoke_handler(tauri::generate_handler![
            sources::source_fetch,
            sources::source_fetch_bytes,
            sources::source_render_and_extract,
            sources::source_session_fetch,
            notify::update_download_notification,
            notify::set_status_bar_style,
            notify::consume_launch_intent,
            notify::start_task_service,
            notify::stop_task_service,
            archive::stage_import_file,
            archive::zip_entries,
            archive::zip_read_texts,
            archive::zip_extract,
            archive::zip_read_bytes,
            archive::write_chunk_b64,
            archive::rename_staged,
            archive::delete_staged,
        ])
        .setup(|app| {
            // Dev harness for the session-webview transport. Off unless
            // LEAFLET_SESSION_SELFTEST names a URL to fetch, so normal
            // runs are unaffected.
            //
            // Desktop-only: it calls the `#[cfg(desktop)]` two-argument
            // `source_session_fetch`, whereas the mobile build compiles the
            // one-argument stub. Without this gate the Android target fails
            // to build at all.
            #[cfg(desktop)]
            if let Ok(target) = std::env::var("LEAFLET_SESSION_SELFTEST") {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    // Twice: the first call pays session creation + the
                    // Cloudflare clear, the second reuses the warm session.
                    // Sequential pass first: cold (session build +
                    // challenge) then warm (reuse).
                    for label in ["cold", "warm"] {
                        let input = serde_json::from_value(serde_json::json!({
                            "url": target.clone(),
                        }))
                        .expect("selftest input");
                        let t0 = std::time::Instant::now();
                        match sources::source_session_fetch(handle.clone(), input).await {
                            Ok(resp) => println!(
                                "[selftest:{label}] status={} bytes={} elapsed={:?}",
                                resp.status_for_test(),
                                resp.text_for_test().len(),
                                t0.elapsed(),
                            ),
                            Err(e) => println!("[selftest:{label}] ERROR: {e}"),
                        }
                    }

                    // Then the case the sequential pass cannot catch: the
                    // app fires overlapping fetches per novel (page, then
                    // admin-ajax). The bridge has one payload slot, so
                    // without per-origin serialization these clobber each
                    // other and the transfer comes up short.
                    let mut set = Vec::new();
                    for i in 0..4 {
                        let h = handle.clone();
                        let u = target.clone();
                        set.push(tauri::async_runtime::spawn(async move {
                            let input = serde_json::from_value(serde_json::json!({ "url": u }))
                                .expect("selftest input");
                            let t0 = std::time::Instant::now();
                            match sources::source_session_fetch(h, input).await {
                                Ok(r) => format!(
                                    "[selftest:concurrent{i}] status={} bytes={} elapsed={:?}",
                                    r.status_for_test(),
                                    r.text_for_test().len(),
                                    t0.elapsed()
                                ),
                                Err(e) => format!("[selftest:concurrent{i}] ERROR: {e}"),
                            }
                        }));
                    }
                    for j in set {
                        match j.await {
                            Ok(line) => println!("{line}"),
                            Err(e) => println!("[selftest:concurrent] join error: {e}"),
                        }
                    }
                    println!("[selftest] done");
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
