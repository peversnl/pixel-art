// Median-cut color quantization over CIELAB points (CLAUDE.md §9 step 3).
// Deterministic (no RNG): repeatedly splits the bucket with the widest
// single-axis range at its median, so the same source image always
// produces the same palette.

function axisRange(bucket) {
  let minL = Infinity, maxL = -Infinity;
  let minA = Infinity, maxA = -Infinity;
  let minB = Infinity, maxB = -Infinity;
  for (const p of bucket) {
    if (p.l < minL) minL = p.l;
    if (p.l > maxL) maxL = p.l;
    if (p.a < minA) minA = p.a;
    if (p.a > maxA) maxA = p.a;
    if (p.b < minB) minB = p.b;
    if (p.b > maxB) maxB = p.b;
  }
  const rl = maxL - minL, ra = maxA - minA, rb = maxB - minB;
  if (rl >= ra && rl >= rb) return { axis: 'l', range: rl };
  if (ra >= rl && ra >= rb) return { axis: 'a', range: ra };
  return { axis: 'b', range: rb };
}

function averageLab(bucket) {
  let l = 0, a = 0, b = 0;
  for (const p of bucket) { l += p.l; a += p.a; b += p.b; }
  const n = bucket.length;
  return { l: l / n, a: a / n, b: b / n };
}

// points: array of {l,a,b}. Returns up to k representative {l,a,b} colors
// (fewer if the input doesn't have enough distinct points to fill k).
function medianCut(points, k) {
  if (points.length === 0) return [];

  let buckets = [points];
  while (buckets.length < k) {
    let targetIndex = -1;
    let targetRange = -1;
    let targetAxis = 'l';

    for (let i = 0; i < buckets.length; i++) {
      if (buckets[i].length < 2) continue;
      const { axis, range } = axisRange(buckets[i]);
      if (range > targetRange) {
        targetRange = range;
        targetIndex = i;
        targetAxis = axis;
      }
    }

    if (targetIndex === -1) break; // nothing left worth splitting

    const bucket = buckets[targetIndex];
    bucket.sort((p, q) => p[targetAxis] - q[targetAxis]);
    const mid = Math.floor(bucket.length / 2);
    buckets.splice(targetIndex, 1, bucket.slice(0, mid), bucket.slice(mid));
  }

  return buckets.map(averageLab);
}

module.exports = { medianCut };
