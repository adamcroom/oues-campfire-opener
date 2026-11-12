// Step engine: keyboard and clicker handling, transitions between steps, text builds,
// presenter notes and preloading. All words, sources, coordinates and timings come from content.js.

// Plain script (not an ES module) so the page also works when index.html is opened straight from
// disk. CONTENT comes from content.js; the scene builders come from the other files.
(() => {
"use strict";

const { createMap, attributionFor, createStarfield, createCampfire, createFireAudio } = window.CampfireParts;

const $ = (id) => document.getElementById(id);
const stage = $("stage");
const panel = $("panel");
const titleEl = $("title");
const attributionEl = $("attribution");
const hazeEl = $("map-haze");
const preparingEl = $("preparing");
const toastEl = $("toast");
const notesEl = $("notes");

const steps = CONTENT.steps;
const LAST = steps.length - 1;
const T = { textDelay: 250, glowLead: 1500, campfireCrossfade: 2000, titleHold: 7000, backSpeed: 0.8, cursorHide: 2000, ...CONTENT.timing };
const CAMPFIRE_STEP = Math.max(0, steps.findIndex((s) => s.toCampfire));

// ---- Motion preference --------------------------------------------------------------------------
// ?motion=full or ?motion=reduced in the URL wins, then content.js, then the computer's setting.

const motionParam = new URLSearchParams(location.search).get("motion");
const motionPref = ["full", "reduced"].includes(motionParam) ? motionParam : CONTENT.motion || "auto";
const reduced = motionPref === "reduced" || (motionPref !== "full" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
stage.classList.toggle("reduced", reduced);

// ---- Scenes -------------------------------------------------------------------------------------

const pinEl = document.createElement("div");
pinEl.className = "pin";
pinEl.innerHTML = '<span class="pin-halo"></span><span class="pin-ring"></span><span class="pin-ring late"></span><span class="pin-dot"></span>';

const starfield = createStarfield($("starfield"), { reducedMotion: reduced, shootingStars: CONTENT.campfire?.shootingStars, shootingStarEvery: CONTENT.campfire?.shootingStarEvery });
const campfire = createCampfire($("campfire"), { reducedMotion: reduced, embers: CONTENT.campfire?.embers });
const audio = createFireAudio();

let lastAttribution = "";
let lastHaze = -1;
const map = createMap({
  container: $("map"),
  content: CONTENT,
  pinElement: pinEl,
  onCamera(cam) {
    const text = attributionFor(cam, CONTENT.attribution);
    if (text !== lastAttribution) { lastAttribution = text; attributionEl.textContent = text; }
    // Distance haze strengthens as the camera tilts toward the horizon.
    const haze = Math.round(Math.min(1, Math.max(0, ((cam.pitch || 0) - 38) / 26)) * 50) / 50;
    if (haze !== lastHaze) { lastHaze = haze; hazeEl.style.opacity = String(haze); }
  },
  onHealth() { updateNotes(); },
});

// ---- State --------------------------------------------------------------------------------------

const state = {
  step: 0,
  build: 0,          // how many of this step's statements are showing
  onFire: false,     // true once the campfire has replaced the map
  titleOnStars: false,
  sound: false,
  preload: "idle",
  progress: 0,
};

let run = null;        // the transition in flight, if any
let autoTimer = 0;     // fades "Pull up a chair." after a few seconds
let glowStarted = 0;
const stopTimers = {};

const realWait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const enabledBuilds = (step) => (step.builds || []).filter((b) => b.enabled !== false);
// The starfield stays alive underneath the first map step: it is the sky around the globe.
const starsUnder = (index) => steps[index].scene === "stars" || (index > 0 && steps[index - 1].scene === "stars");

// One controller per transition. A click during a transition calls hurry(): every wait resolves at
// once and the camera jumps to its end state, so moves are finished quickly and never queued.
function begin() {
  if (run) run.cancel();
  clearTimeout(autoTimer);
  const ctl = { cancelled: false, fast: false, waits: new Set(), hooks: new Set() };
  ctl.onHurry = (fn) => ctl.hooks.add(fn);
  ctl.wait = (ms) => {
    if (ctl.fast || ctl.cancelled || !(ms > 0)) return Promise.resolve();
    return new Promise((resolve) => {
      const entry = { resolve, timer: 0 };
      entry.timer = setTimeout(() => { ctl.waits.delete(entry); resolve(); }, ms);
      ctl.waits.add(entry);
    });
  };
  ctl.hurry = () => {
    if (ctl.fast) return;
    ctl.fast = true;
    stage.classList.add("fast");
    for (const entry of ctl.waits) { clearTimeout(entry.timer); entry.resolve(); }
    ctl.waits.clear();
    for (const fn of ctl.hooks) fn();
    ctl.hooks.clear();
  };
  ctl.cancel = () => { ctl.cancelled = true; ctl.hurry(); };
  run = ctl;
  stage.classList.remove("fast");
  return ctl;
}

function finish(ctl) {
  if (run !== ctl) return;
  run = null;
  updateNotes();
  setTimeout(() => { if (!run || !run.fast) stage.classList.remove("fast"); }, 240);
}

// ---- Layers -------------------------------------------------------------------------------------

function layer(name, on, ms) {
  stage.style.setProperty(`--${name}-ms`, `${Math.max(0, ms)}ms`);
  void stage.offsetWidth; // apply the new duration before the class changes
  stage.classList.toggle(`show-${name}`, on);
}

function setStars(on, ms = 0) {
  clearTimeout(stopTimers.stars);
  if (on) starfield.start();
  else stopTimers.stars = setTimeout(() => starfield.stop(), ms + 150);
  layer("stars", on, ms);
}

function setFire(on, ms = 0) {
  clearTimeout(stopTimers.fire);
  if (on) campfire.start();
  else stopTimers.fire = setTimeout(() => campfire.stop(), ms + 150);
  layer("fire", on, ms);
  audio.setAudible(on);
}

const setMap = (on, ms = 0) => layer("map", on, ms);

function setGlow(on) {
  if (on && !stage.classList.contains("show-glow")) glowStarted = performance.now();
  stage.classList.toggle("show-glow", on);
}

// ---- Text ---------------------------------------------------------------------------------------

function renderPanel(index) {
  panel.replaceChildren();
  for (const build of enabledBuilds(steps[index])) {
    const role = ["headline", "secondary", "thesis"].includes(build.role) ? build.role : "secondary";
    const stmt = document.createElement("div");
    stmt.className = `stmt ${role}`;
    const clip = document.createElement("div");
    clip.className = "stmt-clip";
    const body = document.createElement("div");
    body.className = "stmt-body";
    const text = document.createElement("p");
    text.className = "stmt-text";
    text.textContent = build.text;
    body.append(text);
    if (build.source && build.source.label) {
      // A real link with descriptive text. Clicking it never advances the presentation.
      const link = document.createElement(build.source.url ? "a" : "span");
      link.className = "source";
      link.textContent = `Source: ${build.source.label}`;
      if (build.source.url) {
        link.href = build.source.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      }
      body.append(link);
    }
    clip.append(body);
    stmt.append(clip);
    panel.append(stmt);
  }
}

// Show the first `count` statements. Never more than three on screen: older ones drop away.
function showBuilds(count, instant = false) {
  const items = [...panel.children];
  if (instant) items.forEach((el) => { el.style.transition = "none"; el.querySelector(".stmt-body").style.transition = "none"; });
  items.forEach((el, i) => {
    const shown = i < count && i >= count - 3;
    el.classList.toggle("shown", shown);
    el.classList.toggle("past", shown && i < count - 1);
  });
  if (instant) {
    void panel.offsetHeight;
    items.forEach((el) => { el.style.transition = ""; el.querySelector(".stmt-body").style.transition = ""; });
  }
  panel.classList.toggle("visible", count > 0);
}

const hidePanel = () => panel.classList.remove("visible");

function showTitle(where) {
  titleEl.textContent = CONTENT.title;
  titleEl.classList.toggle("at-fire", where === "fire");
  void titleEl.offsetWidth;
  titleEl.classList.add("on");
}
const hideTitle = () => titleEl.classList.remove("on");
function syncStarsTitle() {
  if (state.step === 0 && state.titleOnStars && !run) showTitle("stars");
  else if (state.step === 0) hideTitle();
}

let toastTimer = 0;
function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("on"), 1600);
}

// ---- Presenter notes ----------------------------------------------------------------------------

const PRELOAD_LABELS = {
  idle: "Not started",
  ready: "Ready",
  partial: "Ready, but some imagery was slow or failed. Press R to try again.",
  interrupted: "Preload interrupted. Press R and wait for Ready.",
  failed: "Map unavailable. Text, stars and campfire still work.",
};

function updateNotes() {
  const step = steps[state.step];
  const count = enabledBuilds(step).length;
  const buildNow = Math.min(count, Math.max(1, state.build));
  $("notes-where").textContent = `Step ${state.step}: ${step.name || step.id}` + (count ? `, build ${buildNow} of ${count}` : "");
  $("notes-text").textContent = step.notes || "";
  const nextStep = steps[state.step + 1];
  const nextName = nextStep ? nextStep.name || nextStep.id : "end of the opener";
  $("notes-next").textContent = count && buildNow < count ? `Next: build ${buildNow + 1} of ${count}, then ${nextName}` : `Next: ${nextName}`;

  $("notes-dot").dataset.state = state.preload;
  $("notes-status-text").textContent = state.preload === "running"
    ? `Preparing imagery… ${Math.round(state.progress * 100)}%`
    : PRELOAD_LABELS[state.preload];

  const flags = [];
  if (steps.some((s) => s.placeholder)) flags.push("Office coordinates are not set yet: the office step uses the Norman center (see content.js).");
  if (map.health.nightFailed) flags.push("Night imagery did not load: showing the Oklahoma outline on a dark map.");
  if (map.health.satFailed) flags.push("Satellite imagery did not load: close-ups stay at state level.");
  if (reduced) flags.push("Reduced motion is on. Add ?motion=full to the address to force full motion.");
  if (state.sound) flags.push("Fire sound is on (plays at the campfire). S turns it off.");
  const list = $("notes-flags");
  list.replaceChildren(...flags.map((f) => { const li = document.createElement("li"); li.textContent = f; return li; }));
}

function setPreload(value, progress = 0) {
  state.preload = value;
  state.progress = progress;
  preparingEl.classList.toggle("on", value === "running" && state.step === 0);
  updateNotes();
}

// ---- Preloading ---------------------------------------------------------------------------------
// While the stars are up, the hidden map visits every camera position so its tiles are in memory
// before the first click. It restarts after a resize (for example going full screen), because a
// different window size needs different tiles.

let preloadId = 0;
async function runPreload() {
  if (!map.available) { setPreload("failed"); return; }
  const id = ++preloadId;
  setPreload("running", 0);
  const result = await map.preload({
    onProgress: (done, total) => { if (id === preloadId) setPreload("running", done / total); },
    shouldStop: () => id !== preloadId || state.step !== 0 || !!run,
  });
  if (id !== preloadId) return;
  if (!map.available) { setPreload("failed"); return; }
  if (!result.done) { setPreload("interrupted"); return; }
  const gaps = result.slow > 0 || map.health.nightFailed || map.health.satFailed;
  setPreload(gaps ? "partial" : "ready");
}

// ---- Transitions --------------------------------------------------------------------------------

// The camera has arrived at a map step: drop the pin, light the fire, or show the first line.
async function settle(ctl, index, builds) {
  const step = steps[index];
  if (step.pin) {
    map.setPin(true, map.cameras[index].center);
    await ctl.wait(reduced ? 0 : 550);
    if (ctl.cancelled) return;
  }
  if (step.toCampfire && builds !== "all") { await lightCampfire(ctl); return; }
  await ctl.wait(T.textDelay);
  if (ctl.cancelled) return;
  const count = enabledBuilds(step).length;
  state.build = builds === "all" ? count : Math.min(1, count);
  renderPanel(index);
  showBuilds(state.build, true);
  finish(ctl);
}

// Firelight first, then the fire itself, then the title.
async function lightCampfire(ctl) {
  setGlow(true);
  await ctl.wait(T.glowLead - (performance.now() - glowStarted));
  if (ctl.cancelled) return;
  setFire(true, T.campfireCrossfade);
  await ctl.wait(T.campfireCrossfade);
  if (ctl.cancelled) return;
  if (ctl.fast) await realWait(170);
  // The fire now covers the map completely, so the layers underneath can go without being seen.
  setMap(false, 0);
  setStars(false, 0);
  setGlow(false);
  state.onFire = true;
  updateNotes();
  await ctl.wait(350);
  if (ctl.cancelled) return;
  showTitle("fire");
  finish(ctl);
  autoTimer = setTimeout(() => { if (!run && state.onFire && state.step !== LAST) holdCampfire(); }, T.titleHold);
}

// Step 6: the clean scene that stays up behind the hosts.
function holdCampfire() {
  clearTimeout(autoTimer);
  state.step = LAST;
  state.build = 0;
  hideTitle();
  updateNotes();
}

async function forward(next) {
  const from = state.step;
  const target = steps[next];
  if (target.scene === "fire" && state.onFire) { holdCampfire(); return; }
  if (reduced || !map.available || target.scene !== "map") { cut(next, 1); return; }

  const ctl = begin();
  hidePanel();
  hideTitle();
  map.setPin(false);
  state.step = next;
  state.build = 0;
  state.onFire = false;
  preparingEl.classList.remove("on");
  updateNotes();

  if (steps[from].scene === "stars") {
    // Descend: the Earth's night lights rise out of the starfield.
    map.setView(map.orbit);
    setStars(true, 0);
    setMap(true, 1500);
  }
  const duration = map.cameras[next].duration ?? 3200;
  const glowFrom = target.toCampfire ? 1 - Math.min(0.5, 1100 / duration) : 2;
  await map.fly(from, next, ctl, {
    duration,
    onProgress: (p) => { if (p >= glowFrom && !ctl.fast) setGlow(true); },
  });
  if (ctl.cancelled) return;
  if (!starsUnder(next)) setStars(false, 400);
  await settle(ctl, next, 1);
}

async function backward(prev) {
  const from = state.step;
  if (reduced || !map.available) { cut(prev, "all"); return; }

  const ctl = begin();
  hidePanel();
  hideTitle();
  setGlow(false);
  map.setPin(false);
  state.step = prev;
  state.build = 0;
  updateNotes();

  const toStars = steps[prev].scene === "stars";
  if (starsUnder(prev)) setStars(true, 0);
  const duration = (map.cameras[from].duration ?? 3200) * T.backSpeed;
  let fading = false;
  await map.fly(from, prev, ctl, {
    duration,
    onProgress: (p) => { if (toStars && !fading && p >= 0.4) { fading = true; setMap(false, duration * 0.55); } },
  });
  if (ctl.cancelled) return;
  if (toStars) {
    setMap(false, 200);
    finish(ctl);
    syncStarsTitle();
    if (state.preload !== "ready") runPreload();
    return;
  }
  await settle(ctl, prev, "all");
}

// From the campfire, back to Beavers Bend on the map.
async function leaveCampfire() {
  const ctl = begin();
  hideTitle();
  hidePanel();
  setGlow(false);
  state.step = CAMPFIRE_STEP;
  state.build = 0;
  state.onFire = false;
  updateNotes();
  map.setView(map.cameras[CAMPFIRE_STEP]);
  setMap(true, 0);
  setFire(false, reduced ? 700 : 1400);
  await ctl.wait(reduced ? 700 : 1400);
  if (ctl.cancelled) return;
  finish(ctl);
}

// A clean cut to any step: fade out, move the camera while nothing is showing, fade back in.
// Used for the number keys, for Reset, and for every move when reduced motion is on.
async function cut(target, builds) {
  const ctl = begin();
  const step = steps[target];
  hidePanel();
  hideTitle();
  setGlow(false);
  map.setPin(false);
  state.step = target;
  state.build = 0;
  state.onFire = false;
  preparingEl.classList.toggle("on", state.preload === "running" && target === 0);
  updateNotes();

  if (step.scene === "stars") {
    setStars(true, 700);
    setMap(false, 700);
    setFire(false, 700);
    await ctl.wait(700);
    if (ctl.cancelled) return;
    map.setView(map.orbit);
    finish(ctl);
    syncStarsTitle();
    if (state.preload !== "ready") runPreload();
    return;
  }

  if (step.scene === "fire") {
    setFire(true, 900);
    await ctl.wait(900);
    if (ctl.cancelled) return;
    if (ctl.fast) await realWait(170);
    setMap(false, 0);
    setStars(false, 0);
    state.onFire = true;
    finish(ctl);
    return;
  }

  const FADE = 450;
  setMap(false, FADE);
  setFire(false, FADE);
  setStars(starsUnder(target), FADE);
  await ctl.wait(FADE);
  if (ctl.cancelled) return;
  if (ctl.fast) await realWait(170);
  map.setView(map.cameras[target]);
  if (!ctl.fast) await Promise.race([map.whenIdle(2500), ctl.wait(2600)]);
  if (ctl.cancelled) return;
  setMap(true, 600);
  await ctl.wait(600);
  if (ctl.cancelled) return;
  await settle(ctl, target, builds);
}

// ---- Navigation ---------------------------------------------------------------------------------

function advance() {
  if (run) { run.hurry(); return; }
  const step = steps[state.step];
  const count = enabledBuilds(step).length;
  if (state.build < count) {
    state.build += 1;
    showBuilds(state.build);
    updateNotes();
    return;
  }
  // Back on the map at Beavers Bend (after stepping back from the fire): light it again.
  if (step.toCampfire && !state.onFire) {
    const ctl = begin();
    lightCampfire(ctl);
    return;
  }
  if (state.step < LAST) { forward(state.step + 1); return; }
  hideTitle();
}

function back() {
  if (run) { run.hurry(); return; }
  clearTimeout(autoTimer);
  if (state.onFire) { leaveCampfire(); return; }
  if (state.build > 1) {
    state.build -= 1;
    showBuilds(state.build);
    updateNotes();
    return;
  }
  if (state.step > 0) backward(state.step - 1);
}

function jump(index) {
  if (index < 0 || index > LAST) return;
  cut(index, 1);
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.().catch(() => {});
}

// ---- Input --------------------------------------------------------------------------------------

// A bouncy clicker can send the same press twice within a few milliseconds. Without this guard the
// second press would fast-forward the move the first one started.
let lastNav = 0;
function nav(fn) {
  const now = performance.now();
  if (now - lastNav < 220) return;
  lastNav = now;
  fn();
}

window.addEventListener("keydown", (e) => {
  // Many clickers have a "start slideshow" button that sends F5. In a browser that reloads the
  // page, which would drop the audience back at the stars. Ctrl+R / Cmd+R still reload.
  if (e.key === "F5") { e.preventDefault(); return; }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  switch (key) {
    case "ArrowRight": case "ArrowDown": case "PageDown": case " ": case "Spacebar":
      e.preventDefault();
      if (!e.repeat) nav(advance);
      break;
    case "ArrowLeft": case "ArrowUp": case "PageUp":
      e.preventDefault();
      if (!e.repeat) nav(back);
      break;
    case "r":
      jump(0);
      break;
    case "f":
      toggleFullscreen();
      break;
    case "n":
      notesEl.hidden = !notesEl.hidden;
      break;
    case "t":
      state.titleOnStars = !state.titleOnStars;
      syncStarsTitle();
      break;
    case "s":
      state.sound = audio.setEnabled(!state.sound);
      toast(state.sound ? "Fire sound on" : "Fire sound off");
      updateNotes();
      break;
    default:
      if (/^[0-9]$/.test(key) && !e.repeat) jump(Number(key));
  }
});

stage.addEventListener("click", (e) => {
  if (e.target.closest("a, #notes")) return; // links open, notes are for reading
  nav(advance);
});

// Hide the pointer when it has been still for a moment.
let cursorTimer = 0;
function wakeCursor() {
  stage.classList.remove("nocursor");
  clearTimeout(cursorTimer);
  cursorTimer = setTimeout(() => stage.classList.add("nocursor"), T.cursorHide);
}
window.addEventListener("mousemove", wakeCursor);
wakeCursor();

let resizeTimer = 0;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    starfield.resize();
    campfire.resize();
    map.resize();
    if (state.step === 0 && !run) runPreload();
  }, 350);
});

// ---- Start --------------------------------------------------------------------------------------

document.documentElement.classList.add("started"); // hides the "did not start" note in index.html
starfield.resize();
campfire.resize();
starfield.start();
titleEl.textContent = CONTENT.title;
updateNotes();

// Text is hidden at first, so the browser would not fetch the font until the first headline.
// Ask for every weight now.
if (document.fonts && document.fonts.load) {
  for (const weight of [500, 600, 700]) document.fonts.load(`${weight} 32px Manrope`).catch(() => {});
}

runPreload();

// Handy in the browser console while rehearsing.
window.campfireOpener = { state, map, advance, back, jump, content: CONTENT };
})();
