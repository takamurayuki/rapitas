//! shortcuts
//!
//! Global shortcut Tauri commands (main + quick capture) and shortcut
//! re-registration. Not responsible for config persistence/parsing
//! (see shortcut_config).

use crate::shortcut_config::{
    load_capture_shortcut_config, load_shortcut_config, parse_shortcut_from_config,
    save_shortcut_key,
};

/// Tauri command: get the current shortcut configuration.
#[tauri::command]
pub fn get_global_shortcut(app: tauri::AppHandle) -> String {
    load_shortcut_config(&app)
}

/// Re-register both global shortcuts (main + quick capture) from config.
/// unregister_all first so a stale registration never lingers; when both keys
/// are configured to the same combo it only registers once (main wins).
pub fn reregister_all_shortcuts(app: &tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;

    app.global_shortcut()
        .unregister_all()
        .map_err(|e| format!("Failed to unregister shortcuts: {e}"))?;

    let main_sc = parse_shortcut_from_config(&load_shortcut_config(app));
    if let Some(sc) = main_sc {
        app.global_shortcut()
            .register(sc)
            .map_err(|e| format!("Failed to register shortcut: {e}"))?;
    }
    if let Some(sc) = parse_shortcut_from_config(&load_capture_shortcut_config(app)) {
        if main_sc != Some(sc) {
            app.global_shortcut()
                .register(sc)
                .map_err(|e| format!("Failed to register capture shortcut: {e}"))?;
        }
    }
    Ok(())
}

/// Tauri command: change the global (bring-to-foreground) shortcut and persist it.
#[tauri::command]
pub fn set_global_shortcut(app: tauri::AppHandle, shortcut: String) -> Result<String, String> {
    parse_shortcut_from_config(&shortcut).ok_or_else(|| format!("Invalid shortcut: {shortcut}"))?;
    save_shortcut_key(&app, "shortcut", &shortcut)?;
    reregister_all_shortcuts(&app)?;
    println!("[Shortcut] Global shortcut changed to: {shortcut}");
    Ok(shortcut)
}

/// Tauri command: get the current quick-capture shortcut configuration.
#[tauri::command]
pub fn get_capture_shortcut(app: tauri::AppHandle) -> String {
    load_capture_shortcut_config(&app)
}

/// Tauri command: change the quick-capture shortcut and persist it.
#[tauri::command]
pub fn set_capture_shortcut(app: tauri::AppHandle, shortcut: String) -> Result<String, String> {
    parse_shortcut_from_config(&shortcut).ok_or_else(|| format!("Invalid shortcut: {shortcut}"))?;
    save_shortcut_key(&app, "captureShortcut", &shortcut)?;
    reregister_all_shortcuts(&app)?;
    println!("[Shortcut] Capture shortcut changed to: {shortcut}");
    Ok(shortcut)
}
