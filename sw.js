// PixelKleur service worker (CLAUDE.md §12).
// Bump this on every deploy — it's the only thing that forces clients to
// pick up new precached files instead of serving stale ones forever.
const CACHE_VERSION = "v3";

const SHELL_CACHE = `pixelkleur-shell-${CACHE_VERSION}`;
const PUZZLE_CACHE = `pixelkleur-puzzles-${CACHE_VERSION}`;
const CACHE_NAMES = new Set([SHELL_CACHE, PUZZLE_CACHE]);

// App shell: everything the game needs to boot with no network at all.
// Sounds aren't listed — audio.js synthesizes tones with WebAudio rather
// than fetching files, so there's nothing to precache there.
const SHELL_ASSETS = [
  "./index.html",
  "./styles.css",
  "./app.js",
  "./storage.js",
  "./render.js",
  "./input.js",
  "./audio.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

function resolve(path) {
  return new URL(path, self.registration.scope).toString();
}

// Puzzle assets aren't static like the shell — the manifest names which
// files exist, and each puzzle file names its own thumbnail — so the
// install step has to read that data to know what to precache.
async function precachePuzzles(cache) {
  const manifestUrl = resolve("./puzzles/manifest.json");
  const manifestResponse = await fetch(manifestUrl);
  if (!manifestResponse.ok) throw new Error(`manifest fetch failed: ${manifestResponse.status}`);
  await cache.put(manifestUrl, manifestResponse.clone());

  const manifest = await manifestResponse.json();
  const filenames = Array.isArray(manifest.puzzles) ? manifest.puzzles : [];

  await Promise.all(
    filenames.map(async (filename) => {
      const puzzleUrl = resolve(`./puzzles/${filename}`);
      const puzzleResponse = await fetch(puzzleUrl);
      if (!puzzleResponse.ok) return;
      await cache.put(puzzleUrl, puzzleResponse.clone());

      const puzzle = await puzzleResponse.json();
      if (!puzzle.thumbnail) return;
      const thumbUrl = resolve(puzzle.thumbnail);
      try {
        const thumbResponse = await fetch(thumbUrl);
        if (thumbResponse.ok) await cache.put(thumbUrl, thumbResponse.clone());
      } catch {
        // thumbnail missing — the library already hides broken puzzles (§10D)
      }
    })
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const shellCache = await caches.open(SHELL_CACHE);
      await shellCache.addAll(SHELL_ASSETS.map(resolve));

      const puzzleCache = await caches.open(PUZZLE_CACHE);
      await precachePuzzles(puzzleCache);

      self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => !CACHE_NAMES.has(key)).map((key) => caches.delete(key)));
      await self.clients.claim();
    })()
  );
});

function isPuzzleAsset(url) {
  return url.pathname.includes("/puzzles/") || url.pathname.includes("/thumbs/");
}

// Navigations can land on any path (e.g. the bare origin, not just
// index.html) but this is a single-page app — there is only ever one
// document to serve, so offline navigations always fall back to the
// precached shell page rather than an exact URL match.
async function navigate(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(resolve("./index.html"), response.clone());
      return response;
    }
    throw new Error(`navigation response not ok: ${response.status}`);
  } catch (err) {
    const cached = await cache.match(resolve("./index.html"));
    if (cached) return cached;
    throw err;
  }
}

// Puzzle data doesn't change once fetched (a regenerated puzzle bumps
// contentHash and this whole cache is versioned away by CACHE_VERSION), so
// cache-first avoids a network round trip every time she opens a puzzle.
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

// The shell should pick up a fresh deploy whenever the network is available,
// only falling back to the precached copy when offline (§12).
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // no CDN deps (§12)

  if (request.mode === "navigate") {
    event.respondWith(navigate(request));
  } else if (isPuzzleAsset(url)) {
    event.respondWith(cacheFirst(request, PUZZLE_CACHE));
  } else {
    event.respondWith(networkFirst(request, SHELL_CACHE));
  }
});
