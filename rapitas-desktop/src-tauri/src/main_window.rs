//! main_window
//!
//! Builds the main window from its `tauri.conf.json` entry, with every
//! response of the bundled app carrying `X-Frame-Options: DENY`.
//!
//! Why the window is built here and not declared: Tauri's configurable
//! response headers (`app.security.headers`) are a fixed allow-list without
//! `X-Frame-Options`, and Next's `headers()` does not apply to the static
//! export the desktop build ships. The only hook on the app's own responses
//! is `on_web_resource_request`, which exists on a window builder only, so
//! the entry is marked `"create": false` and built from its config here.
//!
//! Not responsible for: the dev build's documents, which come from the Next
//! dev server (devUrl) and get both headers from next.config.ts.

use crate::frame_options::{deny_framing, MAIN_WINDOW_LABEL};

/// Build the main window from its config entry, with framing denied.
///
/// Must run first in `setup`: everything after it (the Windows icon hook,
/// the dev-server watch) expects the main window to exist.
///
/// # Arguments
/// * `app` - The app being set up / 起動中のアプリ
///
/// # Errors
/// Returns an error when the config has no main window entry or the window
/// cannot be created. / main の設定が無い・作成できない場合
pub fn build(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == MAIN_WINDOW_LABEL)
        .ok_or("tauri.conf.json has no main window entry")?
        .clone();
    tauri::WebviewWindowBuilder::from_config(app.handle(), &config)?
        .on_web_resource_request(|_request, response| deny_framing(response.headers_mut()))
        .build()?;
    Ok(())
}
