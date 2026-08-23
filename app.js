// PixelKleur — entry point.
// Currently wires up the Puzzle Library screen (CLAUDE.md §10A). The puzzle
// and completion screens are stubs for later phases.
import * as storage from './storage.js';
import { createCanvasEngine } from './render.js';
import { attachPuzzleInput } from './input.js';
import * as audio from './audio.js';

const SAVE_DEBOUNCE_MS = 500;

const STRINGS = {
  appTitle: 'PixelKleur',
  loadingLibrary: 'Puzzels laden...',
  manifestError: 'Kon de puzzels niet laden. Controleer je internetverbinding.',
  retry: 'Opnieuw proberen',
  badgeNew: 'nieuw',
  badgeInProgress: 'bezig',
  badgeDone: 'klaar',
  resetConfirmMessage: 'Alle voortgang wissen?',
  resetConfirmOk: 'Wissen',
  resetConfirmCancel: 'Annuleren',
  backToLibrary: 'Terug naar de puzzels',
  fitButton: 'Passend maken',
  restartButton: 'Opnieuw beginnen',
  restartConfirmMessage: 'Deze puzzel opnieuw beginnen? Alle kleuren worden gewist.',
  restartConfirmOk: 'Opnieuw beginnen',
  restartConfirmCancel: 'Annuleren',
  completionTitle: 'Goed gedaan!',
  playAgain: 'Nog een keer',
  muteOn: 'Geluid dempen',
  muteOff: 'Geluid aanzetten',
};

const libraryGrid = document.getElementById('library-grid');
const libraryStatus = document.getElementById('library-status');
const libraryTitle = document.getElementById('library-title');
const screenPuzzle = document.getElementById('screen-puzzle');
const screenComplete = document.getElementById('screen-complete');

const dialog = document.getElementById('confirm-dialog');
const dialogMessage = document.getElementById('confirm-dialog-message');
const dialogOk = document.getElementById('confirm-dialog-ok');
const dialogCancel = document.getElementById('confirm-dialog-cancel');

let puzzlesById = new Map();

function showConfirm(message, okLabel, cancelLabel) {
  return new Promise((resolve) => {
    dialogMessage.textContent = message;
    dialogOk.textContent = okLabel;
    dialogCancel.textContent = cancelLabel;
    dialog.hidden = false;

    function cleanup(result) {
      dialog.hidden = true;
      dialogOk.removeEventListener('click', onOk);
      dialogCancel.removeEventListener('click', onCancel);
      resolve(result);
    }
    function onOk() { cleanup(true); }
    function onCancel() { cleanup(false); }

    dialogOk.addEventListener('click', onOk);
    dialogCancel.addEventListener('click', onCancel);
  });
}

function countFillableCells(grid) {
  let count = 0;
  for (const row of grid) {
    for (const cell of row) {
      if (cell !== 0) count++;
    }
  }
  return count;
}

// Determines nieuw / bezig / klaar per §10A, discarding stale progress
// whose contentHash no longer matches the puzzle (§11).
function getPuzzleState(puzzle) {
  const progress = storage.getProgress(puzzle.id);
  if (!progress || progress.contentHash !== puzzle.contentHash) {
    if (progress) storage.clearProgress(puzzle.id);
    return { status: 'new', filledCount: 0 };
  }
  if (progress.completed) {
    return { status: 'done', filledCount: countFillableCells(puzzle.grid) };
  }
  const filled = Array.isArray(progress.filled) ? progress.filled : [];
  if (filled.length > 0) {
    return { status: 'in-progress', filledCount: filled.length, filled };
  }
  return { status: 'new', filledCount: 0 };
}

function drawPartialThumbnail(canvas, puzzle, filled) {
  const { width, height, grid, palette } = puzzle;
  const paletteByNumber = new Map(palette.map((p) => [p.n, p.hex]));
  const filledSet = new Set(filled);
  const ctx = canvas.getContext('2d');
  const size = canvas.width;
  const cell = size / Math.max(width, height);
  const offsetX = (size - cell * width) / 2;
  const offsetY = (size - cell * height) / 2;

  ctx.fillStyle = '#e9e9e9';
  ctx.fillRect(0, 0, size, size);

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const n = grid[row][col];
      if (n === 0) continue;
      const index = row * width + col;
      const isFilled = filledSet.has(index);
      ctx.fillStyle = isFilled ? (paletteByNumber.get(n) || '#ccc') : '#f4f4f4';
      ctx.fillRect(offsetX + col * cell, offsetY + row * cell, cell + 0.5, cell + 0.5);
    }
  }
}

function createTile(puzzle) {
  const state = getPuzzleState(puzzle);

  const tile = document.createElement('button');
  tile.type = 'button';
  tile.className = 'library-tile';
  tile.dataset.puzzleId = puzzle.id;

  const thumbWrap = document.createElement('div');
  thumbWrap.className = 'library-tile-thumb';

  if (state.status === 'in-progress') {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 160;
    drawPartialThumbnail(canvas, puzzle, state.filled);
    thumbWrap.appendChild(canvas);
  } else {
    const img = document.createElement('img');
    img.src = puzzle.thumbnail;
    img.alt = puzzle.title;
    img.loading = 'lazy';
    thumbWrap.appendChild(img);
  }

  const badge = document.createElement('span');
  badge.className = `library-tile-badge badge-${state.status}`;
  if (state.status === 'done') {
    badge.textContent = `⭐ ${STRINGS.badgeDone}`;
  } else if (state.status === 'in-progress') {
    const total = countFillableCells(puzzle.grid);
    const pct = total > 0 ? Math.round((state.filledCount / total) * 100) : 0;
    badge.textContent = `${STRINGS.badgeInProgress} ${pct}%`;
  } else {
    badge.textContent = STRINGS.badgeNew;
  }
  thumbWrap.appendChild(badge);

  const title = document.createElement('span');
  title.className = 'library-tile-title';
  title.textContent = puzzle.title;

  tile.appendChild(thumbWrap);
  tile.appendChild(title);

  tile.addEventListener('click', () => {
    window.location.hash = `#/puzzle/${puzzle.id}`;
  });

  return tile;
}

// §10D: a puzzle JSON that parses but doesn't match the shape the rest of
// the app assumes (missing grid, mismatched dimensions, ...) must be
// rejected here — otherwise it throws later inside createTile/mountPuzzleScreen
// and takes the whole library or puzzle screen down with it.
function isValidPuzzle(puzzle) {
  if (!puzzle || typeof puzzle !== 'object') return false;
  const { id, title, width, height, grid, palette, contentHash, thumbnail } = puzzle;
  if (typeof id !== 'string' || !id) return false;
  if (typeof title !== 'string' || !title) return false;
  if (!Number.isInteger(width) || width <= 0) return false;
  if (!Number.isInteger(height) || height <= 0) return false;
  if (typeof contentHash !== 'string' || !contentHash) return false;
  if (typeof thumbnail !== 'string' || !thumbnail) return false;
  if (!Array.isArray(grid) || grid.length !== height) return false;
  if (!grid.every((row) => Array.isArray(row) && row.length === width)) return false;
  if (!Array.isArray(palette) || palette.length === 0) return false;
  if (!palette.every((p) => p && typeof p.n === 'number' && typeof p.hex === 'string' && typeof p.name === 'string')) {
    return false;
  }
  return true;
}

async function loadPuzzle(filename) {
  const response = await fetch(`puzzles/${filename}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const puzzle = await response.json();
  if (!isValidPuzzle(puzzle)) throw new Error(`Invalid puzzle data in "${filename}"`);
  return puzzle;
}

async function renderLibrary() {
  libraryGrid.innerHTML = '';
  libraryStatus.hidden = false;
  libraryStatus.innerHTML = '';
  libraryStatus.textContent = STRINGS.loadingLibrary;

  let manifest;
  try {
    const response = await fetch('puzzles/manifest.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    manifest = await response.json();
  } catch (err) {
    console.error('Failed to load puzzle manifest', err);
    libraryStatus.innerHTML = '';
    const message = document.createElement('p');
    message.textContent = STRINGS.manifestError;
    const retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.className = 'retry-button';
    retryBtn.textContent = STRINGS.retry;
    retryBtn.addEventListener('click', () => {
      renderLibrary().then(handleRoute);
    });
    libraryStatus.appendChild(message);
    libraryStatus.appendChild(retryBtn);
    return;
  }

  const puzzles = await Promise.all(
    (manifest.puzzles || []).map(async (filename) => {
      try {
        return await loadPuzzle(filename);
      } catch (err) {
        console.error(`Failed to load puzzle "${filename}"`, err);
        return null;
      }
    })
  );

  libraryStatus.hidden = true;
  libraryStatus.textContent = '';

  const validPuzzles = puzzles.filter(Boolean);
  puzzlesById = new Map(validPuzzles.map((p) => [p.id, p]));

  for (const puzzle of validPuzzles) {
    libraryGrid.appendChild(createTile(puzzle));
  }
}

let longPressTimer = null;

function setupResetLongPress() {
  const start = () => {
    longPressTimer = setTimeout(async () => {
      longPressTimer = null;
      const confirmed = await showConfirm(
        STRINGS.resetConfirmMessage,
        STRINGS.resetConfirmOk,
        STRINGS.resetConfirmCancel
      );
      if (confirmed) {
        storage.clearAllProgress();
        renderLibrary();
      }
    }, 3000);
  };
  const cancel = () => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  };

  libraryTitle.addEventListener('pointerdown', start);
  libraryTitle.addEventListener('pointerup', cancel);
  libraryTitle.addEventListener('pointerleave', cancel);
  libraryTitle.addEventListener('pointercancel', cancel);
}

let currentEngine = null;
let currentInput = null;
let saveTimer = null;
let pendingSave = null; // {puzzleId, contentHash, totalFillable} for the mounted puzzle

function flushSave(filledIndices) {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!pendingSave) return;
  storage.setProgress(pendingSave.puzzleId, {
    contentHash: pendingSave.contentHash,
    filled: filledIndices,
    completed: filledIndices.length >= pendingSave.totalFillable,
    updatedAt: Date.now(),
  });
}

function scheduleSave(filledIndices) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    flushSave(filledIndices);
  }, SAVE_DEBOUNCE_MS);
}

// Android backgrounds/kills tabs without warning — flush immediately
// instead of waiting on the debounce (§11).
function onVisibilityChange() {
  if (document.visibilityState === 'hidden' && currentInput) {
    flushSave(currentInput.getFilled());
  }
}

function unmountPuzzleScreen() {
  if (currentInput) {
    flushSave(currentInput.getFilled());
    currentInput.destroy();
    currentInput = null;
  }
  if (currentEngine) {
    currentEngine.destroy();
    currentEngine = null;
  }
  document.removeEventListener('visibilitychange', onVisibilityChange);
  pendingSave = null;
}

let completeAnimHandle = null;

function unmountCompleteScreen() {
  if (completeAnimHandle !== null) {
    cancelAnimationFrame(completeAnimHandle);
    completeAnimHandle = null;
  }
}

function showScreen(id) {
  if (id !== 'screen-puzzle') unmountPuzzleScreen();
  if (id !== 'screen-complete') unmountCompleteScreen();
  document.querySelectorAll('.screen').forEach((el) => {
    el.hidden = el.id !== id;
  });
}

function updateColorIndicator(el, puzzle, n) {
  const entry = puzzle.palette.find((p) => p.n === n);
  el.innerHTML = '';
  const dot = document.createElement('span');
  dot.className = 'color-indicator-dot';
  dot.style.background = entry ? entry.hex : 'transparent';
  const label = document.createElement('span');
  label.textContent = entry ? entry.name : '';
  el.appendChild(dot);
  el.appendChild(label);
}

// Per-color totals from the grid, keyed by palette number (§3.6/§6).
function countByColor(grid) {
  const counts = new Map();
  for (const row of grid) {
    for (const n of row) {
      if (n === 0) continue;
      counts.set(n, (counts.get(n) || 0) + 1);
    }
  }
  return counts;
}

// Mounts the canvas engine (render.js, §5) and gesture model (input.js,
// §4) for a puzzle. The saved fill state seeds both so reopening a puzzle
// resumes prior progress.
function mountPuzzleScreen(puzzle) {
  unmountPuzzleScreen();
  screenPuzzle.innerHTML = '';

  const header = document.createElement('header');
  header.className = 'puzzle-header';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'back-button';
  back.textContent = `← ${STRINGS.backToLibrary}`;
  back.addEventListener('click', () => {
    window.location.hash = '#/';
    renderLibrary();
  });
  const title = document.createElement('h2');
  title.className = 'puzzle-header-title';
  title.textContent = puzzle.title;
  const progressIndicator = document.createElement('div');
  progressIndicator.className = 'progress-indicator';
  const colorIndicator = document.createElement('div');
  colorIndicator.className = 'color-indicator';
  const fitButton = document.createElement('button');
  fitButton.type = 'button';
  fitButton.className = 'fit-button';
  fitButton.textContent = STRINGS.fitButton;
  const restartButton = document.createElement('button');
  restartButton.type = 'button';
  restartButton.className = 'restart-button';
  restartButton.textContent = STRINGS.restartButton;
  restartButton.addEventListener('click', async () => {
    const confirmed = await showConfirm(
      STRINGS.restartConfirmMessage,
      STRINGS.restartConfirmOk,
      STRINGS.restartConfirmCancel
    );
    if (confirmed) {
      // Unmount first: it flushes the (still-full) in-progress save. Only
      // after that flush lands do we clear storage, otherwise the flush
      // would silently re-write the old progress on top of the clear.
      unmountPuzzleScreen();
      storage.clearProgress(puzzle.id);
      mountPuzzleScreen(puzzle);
    }
  });
  const muteButton = document.createElement('button');
  muteButton.type = 'button';
  muteButton.className = 'mute-button';
  function refreshMuteButton() {
    const muted = audio.isMuted();
    muteButton.textContent = muted ? '🔇' : '🔊';
    muteButton.setAttribute('aria-label', muted ? STRINGS.muteOff : STRINGS.muteOn);
  }
  refreshMuteButton();
  muteButton.addEventListener('click', () => {
    audio.setMuted(!audio.isMuted());
    refreshMuteButton();
  });
  header.appendChild(back);
  header.appendChild(title);
  header.appendChild(progressIndicator);
  header.appendChild(colorIndicator);
  header.appendChild(fitButton);
  header.appendChild(restartButton);
  header.appendChild(muteButton);

  const canvasContainer = document.createElement('div');
  canvasContainer.className = 'puzzle-canvas-container';

  const palette = document.createElement('div');
  palette.className = 'palette';

  screenPuzzle.appendChild(header);
  screenPuzzle.appendChild(canvasContainer);
  screenPuzzle.appendChild(palette);

  currentEngine = createCanvasEngine(canvasContainer, puzzle);
  fitButton.addEventListener('click', () => currentEngine.resetView());

  const progress = storage.getProgress(puzzle.id);
  const initialFilled = progress && progress.contentHash === puzzle.contentHash && Array.isArray(progress.filled)
    ? progress.filled
    : [];
  currentEngine.setFilled(initialFilled);

  const totalFillable = countFillableCells(puzzle.grid);
  pendingSave = {
    puzzleId: puzzle.id,
    contentHash: puzzle.contentHash,
    totalFillable,
  };

  // §3.6: per-color totals vs. how many of each are already filled, so a
  // resumed puzzle starts with the right swatches checked off.
  const totalByColor = countByColor(puzzle.grid);
  const filledByColor = new Map();
  for (const index of initialFilled) {
    const row = Math.floor(index / puzzle.width);
    const col = index % puzzle.width;
    const n = puzzle.grid[row][col];
    if (n) filledByColor.set(n, (filledByColor.get(n) || 0) + 1);
  }
  let totalFilledCount = initialFilled.length;

  function isColorComplete(n) {
    return (filledByColor.get(n) || 0) >= (totalByColor.get(n) || 0);
  }

  function firstUnfinishedColor() {
    for (const entry of puzzle.palette) {
      if (!isColorComplete(entry.n)) return entry.n;
    }
    return null;
  }

  function nextUnfinishedColorAfter(n) {
    const idx = puzzle.palette.findIndex((p) => p.n === n);
    for (let i = 1; i <= puzzle.palette.length; i++) {
      const candidate = puzzle.palette[(idx + i) % puzzle.palette.length];
      if (!isColorComplete(candidate.n)) return candidate.n;
    }
    return null;
  }

  function updateProgressIndicator() {
    progressIndicator.textContent = `${totalFilledCount}/${totalFillable}`;
  }

  const swatchButtons = new Map();
  function updateSwatch(n) {
    const btn = swatchButtons.get(n);
    if (!btn) return;
    btn.classList.toggle('completed', isColorComplete(n));
  }

  for (const entry of puzzle.palette) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'palette-swatch';
    btn.style.setProperty('--swatch-color', entry.hex);

    const swatch = document.createElement('span');
    swatch.className = 'palette-swatch-color';
    const number = document.createElement('span');
    number.className = 'palette-swatch-number';
    number.textContent = String(entry.n);
    swatch.appendChild(number);
    const check = document.createElement('span');
    check.className = 'palette-swatch-check';
    check.textContent = '✓';
    swatch.appendChild(check);

    const name = document.createElement('span');
    name.className = 'palette-swatch-name';
    name.textContent = entry.name;

    btn.appendChild(swatch);
    btn.appendChild(name);
    btn.addEventListener('click', () => currentInput.setSelectedColor(entry.n));

    palette.appendChild(btn);
    swatchButtons.set(entry.n, btn);
    updateSwatch(entry.n);
  }

  const initialColor = firstUnfinishedColor() ?? puzzle.palette[0].n;
  updateColorIndicator(colorIndicator, puzzle, initialColor);
  updateProgressIndicator();

  function selectSwatch(n) {
    for (const [swatchN, btn] of swatchButtons) {
      btn.classList.toggle('selected', swatchN === n);
    }
  }
  selectSwatch(initialColor);

  currentInput = attachPuzzleInput({
    container: canvasContainer,
    engine: currentEngine,
    puzzle,
    initialColor,
    initialFilled,
    onFillsChange: scheduleSave,
    onColorChange: (n) => {
      updateColorIndicator(colorIndicator, puzzle, n);
      selectSwatch(n);
    },
    onCellFilled: (index, n) => {
      filledByColor.set(n, (filledByColor.get(n) || 0) + 1);
      totalFilledCount++;
      updateProgressIndicator();

      const done = isColorComplete(n);
      audio.playFill((filledByColor.get(n) || 0) / (totalByColor.get(n) || 1));

      if (done) {
        updateSwatch(n);
        audio.playColorDone();
        const next = nextUnfinishedColorAfter(n);
        if (next !== null) currentInput.setSelectedColor(next);
      }

      if (totalFilledCount >= totalFillable) {
        triggerCompletion(puzzle);
      }
    },
    onCellErased: (index, n) => {
      const wasComplete = isColorComplete(n);
      filledByColor.set(n, Math.max(0, (filledByColor.get(n) || 0) - 1));
      totalFilledCount--;
      updateProgressIndicator();
      if (wasComplete) updateSwatch(n);
    },
  });

  document.addEventListener('visibilitychange', onVisibilityChange);
}

// §10C: fade the gridlines to reveal the finished picture, persist the
// completed flag immediately (don't wait on the save debounce), then swap
// to the completion screen.
async function triggerCompletion(puzzle) {
  if (currentInput) flushSave(currentInput.getFilled());
  if (currentEngine) await currentEngine.fadeGridlines(600);
  showScreen('screen-complete');
  mountCompleteScreen(puzzle);
}

// Renders the finished grid as flat colored cells with no gridlines or
// numbers — the "full picture reveal" (§10C).
function drawFullImage(canvas, puzzle) {
  const { width, height, grid, palette } = puzzle;
  const paletteByNumber = new Map(palette.map((p) => [p.n, p.hex]));
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, rect.width, rect.height);

  const cell = rect.width / width;
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const n = grid[row][col];
      if (n === 0) continue;
      ctx.fillStyle = paletteByNumber.get(n) || '#cccccc';
      ctx.fillRect(col * cell, row * cell, cell + 0.5, cell + 0.5);
    }
  }
}

const CONFETTI_COLORS = ['#F5A623', '#4A90D9', '#D9534F', '#5CB85C', '#9B59B6', '#F1C40F'];
const CONFETTI_DURATION_MS = 3000;
const CONFETTI_COUNT = 80;

function startConfetti(canvas) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const particles = Array.from({ length: CONFETTI_COUNT }, () => ({
    x: Math.random() * rect.width,
    y: -20 - Math.random() * rect.height,
    size: 4 + Math.random() * 5,
    color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
    speedY: 1.5 + Math.random() * 2.5,
    speedX: (Math.random() - 0.5) * 1.5,
    rotation: Math.random() * Math.PI * 2,
    spin: (Math.random() - 0.5) * 0.2,
  }));

  const start = performance.now();

  function frame(now) {
    const elapsed = now - start;
    ctx.clearRect(0, 0, rect.width, rect.height);
    for (const p of particles) {
      p.x += p.speedX;
      p.y += p.speedY;
      p.rotation += p.spin;
      if (p.y > rect.height + 20) {
        p.y = -20;
        p.x = Math.random() * rect.width;
      }
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      ctx.restore();
    }
    if (elapsed < CONFETTI_DURATION_MS) {
      completeAnimHandle = requestAnimationFrame(frame);
    } else {
      completeAnimHandle = null;
      ctx.clearRect(0, 0, rect.width, rect.height);
    }
  }
  completeAnimHandle = requestAnimationFrame(frame);
}

function mountCompleteScreen(puzzle) {
  unmountCompleteScreen();
  screenComplete.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'complete-wrap';

  const title = document.createElement('h2');
  title.className = 'complete-title';
  title.textContent = `${STRINGS.completionTitle} ${puzzle.title}`;

  const imageWrap = document.createElement('div');
  imageWrap.className = 'complete-image-wrap';
  imageWrap.style.aspectRatio = `${puzzle.width} / ${puzzle.height}`;

  const imageCanvas = document.createElement('canvas');
  imageCanvas.className = 'complete-image';
  const confettiCanvas = document.createElement('canvas');
  confettiCanvas.className = 'complete-confetti';
  imageWrap.appendChild(imageCanvas);
  imageWrap.appendChild(confettiCanvas);

  const actions = document.createElement('div');
  actions.className = 'complete-actions';

  const againBtn = document.createElement('button');
  againBtn.type = 'button';
  againBtn.className = 'complete-button';
  againBtn.textContent = STRINGS.playAgain;
  againBtn.addEventListener('click', () => {
    storage.clearProgress(puzzle.id);
    showScreen('screen-puzzle');
    mountPuzzleScreen(puzzle);
  });

  const libraryBtn = document.createElement('button');
  libraryBtn.type = 'button';
  libraryBtn.className = 'complete-button complete-button-primary';
  libraryBtn.textContent = STRINGS.backToLibrary;
  libraryBtn.addEventListener('click', () => {
    window.location.hash = '#/';
    renderLibrary();
  });

  actions.appendChild(againBtn);
  actions.appendChild(libraryBtn);

  wrap.appendChild(title);
  wrap.appendChild(imageWrap);
  wrap.appendChild(actions);
  screenComplete.appendChild(wrap);

  drawFullImage(imageCanvas, puzzle);
  startConfetti(confettiCanvas);
  audio.playFanfare();
}

// §10D: unknown puzzle id in the URL redirects to the library.
function handleRoute() {
  const match = window.location.hash.match(/^#\/puzzle\/(.+)$/);
  if (match) {
    const puzzle = puzzlesById.get(decodeURIComponent(match[1]));
    if (!puzzle) {
      window.location.hash = '#/';
      return;
    }
    showScreen('screen-puzzle');
    mountPuzzleScreen(puzzle);
    return;
  }
  showScreen('screen-library');
}

window.addEventListener('hashchange', handleRoute);

// Chrome suspends new AudioContexts until a user gesture resumes them —
// unlock on the very first tap anywhere in the app (§13).
function unlockAudioOnce() {
  audio.unlock();
  document.removeEventListener('pointerdown', unlockAudioOnce);
}

// Registered after load so it never competes with the app's own first
// paint/fetches for bandwidth (§12).
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.error('Service worker registration failed', err);
    });
  });
}

async function init() {
  document.title = STRINGS.appTitle;
  libraryTitle.textContent = STRINGS.appTitle;
  document.addEventListener('pointerdown', unlockAudioOnce);
  registerServiceWorker();
  setupResetLongPress();
  await renderLibrary();
  handleRoute();
}

init();
