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

mod shortcut_config;

mod app_setup;
mod browser;
mod pomodoro_float;
mod quick_capture;
mod shortcuts;
mod toast;
mod voice_commands;
mod window_commands;

fn main() {
    app_setup::run();
}
