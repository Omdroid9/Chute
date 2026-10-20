// On-device voice capture: hold Right ⌘ (or the mic button) to record, release
// to transcribe. Audio never leaves the machine — cpal captures the mic, we
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

use crate::{mic_permission, window, AppState};

const MODEL_FILE: &str = "ggml-base.en.bin";
// TODO(ship): mirror this to a Chute GitHub release so we don't depend on HF
// availability. Fine for the beta — the URL is stable and native fetch is not
// gated by the JS http allow-list.
const MODEL_URL: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin";
const WHISPER_RATE: u32 = 16_000;
/// Reject clips shorter than this (stray taps).
const MIN_AUDIO_SAMPLES: usize = WHISPER_RATE as usize / 5; // ~200 ms
const HEAR_NOTHING_MSG: &str =
  "Couldn't hear that — hold longer and speak clearly.";

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
  // cpal will open a silent stream if Microphone TCC isn't granted — whisper
  // then invents "you". Force the real macOS prompt first.
  mic_permission::ensure_microphone_access(app)?;

  let state = app.state::<AppState>();
  let mut slot = state.voice.recording.lock().map_err(|_| "voice state poisoned")?;
  if slot.is_some() {
    return Ok(()); // already recording (guards key auto-repeat)
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
      let err_fn = |err| eprintln!("[voice] input stream error: {err}");

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
    let mut audio = resample_linear(&mono, input_rate, WHISPER_RATE);
    audio = trim_silence(&audio, WHISPER_RATE);
    normalize_peak(&mut audio);

    let duration_ms = (audio.len() as f64 / WHISPER_RATE as f64 * 1000.0) as u64;
    let rms = rms_energy(&audio);
    eprintln!(
      "[voice] rate={}Hz ch={} raw_frames={} out_samples={} duration_ms={} rms={:.4}",
      input_rate,
      channels,
      mono.len(),
      audio.len(),
      duration_ms,
      rms
    );

    // Always keep the last clip for local debugging (overwritten each capture).
    if let Err(err) = dump_debug_wav(&app, &audio) {
      eprintln!("[voice] wav dump failed: {err}");
    }

    // ~0.01 RMS ≈ quiet room / denied mic (silence). Be loud about it.
    if audio.len() < MIN_AUDIO_SAMPLES || rms < 0.01 {
      let msg = if rms < 0.01 {
        format!(
          "Microphone seems silent (level {rms:.4}). Check System Settings → Privacy & Security → Microphone → Chute is on, then hold and speak louder."
        )
      } else {
        HEAR_NOTHING_MSG.to_string()
      };
      let _ = app.emit("chute://voice-error", json!({ "message": msg }));
      emit_state(&app, "idle");
      return;
    }

    match transcribe(&app, &audio) {
      Ok(text) if !text.is_empty() => {
        eprintln!("[voice] transcript len={}", text.len());
        let _ = app.emit("chute://voice-transcript", json!({ "text": text }));
        emit_state(&app, "idle");
      }
      Ok(_) => {
        let _ = app.emit(
          "chute://voice-error",
          json!({ "message": HEAR_NOTHING_MSG }),
        );
        emit_state(&app, "idle");
      }
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

  // Tuned for short push-to-talk clips. Avoid single_segment — it forces an
  // emission and is a common source of "you" / "thank you" hallucinations on
  // quiet or short buffers.
  let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
  params.set_language(Some("en"));
  params.set_translate(false);
  params.set_no_context(true);
  params.set_suppress_blank(true);
  params.set_suppress_nst(true);
  params.set_no_speech_thold(0.85);
  params.set_entropy_thold(2.4);
  params.set_logprob_thold(-0.8);
  params.set_temperature(0.0);
  params.set_duration_ms(((audio.len() as f64 / WHISPER_RATE as f64) * 1000.0) as i32);
  params.set_print_special(false);
  params.set_print_progress(false);
  params.set_print_realtime(false);
  params.set_print_timestamps(false);

  whisper_state.full(params, audio).map_err(|e| e.to_string())?;

  let mut chunks = Vec::new();
  for segment in whisper_state.as_iter() {
    let no_speech = segment.no_speech_probability();
    if no_speech > 0.7 {
      eprintln!("[voice] drop segment (no_speech={no_speech:.2})");
      continue;
    }
    if let Ok(chunk) = segment.to_str_lossy() {
      let trimmed = chunk.trim();
      if !trimmed.is_empty() && !is_hallucination(trimmed) {
        chunks.push(trimmed.to_string());
      } else if !trimmed.is_empty() {
        eprintln!("[voice] drop hallucination segment: {trimmed:?}");
      }
    }
  }
  let text = join_transcript_chunks(&chunks);
  if is_hallucination(&text) {
    eprintln!("[voice] rejecting hallucinated transcript: {text:?}");
    return Ok(String::new());
  }
  Ok(text)
}

/// Whisper's classic short-clip hallucinations — treat as "heard nothing".
fn is_hallucination(text: &str) -> bool {
  let t = text
    .trim()
    .trim_matches(|c: char| c.is_ascii_punctuation())
    .to_ascii_lowercase();
  if t.is_empty() {
    return true;
  }
  matches!(
    t.as_str(),
    "you"
      | "thank you"
      | "thanks"
      | "thanks for watching"
      | "thank you for watching"
      | "please subscribe"
      | "bye"
      | "hmm"
      | "uh"
      | "um"
      | "ah"
      | "oh"
      | "the"
      | "a"
      | "i"
      | "and"
  )
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

/// Linear-interpolation resampler. Speech is band-limited enough that this is
/// fine for 48→16 kHz once we trim silence and normalize; a sinc resampler can
/// replace this later if accuracy still asks.
fn resample_linear(input: &[f32], from: u32, to: u32) -> Vec<f32> {
  if from == 0 || to == 0 {
    return Vec::new();
  }
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

/// Drop leading/trailing near-silence so whisper doesn't invent filler from
/// the quiet head/tail of a PTT hold.
fn trim_silence(samples: &[f32], sample_rate: u32) -> Vec<f32> {
  if samples.is_empty() {
    return Vec::new();
  }
  let threshold = 0.01_f32;
  let pad = (sample_rate as usize / 50).max(1); // ~20 ms keep before/after speech

  let first = samples.iter().position(|&s| s.abs() >= threshold);
  let last = samples.iter().rposition(|&s| s.abs() >= threshold);
  match (first, last) {
    (Some(start), Some(end)) if end >= start => {
      let from = start.saturating_sub(pad);
      let to = (end + 1 + pad).min(samples.len());
      samples[from..to].to_vec()
    }
    _ => samples.to_vec(),
  }
}

fn normalize_peak(samples: &mut [f32]) {
  let peak = samples
    .iter()
    .fold(0.0_f32, |acc, &s| acc.max(s.abs()));
  if peak < 1e-6 || peak > 0.95 {
    // Too quiet to help, or already loud enough.
    if peak >= 1e-6 && peak < 0.05 {
      let gain = 0.7 / peak;
      for s in samples.iter_mut() {
        *s = (*s * gain).clamp(-1.0, 1.0);
      }
    }
    return;
  }
  let gain = 0.9 / peak;
  for s in samples.iter_mut() {
    *s = (*s * gain).clamp(-1.0, 1.0);
  }
}

fn rms_energy(samples: &[f32]) -> f32 {
  if samples.is_empty() {
    return 0.0;
  }
  let sum: f32 = samples.iter().map(|s| s * s).sum();
  (sum / samples.len() as f32).sqrt()
}

fn join_transcript_chunks(chunks: &[String]) -> String {
  chunks
    .iter()
    .map(|c| c.trim())
    .filter(|c| !c.is_empty())
    .collect::<Vec<_>>()
    .join(" ")
}

fn dump_debug_wav(app: &AppHandle, audio: &[f32]) -> Result<(), String> {
  let path = app
    .path()
    .app_data_dir()
    .map_err(|e| e.to_string())?
    .join("voice-last.wav");
  write_wav_f32(&path, audio, WHISPER_RATE)
}

fn write_wav_f32(path: &PathBuf, samples: &[f32], sample_rate: u32) -> Result<(), String> {
  let mut pcm = Vec::with_capacity(samples.len() * 2);
  for &s in samples {
    let v = (s.clamp(-1.0, 1.0) * 32767.0) as i16;
    pcm.extend_from_slice(&v.to_le_bytes());
  }
  let data_len = pcm.len() as u32;
  let mut out = Vec::with_capacity(44 + pcm.len());
  out.extend_from_slice(b"RIFF");
  out.extend_from_slice(&(36 + data_len).to_le_bytes());
  out.extend_from_slice(b"WAVE");
  out.extend_from_slice(b"fmt ");
  out.extend_from_slice(&16u32.to_le_bytes()); // PCM chunk size
  out.extend_from_slice(&1u16.to_le_bytes()); // audio format = PCM
  out.extend_from_slice(&1u16.to_le_bytes()); // mono
  out.extend_from_slice(&sample_rate.to_le_bytes());
  let byte_rate = sample_rate * 2;
  out.extend_from_slice(&byte_rate.to_le_bytes());
  out.extend_from_slice(&2u16.to_le_bytes()); // block align
  out.extend_from_slice(&16u16.to_le_bytes()); // bits per sample
  out.extend_from_slice(b"data");
  out.extend_from_slice(&data_len.to_le_bytes());
  out.extend_from_slice(&pcm);
  fs::write(path, out).map_err(|e| e.to_string())
}

// ---- Push-to-talk entry points (Right ⌘ tap / mic button) -----------------

pub fn ptt_pressed(app: &AppHandle) {
  match start_recording(app) {
    Ok(()) => {
      let _ = window::show_capture_window(app);
      emit_state(app, "recording");
    }
    Err(err) => {
      // Always raise capture so the UI can show the error (mic denied, etc.).
      let _ = window::show_capture_window(app);
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

/// Debug helper: transcribe a WAV from disk so whisper can be proven without
/// exercising the mic / hotkey path. Expects (or resamples to) 16 kHz mono.
#[tauri::command]
pub fn voice_debug_transcribe_wav(app: AppHandle, path: String) -> Result<String, String> {
  let samples = read_wav_f32_mono_16k(PathBuf::from(path.trim()))?;
  if samples.len() < MIN_AUDIO_SAMPLES {
    return Err("WAV is too short to transcribe.".to_string());
  }
  let mut audio = samples;
  audio = trim_silence(&audio, WHISPER_RATE);
  normalize_peak(&mut audio);
  transcribe(&app, &audio)
}

fn read_wav_f32_mono_16k(path: PathBuf) -> Result<Vec<f32>, String> {
  let bytes = fs::read(&path).map_err(|e| e.to_string())?;
  if bytes.len() < 44 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
    return Err("Not a WAV file.".to_string());
  }
  // Minimal PCM WAV parser (fmt + data chunks).
  let mut offset = 12usize;
  let mut sample_rate = 0u32;
  let mut channels = 0u16;
  let mut bits = 0u16;
  let mut data: &[u8] = &[];
  while offset + 8 <= bytes.len() {
    let id = &bytes[offset..offset + 4];
    let size = u32::from_le_bytes(bytes[offset + 4..offset + 8].try_into().unwrap()) as usize;
    let start = offset + 8;
    let end = start.saturating_add(size).min(bytes.len());
    if id == b"fmt " && size >= 16 {
      channels = u16::from_le_bytes(bytes[start + 2..start + 4].try_into().unwrap());
      sample_rate = u32::from_le_bytes(bytes[start + 4..start + 8].try_into().unwrap());
      bits = u16::from_le_bytes(bytes[start + 14..start + 16].try_into().unwrap());
    } else if id == b"data" {
      data = &bytes[start..end];
    }
    offset = end + (size % 2); // word-align
  }
  if sample_rate == 0 || channels == 0 || data.is_empty() {
    return Err("WAV is missing fmt/data.".to_string());
  }
  if bits != 16 {
    return Err(format!("Expected 16-bit PCM WAV, got {bits}-bit."));
  }
  let mut samples = Vec::with_capacity(data.len() / 2);
  for chunk in data.chunks_exact(2) {
    let v = i16::from_le_bytes([chunk[0], chunk[1]]);
    samples.push(v as f32 / 32768.0);
  }
  let mono = downmix_mono(&samples, channels);
  Ok(resample_linear(&mono, sample_rate, WHISPER_RATE))
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

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn downmix_averages_stereo_frames() {
    let interleaved = vec![1.0, -1.0, 0.5, 0.5];
    let mono = downmix_mono(&interleaved, 2);
    assert_eq!(mono, vec![0.0, 0.5]);
  }

  #[test]
  fn downmix_passthrough_mono() {
    let samples = vec![0.1, 0.2, 0.3];
    assert_eq!(downmix_mono(&samples, 1), samples);
  }

  #[test]
  fn resample_identity_when_rates_match() {
    let input = vec![0.0, 0.5, 1.0];
    assert_eq!(resample_linear(&input, 16_000, 16_000), input);
  }

  #[test]
  fn resample_halves_length_when_downsampling_2x() {
    let input: Vec<f32> = (0..100).map(|i| (i as f32) / 100.0).collect();
    let out = resample_linear(&input, 32_000, 16_000);
    assert!((out.len() as i32 - 50).abs() <= 1);
  }

  #[test]
  fn trim_silence_keeps_speech_core() {
    let mut samples = vec![0.0_f32; 1000];
    for s in samples.iter_mut().skip(400).take(200) {
      *s = 0.5;
    }
    let trimmed = trim_silence(&samples, 16_000);
    assert!(trimmed.len() < samples.len());
    assert!(trimmed.iter().any(|s| s.abs() >= 0.5));
  }

  #[test]
  fn join_chunks_with_spaces() {
    let chunks = vec!["call mom".into(), "tomorrow".into()];
    assert_eq!(join_transcript_chunks(&chunks), "call mom tomorrow");
  }

  #[test]
  fn rejects_common_hallucinations() {
    assert!(is_hallucination("you"));
    assert!(is_hallucination("Thank you."));
    assert!(is_hallucination("  thanks for watching  "));
    assert!(!is_hallucination("call mom tomorrow"));
    assert!(!is_hallucination("testing"));
  }

  #[test]
  fn normalize_boosts_quiet_speech() {
    let mut samples = vec![0.01_f32, -0.01, 0.008];
    normalize_peak(&mut samples);
    let peak = samples.iter().fold(0.0_f32, |a, &s| a.max(s.abs()));
    assert!(peak > 0.5);
  }

  #[test]
  fn write_wav_roundtrips_header() {
    let dir = std::env::temp_dir().join("chute-voice-test");
    let _ = fs::create_dir_all(&dir);
    let path = dir.join("test.wav");
    let samples = vec![0.0_f32, 0.5, -0.5, 0.0];
    write_wav_f32(&path, &samples, 16_000).expect("write");
    let bytes = fs::read(&path).expect("read");
    assert_eq!(&bytes[0..4], b"RIFF");
    assert_eq!(&bytes[8..12], b"WAVE");
    let _ = fs::remove_file(&path);
  }
}
