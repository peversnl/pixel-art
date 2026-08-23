// PixelKleur — pointer gesture model (CLAUDE.md §4).
//
// One state machine driven entirely by Pointer Events, tracking active
// pointer IDs. At most two pointers are tracked; a third+ finger is
// ignored outright.
//
//   0 pointers -> 1 pointer   : begin a paint gesture (tap or drag)
//   1 pointer -> 2 pointers   : paint gesture cancelled, begin pinch/pan.
//                                Cells already filled stay filled — fills
//                                are applied eagerly, one cell at a time,
//                                so there is nothing to roll back.
//   2 pointers -> 1 pointer   : pinch ends; the remaining finger does NOT
//                                resume painting (mode goes to "suppressed"
//                                until every pointer lifts).
//   -> 0 pointers             : reset to idle, ready for a fresh gesture.
//
// Tap vs. drag is not decided at release. The cell under the very first
// touch is resolved immediately on pointerdown (fill it if it matches the
// selected color, otherwise ignore it) so a plain tap and the first instant
// of a drag behave identically. Non-matching cells are always skipped for
// filling — selecting a color is the only way to change what gets painted.
// If the very first touch isn't on a fillable matching cell, though, a drag
// from there pans the view instead of doing nothing (see paintKind below) —
// otherwise a one-finger drag over background or the wrong color would be a
// dead zone once zoomed in, which reads as "I can't move the picture."

const LONG_PRESS_MS = 600;
const MOVE_THRESHOLD = 10; // px — cancels long-press, per §4

export function attachPuzzleInput({
  container,
  engine,
  puzzle,
  initialColor,
  initialFilled = [],
  onFillsChange,
  onColorChange,
  onCellFilled,
  onCellErased,
}) {
  const filled = new Set(initialFilled);
  let selectedColor = initialColor;

  const activePointers = new Map(); // pointerId -> {x, y}
  let mode = 'idle'; // 'idle' | 'paint' | 'pinch' | 'suppressed'

  let paintPointerId = null;
  let paintStart = { x: 0, y: 0 };
  let paintLast = { x: 0, y: 0 };
  let longPressTimer = null;

  // What a one-finger drag does for the current gesture, decided once at
  // pointerdown (and possibly resolved on first move — see paintKind ===
  // null below) so a single drag never flips between filling and panning
  // partway through:
  //   'fill' — started on an unfilled cell matching the selected color;
  //            drag-fills matching cells crossed, same as before.
  //   'pan'  — started on background, a non-matching cell, or the pointer
  //            moved before an armed long-press could resolve; there is
  //            nothing to paint here, so the drag pans the view instead of
  //            being a dead zone (§4).
  //   null   — started on an already-filled cell; still waiting to see if
  //            this is a long-press (erase) or turns into a drag (pan).
  let paintKind = null;

  let pinch = null; // {initialDistance, initialZoom, contentX, contentY}

  function cellValueAt(hit) {
    return hit ? puzzle.grid[hit.row][hit.col] : 0;
  }

  function valueAtIndex(index) {
    const row = Math.floor(index / puzzle.width);
    const col = index % puzzle.width;
    return puzzle.grid[row][col];
  }

  function fillAt(index) {
    if (filled.has(index)) return;
    filled.add(index);
    engine.fillCell(index);
    onFillsChange(Array.from(filled));
    if (onCellFilled) onCellFilled(index, valueAtIndex(index));
  }

  function eraseAt(index) {
    if (!filled.has(index)) return;
    filled.delete(index);
    engine.unfillCell(index);
    onFillsChange(Array.from(filled));
    if (onCellErased) onCellErased(index, valueAtIndex(index));
  }

  function setSelectedColor(n) {
    if (n === selectedColor) return;
    selectedColor = n;
    onColorChange(selectedColor);
  }

  function clearLongPressTimer() {
    if (longPressTimer !== null) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  }

  // Single hit-test + fill decision, used only for the cell under the very
  // first touch of a gesture (§3.2, §3.5). Also decides paintKind for the
  // rest of the gesture (see the comment on its declaration above).
  function handleInitialTouch(x, y) {
    const hit = engine.hitTest(x, y);
    const value = cellValueAt(hit);
    if (!hit || value === 0) {
      paintKind = 'pan';
      return;
    }

    if (filled.has(hit.index)) {
      // Already filled: tapping does nothing (§3.5). The only thing that
      // can happen next is a long-press erase, so arm that timer.
      paintKind = null;
      longPressTimer = setTimeout(() => {
        longPressTimer = null;
        if (mode === 'paint' && paintPointerId !== null) {
          eraseAt(hit.index);
        }
      }, LONG_PRESS_MS);
      return;
    }

    if (value === selectedColor) {
      paintKind = 'fill';
      fillAt(hit.index);
    } else {
      paintKind = 'pan';
    }
  }

  // Fills every matching, unfilled cell crossed between two points, so a
  // fast swipe between two pointermove samples doesn't skip cells.
  function paintSegment(fromX, fromY, toX, toY) {
    const { cell, zoom } = engine.getViewport();
    const effectiveCell = cell * zoom || 1;
    const dist = Math.hypot(toX - fromX, toY - fromY);
    const steps = Math.max(1, Math.ceil(dist / Math.max(4, effectiveCell / 2)));

    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = fromX + (toX - fromX) * t;
      const y = fromY + (toY - fromY) * t;
      const hit = engine.hitTest(x, y);
      if (!hit) continue;
      const value = cellValueAt(hit);
      if (value !== 0 && value === selectedColor) fillAt(hit.index);
    }
  }

  function beginPinch() {
    clearLongPressTimer();
    mode = 'pinch';
    engine.setPreview([]);

    const [idA, idB] = activePointers.keys();
    const a = activePointers.get(idA);
    const b = activePointers.get(idB);
    const rect = container.getBoundingClientRect();
    const viewport = engine.getViewport();
    const midX = (a.x + b.x) / 2 - rect.left;
    const midY = (a.y + b.y) / 2 - rect.top;

    pinch = {
      initialDistance: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      initialZoom: viewport.zoom,
      // Content-space anchor (in fit-to-screen "cell" units) that must stay
      // under the pinch midpoint as zoom/pan change.
      contentX: (midX - viewport.panX) / viewport.zoom,
      contentY: (midY - viewport.panY) / viewport.zoom,
    };
  }

  function updatePinch() {
    const [idA, idB] = activePointers.keys();
    const a = activePointers.get(idA);
    const b = activePointers.get(idB);
    const rect = container.getBoundingClientRect();

    const distance = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const newZoom = pinch.initialZoom * (distance / pinch.initialDistance);
    const midX = (a.x + b.x) / 2 - rect.left;
    const midY = (a.y + b.y) / 2 - rect.top;

    engine.setViewport(newZoom, midX - pinch.contentX * newZoom, midY - pinch.contentY * newZoom);
  }

  function endPaintGesture() {
    clearLongPressTimer();
    engine.setPreview([]);
    paintPointerId = null;
    paintKind = null;
  }

  function onPointerDown(e) {
    if (activePointers.size >= 2) return; // ignore a 3rd+ finger

    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try {
      container.setPointerCapture(e.pointerId);
    } catch {
      // unsupported pointer type — safe to ignore, tracking still works
    }

    if (activePointers.size === 1) {
      mode = 'paint';
      paintPointerId = e.pointerId;
      paintStart = { x: e.clientX, y: e.clientY };
      paintLast = paintStart;
      handleInitialTouch(e.clientX, e.clientY);
    } else if (activePointers.size === 2) {
      beginPinch();
    }
  }

  function onPointerMove(e) {
    if (!activePointers.has(e.pointerId)) return;
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (mode === 'pinch') {
      updatePinch();
      return;
    }

    if (mode === 'paint' && e.pointerId === paintPointerId) {
      const moved = Math.hypot(e.clientX - paintStart.x, e.clientY - paintStart.y);
      if (moved >= MOVE_THRESHOLD) {
        clearLongPressTimer();
        // Started on an already-filled cell (paintKind still undecided):
        // there's nothing to paint from there, so a real drag pans (§4).
        if (paintKind === null) paintKind = 'pan';
      }

      if (paintKind === 'fill') {
        paintSegment(paintLast.x, paintLast.y, e.clientX, e.clientY);
        const hit = engine.hitTest(e.clientX, e.clientY);
        engine.setPreview(hit ? [hit.index] : []);
      } else if (paintKind === 'pan') {
        const viewport = engine.getViewport();
        const dx = e.clientX - paintLast.x;
        const dy = e.clientY - paintLast.y;
        engine.setViewport(viewport.zoom, viewport.panX + dx, viewport.panY + dy);
      }
      paintLast = { x: e.clientX, y: e.clientY };
    }
    // mode === 'suppressed': a leftover finger from a finished pinch.
    // Ignored until every pointer lifts and a fresh gesture begins.
  }

  function onPointerEnd(e) {
    if (!activePointers.has(e.pointerId)) return;
    activePointers.delete(e.pointerId);
    try {
      container.releasePointerCapture(e.pointerId);
    } catch {
      // already released — safe to ignore
    }

    if (mode === 'pinch') {
      if (activePointers.size < 2) {
        pinch = null;
        mode = activePointers.size === 0 ? 'idle' : 'suppressed';
      }
      return;
    }

    if (mode === 'paint' && e.pointerId === paintPointerId) {
      endPaintGesture();
      mode = activePointers.size === 0 ? 'idle' : 'suppressed';
      return;
    }

    if (activePointers.size === 0) mode = 'idle';
  }

  container.addEventListener('pointerdown', onPointerDown);
  container.addEventListener('pointermove', onPointerMove);
  container.addEventListener('pointerup', onPointerEnd);
  container.addEventListener('pointercancel', onPointerEnd);

  return {
    setSelectedColor,

    getFilled() {
      return Array.from(filled);
    },

    destroy() {
      clearLongPressTimer();
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerup', onPointerEnd);
      container.removeEventListener('pointercancel', onPointerEnd);
    },
  };
}
