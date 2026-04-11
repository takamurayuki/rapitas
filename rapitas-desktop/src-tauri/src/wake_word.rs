//! Wake Word Detector
//!
//! Continuously monitors the microphone in the background for a wake word.
//! When detected, brings the Rapitas window to the foreground.
//!
//! Strategy:
//!   1. Low-power audio monitoring via cpal (RMS volume check)
//!   2. When voice activity detected, record a 2-second clip
//!   3. Transcribe the clip with whisper.cpp
//!   4. Check if transcript contains the wake word
//!   5. If yes, emit event to frontend and show window

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Whether wake word detection is active.
static WAKE_WORD_ACTIVE: AtomicBool = AtomicBool::new(false);

/// Keywords that trigger activation (checked case-insensitively).
const WAKE_WORDS: &[&str] = &["ラピタス", "らぴたす", "rapitas", "ラピプラス", "rapi"];

/// RMS threshold for voice activity detection.
const VAD_THRESHOLD: f32 = 0.008;

/// Duration to record after voice activity is detected.
const CLIP_DURATION: Duration = Duration::from_secs(2);

/// Cooldown after a successful detection to avoid rapid re-triggers.
const COOLDOWN: Duration = Duration::from_secs(3);

/// Check if the wake word detector is running.
pub fn is_active() -> bool {
    WAKE_WORD_ACTIVE.load(Ordering::SeqCst)
}

/// Start the wake word detector in a background thread.
///
/// Returns immediately. The detector runs until `stop()` is called.
pub fn start(app_handle: tauri::AppHandle) {
    if WAKE_WORD_ACTIVE.load(Ordering::SeqCst) {
        return;
    }
    WAKE_WORD_ACTIVE.store(true, Ordering::SeqCst);

    std::thread::spawn(move || {
        if let Err(e) = detection_loop(&app_handle) {
            eprintln!("[wake_word] Detection loop error: {e}");
        }
        WAKE_WORD_ACTIVE.store(false, Ordering::SeqCst);
    });
}

/// Stop the wake word detector.
pub fn stop() {
    WAKE_WORD_ACTIVE.store(false, Ordering::SeqCst);
}

/// Main detection loop.
fn detection_loop(app_handle: &tauri::AppHandle) -> Result<(), String> {
    let host = cpal::default_host();
    let device = host.default_input_device().ok_or("No input device found")?;

    let config = device
        .default_input_config()
        .map_err(|e| format!("Input config error: {e}"))?;

    let sample_rate = config.sample_rate().0;
    let channels = config.channels() as usize;

    // Shared RMS level for voice activity detection
    let rms_level: Arc<Mutex<f32>> = Arc::new(Mutex::new(0.0));
    let rms_clone = rms_level.clone();

    // Shared buffer for recording clips
    let clip_buffer: Arc<Mutex<Vec<f32>>> = Arc::new(Mutex::new(Vec::new()));
    let clip_clone = clip_buffer.clone();
    let is_recording_clip = Arc::new(AtomicBool::new(false));
    let is_recording_clone = is_recording_clip.clone();

    let err_fn = |err: cpal::StreamError| {
        eprintln!("[wake_word] Stream error: {err}");
    };

    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => device.build_input_stream(
            &config.into(),
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                // Calculate RMS
                let mut sum = 0.0f32;
                for chunk in data.chunks(channels) {
                    let mono = chunk.iter().sum::<f32>() / channels as f32;
                    sum += mono * mono;

                    // If recording a clip, store the sample
                    if is_recording_clone.load(Ordering::Relaxed) {
                        if let Ok(mut buf) = clip_clone.try_lock() {
                            buf.push(mono);
                        }
                    }
                }
                let rms = (sum / (data.len() / channels) as f32).sqrt();
                if let Ok(mut level) = rms_clone.try_lock() {
                    *level = rms;
                }
            },
            err_fn,
            None,
        ),
        cpal::SampleFormat::I16 => device.build_input_stream(
            &config.into(),
            move |data: &[i16], _: &cpal::InputCallbackInfo| {
                let mut sum = 0.0f32;
                for chunk in data.chunks(channels) {
                    let mono =
                        chunk.iter().map(|&s| s as f32 / 32768.0).sum::<f32>() / channels as f32;
                    sum += mono * mono;
                    if is_recording_clone.load(Ordering::Relaxed) {
                        if let Ok(mut buf) = clip_clone.try_lock() {
                            buf.push(mono);
                        }
                    }
                }
                let rms = (sum / (data.len() / channels) as f32).sqrt();
                if let Ok(mut level) = rms_clone.try_lock() {
                    *level = rms;
                }
            },
            err_fn,
            None,
        ),
        f => return Err(format!("Unsupported format: {f:?}")),
    }
    .map_err(|e| format!("Build stream error: {e}"))?;

    stream.play().map_err(|e| format!("Play error: {e}"))?;

    let mut last_detection = Instant::now() - COOLDOWN;

    while WAKE_WORD_ACTIVE.load(Ordering::SeqCst) {
        std::thread::sleep(Duration::from_millis(100));

        let current_rms = *rms_level.lock().unwrap();

        // Voice activity detected?
        if current_rms > VAD_THRESHOLD && last_detection.elapsed() > COOLDOWN {
            // Record a short clip
            is_recording_clip.store(true, Ordering::SeqCst);
            clip_buffer.lock().unwrap().clear();

            std::thread::sleep(CLIP_DURATION);

            is_recording_clip.store(false, Ordering::SeqCst);

            let samples: Vec<f32> = clip_buffer.lock().unwrap().clone();

            if samples.len() < 1000 {
                continue;
            }

            // Resample to 16kHz if needed
            let pcm_16k = if sample_rate == 16000 {
                samples
            } else {
                resample(&samples, sample_rate, 16000)
            };

            // Write to temp WAV and transcribe
            match transcribe_clip(&pcm_16k) {
                Ok(text) => {
                    let lower = text.to_lowercase();
                    if WAKE_WORDS
                        .iter()
                        .any(|kw| lower.contains(&kw.to_lowercase()))
                    {
                        last_detection = Instant::now();

                        // Emit event to frontend
                        // NOTE: Tauri 2.x uses Emitter trait from tauri::Manager.
                        use tauri::Emitter;
                        let _ = app_handle.emit("wake-word-detected", &text);

                        // Bring window to foreground
                        use tauri::Manager;
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                }
                Err(e) => {
                    eprintln!("[wake_word] Transcription error: {e}");
                }
            }
        }
    }

    drop(stream);
    Ok(())
}

/// Transcribe a short PCM clip using whisper.cpp.
fn transcribe_clip(samples: &[f32]) -> Result<String, String> {
    let result = crate::voice_recognition::transcribe_pcm(samples, "ja")?;
    Ok(result.text)
}

/// Simple linear resampling.
fn resample(samples: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
    let ratio = from_rate as f64 / to_rate as f64;
    let output_len = (samples.len() as f64 / ratio) as usize;
    let mut output = Vec::with_capacity(output_len);
    for i in 0..output_len {
        let src_idx = i as f64 * ratio;
        let idx = src_idx as usize;
        let frac = src_idx - idx as f64;
        if idx + 1 < samples.len() {
            output
                .push((samples[idx] as f64 * (1.0 - frac) + samples[idx + 1] as f64 * frac) as f32);
        } else if idx < samples.len() {
            output.push(samples[idx]);
        }
    }
    output
}
