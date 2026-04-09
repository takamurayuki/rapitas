//! shortcut_config
//!
//! Persistence and parsing for the global keyboard shortcut that brings
//! the Rapitas window to the foreground. The shortcut string is stored as
//! JSON in `<app_config_dir>/shortcut.json` (e.g.
//! `Ctrl+Alt+R`) and parsed into a `tauri_plugin_global_shortcut::Shortcut`
//! when the app starts or when the user changes it from the UI.

use std::path::PathBuf;
use tauri::Manager;

const DEFAULT_SHORTCUT: &str = "Ctrl+Alt+R";

/// Get the path to the shortcut configuration file.
pub fn shortcut_config_path(app: &tauri::AppHandle) -> PathBuf {
    let app_dir = app
        .path()
        .app_config_dir()
        .expect("failed to get app config dir");
    std::fs::create_dir_all(&app_dir).ok();
    app_dir.join("shortcut.json")
}

/// Load the shortcut string from saved configuration.
pub fn load_shortcut_config(app: &tauri::AppHandle) -> String {
    let path = shortcut_config_path(app);
    if let Ok(content) = std::fs::read_to_string(&path) {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(s) = val["shortcut"].as_str() {
                return s.to_string();
            }
        }
    }
    DEFAULT_SHORTCUT.to_string()
}

/// Parse a shortcut string and convert it to a Shortcut instance.
pub fn parse_shortcut_from_config(config: &str) -> Option<tauri_plugin_global_shortcut::Shortcut> {
    use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut};

    let parts: Vec<&str> = config.split('+').map(|s| s.trim()).collect();
    if parts.is_empty() {
        return None;
    }

    let mut modifiers = Modifiers::empty();
    let key_str = parts.last()?;

    for &part in &parts[..parts.len() - 1] {
        match part.to_lowercase().as_str() {
            "ctrl" | "control" => modifiers |= Modifiers::CONTROL,
            "alt" => modifiers |= Modifiers::ALT,
            "shift" => modifiers |= Modifiers::SHIFT,
            "super" | "meta" | "win" | "cmd" => modifiers |= Modifiers::SUPER,
            _ => {}
        }
    }

    let code = match key_str.to_uppercase().as_str() {
        "A" => Code::KeyA,
        "B" => Code::KeyB,
        "C" => Code::KeyC,
        "D" => Code::KeyD,
        "E" => Code::KeyE,
        "F" => Code::KeyF,
        "G" => Code::KeyG,
        "H" => Code::KeyH,
        "I" => Code::KeyI,
        "J" => Code::KeyJ,
        "K" => Code::KeyK,
        "L" => Code::KeyL,
        "M" => Code::KeyM,
        "N" => Code::KeyN,
        "O" => Code::KeyO,
        "P" => Code::KeyP,
        "Q" => Code::KeyQ,
        "R" => Code::KeyR,
        "S" => Code::KeyS,
        "T" => Code::KeyT,
        "U" => Code::KeyU,
        "V" => Code::KeyV,
        "W" => Code::KeyW,
        "X" => Code::KeyX,
        "Y" => Code::KeyY,
        "Z" => Code::KeyZ,
        "0" => Code::Digit0,
        "1" => Code::Digit1,
        "2" => Code::Digit2,
        "3" => Code::Digit3,
        "4" => Code::Digit4,
        "5" => Code::Digit5,
        "6" => Code::Digit6,
        "7" => Code::Digit7,
        "8" => Code::Digit8,
        "9" => Code::Digit9,
        "F1" => Code::F1,
        "F2" => Code::F2,
        "F3" => Code::F3,
        "F4" => Code::F4,
        "F5" => Code::F5,
        "F6" => Code::F6,
        "F7" => Code::F7,
        "F8" => Code::F8,
        "F9" => Code::F9,
        "F10" => Code::F10,
        "F11" => Code::F11,
        "F12" => Code::F12,
        "SPACE" => Code::Space,
        "ENTER" | "RETURN" => Code::Enter,
        "ESCAPE" | "ESC" => Code::Escape,
        "TAB" => Code::Tab,
        _ => return None,
    };

    let mods = if modifiers.is_empty() {
        None
    } else {
        Some(modifiers)
    };

    Some(Shortcut::new(mods, code))
}
