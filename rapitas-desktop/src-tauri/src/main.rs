//! main
//!
//! Crate root: module declarations only. Bootstrap and the Tauri builder
//! live in app_setup; commands live in their responsibility modules.

// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(target_os = "windows")]
mod window_manager;

mod browser_launcher;

#[cfg(target_os = "windows")]
mod split_screen_manager;

mod voice_recognition;
mod wake_word;

mod terminal;

#[cfg(not(debug_assertions))]
mod release;
#[cfg(not(debug_assertions))]
mod sidecar_launch;

// Sidecar supervision (ADR-0010 phase 1). Used only by `release`, but also
// compiled for tests so its decisions are tested in the normal debug run.
#[cfg(all(target_os = "windows", any(test, not(debug_assertions))))]
mod sidecar_job;
#[cfg(any(test, not(debug_assertions)))]
mod sidecar_policy;

mod shortcut_config;

mod app_icon;
mod app_setup;
mod browser;
mod dev_server_wait;
mod frame_options;
mod link_webview;
mod main_window;
mod pomodoro_float;
mod quick_capture;
mod rapi_float;
mod shortcuts;
mod toast;
mod today_todo;
mod voice_commands;
mod window_commands;

fn main() {
    app_setup::run();
}
