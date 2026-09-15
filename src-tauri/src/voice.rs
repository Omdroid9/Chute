// On-device voice capture: hold the push-to-talk hotkey to record, release to
// transcribe. Audio never leaves the machine — cpal captures the mic, we
// resample to 16 kHz mono, and whisper.cpp (via whisper-rs) transcribes locally.
// The transcript is emitted to the capture window, which drops it into the
// input box exactly as if the user had typed it.

use std::fs;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

use crate::{window, AppState};

const MODEL_FILE: &str = "ggml-base.en.bin";
// TODO(ship): mirror this to a Chute GitHub release so we don't depend on HF
// availability. Fine for the beta — the URL is stable and native fetch is not
// gated by the JS http allow-list.
const MODEL_URL: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin";
const WHISPER_RATE: u32 = 16_000;

/// Per-app voice state, held in `AppState`. The cpal stream itself is `!Send`,
/// so it never lives here — it stays on the recording thread; we only keep the
/// shared sample buffer, a stop flag, and the thread handle.
pub struct VoiceState {
  recording: Mutex<Option<ActiveRecording>>,
  /// The loaded whisper model, cached so we don't re-read ~140 MB per capture.
  model: Mutex<Option<Arc<WhisperContext>>>,
}

impl VoiceState {
  pub fn new() -> Self {
    Self {
      recording: Mutex::new(None),
      model: Mutex::new(None),
    }
  }
}

struct ActiveRecording {
  samples: Arc<Mutex<Vec<f32>>>,
  input_rate: u32,
  channels: u16,
  stop: Arc<AtomicBool>,
  handle: thread::JoinHandle<()>,
}

fn model_path(app: &AppHandle) -> Result<PathBuf, String> {
  let dir = app
    .path()
    .app_data_dir()
    .map_err(|e| e.to_string())?
    .join("models");
  Ok(dir.join(MODEL_FILE))
}

pub fn model_is_ready(app: &AppHandle) -> bool {
  model_path(app).map(|p| p.exists()).unwrap_or(false)
}

// ---- Recording ------------------------------------------------------------

/// Begin capturing the microphone. Spawns a thread that owns the (`!Send`) cpal
/// stream and pushes samples into a shared buffer until the stop flag is set.
fn start_recording(app: &AppHandle) -> Result<(), String> {
  let state = app.state::<AppState>();
  let mut slot = state.voice.recording.lock().map_err(|_| "voice state poisoned")?;
  if slot.is_some() {
    return Ok(()); // already recording (guards hotkey auto-repeat)
  }

  let stop = Arc::new(AtomicBool::new(false));
  let stop_thread = stop.clone();
  let (tx, rx) = mpsc::channel::<Result<(Arc<Mutex<Vec<f32>>>, u32, u16), String>>();

  let handle = thread::spawn(move || {
    // Everything touching the cpal stream stays on this thread — the stream is
    // not Send and must be created, played, and dropped here.
    let built = (|| -> Result<(Arc<Mutex<Vec<f32>>>, u32, u16, cpal::Stream), String> {
      let host = cpal::default_host();
      let device = host
        .default_input_device()
        .ok_or_else(|| "No microphone was found.".to_string())?;
      let supported = device.default_input_config().map_err(|e| e.to_string())?;
      let sample_format = supported.sample_format();
      let config: cpal::StreamConfig = supported.into();
      let channels = config.channels;
      let rate = config.sample_rate;

      let samples = Arc::new(Mutex::new(Vec::<f32>::new()));
      let sink = samples.clone();
      let err_fn = |err| eprintln!("voice: input stream error: {err}");

      let stream = match sample_format {
        cpal::SampleFormat::F32 => device.build_input_stream(
          config.clone(),
          move |data: &[f32], _: &_| {
            if let Ok(mut buf) = sink.lock() {
              buf.extend_from_slice(data);
            }
          },
          err_fn,
          None,
        ),
        cpal::SampleFormat::I16 => device.build_input_stream(
          config.clone(),
          move |data: &[i16], _: &_| {
            if let Ok(mut buf) = sink.lock() {
              buf.extend(data.iter().map(|&s| s as f32 / 32768.0));
            }
          },
          err_fn,
          None,
        ),
        cpal::SampleFormat::U16 => device.build_input_stream(
          config.clone(),
          move |data: &[u16], _: &_| {
            if let Ok(mut buf) = sink.lock() {
              buf.extend(data.iter().map(|&s| (s as f32 - 32768.0) / 32768.0));
            }
          },
          err_fn,
          None,
        ),
        other => return Err(format!("Unsupported audio format: {other:?}")),
      }
      .map_err(|e| e.to_string())?;

      stream.play().map_err(|e| e.to_string())?;
      Ok((samples, rate, channels, stream))
    })();

    match built {
      Ok((samples, rate, channels, stream)) => {
        let _ = tx.send(Ok((samples, rate, channels)));
        while !stop_thread.load(Ordering::Relaxed) {
          thread::sleep(Duration::from_millis(40));
        }
        drop(stream); // stops the capture
      }
      Err(err) => {
        let _ = tx.send(Err(err));
      }
    }
  });

  match rx.recv() {
    Ok(Ok((samples, input_rate, channels))) => {
      *slot = Some(ActiveRecording {
        samples,
        input_rate,
        channels,
        stop,
        handle,
      });
      Ok(())
    }
    Ok(Err(err)) => {
      let _ = handle.join();
      Err(err)
    }
    Err(_) => Err("Recorder thread stopped unexpectedly.".to_string()),
  }
}

/// Stop the recording, then transcribe on a background thread and emit the
/// result. Never blocks the caller (whisper runs off the event thread).
fn stop_and_transcribe(app: AppHandle) {
  let state = app.state::<AppState>();
  let active = match state.voice.recording.lock() {
    Ok(mut slot) => slot.take(),
    Err(_) => None,
  };

  let Some(active) = active else {
    return; // nothing was recording
  };

  active.stop.store(true, Ordering::Relaxed);
  let _ = active.handle.join();

  let raw = match active.samples.lock() {
    Ok(buf) => buf.clone(),
    Err(_) => Vec::new(),
  };
  let input_rate = active.input_rate;
  let channels = active.channels;

  emit_state(&app, "transcribing");

  thread::spawn(move || {
    let mono = downmix_mono(&raw, channels);
    let audio = resample_linear(&mono, input_rate, WHISPER_RATE);

    if audio.len() < WHISPER_RATE as usize / 5 {
      // < ~200 ms: almost certainly a stray tap, not speech.
      emit_state(&app, "idle");
      return;
    }

    match transcribe(&app, &audio) {
      Ok(text) if !text.is_empty() => {
        let _ = app.emit("chute://voice-transcript", json!({ "text": text }));
        emit_state(&app, "idle");
      }
      Ok(_) => emit_state(&app, "idle"),
      Err(err) => {
        let _ = app.emit("chute://voice-error", json!({ "message": err }));
        emit_state(&app, "idle");
      }
    }
  });
}

fn emit_state(app: &AppHandle, state: &str) {
  let _ = app.emit("chute://voice-state", json!({ "state": state }));
}

// ---- Transcription --------------------------------------------------------

fn transcribe(app: &AppHandle, audio: &[f32]) -> Result<String, String> {
  let ctx = load_model(app)?;
  let mut whisper_state = ctx.create_state().map_err(|e| e.to_string())?;

  let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
  params.set_language(Some("en"));
  params.set_print_special(false);
  params.set_print_progress(false);
  params.set_print_realtime(false);
  params.set_print_timestamps(false);

  whisper_state.full(params, audio).map_err(|e| e.to_string())?;

  let mut text = String::new();
  for segment in whisper_state.as_iter() {
    if let Ok(chunk) = segment.to_str_lossy() {
      text.push_str(&chunk);
    }
  }
  Ok(text.trim().to_string())
}

/// Load (and cache) the whisper model. Errors clearly if it isn't downloaded.
fn load_model(app: &AppHandle) -> Result<Arc<WhisperContext>, String> {
  let state = app.state::<AppState>();
  {
    let guard = state.voice.model.lock().map_err(|_| "voice model poisoned")?;
    if let Some(ctx) = guard.as_ref() {
      return Ok(ctx.clone());
    }
  }

  let path = model_path(app)?;
  if !path.exists() {
    return Err("Voice model isn't installed yet.".to_string());
  }
  let path_str = path.to_string_lossy().to_string();
  let ctx = WhisperContext::new_with_params(&path_str, WhisperContextParameters::default())
    .map_err(|e| e.to_string())?;
  let ctx = Arc::new(ctx);

  if let Ok(mut guard) = state.voice.model.lock() {
    *guard = Some(ctx.clone());
  }
  Ok(ctx)
}

// ---- Audio helpers --------------------------------------------------------

fn downmix_mono(interleaved: &[f32], channels: u16) -> Vec<f32> {
  if channels <= 1 {
    return interleaved.to_vec();
  }
  let ch = channels as usize;
  interleaved
    .chunks(ch)
    .map(|frame| frame.iter().copied().sum::<f32>() / ch as f32)
    .collect()
}

/// Linear-interpolation resampler. Good enough for band-limited speech at
/// 16 kHz; can be swapped for a windowed-sinc resampler later if accuracy asks.
fn resample_linear(input: &[f32], from: u32, to: u32) -> Vec<f32> {
  if from == to || input.is_empty() {
    return input.to_vec();
  }
  let ratio = to as f64 / from as f64;
  let out_len = ((input.len() as f64) * ratio).round() as usize;
  let mut out = Vec::with_capacity(out_len);
  for i in 0..out_len {
    let src = i as f64 / ratio;
    let idx = src.floor() as usize;
    let frac = (src - idx as f64) as f32;
    let a = input.get(idx).copied().unwrap_or(0.0);
    let b = input.get(idx + 1).copied().unwrap_or(a);
    out.push(a + (b - a) * frac);
  }
  out
}

// ---- Push-to-talk entry points (called from the global-shortcut handler) ---

pub fn ptt_pressed(app: &AppHandle) {
  match start_recording(app) {
    Ok(()) => {
      let _ = window::show_capture_window(app);
      emit_state(app, "recording");
    }
    Err(err) => {
      let _ = app.emit("chute://voice-error", json!({ "message": err }));
    }
  }
}

pub fn ptt_released(app: &AppHandle) {
  stop_and_transcribe(app.clone());
}

// ---- Commands (mic button + model management from the UI) -----------------

#[tauri::command]
pub fn voice_start(app: AppHandle) -> Result<(), String> {
  start_recording(&app)?;
  emit_state(&app, "recording");
  Ok(())
}

#[tauri::command]
pub fn voice_stop(app: AppHandle) {
  stop_and_transcribe(app);
}

#[tauri::command]
pub fn voice_model_status(app: AppHandle) -> String {
  if model_is_ready(&app) {
    "ready".to_string()
  } else {
    "needs-model".to_string()
  }
}

/// Download the model to the app data dir, emitting progress. Returns
/// immediately; the UI follows `chute://voice-model-*` events.
#[tauri::command]
pub fn voice_download_model(app: AppHandle) -> Result<(), String> {
  let dest = model_path(&app)?;
  if dest.exists() {
    let _ = app.emit("chute://voice-model-done", json!({}));
    return Ok(());
  }
  let dir = dest
    .parent()
    .ok_or_else(|| "bad model path".to_string())?
    .to_path_buf();

  thread::spawn(move || {
    if let Err(err) = download_model(&app, &dir, &dest) {
      let _ = app.emit("chute://voice-model-error", json!({ "message": err }));
    } else {
      let _ = app.emit("chute://voice-model-done", json!({}));
    }
  });
  Ok(())
}

fn download_model(app: &AppHandle, dir: &PathBuf, dest: &PathBuf) -> Result<(), String> {
  fs::create_dir_all(dir).map_err(|e| e.to_string())?;
  let tmp = dest.with_extension("bin.part");

  let mut resp = reqwest::blocking::get(MODEL_URL).map_err(|e| e.to_string())?;
  if !resp.status().is_success() {
    return Err(format!("Download failed (HTTP {}).", resp.status().as_u16()));
  }
  let total = resp.content_length().unwrap_or(0);

  let mut file = fs::File::create(&tmp).map_err(|e| e.to_string())?;
  let mut buf = [0u8; 65_536];
  let mut downloaded: u64 = 0;
  loop {
    let n = resp.read(&mut buf).map_err(|e| e.to_string())?;
    if n == 0 {
      break;
    }
    file.write_all(&buf[..n]).map_err(|e| e.to_string())?;
    downloaded += n as u64;
    let _ = app.emit(
      "chute://voice-model-progress",
      json!({ "downloaded": downloaded, "total": total }),
    );
  }
  file.flush().map_err(|e| e.to_string())?;
  fs::rename(&tmp, dest).map_err(|e| e.to_string())?;
  Ok(())
}
