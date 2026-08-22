// PixelKleur — localStorage persistence (CLAUDE.md §11).
// Namespaced and versioned; every read/write is wrapped in try/catch since
// storage can be full or disabled.

const PREFIX = 'pixelkleur:v1:';

function read(key) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // storage full or disabled — silently drop the write
  }
}

export function getSettings() {
  const settings = read('settings');
  return settings && typeof settings === 'object' ? { muted: false, ...settings } : { muted: false };
}

export function setSettings(settings) {
  write('settings', settings);
}

export function getProgress(puzzleId) {
  return read(`progress:${puzzleId}`);
}

export function setProgress(puzzleId, progress) {
  write(`progress:${puzzleId}`, progress);
}

export function clearProgress(puzzleId) {
  try {
    localStorage.removeItem(PREFIX + `progress:${puzzleId}`);
  } catch {
    // ignore
  }
}

export function clearAllProgress() {
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(PREFIX + 'progress:')) keys.push(key);
    }
    keys.forEach((key) => localStorage.removeItem(key));
  } catch {
    // ignore
  }
}
