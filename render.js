// PixelKleur — canvas rendering engine (CLAUDE.md §5).
//
// Two stacked canvases per puzzle:
//   base   — filled cells, gridlines, numbers. Redrawn only when the fill
//            state, zoom, or viewport size changes.
//   active — transient per-frame content (drag-fill preview, hint pulse).
//            Cheap to redraw; owned separately so it never forces a full
//            base repaint.
// Both are DPR-scaled so numbers stay crisp, and both redraw is coalesced
// onto a single requestAnimationFrame per dirty batch — never synchronously
// inside a pointer event handler.

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

// Below this effective cell size (CSS px) numbers are illegible — hide them
// and expect the player to zoom in instead (§5).
const NUMBER_HIDE_THRESHOLD = 14;

const EMPTY_CELL_COLOR = '#ffffff';
const GRID_LINE_ALPHA = 0.15;
const NUMBER_COLOR = '#33312c';
const PREVIEW_COLOR = 'rgba(74, 144, 217, 0.35)';

export function createCanvasEngine(container, puzzle) {
  const { width, height, grid, palette } = puzzle;
  const paletteByNumber = new Map(palette.map((p) => [p.n, p.hex]));

  const baseCanvas = document.createElement('canvas');
  baseCanvas.className = 'puzzle-canvas puzzle-canvas-base';
  const activeCanvas = document.createElement('canvas');
  activeCanvas.className = 'puzzle-canvas puzzle-canvas-active';

  container.appendChild(baseCanvas);
  container.appendChild(activeCanvas);

  const baseCtx = baseCanvas.getContext('2d');
  const activeCtx = activeCanvas.getContext('2d');

  const state = {
    cssWidth: 0,
    cssHeight: 0,
    cell: 0, // base cell size in CSS px at zoom 1 (fit-to-screen)
    zoom: 1,
    panX: 0,
    panY: 0,
    filled: new Set(),
    preview: new Set(),
    gridAlpha: 1, // faded to 0 for the completion reveal (§10C)
  };

  let baseDirty = true;
  let activeDirty = true;
  let rafHandle = null;

  function scheduleDraw() {
    if (rafHandle !== null) return;
    rafHandle = requestAnimationFrame(() => {
      rafHandle = null;
      if (baseDirty) {
        drawBase();
        baseDirty = false;
      }
      if (activeDirty) {
        drawActive();
        activeDirty = false;
      }
    });
  }

  function sizeCanvas(canvas, ctx, cssWidth, cssHeight, dpr) {
    canvas.width = Math.max(1, Math.round(cssWidth * dpr));
    canvas.height = Math.max(1, Math.round(cssHeight * dpr));
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function centerGrid() {
    const effectiveCell = state.cell * state.zoom;
    state.panX = (state.cssWidth - width * effectiveCell) / 2;
    state.panY = (state.cssHeight - height * effectiveCell) / 2;
  }

  // Clamps one axis of pan so the grid can never be dragged fully off-screen
  // (§4): if the grid is smaller than the viewport on this axis it's
  // centered (no slack to pan); otherwise pan is capped so the grid always
  // fully covers the viewport, never revealing empty space past an edge.
  function clampPan(pan, contentSize, viewportSize) {
    if (contentSize <= viewportSize) return (viewportSize - contentSize) / 2;
    return Math.min(0, Math.max(viewportSize - contentSize, pan));
  }

  function fitToScreen() {
    const cellFitW = state.cssWidth / width;
    const cellFitH = state.cssHeight / height;
    state.cell = Math.max(1, Math.min(cellFitW, cellFitH));
    state.zoom = MIN_ZOOM;
    centerGrid();
  }

  // True only before the container has ever been measured (page load).
  // Later calls come from ResizeObserver and must NOT re-fit: on mobile
  // Chrome the dynamic toolbar showing/hiding resizes the viewport (and
  // therefore this 100dvh-sized container) during ordinary scrolling, and
  // snapping the player's zoom/pan back to fit-to-screen on every such
  // wobble would silently discard their work-in-progress view (§4 — only
  // "passend maken" should ever do that).
  let hasLaidOut = false;

  function resize() {
    const rect = container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    let anchorCol = 0;
    let anchorRow = 0;
    let preservedEffectiveCell = 0;
    if (hasLaidOut) {
      const oldEffectiveCell = state.cell * state.zoom;
      anchorCol = (state.cssWidth / 2 - state.panX) / oldEffectiveCell;
      anchorRow = (state.cssHeight / 2 - state.panY) / oldEffectiveCell;
      preservedEffectiveCell = oldEffectiveCell;
    }

    state.cssWidth = rect.width;
    state.cssHeight = rect.height;
    const dpr = window.devicePixelRatio || 1;
    sizeCanvas(baseCanvas, baseCtx, state.cssWidth, state.cssHeight, dpr);
    sizeCanvas(activeCanvas, activeCtx, state.cssWidth, state.cssHeight, dpr);

    if (!hasLaidOut) {
      fitToScreen();
      hasLaidOut = true;
    } else {
      const cellFitW = state.cssWidth / width;
      const cellFitH = state.cssHeight / height;
      state.cell = Math.max(1, Math.min(cellFitW, cellFitH));
      state.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, preservedEffectiveCell / state.cell));
      const effectiveCell = state.cell * state.zoom;
      const rawPanX = state.cssWidth / 2 - anchorCol * effectiveCell;
      const rawPanY = state.cssHeight / 2 - anchorRow * effectiveCell;
      state.panX = clampPan(rawPanX, width * effectiveCell, state.cssWidth);
      state.panY = clampPan(rawPanY, height * effectiveCell, state.cssHeight);
    }

    baseDirty = true;
    activeDirty = true;
    scheduleDraw();
  }

  function drawBase() {
    const ctx = baseCtx;
    ctx.clearRect(0, 0, state.cssWidth, state.cssHeight);

    const effectiveCell = state.cell * state.zoom;
    const showNumbers = effectiveCell >= NUMBER_HIDE_THRESHOLD;
    if (showNumbers) {
      const fontSize = Math.min(effectiveCell * 0.5, 22);
      ctx.font = `600 ${fontSize}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
    }

    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const n = grid[row][col];
        if (n === 0) continue;

        const x = state.panX + col * effectiveCell;
        const y = state.panY + row * effectiveCell;
        const index = row * width + col;
        const isFilled = state.filled.has(index);

        ctx.fillStyle = isFilled ? (paletteByNumber.get(n) || '#cccccc') : EMPTY_CELL_COLOR;
        ctx.fillRect(x, y, effectiveCell, effectiveCell);

        if (state.gridAlpha > 0) {
          ctx.strokeStyle = `rgba(0, 0, 0, ${GRID_LINE_ALPHA * state.gridAlpha})`;
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, y + 0.5, effectiveCell - 1, effectiveCell - 1);
        }

        if (!isFilled && showNumbers) {
          ctx.fillStyle = NUMBER_COLOR;
          ctx.fillText(String(n), x + effectiveCell / 2, y + effectiveCell / 2 + 1);
        }
      }
    }
  }

  function drawActive() {
    const ctx = activeCtx;
    ctx.clearRect(0, 0, state.cssWidth, state.cssHeight);
    if (state.preview.size === 0) return;

    const effectiveCell = state.cell * state.zoom;
    ctx.fillStyle = PREVIEW_COLOR;
    for (const index of state.preview) {
      const row = Math.floor(index / width);
      const col = index % width;
      const x = state.panX + col * effectiveCell;
      const y = state.panY + row * effectiveCell;
      ctx.fillRect(x, y, effectiveCell, effectiveCell);
    }
  }

  // Pure arithmetic hit-test (§5): col/row from a client-space point, using
  // the same pan/zoom transform drawBase() uses to place cells.
  function hitTest(clientX, clientY) {
    const rect = baseCanvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const effectiveCell = state.cell * state.zoom;
    const col = Math.floor((x - state.panX) / effectiveCell);
    const row = Math.floor((y - state.panY) / effectiveCell);
    if (col < 0 || col >= width || row < 0 || row >= height) return null;
    return { row, col, index: row * width + col };
  }

  // ResizeObserver always delivers one initial callback after observe(),
  // even when size hasn't changed yet — that alone drives the first
  // resize()/draw. Calling resize() again here would just clear and
  // re-schedule a redundant paint on top of it.
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);

  return {
    hitTest,

    setFilled(filledIndices) {
      state.filled = new Set(filledIndices);
      baseDirty = true;
      scheduleDraw();
    },

    fillCell(index) {
      state.filled.add(index);
      baseDirty = true;
      scheduleDraw();
    },

    unfillCell(index) {
      state.filled.delete(index);
      baseDirty = true;
      scheduleDraw();
    },

    setPreview(indices) {
      state.preview = new Set(indices);
      activeDirty = true;
      scheduleDraw();
    },

    // zoom is clamped to [1, 4] per §4; re-centers on the grid midpoint.
    // Focal-point zooming (zoom-toward-pinch-center) is Phase 4 territory.
    setZoom(zoom) {
      state.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
      centerGrid();
      baseDirty = true;
      activeDirty = true;
      scheduleDraw();
    },

    getZoom() {
      return state.zoom;
    },

    // Current viewport, for the input layer to compute pinch focal-point
    // math against (§4). `cell` is the fit-to-screen base unit; multiply by
    // `zoom` for the effective on-screen cell size.
    getViewport() {
      return {
        zoom: state.zoom,
        panX: state.panX,
        panY: state.panY,
        cell: state.cell,
        cssWidth: state.cssWidth,
        cssHeight: state.cssHeight,
      };
    },

    // Arbitrary pan+zoom for pinch gestures — unlike setZoom(), this does
    // NOT recenter; it clamps pan against the requested zoom so the grid
    // stays at least partially on-screen (§4).
    setViewport(zoom, panX, panY) {
      state.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
      const effectiveCell = state.cell * state.zoom;
      state.panX = clampPan(panX, width * effectiveCell, state.cssWidth);
      state.panY = clampPan(panY, height * effectiveCell, state.cssHeight);
      baseDirty = true;
      activeDirty = true;
      scheduleDraw();
    },

    // "passend maken" (fit) button target (§4).
    resetView() {
      fitToScreen();
      baseDirty = true;
      activeDirty = true;
      scheduleDraw();
    },

    // Animates gridlines to invisible for the completion reveal (§10C).
    // Resolves once the fade finishes so the caller can chain the screen
    // transition after it.
    fadeGridlines(durationMs = 600) {
      return new Promise((resolve) => {
        const startAlpha = state.gridAlpha;
        const start = performance.now();
        function step(now) {
          const t = Math.min(1, (now - start) / durationMs);
          state.gridAlpha = startAlpha * (1 - t);
          baseDirty = true;
          scheduleDraw();
          if (t < 1) {
            requestAnimationFrame(step);
          } else {
            resolve();
          }
        }
        requestAnimationFrame(step);
      });
    },

    destroy() {
      resizeObserver.disconnect();
      baseCanvas.remove();
      activeCanvas.remove();
    },
  };
}
