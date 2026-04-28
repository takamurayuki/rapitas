//! release
//!
//! Backend sidecar lifecycle for release builds. The Bun-compiled
//! `rapitas-backend` binary is shipped as a Tauri sidecar; this module
//! locates it (dev or release path), copies it into the per-user app data
//! directory, launches it, forwards stdout/stderr to the host, and shuts
//! it down when the app exits.
//!
//! Compiled only when `not(debug_assertions)` — see `mod release;` in
//! `main.rs`. In debug builds the backend is started by `dev.js` instead.

use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_shell::ShellExt;

pub struct BackendState {
    pub child: Option<tauri_plugin_shell::process::CommandChild>,
}

pub fn setup_sidecar(app: &tauri::App) {
    let shell = app.shell();

    let backend_filename = if cfg!(target_os = "windows") {
        "rapitas-backend.exe"
    } else if cfg!(target_os = "macos") {
        "rapitas-backend"
    } else {
        "rapitas-backend"
    };

    // Dev mode: src-tauri/binaries/rapitas-backend-*.exe
    // Release mode: $INSTDIR/binaries/rapitas-backend-*.exe
    let resource_path = {
        let dev_resource_dir = app
            .path()
            .resource_dir()
            .expect("failed to get resource dir")
            .join("binaries");

        println!("[Backend] Checking dev resources: {:?}", dev_resource_dir);

        let mut backend_path = None;

        if dev_resource_dir.exists() {
            if let Ok(entries) = std::fs::read_dir(&dev_resource_dir) {
                backend_path = entries.filter_map(|e| e.ok()).map(|e| e.path()).find(|p| {
                    p.file_name()
                        .and_then(|n| n.to_str())
                        .map(|n| {
                            n.starts_with("rapitas-backend")
                                && n.ends_with(if cfg!(windows) { ".exe" } else { "" })
                        })
                        .unwrap_or(false)
                });
            }
        }

        // Release mode: check the binaries subdirectory next to the app executable
        if backend_path.is_none() {
            let app_dir = std::env::current_exe()
                .expect("failed to get current exe path")
                .parent()
                .expect("failed to get parent dir")
                .to_path_buf();

            let release_binaries_dir = app_dir.join("binaries");
            println!(
                "[Backend] Checking release binaries: {:?}",
                release_binaries_dir
            );

            if release_binaries_dir.exists() {
                if let Ok(entries) = std::fs::read_dir(&release_binaries_dir) {
                    backend_path = entries.filter_map(|e| e.ok()).map(|e| e.path()).find(|p| {
                        p.file_name()
                            .and_then(|n| n.to_str())
                            .map(|n| {
                                n.starts_with("rapitas-backend")
                                    && n.ends_with(if cfg!(windows) { ".exe" } else { "" })
                            })
                            .unwrap_or(false)
                    });
                }
            }
        }

        backend_path.expect("Backend executable not found in resources or app directory")
    };

    println!("[Backend] Found backend: {:?}", resource_path);

    // Copy backend to app data directory
    let app_data_dir = app
        .path()
        .app_data_dir()
        .expect("failed to get app data dir");

    std::fs::create_dir_all(&app_data_dir).ok();

    let backend_path = app_data_dir.join(backend_filename);

    // Copy resource (overwrite on update)
    std::fs::copy(&resource_path, &backend_path).expect("failed to copy backend executable");
    println!("[Backend] Copied to: {:?}", backend_path);

    // Launch the backend process
    let backend_command = shell
        .command(backend_path.to_string_lossy().to_string())
        .env("TAURI_BUILD", "true");

    let (mut rx, child) = backend_command.spawn().expect("failed to spawn backend");

    // Store child process handle for cleanup on exit
    let state = app.state::<Mutex<BackendState>>();
    state.lock().unwrap().child = Some(child);

    // Forward backend output to logs
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let line = String::from_utf8_lossy(&line);
                    println!("[Backend] {line}");
                }
                CommandEvent::Stderr(line) => {
                    let line = String::from_utf8_lossy(&line);
                    eprintln!("[Backend Error] {line}");
                }
                CommandEvent::Error(err) => {
                    eprintln!("[Backend] Error: {err}");
                }
                CommandEvent::Terminated(payload) => {
                    println!("[Backend] Terminated with code: {:?}", payload.code);
                }
                _ => {}
            }
        }
    });

    println!("Backend started successfully!");
}

pub fn kill_backend(app: &tauri::AppHandle) {
    let state = app.state::<Mutex<BackendState>>();
    let mut guard = state.lock().unwrap();
    if let Some(child) = guard.child.take() {
        let _ = child.kill();
        println!("Backend stopped.");
    }
}
