//! voice_commands
//!
//! Thin Tauri command wrappers over voice recognition and wake word
//! detection. Implementation lives in voice_recognition / wake_word.

/// Check if the Whisper model is downloaded.
#[tauri::command]
pub fn voice_model_status() -> serde_json::Value {
    serde_json::json!({
        "downloaded": crate::voice_recognition::is_model_downloaded(),
        "recording": crate::voice_recognition::is_recording(),
    })
}

/// Start audio recording, then transcribe when stopped.
#[tauri::command]
pub async fn voice_start_recording() -> Result<String, String> {
    crate::voice_recognition::start_recording()?;

    // Run audio capture in a blocking thread (cpal requires it)
    let wav_path = tokio::task::spawn_blocking(crate::voice_recognition::capture_audio)
        .await
        .map_err(|e| format!("Recording task failed: {e}"))??;

    // Transcribe the captured WAV using whisper.cpp subprocess
    let result = crate::voice_recognition::transcribe(&wav_path, "ja")?;
    Ok(result.text)
}

/// Stop the current recording session.
#[tauri::command]
pub fn voice_stop_recording() {
    crate::voice_recognition::stop_recording();
}

/// Start wake word detection in the background.
/// Monitors the microphone for "ラピタス" and brings the window to the foreground.
#[tauri::command]
pub fn wake_word_start(app: tauri::AppHandle) {
    crate::wake_word::start(app);
}

/// Stop wake word detection.
#[tauri::command]
pub fn wake_word_stop() {
    crate::wake_word::stop();
}

/// Check if wake word detection is active.
#[tauri::command]
pub fn wake_word_status() -> bool {
    crate::wake_word::is_active()
}
