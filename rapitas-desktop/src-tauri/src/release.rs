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
            backend_path = find_backend_binary(&dev_resource_dir);
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
                backend_path = find_backend_binary(&release_binaries_dir);
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

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        let mut permissions = std::fs::metadata(&backend_path)
            .expect("failed to read backend executable metadata")
            .permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&backend_path, permissions)
            .expect("failed to mark backend executable");
    }

    let database_url = resolve_database_url(&app_data_dir);
    let data_dir = app_data_dir.to_string_lossy().to_string();

    // Launch the backend process
    let backend_command = shell
        .command(backend_path.to_string_lossy().to_string())
        .env("TAURI_BUILD", "true")
        .env("RAPITAS_DB_PROVIDER", "sqlite")
        .env("PORT", "3001")
        .env("DATABASE_URL", database_url)
        .env("RAPITAS_DATA_DIR", data_dir)
        .env("FRONTEND_URL", "tauri://localhost")
        .env(
            "CORS_ORIGIN",
            "tauri://localhost,http://localhost:3000,http://127.0.0.1:3000",
        );

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

fn find_backend_binary(dir: &std::path::Path) -> Option<std::path::PathBuf> {
    let target_triple = option_env!("TAURI_ENV_TARGET_TRIPLE").unwrap_or("");
    let mut candidates: Vec<_> = std::fs::read_dir(dir)
        .ok()?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| {
            let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
                return false;
            };
            if !name.starts_with("rapitas-backend") || name.contains("placeholder") {
                return false;
            }
            if cfg!(windows) && !name.ends_with(".exe") {
                return false;
            }
            std::fs::metadata(path)
                .map(|metadata| metadata.is_file() && metadata.len() > 0)
                .unwrap_or(false)
        })
        .collect();

    candidates.sort_by(|left, right| {
        let left_name = left
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("");
        let right_name = right
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("");
        let left_score = backend_candidate_score(left_name, target_triple);
        let right_score = backend_candidate_score(right_name, target_triple);
        right_score
            .cmp(&left_score)
            .then_with(|| left_name.cmp(right_name))
    });

    candidates.into_iter().next()
}

fn backend_candidate_score(name: &str, target_triple: &str) -> u8 {
    if !target_triple.is_empty() && name.contains(target_triple) {
        3
    } else if name == "rapitas-backend" || name == "rapitas-backend.exe" {
        2
    } else {
        1
    }
}

fn resolve_database_url(app_data_dir: &std::path::Path) -> String {
    if let Ok(database_url) = std::env::var("DATABASE_URL") {
        if database_url.trim().starts_with("file:") {
            return database_url;
        }
    }

    let env_file = app_data_dir.join(".env");
    if let Ok(contents) = std::fs::read_to_string(&env_file) {
        if let Some(database_url) = contents.lines().find_map(parse_database_url_line) {
            println!("[Backend] Loaded DATABASE_URL from {:?}", env_file);
            return database_url;
        }
    }

    let database_path = app_data_dir.join("rapitas.db");
    let database_url = format!("file:{}", database_path.to_string_lossy());
    println!("[Backend] Using desktop SQLite database: {database_path:?}");
    database_url
}

fn parse_database_url_line(line: &str) -> Option<String> {
    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed.starts_with('#') {
        return None;
    }

    let (key, value) = trimmed.split_once('=')?;
    if key.trim() != "DATABASE_URL" {
        return None;
    }

    let value = value
        .trim()
        .trim_matches('"')
        .trim_matches('\'')
        .to_string();
    if value.is_empty() || !value.starts_with("file:") {
        None
    } else {
        Some(value)
    }
}

pub fn kill_backend(app: &tauri::AppHandle) {
    let state = app.state::<Mutex<BackendState>>();
    let mut guard = state.lock().unwrap();
    if let Some(child) = guard.child.take() {
        let _ = child.kill();
        println!("Backend stopped.");
    }
}
