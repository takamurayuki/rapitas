//! terminal
//!
//! Backend for the in-app VS Code-like integrated terminal. Owns one real PTY
//! (ConPTY on Windows, openpty elsewhere) per session via `portable-pty`,
//! streams output to the webview over Tauri events, and accepts keystrokes /
//! resizes / close requests from the frontend through commands.
//!
//! It does NOT own any UI concern (tabs, panes, layout) — that lives in the
//! frontend; this module only manages PTY lifecycles keyed by a session id.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use tauri::{AppHandle, Emitter, Manager, State};

/// Event emitted to the frontend with a chunk of PTY output (base64-encoded).
#[derive(Clone, serde::Serialize)]
struct TerminalOutput {
    id: String,
    /// Base64 of the raw PTY bytes. The frontend decodes to a Uint8Array and
    /// feeds xterm.js, which has its own incremental UTF-8 decoder.
    data: String,
}

/// Event emitted when a PTY reaches EOF (the shell exited).
#[derive(Clone, serde::Serialize)]
struct TerminalExit {
    id: String,
}

/// A single live PTY session.
struct TerminalSession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

/// Tauri-managed registry of all live PTY sessions.
pub struct TerminalManager {
    sessions: Mutex<HashMap<String, TerminalSession>>,
}

impl TerminalManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }

    /// Kill every live PTY and clear the registry. Called on app/tray quit so
    /// no shell (and its children) is left orphaned when the app exits.
    pub fn kill_all(&self) {
        let mut map = self.sessions.lock().unwrap();
        for session in map.values_mut() {
            let _ = session.child.kill();
        }
        map.clear();
    }

    fn remove(&self, id: &str) {
        self.sessions.lock().unwrap().remove(id);
    }
}

/// Resolve the default shell for the current OS when the caller didn't specify
/// one. Mirrors VS Code's default (PowerShell on Windows, $SHELL elsewhere).
fn default_shell() -> String {
    #[cfg(target_os = "windows")]
    {
        // PowerShell to match the user's environment and VS Code's default;
        // a shell picker can override this later.
        "powershell.exe".to_string()
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
    }
}

/// Resolve the working directory: the caller's choice, else the user's home.
fn resolve_cwd(cwd: Option<String>) -> Option<String> {
    if let Some(dir) = cwd {
        if !dir.trim().is_empty() {
            return Some(dir);
        }
    }
    #[cfg(target_os = "windows")]
    let home = std::env::var("USERPROFILE").ok();
    #[cfg(not(target_os = "windows"))]
    let home = std::env::var("HOME").ok();
    home
}

/// PowerShell shell-integration script. Wraps the existing prompt so each new
/// prompt emits OSC 133 markers (D = previous command done + exit code, A/B =
/// prompt bounds). The frontend reads these to detect command completion.
/// Fully wrapped in try/catch so a failure degrades to a normal prompt.
#[cfg(target_os = "windows")]
const SHELL_INTEGRATION_PS1: &str = r#"
try {
  if (-not $Global:__RapitasIntegrated) {
    $Global:__RapitasIntegrated = $true
    $Global:__RapitasOriginalPrompt = $function:prompt
    function Global:prompt {
      $ec = $LASTEXITCODE
      if ($null -eq $ec) { $ec = 0 }
      $p = ''
      try { $p = & $Global:__RapitasOriginalPrompt } catch { $p = "PS $(Get-Location)> " }
      $e = [char]27
      $b = [char]7
      return "$e]133;D;$ec$b$e]133;A$b$p$e]133;B$b"
    }
  }
} catch {}
"#;

/// Write the shell-integration script to a temp file (overwritten each launch
/// so updates apply). Returns its path, or None on failure.
#[cfg(target_os = "windows")]
fn write_integration_script() -> Option<std::path::PathBuf> {
    let path = std::env::temp_dir().join("rapitas-shell-integration.ps1");
    std::fs::write(&path, SHELL_INTEGRATION_PS1).ok()?;
    Some(path)
}

/// Spawn a new PTY session and start streaming its output to the frontend.
///
/// # Arguments
/// * `id` - Caller-assigned unique session id / 呼び出し側が割り当てる一意のセッションID
/// * `shell` - Shell executable; defaults per-OS when omitted / シェル（未指定でOS既定）
/// * `cwd` - Working directory; defaults to home when omitted / 作業ディレクトリ（未指定でホーム）
/// * `cols`/`rows` - Initial terminal size / 初期サイズ
///
/// # Errors
/// Returns a message when the id is already in use or the PTY/shell fails to
/// start. / IDが使用中、またはPTY/シェル起動に失敗した場合にメッセージを返す。
#[tauri::command]
pub fn terminal_create(
    app: AppHandle,
    state: State<'_, TerminalManager>,
    id: String,
    shell: Option<String>,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    {
        let map = state.sessions.lock().unwrap();
        if map.contains_key(&id) {
            return Err(format!("Terminal '{id}' already exists"));
        }
    }

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("openpty failed: {e}"))?;

    let use_default_shell = shell.is_none();
    let shell_path = shell.unwrap_or_else(default_shell);
    let mut cmd = CommandBuilder::new(shell_path);

    // Inject PowerShell shell integration for the default shell so the frontend
    // can detect command completion. Degrades to a plain shell if the script
    // can't be written.
    #[cfg(target_os = "windows")]
    if use_default_shell {
        if let Some(path) = write_integration_script() {
            let dotted = format!(". '{}'", path.display().to_string().replace('\'', "''"));
            cmd.arg("-NoExit");
            cmd.arg("-ExecutionPolicy");
            cmd.arg("Bypass");
            cmd.arg("-Command");
            cmd.arg(dotted);
        }
    }
    #[cfg(not(target_os = "windows"))]
    let _ = use_default_shell;

    if let Some(dir) = resolve_cwd(cwd) {
        cmd.cwd(dir);
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("spawn shell failed: {e}"))?;
    // Drop the slave so the master observes EOF once the shell exits.
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("clone reader failed: {e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("take writer failed: {e}"))?;

    // Reader thread: forward PTY output to the webview until EOF.
    let app_reader = app.clone();
    let id_reader = id.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break, // EOF — shell exited
                Ok(n) => {
                    let payload = TerminalOutput {
                        id: id_reader.clone(),
                        data: BASE64.encode(&buf[..n]),
                    };
                    let _ = app_reader.emit("terminal-output", payload);
                }
                Err(_) => break,
            }
        }
        // Reap the session so an exited shell doesn't linger in the registry.
        if let Some(mgr) = app_reader.try_state::<TerminalManager>() {
            mgr.remove(&id_reader);
        }
        let _ = app_reader.emit("terminal-exit", TerminalExit { id: id_reader });
    });

    state.sessions.lock().unwrap().insert(
        id,
        TerminalSession {
            master: pair.master,
            writer,
            child,
        },
    );
    Ok(())
}

/// Write user keystrokes (UTF-8) to a PTY's stdin.
#[tauri::command]
pub fn terminal_write(
    state: State<'_, TerminalManager>,
    id: String,
    data: String,
) -> Result<(), String> {
    let mut map = state.sessions.lock().unwrap();
    let session = map
        .get_mut(&id)
        .ok_or_else(|| format!("Terminal '{id}' not found"))?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("write failed: {e}"))?;
    session
        .writer
        .flush()
        .map_err(|e| format!("flush failed: {e}"))?;
    Ok(())
}

/// Resize a PTY to match the xterm.js viewport (cols × rows).
#[tauri::command]
pub fn terminal_resize(
    state: State<'_, TerminalManager>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let map = state.sessions.lock().unwrap();
    let session = map
        .get(&id)
        .ok_or_else(|| format!("Terminal '{id}' not found"))?;
    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("resize failed: {e}"))
}

/// Kill a PTY and drop its session.
#[tauri::command]
pub fn terminal_close(state: State<'_, TerminalManager>, id: String) -> Result<(), String> {
    if let Some(mut session) = state.sessions.lock().unwrap().remove(&id) {
        let _ = session.child.kill();
    }
    Ok(())
}

/// Best-effort kill of every PTY. Safe to call when the manager is absent.
pub fn kill_all(app: &AppHandle) {
    if let Some(mgr) = app.try_state::<TerminalManager>() {
        mgr.kill_all();
    }
}
