// PixelKleur — audio (CLAUDE.md §13).
// WebAudio-synthesized tones rather than baked files: self-hosted with zero
// asset weight, and it sidesteps ever needing to author/replace .ogg files.
import * as storage from './storage.js';

const FILL_THROTTLE_MS = 60; // at most one fill sound per drag tick (§13)
const FILL_BASE_FREQ = 440; // A4
const FILL_SEMITONE_RANGE = 7; // rises up to a fifth as a color nears completion

let ctx = null;
let muted = storage.getSettings().muted;
let lastFillAt = 0;

function ensureContext() {
  if (ctx) return ctx;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  ctx = new AudioContextClass();
  return ctx;
}

// Must run inside a user-gesture handler — Chrome suspends new/backgrounded
// AudioContexts until one does (§13).
export function unlock() {
  const audioCtx = ensureContext();
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
}

export function isMuted() {
  return muted;
}

export function setMuted(value) {
  muted = value;
  storage.setSettings({ ...storage.getSettings(), muted: value });
}

function semitoneRatio(semitones) {
  return Math.pow(2, semitones / 12);
}

function playTone({ freq, duration, type = 'sine', peakGain = 0.15, delay = 0 }) {
  if (muted) return;
  const audioCtx = ensureContext();
  if (!audioCtx) return;
  const startAt = audioCtx.currentTime + delay;

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, startAt);
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(peakGain, startAt + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, startAt + duration);

  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(startAt);
  osc.stop(startAt + duration + 0.02);
}

// Fill blip. `progress` (0..1) is how full the current color is, so pitch
// rises toward completion and resets when a new color is selected (§13).
export function playFill(progress = 0) {
  const now = performance.now();
  if (now - lastFillAt < FILL_THROTTLE_MS) return;
  lastFillAt = now;

  const semitones = Math.min(FILL_SEMITONE_RANGE, Math.max(0, progress) * FILL_SEMITONE_RANGE);
  playTone({ freq: FILL_BASE_FREQ * semitoneRatio(semitones), duration: 0.08, type: 'sine', peakGain: 0.12 });
}

// Soft two-note chime when a color's every cell is filled.
export function playColorDone() {
  playTone({ freq: 660, duration: 0.18, type: 'triangle', peakGain: 0.15 });
  playTone({ freq: 880, duration: 0.22, type: 'triangle', peakGain: 0.12, delay: 0.08 });
}

// Completion fanfare — short ascending arpeggio.
export function playFanfare() {
  const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
  notes.forEach((freq, i) => {
    playTone({ freq, duration: 0.3, type: 'triangle', peakGain: 0.15, delay: i * 0.12 });
  });
}
