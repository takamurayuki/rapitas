//! release
//!
//! Backend sidecar lifecycle and supervision for release builds (ADR-0010
//! phase 1). Launches the Bun-compiled backend, forwards its output, and
//! supervises it:
//! - On Windows it is put in a kill-on-close Job Object, so every process it
//!   starts ends with the app — `kill_backend` alone only reached the sidecar.
//! - Any exit while the app runs is answered by `RestartPolicy`: code 75 (the
//!   "restart me" contract, e.g. POST /deploy/now) restarts at once; any other
//!   exit, including 0, restarts with back-off, and repeated crashes give up
//!   with a toast instead of leaving the app silently without a backend.
//! - A backend that never reports `ready: true` on `/health` is killed, which
//!   feeds the same restart path.
//!
//! Launch preparation lives in `sidecar_launch.rs`. Compiled only when
//! `not(debug_assertions)`; in debug builds `dev.js` runs the backend.

use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::Manager;
use tauri_plugin_shell::ShellExt;

use crate::sidecar_launch::BackendLaunch;
use crate::sidecar_policy::{parse_health_response, ExitAction, RestartPolicy};

pub struct BackendState {
    pub child: Option<tauri_plugin_shell::process::CommandChild>,
}

/// How long a freshly started backend may take to report `ready: true`.
/// Warm-up runs after the listener opens and has taken tens of seconds on a
/// cold desktop DB, so this is generous: it exists for a hung start, not a slow one.
const READY_TIMEOUT: Duration = Duration::from_secs(180);
const READY_POLL: Duration = Duration::from_secs(1);
const BACKEND_ADDR: &str = "127.0.0.1:3001";

/// Set by `kill_backend` when the app is quitting so a backend exit that
/// races the shutdown is never answered with a fresh spawn.
static SHUTTING_DOWN: AtomicBool = AtomicBool::new(false);

fn restart_policy() -> &'static Mutex<RestartPolicy> {
    static POLICY: OnceLock<Mutex<RestartPolicy>> = OnceLock::new();
    POLICY.get_or_init(|| Mutex::new(RestartPolicy::default()))
}

/// Put the backend in the app's kill-on-close job (Windows). Failing to is
/// logged, not fatal: the backend still runs, just without the cleanup.
#[cfg(target_os = "windows")]
fn contain(pid: u32) {
    use crate::sidecar_job::KillOnCloseJob;
    static JOB: OnceLock<Option<KillOnCloseJob>> = OnceLock::new();
    let job = JOB.get_or_init(|| match KillOnCloseJob::new() {
        Ok(job) => Some(job),
        Err(err) => {
            eprintln!("[Backend] Could not create the job object: {err}");
            None
        }
    });
    match job.as_ref().map(|j| j.assign_pid(pid)) {
        Some(Ok(())) => println!("[Backend] pid {pid} contained in the app's job object"),
        Some(Err(err)) => eprintln!("[Backend] Could not contain pid {pid}: {err}"),
        None => {}
    }
}

// TODO: Contain the sidecar's descendants on macOS/Linux too (process group
// or prctl(PR_SET_PDEATHSIG)); tauri-plugin-shell's Command has no pre_exec,
// so it needs a different spawn path. ADR-0010 phase 1 follow-up.
#[cfg(not(target_os = "windows"))]
fn contain(_pid: u32) {}

pub fn setup_sidecar(app: &tauri::App) {
    let launch = crate::sidecar_launch::prepare_backend_launch(app);
    let handle = app.handle().clone();
    if let Err(err) = spawn_backend(&handle, launch) {
        panic!("failed to spawn backend: {err}");
    }
    println!("Backend started successfully!");
}

/// Spawn the backend, contain it, store its child in `BackendState`, watch
/// its events and its readiness. Every exit goes through `RestartPolicy`.
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
    let pid = child.pid();
    println!("[Backend] Spawned backend (pid {pid})");
    // Before the backend has had time to start anything, so every process it
    // starts is born inside the job.
    contain(pid);

    // Replaces the handle of a backend that just exited, so kill_backend kills the live one.
    guard.child = Some(child);
    drop(guard);

    watch_readiness(app.clone(), pid);

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    println!("[Backend] {}", String::from_utf8_lossy(&line));
                }
                CommandEvent::Stderr(line) => {
                    eprintln!("[Backend Error] {}", String::from_utf8_lossy(&line));
                }
                CommandEvent::Error(err) => eprintln!("[Backend] Error: {err}"),
                CommandEvent::Terminated(payload) => {
                    println!("[Backend] Terminated with code: {:?}", payload.code);
                    let action = restart_policy().lock().unwrap().on_exit(
                        payload.code,
                        SHUTTING_DOWN.load(Ordering::SeqCst),
                        Instant::now(),
                    );
                    handle_exit(&app, launch.clone(), action).await;
                    break;
                }
                _ => {}
            }
        }
    });

    Ok(())
}

async fn handle_exit(app: &tauri::AppHandle, launch: Arc<BackendLaunch>, action: ExitAction) {
    match action {
        ExitAction::Stop => println!("[Backend] App is shutting down; not restarting."),
        ExitAction::Restart { delay } => {
            println!("[Backend] Restarting backend in {delay:?}...");
            tokio::time::sleep(delay).await;
            match spawn_backend(app, launch) {
                Ok(()) => println!("[Backend] Backend restarted."),
                Err(err) => eprintln!("[Backend] Restart failed: {err}"),
            }
        }
        ExitAction::GiveUp => {
            eprintln!("[Backend] Backend keeps exiting; giving up on restarts.");
            // NOTE: Before ADR-0010 a dead backend left the app silently empty;
            // say so on screen instead of only in a log nobody reads.
            let _ = crate::toast::show_toast_window(
                app.clone(),
                "Rapitas".into(),
                "バックエンドが繰り返し停止したため、自動での再起動を止めました。アプリを再起動してください。"
                    .into(),
                None,
                None,
                None,
            )
            .await;
        }
    }
}

/// Wait for the backend at `pid` to report `ready: true`; if it never does
/// within `READY_TIMEOUT`, kill it so the restart path takes over.
fn watch_readiness(app: tauri::AppHandle, pid: u32) {
    std::thread::spawn(move || {
        let started = Instant::now();
        let mut last_stage: Option<String> = None;
        while started.elapsed() < READY_TIMEOUT {
            if SHUTTING_DOWN.load(Ordering::SeqCst) || !is_current(&app, pid) {
                return;
            }
            if let Some(readiness) = probe_health() {
                if readiness.ready {
                    println!("[Backend] Ready after {:?} (pid {pid})", started.elapsed());
                    return;
                }
                last_stage = readiness.warmup_stage.or(last_stage);
            }
            std::thread::sleep(READY_POLL);
        }
        eprintln!(
            "[Backend] pid {pid} not ready after {READY_TIMEOUT:?} (last warm-up stage: {last_stage:?}); killing it"
        );
        let state = app.state::<Mutex<BackendState>>();
        let mut guard = state.lock().unwrap();
        if guard.child.as_ref().map(|c| c.pid()) == Some(pid) {
            if let Some(child) = guard.child.take() {
                let _ = child.kill();
            }
        }
    });
}

fn is_current(app: &tauri::AppHandle, pid: u32) -> bool {
    let state = app.state::<Mutex<BackendState>>();
    let guard = state.lock().unwrap();
    guard.child.as_ref().map(|c| c.pid()) == Some(pid)
}

/// One `GET /health` over a plain socket (no HTTP client dependency for one call).
fn probe_health() -> Option<crate::sidecar_policy::Readiness> {
    let mut stream =
        TcpStream::connect_timeout(&BACKEND_ADDR.parse().ok()?, Duration::from_secs(2)).ok()?;
    stream.set_read_timeout(Some(Duration::from_secs(5))).ok()?;
    stream
        .write_all(b"GET /health HTTP/1.0\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        .ok()?;
    let mut response = String::new();
    stream.read_to_string(&mut response).ok()?;
    parse_health_response(&response)
}

pub fn kill_backend(app: &tauri::AppHandle) {
    let state = app.state::<Mutex<BackendState>>();
    let mut guard = state.lock().unwrap();
    // Under the state lock, so an in-flight restart either finished storing
    // its child (killed below) or will see the flag and not spawn.
    SHUTTING_DOWN.store(true, Ordering::SeqCst);
    if let Some(child) = guard.child.take() {
        let _ = child.kill();
        println!("Backend stopped.");
    }
    // The backend's own children end when this process exits and the OS
    // closes the job handle (kill-on-close).
}
