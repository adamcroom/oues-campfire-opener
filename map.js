// Map layer: MapLibre setup, tile sources, camera moves and preloading.
// Text, coordinates and timing live in content.js. This file only knows how to draw and move.

// Plain script (not an ES module) so the page also works when index.html is opened straight from
// disk: browsers refuse to load modules from file:// addresses. Each file keeps its internals inside
// this function and shares only what the others need through window.CampfireParts.
(() => {
"use strict";

// ---- Tile sources (both free, no API key) ---------------------------------------------------

const TILE_URLS = {
  // NASA GIBS, VIIRS Black Marble, Web Mercator. Native zoom tops out at 8.
  night: "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png",
  // Esri World Imagery.
  sat: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
};

// Zoom thresholds, in "design zoom" (the zoom numbers used in content.js, tuned for 1920x1080).
const NIGHT_MAX_ZOOM = 9.4;        // night lights are fully covered by satellite well before this
const SAT_FADE = [7.0, 8.6];       // satellite fades in over the night lights across this range
const OUTLINE_BAND = [4.5, 5.7, 7.9, 9.3]; // Oklahoma outline and dimming: in, hold, hold, out
const FALLBACK_ZOOM = 6.4;         // if satellite imagery is unavailable, close-ups stay at state level

const BACKGROUND = "#04070f";

// ---- Small math helpers -----------------------------------------------------------------------

const clamp01 = (t) => Math.min(1, Math.max(0, t));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2); // ease-in-out
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerpAngle = (a, b, t) => a + ((((b - a) % 360) + 540) % 360 - 180) * t;
const mercX = (lng) => (lng + 180) / 360;
const mercY = (lat) => (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
const unX = (x) => x * 360 - 180;
const unY = (y) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;
const SIDES = ["top", "bottom", "left", "right"];

// ---- Camera paths -------------------------------------------------------------------------------

// A leg is the camera path between two neighbouring steps, as a function of time t (0 to 1).
// Zoom follows an eased profile (optionally lifting to a "via" zoom first), and the ground
// position advances fastest while zoomed out, so the picture slides across the screen at an even
// speed however deep the zoom is. Played with 1 - t, the same path takes the camera back again.
function buildLeg(a, b) {
  const via = b.via || null;
  const LIFT_END = 0.34;
  const DESCENT_START = 0.56;

  const phased = (t, from, mid, to, late) => {
    if (!via) return lerp(from, to, ease(t));
    if (t < LIFT_END) return lerp(from, mid, ease(t / LIFT_END));
    if (t <= DESCENT_START) return mid;
    const s = (t - DESCENT_START) / (1 - DESCENT_START);
    return lerp(mid, to, ease(late ? smooth(0.2, 1, s) * s : s));
  };
  const zoomAt = (t) => phased(t, a.zoom, via && via.zoom, b.zoom, false);
  // On the way down the camera keeps looking at the ground a little longer, then tilts up late.
  const pitchAt = (t) => phased(t, a.pitch || 0, via ? (via.pitch ?? 0) : 0, b.pitch || 0, true);

  const N = 480;
  const cum = new Float64Array(N + 1);
  for (let i = 0; i < N; i++) {
    const t = (i + 0.5) / N;
    cum[i + 1] = cum[i] + Math.pow(2, -zoomAt(t)) * smooth(0, 0.16, t) * smooth(1, 0.84, t);
  }
  const total = cum[N] || 1;
  const panAt = (t) => {
    const f = clamp01(t) * N;
    const i = Math.min(N - 1, Math.floor(f));
    return (cum[i] + (cum[i + 1] - cum[i]) * (f - i)) / total;
  };

  const ax = mercX(a.center[0]), ay = mercY(a.center[1]);
  const bx = mercX(b.center[0]), by = mercY(b.center[1]);
  const pa = a.padding || {}, pb = b.padding || {};

  return {
    at(time) {
      const t = clamp01(time);
      const u = panAt(t);
      const e = ease(t);
      const padding = {};
      for (const side of SIDES) padding[side] = lerp(pa[side] || 0, pb[side] || 0, e);
      return {
        center: [unX(lerp(ax, bx, u)), unY(lerp(ay, by, u))],
        zoom: zoomAt(t),
        pitch: pitchAt(t),
        bearing: lerpAngle(a.bearing || 0, b.bearing || 0, e),
        padding,
      };
    },
  };
}

// Which imagery credits apply at this camera position.
function attributionFor(cam, labels) {
  const parts = [];
  if (cam.zoom < SAT_FADE[1]) parts.push(labels.night);
  if (cam.zoom > SAT_FADE[0]) parts.push(labels.satellite);
  return parts.join(" ");
}

// ---- Tile loading through an in-memory cache ----------------------------------------------------

// Every tile is fetched once and its bytes are kept in memory. The preload pass fills this
// cache, so live camera moves never wait on the network. It also means we do not depend on the
// browser's HTTP cache (NASA GIBS sends "no-store", so the browser would refetch every time).
const tileBytes = new Map();
const tileStats = { night: { ok: 0, fail: 0 }, sat: { ok: 0, fail: 0 } };
const MAX_CACHED_TILES = 6000;
let protocolInstalled = false;
let onTileResult = () => {};

async function fetchBytes(url) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 12000);
  try {
    const res = await fetch(url, { signal: abort.signal });
    if (!res.ok) throw new Error(`Tile request failed (${res.status})`);
    return await res.arrayBuffer();
  } finally {
    clearTimeout(timer);
  }
}

function installTileProtocol(gl) {
  if (protocolInstalled) return;
  protocolInstalled = true;
  gl.addProtocol("mem", async (params) => {
    const key = params.url;
    const [kind, z, y, x] = key.slice("mem://".length).split("/");
    let pending = tileBytes.get(key);
    if (!pending) {
      const url = TILE_URLS[kind].replace("{z}", z).replace("{y}", y).replace("{x}", x);
      // The fetch is not tied to MapLibre's abort signal on purpose: a tile requested in passing
      // during a move still lands in the cache.
      pending = fetchBytes(url).then(
        (bytes) => { tileStats[kind].ok++; onTileResult(kind, true); return bytes; },
        (err) => { tileStats[kind].fail++; tileBytes.delete(key); onTileResult(kind, false); throw err; },
      );
      tileBytes.set(key, pending);
      if (tileBytes.size > MAX_CACHED_TILES) tileBytes.delete(tileBytes.keys().next().value);
    }
    const bytes = await pending;
    return { data: bytes.slice(0) };
  });
}

// ---- The map ------------------------------------------------------------------------------------

function createMap({ container, content, pinElement, onCamera, onHealth }) {
  // ?map=off in the address rehearses what happens if MapLibre or WebGL is unavailable.
  const mapOff = new URLSearchParams(location.search).get("map") === "off";
  const gl = mapOff ? null : window.maplibregl;
  const steps = content.steps;
  const useGlobe = content.map.projection !== "mercator";
  const health = { available: false, nightFailed: false, satFailed: false };

  // One resolved camera per step. The stars step uses the orbit view; a step without a camera
  // (the campfire) keeps the one before it.
  const orbit = { pitch: 0, bearing: 0, ...content.map.orbit };
  if (!useGlobe) orbit.zoom = Math.max(orbit.zoom, 1.9); // a flat world has to fill the screen
  let previous = orbit;
  const cameras = steps.map((step, i) => {
    if (i === 0) previous = orbit;
    else if (step.camera) previous = { pitch: 0, bearing: 0, ...step.camera };
    return previous;
  });

  let map = null;
  let marker = null;
  let za = 0;          // zoom adjustment so framing matches the 1920x1080 design on any screen
  let current = orbit; // the camera most recently applied
  let resolveReady;
  const ready = new Promise((resolve) => { resolveReady = resolve; });

  const computeZa = () => {
    const w = container.clientWidth || 1920, h = container.clientHeight || 1080;
    return Math.log2(Math.max(0.2, Math.min(w / 1920, h / 1080)));
  };

  const zoomBand = (stops, max) => [
    "interpolate", ["linear"], ["zoom"],
    stops[0] + za, 0, stops[1] + za, max, stops[2] + za, max, stops[3] + za, 0,
  ];
  const outlineOpacity = (max) => (health.nightFailed || health.satFailed ? max : zoomBand(OUTLINE_BAND, max));
  const satOpacity = () => ["interpolate", ["linear"], ["zoom"], SAT_FADE[0] + za, 0, SAT_FADE[1] + za, 1];
  const atmosphere = () => ["interpolate", ["linear"], ["zoom"], 0, 1, 3.4 + za, 0.7, 5.6 + za, 0];
  const z = (design) => Math.min(24, Math.max(0, design + za));

  function buildStyle() {
    const d = content.map.dusk || {};
    const dusk = {
      "raster-brightness-max": d.brightnessMax ?? 0.56,
      "raster-brightness-min": d.brightnessMin ?? 0,
      "raster-saturation": d.saturation ?? -0.3,
      "raster-contrast": d.contrast ?? 0.1,
      "raster-hue-rotate": d.hueRotate ?? 8,
      "raster-fade-duration": 260,
    };
    const raster = (kind, maxzoom) => ({ type: "raster", tiles: [`mem://${kind}/{z}/{y}/{x}`], tileSize: 256, maxzoom });
    const style = {
      version: 8,
      projection: { type: useGlobe ? "globe" : "mercator" },
      sources: {
        // The "base", "far" and "mid" sources are coarse copies of the same imagery. They need only
        // a handful of tiles, so they are always on hand underneath the sharp layer: when the
        // camera pulls back quickly there is imagery at the edges instead of a dark gap.
        "night-base": raster("night", 3),
        night: raster("night", 8),
        "sat-far": raster("sat", 10),
        "sat-mid": raster("sat", 14),
        sat: raster("sat", 18),
        "ok-dim": {
          type: "geojson",
          data: {
            type: "Feature", properties: {},
            geometry: { type: "Polygon", coordinates: [[[-172, 4], [-28, 4], [-28, 74], [-172, 74], [-172, 4]], OKLAHOMA_RING] },
          },
        },
        "ok-line": {
          type: "geojson",
          data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: OKLAHOMA_RING } },
        },
      },
      layers: [
        { id: "bg", type: "background", paint: { "background-color": BACKGROUND } },
        { id: "night-base", type: "raster", source: "night-base", maxzoom: z(NIGHT_MAX_ZOOM), paint: { "raster-fade-duration": 260 } },
        { id: "night", type: "raster", source: "night", maxzoom: z(NIGHT_MAX_ZOOM), paint: { "raster-fade-duration": 260 } },
        // Only "sat-far" is drawn while satellite is fading in, so the fade is a clean single layer.
        { id: "sat-far", type: "raster", source: "sat-far", minzoom: z(SAT_FADE[0] - 0.1), paint: { ...dusk, "raster-opacity": satOpacity() } },
        { id: "sat-mid", type: "raster", source: "sat-mid", minzoom: z(SAT_FADE[1]), paint: { ...dusk } },
        { id: "sat", type: "raster", source: "sat", minzoom: z(SAT_FADE[1]), paint: { ...dusk } },
        // Oklahoma: dim everything outside the state and trace it with a soft glow.
        { id: "ok-dim", type: "fill", source: "ok-dim", paint: { "fill-color": "#01030a", "fill-antialias": false, "fill-opacity": zoomBand(OUTLINE_BAND, 0.56) } },
        { id: "ok-glow", type: "line", source: "ok-line", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#a9ccff", "line-width": 22, "line-blur": 20, "line-opacity": outlineOpacity(0.5) } },
        { id: "ok-glow-inner", type: "line", source: "ok-line", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#cfe2ff", "line-width": 7, "line-blur": 6, "line-opacity": outlineOpacity(0.7) } },
        { id: "ok-edge", type: "line", source: "ok-line", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#f3f8ff", "line-width": 1.6, "line-opacity": outlineOpacity(0.95) } },
      ],
    };
    if (useGlobe) style.sky = { "atmosphere-blend": atmosphere() };
    return style;
  }

  // Re-apply everything that depends on the screen size or on imagery health.
  function applyZoomRules() {
    if (!map || !map.getLayer("sat")) return;
    map.setLayerZoomRange("night-base", 0, z(NIGHT_MAX_ZOOM));
    map.setLayerZoomRange("night", 0, z(NIGHT_MAX_ZOOM));
    map.setLayerZoomRange("sat-far", z(SAT_FADE[0] - 0.1), 24);
    map.setLayerZoomRange("sat-mid", z(SAT_FADE[1]), 24);
    map.setLayerZoomRange("sat", z(SAT_FADE[1]), 24);
    map.setPaintProperty("sat-far", "raster-opacity", satOpacity());
    map.setPaintProperty("ok-dim", "fill-opacity", health.nightFailed ? 0 : zoomBand(OUTLINE_BAND, 0.56));
    map.setPaintProperty("ok-glow", "line-opacity", outlineOpacity(0.5));
    map.setPaintProperty("ok-glow-inner", "line-opacity", outlineOpacity(0.7));
    map.setPaintProperty("ok-edge", "line-opacity", outlineOpacity(0.95));
    if (useGlobe) map.setSky({ "atmosphere-blend": atmosphere() });
  }

  function setView(cam) {
    current = cam;
    if (map) {
      const w = container.clientWidth, h = container.clientHeight;
      const p = cam.padding || {};
      let zoom = cam.zoom, pitch = cam.pitch || 0;
      // Without satellite imagery there is nothing to see up close: hold at state level, where the
      // outline and the pin still tell the story.
      if (health.satFailed && zoom > FALLBACK_ZOOM) { zoom = FALLBACK_ZOOM; pitch = Math.min(pitch, 20); }
      map.jumpTo({
        center: cam.center,
        zoom: zoom + za,
        pitch,
        bearing: cam.bearing || 0,
        padding: { top: (p.top || 0) * h, bottom: (p.bottom || 0) * h, left: (p.left || 0) * w, right: (p.right || 0) * w },
      });
    }
    if (onCamera) onCamera(cam);
  }

  const legs = new Map();
  function legBetween(lower, upper) {
    const key = `${lower}>${upper}`;
    if (!legs.has(key)) legs.set(key, buildLeg(cameras[lower], cameras[upper]));
    return legs.get(key);
  }

  // Animate between two neighbouring steps. ctl.fast jumps straight to the end state and
  // ctl.cancelled abandons the move (see the step engine in app.js).
  function fly(from, to, ctl, opts = {}) {
    const lower = Math.min(from, to), upper = Math.max(from, to);
    const leg = legBetween(lower, upper);
    const forward = to > from;
    const duration = opts.duration ?? cameras[upper].duration ?? 3200;
    return new Promise((resolve) => {
      const started = performance.now();
      let done = false, raf = 0, safety = 0;
      const end = () => {
        if (done) return;
        done = true;
        cancelAnimationFrame(raf);
        clearTimeout(safety);
        if (!ctl.cancelled) {
          setView(cameras[to]);
          if (opts.onProgress) opts.onProgress(1);
        }
        resolve();
      };
      const frame = (now) => {
        if (done) return;
        const t = clamp01((now - started) / duration);
        if (ctl.cancelled || ctl.fast || t >= 1) { end(); return; }
        setView(leg.at(forward ? t : 1 - t));
        if (opts.onProgress) opts.onProgress(t);
        raf = requestAnimationFrame(frame);
      };
      // Browsers stop animation frames in a background tab. The timer and the hurry hook make
      // sure a move always ends on its end state and the step engine is never left waiting.
      safety = setTimeout(end, duration + 500);
      if (ctl.onHurry) ctl.onHurry(end);
      raf = requestAnimationFrame(frame);
    });
  }

  // Resolves true once every tile for the current view is loaded and drawn, false on timeout.
  function whenIdle(timeout = 5000) {
    if (!map) return Promise.resolve(true);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        map.off("idle", onIdle);
        resolve(value);
      };
      const onIdle = () => finish(true);
      const timer = setTimeout(() => finish(false), timeout);
      map.on("idle", onIdle);
      map.triggerRepaint();
    });
  }

  const whenVisible = () => new Promise((resolve) => {
    if (!document.hidden) { resolve(); return; }
    const check = () => { if (!document.hidden) { document.removeEventListener("visibilitychange", check); resolve(); } };
    document.addEventListener("visibilitychange", check);
  });

  // The camera positions worth warming: every step's end state plus frames along each flight path,
  // spaced so that neither the zoom nor the view changes much from one frame to the next.
  function preloadFrames() {
    const w = container.clientWidth || 1920;
    const far = (p, q) => {
      const scale = 512 * Math.pow(2, Math.max(p.zoom, q.zoom) + za);
      const dist = Math.hypot(mercX(p.center[0]) - mercX(q.center[0]), mercY(p.center[1]) - mercY(q.center[1])) * scale;
      return Math.abs(p.zoom - q.zoom) >= 0.3 || Math.abs(p.pitch - q.pitch) >= 8 || Math.abs(p.bearing - q.bearing) >= 10 || dist >= 0.18 * w;
    };
    const frames = [];
    // Last leg first, each played backward, so the walk finishes on the opening view.
    for (let i = cameras.length - 1; i >= 1; i--) {
      if (cameras[i] === cameras[i - 1]) continue;
      const leg = legBetween(i - 1, i);
      const picked = [];
      const SAMPLES = 400;
      for (let k = 0; k <= SAMPLES; k++) {
        const cam = leg.at(k / SAMPLES);
        if (!picked.length || k === SAMPLES || far(picked[picked.length - 1], cam)) picked.push(cam);
      }
      frames.push(...picked.reverse());
    }
    return frames;
  }

  // Visit every frame while the map is hidden behind the stars and wait for its tiles.
  async function preload({ onProgress, shouldStop }) {
    if (!map) return { done: false, slow: 0, stats: tileStats };
    await ready;
    const frames = preloadFrames();
    let slow = 0;
    for (let i = 0; i < frames.length; i++) {
      await whenVisible();
      if (shouldStop()) return { done: false, slow, stats: tileStats };
      setView(frames[i]);
      const loaded = await whenIdle(7000);
      if (shouldStop()) return { done: false, slow, stats: tileStats };
      if (!loaded) slow++;
      if (onProgress) onProgress(i + 1, frames.length);
    }
    setView(orbit);
    await whenIdle(4000);
    return { done: true, slow, stats: tileStats };
  }

  function setPin(on, lngLat) {
    if (!marker) return;
    if (on && lngLat) marker.setLngLat(lngLat);
    pinElement.classList.toggle("on", !!on);
  }

  function resize() {
    za = computeZa();
    if (!map) return;
    map.resize();
    applyZoomRules();
    setView(current);
  }

  function checkHealth() {
    const failed = (s) => s.fail >= 4 && s.ok === 0;
    const night = failed(tileStats.night), sat = failed(tileStats.sat);
    if (night === health.nightFailed && sat === health.satFailed) return;
    health.nightFailed = night;
    health.satFailed = sat;
    applyZoomRules();
    setView(current);
    if (onHealth) onHealth({ ...health });
  }

  // ---- Start up ---------------------------------------------------------------------------------

  if (gl && gl.Map) {
    try {
      za = computeZa();
      installTileProtocol(gl);
      onTileResult = (kind, ok) => { if (!ok || health.nightFailed || health.satFailed) checkHealth(); };
      map = new gl.Map({
        container,
        style: buildStyle(),
        center: orbit.center,
        zoom: orbit.zoom + za,
        pitch: orbit.pitch,
        bearing: orbit.bearing,
        interactive: false,            // an accidental mouse move must never shift the map
        attributionControl: false,     // credits are shown in our own corner label
        maxPitch: 75,
        minZoom: -2,
        renderWorldCopies: true,
        refreshExpiredTiles: false,
        maxTileCacheSize: 500,
        pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5),
        fadeDuration: 0,
      });
      health.available = true;
      // Tile failures are counted in the tile protocol above; everything else is just logged.
      map.on("error", (e) => { if (e && e.error && !/Tile request failed|aborted|AbortError/i.test(String(e.error.message))) console.warn("[map]", e.error.message || e.error); });
      map.once("load", () => resolveReady(true));
      setTimeout(() => resolveReady(false), 20000);

      const holder = document.createElement("div");
      holder.appendChild(pinElement);
      marker = new gl.Marker({ element: holder, anchor: "center" }).setLngLat(orbit.center).addTo(map);
    } catch (err) {
      console.warn("[map] Could not start MapLibre; continuing without the map.", err);
      map = null;
      health.available = false;
      resolveReady(false);
    }
  } else {
    console.warn("[map] MapLibre did not load; continuing without the map.");
    resolveReady(false);
  }

  return {
    get available() { return health.available; },
    health,
    ready,
    cameras,
    orbit,
    setView,
    fly,
    whenIdle,
    preload,
    setPin,
    resize,
    stats: tileStats,
    get instance() { return map; },
  };
}

window.CampfireParts = Object.assign(window.CampfireParts || {}, { createMap, attributionFor, buildLeg });
})();
