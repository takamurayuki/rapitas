//! shortcuts
//!
//! Global shortcut Tauri commands (main + quick capture + today's todo) and
//! shortcut re-registration. Not responsible for config persistence/parsing
//! (see shortcut_config).

use crate::shortcut_config::{
    load_capture_shortcut_config, load_shortcut_config, load_todo_shortcut_config,
    parse_shortcut_from_config, save_shortcut_key,
};
use tauri_plugin_global_shortcut::Shortcut;

/// Tauri command: get the current shortcut configuration.
#[tauri::command]
pub fn get_global_shortcut(app: tauri::AppHandle) -> String {
    load_shortcut_config(&app)
}

/// Decide which of the three configured shortcuts should actually be
/// registered, applying pairwise dedup so a combo shared by two or three of
/// them only registers once (priority: main > capture > todo).
///
/// Pure and Tauri-runtime-free so the dedup rule itself is unit-testable
/// without a live `AppHandle`/`GlobalShortcut` plugin instance.
fn shortcuts_to_register(
    main_sc: Option<Shortcut>,
    capture_sc: Option<Shortcut>,
    todo_sc: Option<Shortcut>,
) -> Vec<Shortcut> {
    let mut out = Vec::new();
    if let Some(sc) = main_sc {
        out.push(sc);
    }
    if let Some(sc) = capture_sc {
        if main_sc != Some(sc) {
            out.push(sc);
        }
    }
    if let Some(sc) = todo_sc {
        if main_sc != Some(sc) && capture_sc != Some(sc) {
            out.push(sc);
        }
    }
    out
}

/// Re-register all three global shortcuts (main + quick capture + today's
/// todo) from config. unregister_all first so a stale registration never
/// lingers; pairwise-compares every combo against the ones already
/// registered so a key shared by two or three of them only registers once
/// (main wins over capture, both win over todo).
pub fn reregister_all_shortcuts(app: &tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;

    app.global_shortcut()
        .unregister_all()
        .map_err(|e| format!("Failed to unregister shortcuts: {e}"))?;

    let main_sc = parse_shortcut_from_config(&load_shortcut_config(app));
    let capture_sc = parse_shortcut_from_config(&load_capture_shortcut_config(app));
    let todo_sc = parse_shortcut_from_config(&load_todo_shortcut_config(app));

    for sc in shortcuts_to_register(main_sc, capture_sc, todo_sc) {
        app.global_shortcut()
            .register(sc)
            .map_err(|e| format!("Failed to register shortcut: {e}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    fn sc(s: &str) -> Shortcut {
        Shortcut::from_str(s).expect("valid shortcut string in test fixture")
    }

    #[test]
    fn all_three_distinct_registers_all_three() {
        let result = shortcuts_to_register(Some(sc("Ctrl+Alt+R")), Some(sc("Ctrl+Alt+I")), Some(sc("Ctrl+Alt+T")));
        assert_eq!(result, vec![sc("Ctrl+Alt+R"), sc("Ctrl+Alt+I"), sc("Ctrl+Alt+T")]);
    }

    #[test]
    fn capture_matching_main_is_deduped() {
        let result = shortcuts_to_register(Some(sc("Ctrl+Alt+R")), Some(sc("Ctrl+Alt+R")), Some(sc("Ctrl+Alt+T")));
        assert_eq!(result, vec![sc("Ctrl+Alt+R"), sc("Ctrl+Alt+T")]);
    }

    #[test]
    fn todo_matching_main_is_deduped() {
        let result = shortcuts_to_register(Some(sc("Ctrl+Alt+R")), Some(sc("Ctrl+Alt+I")), Some(sc("Ctrl+Alt+R")));
        assert_eq!(result, vec![sc("Ctrl+Alt+R"), sc("Ctrl+Alt+I")]);
    }

    #[test]
    fn todo_matching_capture_is_deduped() {
        let result = shortcuts_to_register(Some(sc("Ctrl+Alt+R")), Some(sc("Ctrl+Alt+I")), Some(sc("Ctrl+Alt+I")));
        assert_eq!(result, vec![sc("Ctrl+Alt+R"), sc("Ctrl+Alt+I")]);
    }

    #[test]
    fn all_three_identical_registers_only_main() {
        let result = shortcuts_to_register(Some(sc("Ctrl+Alt+R")), Some(sc("Ctrl+Alt+R")), Some(sc("Ctrl+Alt+R")));
        assert_eq!(result, vec![sc("Ctrl+Alt+R")]);
    }

    #[test]
    fn none_configured_registers_nothing() {
        assert_eq!(shortcuts_to_register(None, None, None), Vec::<Shortcut>::new());
    }
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
