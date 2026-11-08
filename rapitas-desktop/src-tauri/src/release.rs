//! release
//!
//! Backend sidecar lifecycle for release builds. The Bun-compiled
//! `rapitas-backend` binary is shipped as a Tauri sidecar; this module
//! locates it (dev or release path), copies it into the per-user app data
//! directory, launches it, forwards stdout/stderr to the host, and shuts
//! it down when the app exits. A backend exit with code 75 (the "please
//! restart me" contract, e.g. after POST /deploy/now) is answered with a
//! fresh spawn, exactly like dev.js does in debug builds.
//!
//! Compiled only when `not(debug_assertions)` — see `mod release;` in
//! `main.rs`. In debug builds the backend is started by `dev.js` instead.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::Manager;
use tauri_plugin_shell::ShellExt;

pub struct BackendState {
    pub child: Option<tauri_plugin_shell::process::CommandChild>,
}

pub fn setup_sidecar(app: &tauri::App) {
    let launch = prepare_backend_launch(app);
    let handle = app.handle().clone();
    if let Err(err) = spawn_backend(&handle, launch) {
        panic!("failed to spawn backend: {err}");
    }
    println!("Backend started successfully!");
}

/// Exit code the backend uses to ask its launcher for a restart (same
/// contract as dev.js / restart-supervisor.ts; e.g. POST /deploy/now).
const RESTART_EXIT_CODE: i32 = 75;

/// Set by `kill_backend` when the app is quitting so a backend exit that
/// races the shutdown is never answered with a fresh spawn.
static SHUTTING_DOWN: AtomicBool = AtomicBool::new(false);

/// Everything needed to (re)spawn the backend. Resolved once in
/// `setup_sidecar` (binary located + copied, Prisma engine copied, DB URL
/// resolved) and reused verbatim for every exit-75 restart.
struct BackendLaunch {
    backend_path: std::path::PathBuf,
    database_url: String,
    data_dir: String,
    query_engine_path: Option<std::path::PathBuf>,
}

fn prepare_backend_launch(app: &tauri::App) -> Arc<BackendLaunch> {
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

    // Copy the bundled Prisma query engine next to the exe and remember its
    // path. bun's single-file compile cannot embed the .node native library and
    // user machines have no node_modules, so without this the backend dies at
    // startup with PrismaClientInitializationError ("could not locate the
    // Query Engine") before ever listening on 3001.
    let query_engine_path = resource_path
        .parent()
        .and_then(|dir| std::fs::read_dir(dir).ok())
        .and_then(|entries| {
            entries.filter_map(|e| e.ok()).map(|e| e.path()).find(|p| {
                p.file_name()
                    .and_then(|n| n.to_str())
                    .map(|n| n.contains("query_engine") && n.ends_with(".node"))
                    .unwrap_or(false)
            })
        })
        .and_then(|engine_src| {
            let engine_dst =
                app_data_dir.join(engine_src.file_name().expect("engine file has a name"));
            match std::fs::copy(&engine_src, &engine_dst) {
                Ok(_) => {
                    println!("[Backend] Prisma engine copied to: {:?}", engine_dst);
                    Some(engine_dst)
                }
                Err(err) => {
                    eprintln!("[Backend] Failed to copy Prisma engine: {err}");
                    None
                }
            }
        });
    if query_engine_path.is_none() {
        eprintln!(
            "[Backend] WARNING: no bundled Prisma query engine found — the backend will likely fail to start."
        );
    }

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

    Arc::new(BackendLaunch {
        backend_path,
        database_url,
        data_dir,
        query_engine_path,
    })
}

/// Spawn the backend, store its child in `BackendState`, and watch its
/// events. On `Terminated` with code 75 (and the app not quitting) the
/// watcher calls this again, so restarts chain indefinitely.
///
/// The state lock is held across the SHUTTING_DOWN check, the spawn and the
/// store: `kill_backend` sets the flag under the same lock, so a restart can
/// never slip in after the quit path has already taken and killed the child.
fn spawn_backend(app: &tauri::AppHandle, launch: Arc<BackendLaunch>) -> Result<(), String> {
    let state = app.state::<Mutex<BackendState>>();
    let mut guard = state.lock().unwrap();
    if SHUTTING_DOWN.load(Ordering::SeqCst) {
        println!("[Backend] App is shutting down; not spawning backend.");
        return Ok(());
    }

    // Launch the backend process
    let mut backend_command = app
        .shell()
        .command(launch.backend_path.to_string_lossy().to_string())
        .env("TAURI_BUILD", "true")
        .env("RAPITAS_DB_PROVIDER", "sqlite")
        .env("PORT", "3001")
        .env("DATABASE_URL", launch.database_url.clone())
        .env("RAPITAS_DATA_DIR", launch.data_dir.clone())
        .env("FRONTEND_URL", "tauri://localhost")
        .env(
            "CORS_ORIGIN",
            "tauri://localhost,http://localhost:3000,http://127.0.0.1:3000",
        );
    // Explicit engine path — Prisma's own search never resolves inside a bun
    // single-file binary, so point it at the engine we just copied.
    if let Some(engine) = &launch.query_engine_path {
        backend_command = backend_command.env(
            "PRISMA_QUERY_ENGINE_LIBRARY",
            engine.to_string_lossy().to_string(),
        );
    }

    let (mut rx, child) = backend_command.spawn().map_err(|err| err.to_string())?;
    println!("[Backend] Spawned backend (pid {})", child.pid());

    // Store child process handle for cleanup on exit (replaces the handle of
    // a backend that just exited with 75, so kill_backend kills the live one)
    guard.child = Some(child);
    drop(guard);

    let app = app.clone();

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
                    if payload.code != Some(RESTART_EXIT_CODE) {
                        // Signal kill (None), clean exit (0) or a crash code:
                        // not a restart request.
                        break;
                    }
                    if SHUTTING_DOWN.load(Ordering::SeqCst) {
                        println!("[Backend] Exit code {RESTART_EXIT_CODE} during app shutdown; not restarting.");
                        break;
                    }
                    println!("[Backend] Exit code {RESTART_EXIT_CODE} = restart requested; restarting backend...");
                    match spawn_backend(&app, launch.clone()) {
                        Ok(()) => println!("[Backend] Backend restarted."),
                        Err(err) => eprintln!("[Backend] Restart failed: {err}"),
                    }
                    break;
                }
                _ => {}
            }
        }
    });

    Ok(())
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
    // Under the state lock, so an in-flight exit-75 restart either finished
    // storing its child (killed below) or will see the flag and not spawn.
    SHUTTING_DOWN.store(true, Ordering::SeqCst);
    if let Some(child) = guard.child.take() {
        let _ = child.kill();
        println!("Backend stopped.");
    }
}
