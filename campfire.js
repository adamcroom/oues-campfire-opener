// The campfire: an illustrated night scene that can hold behind the hosts for an hour or more.
//
// The still parts of the picture (sky, pines, ground, logs, stones) are painted once per resize
// into two off-screen images: one with dim firelight, one with full firelight. Each frame blends
// the two (that is the flicker), then draws the live parts: flames, embers and a few twinkling
// stars. Nothing is allocated per frame, so memory stays flat.

// Plain script (not an ES module) so the page also works when index.html is opened straight from
// disk: browsers refuse to load modules from file:// addresses. Each file keeps its internals inside
// this function and shares only what the others need through window.CampfireParts.
(() => {
"use strict";

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Where the base of the fire sits, as a fraction of the frame. The map's firelight glow (#glow in
// styles.css) and the Beavers Bend camera padding in content.js are lined up with this.
const FIRE_X = 0.5;
const FIRE_Y = 0.735;
const HORIZON = 0.655;
const FIRE_SCALE = 1.18; // the fire, its stones and its logs are drawn a little larger than the rest
const FRAME_MS = 31; // about 30 frames a second: smooth for motion this slow, and easy on the laptop

// Flame tongues in design units (1 unit = 1px on a 1920x1080 frame), relative to the fire's base.
// l is the colour layer, from the deep orange outside (0) to the pale core (3).
const TONGUES = [
  { l: 0, x: -80, w: 44, h: 150, ph: 0.3 }, { l: 0, x: -42, w: 54, h: 228, ph: 1.9 },
  { l: 0, x: 2, w: 62, h: 290, ph: 4.1 }, { l: 0, x: 46, w: 54, h: 216, ph: 2.7 },
  { l: 0, x: 82, w: 42, h: 140, ph: 5.5 },
  { l: 1, x: -54, w: 38, h: 122, ph: 3.3 }, { l: 1, x: -15, w: 47, h: 196, ph: 0.9 },
  { l: 1, x: 27, w: 45, h: 168, ph: 5.0 }, { l: 1, x: 61, w: 34, h: 102, ph: 2.2 },
  { l: 2, x: -27, w: 30, h: 94, ph: 1.2 }, { l: 2, x: 6, w: 37, h: 136, ph: 3.9 },
  { l: 2, x: 37, w: 28, h: 86, ph: 0.2 },
  { l: 3, x: -8, w: 22, h: 60, ph: 2.5 }, { l: 3, x: 16, w: 20, h: 52, ph: 4.6 },
];
const LAYER_COLORS = [
  ["#ff7c2b", "#ee531d", "#c2371a"],
  ["#ffa63e", "#ff8a3d", "#f8752c"],
  ["#ffd562", "#ffb640", "#ffa23a"],
  ["#fff5d2", "#ffe491", "#ffd15f"],
];
// Small flames that break away from the top, rise and fade.
const LICKS = [
  { x: -30, period: 3.6, offset: 0.0 },
  { x: 24, period: 4.7, offset: 1.9 },
  { x: 2, period: 5.6, offset: 3.4 },
];
const EMBER_COLORS = ["255,236,176", "255,178,78", "255,110,46"];

function createCampfire(canvas, options = {}) {
  const ctx = canvas.getContext("2d", { alpha: false });
  let reduced = !!options.reducedMotion;
  const emberTarget = Math.max(0, Math.min(120, options.embers ?? 34));

  let W = 0, H = 0, scale = 1, u = 1, fu = 1, fx = 0, fy = 0;
  let dim = null, lit = null, frontDim = null, frontLit = null, front = { x: 0, y: 0, w: 0, h: 0 };
  let halo = null, emberSprites = [], flameFills = [];
  let twinkles = [];

  const MAX_EMBERS = 120;
  const ex = new Float32Array(MAX_EMBERS), ey = new Float32Array(MAX_EMBERS);
  const evx = new Float32Array(MAX_EMBERS), evy = new Float32Array(MAX_EMBERS);
  const eage = new Float32Array(MAX_EMBERS), elife = new Float32Array(MAX_EMBERS);
  const esize = new Float32Array(MAX_EMBERS), eseed = new Float32Array(MAX_EMBERS);

  let running = false, raf = 0, last = 0, lastDraw = 0, time = 0;

  const emberCount = () => (reduced ? Math.min(8, emberTarget) : emberTarget);

  function spawnEmber(i, warm) {
    ex[i] = fx + (Math.random() - 0.5) * 120 * fu;
    ey[i] = fy - (70 + Math.random() * 150) * fu;
    evx[i] = (Math.random() - 0.5) * 18 * fu;
    evy[i] = -(30 + Math.random() * 44) * fu;
    elife[i] = 3.5 + Math.random() * 5;
    eage[i] = warm ? Math.random() * elife[i] : 0;
    esize[i] = (1.3 + Math.random() * 1.7) * Math.max(0.75, u);
    eseed[i] = Math.random() * 6.28;
    if (warm) { ey[i] += evy[i] * eage[i] * 0.8; }
  }

  // ---- Painting the still scene ---------------------------------------------------------------

  function layerCanvas(w = W, h = H) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w * scale));
    c.height = Math.max(1, Math.round(h * scale));
    const g = c.getContext("2d");
    g.scale(scale, scale);
    return [c, g];
  }

  // A stylised pine: stacked tiers that widen toward the ground.
  function pine(g, x, baseY, h, rand) {
    const tiers = 7 + Math.floor(rand() * 4);
    const width = h * (0.27 + rand() * 0.09);
    const left = [], right = [];
    for (let i = 1; i <= tiers; i++) {
      const f = i / tiers;
      const y = baseY - h + h * 0.92 * f;
      const half = width * 0.5 * (0.1 + 0.9 * Math.pow(f, 0.86));
      right.push([half * (0.84 + rand() * 0.3), y + h * 0.012 * rand()]);
      left.push([half * (0.84 + rand() * 0.3), y + h * 0.012 * rand()]);
    }
    const trunk = width * 0.05;
    g.beginPath();
    g.moveTo(x, baseY - h);
    for (const [half, y] of right) { g.lineTo(x + half, y); g.lineTo(x + half * 0.46, y + h * 0.006); }
    g.lineTo(x + trunk, baseY - h * 0.075);
    g.lineTo(x + trunk, baseY);
    g.lineTo(x - trunk, baseY);
    g.lineTo(x - trunk, baseY - h * 0.075);
    for (let i = left.length - 1; i >= 0; i--) { const [half, y] = left[i]; g.lineTo(x - half * 0.46, y + h * 0.006); g.lineTo(x - half, y); }
    g.closePath();
    g.fill();
  }

  // Tint whatever is already on this layer with firelight, strongest near the fire.
  function warmTint(g, radius, strength) {
    g.globalCompositeOperation = "source-atop";
    const grad = g.createRadialGradient(fx, fy - 70 * u, 0, fx, fy - 70 * u, radius);
    grad.addColorStop(0, `rgba(255,136,60,${strength})`);
    grad.addColorStop(0.45, `rgba(255,112,44,${strength * 0.42})`);
    grad.addColorStop(1, "rgba(255,100,40,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = "source-over";
  }

  // Fill a shape dark, then light the side of it that faces the fire.
  function litShape(g, path, baseColor, lightX, lightY, radius, strength) {
    g.fillStyle = baseColor;
    g.fill(path);
    g.save();
    g.clip(path);
    const grad = g.createRadialGradient(lightX, lightY, 0, lightX, lightY, radius);
    grad.addColorStop(0, `rgba(255,176,104,${Math.min(1, strength)})`);
    grad.addColorStop(0.5, `rgba(255,122,50,${Math.min(1, strength * 0.45)})`);
    grad.addColorStop(1, "rgba(180,60,20,0)");
    g.fillStyle = grad;
    g.fillRect(lightX - radius, lightY - radius, radius * 2, radius * 2);
    g.restore();
  }

  function stonePath(cx, cy, w, h, tilt) {
    const p = new Path2D();
    p.ellipse(cx, cy, w / 2, h / 2, tilt, 0, Math.PI * 2);
    return p;
  }

  function ringStones() {
    const rand = mulberry32(77);
    const stones = [];
    const n = 13;
    for (let i = 0; i < n; i++) {
      const angle = (i / n) * Math.PI * 2 + (rand() - 0.5) * 0.16;
      stones.push({
        x: fx + Math.cos(angle) * 170 * fu,
        y: fy + 4 * fu + Math.sin(angle) * 46 * fu,
        w: (44 + rand() * 20) * fu,
        h: (30 + rand() * 12) * fu,
        tilt: (rand() - 0.5) * 0.5,
        front: Math.sin(angle) > 0.12,
      });
    }
    return stones.sort((p, q) => p.y - q.y);
  }

  function paintScene(k) {
    const [c, g] = layerCanvas();
    const rand = mulberry32(4242);
    const horizon = H * HORIZON;

    // Sky, with a little warmth where the firelight reaches the air above the clearing.
    const sky = g.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, "#02040b");
    sky.addColorStop(0.55, "#071024");
    sky.addColorStop(1, "#0e1b37");
    g.fillStyle = sky;
    g.fillRect(0, 0, W, horizon + 2);
    const air = g.createRadialGradient(fx, horizon, 0, fx, horizon, 760 * u);
    air.addColorStop(0, `rgba(255,120,50,${0.2 * k})`);
    air.addColorStop(1, "rgba(255,120,50,0)");
    g.fillStyle = air;
    g.fillRect(0, 0, W, horizon + 2);

    // Stars: the starfield returning faintly overhead.
    const starCount = Math.round(330 * (W / (1920 * u)));
    g.fillStyle = "#e6eeff";
    for (let i = 0; i < starCount; i++) {
      const x = rand() * W;
      const yf = Math.pow(rand(), 1.35);
      const y = yf * horizon * 0.9;
      const r = (0.6 + 1.3 * Math.pow(rand(), 5)) * Math.max(0.8, u);
      g.globalAlpha = (0.3 + 0.7 * Math.pow(rand(), 1.6)) * (1 - yf * 0.7);
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    g.globalAlpha = 1;

    // Far ridge and the far line of pines, on their own layer so the firelight tints only them.
    {
      const [fc, fg] = layerCanvas();
      const frand = mulberry32(911);
      fg.fillStyle = "#0a1428";
      fg.beginPath();
      fg.moveTo(0, H);
      for (let x = 0; x <= W; x += 24 * u) {
        const f = x / W;
        fg.lineTo(x, horizon - (52 + 26 * Math.sin(f * Math.PI * 1.3 + 0.4) + 11 * Math.sin(f * 9 + 1)) * u);
      }
      fg.lineTo(W, H);
      fg.closePath();
      fg.fill();
      fg.fillStyle = "#070f20";
      for (let x = -40 * u; x < W + 40 * u; x += (26 + frand() * 34) * u) {
        const edge = Math.abs(x / W - 0.5) * 2;
        const h = (150 + frand() * 170) * (0.6 + 0.6 * edge) * u;
        pine(fg, x, horizon + (4 + frand() * 10) * u, h, frand);
      }
      warmTint(fg, 860 * u, 0.5 * k);
      g.drawImage(fc, 0, 0, W, H);
    }

    // Ground and the pool of light around the fire.
    const ground = g.createLinearGradient(0, horizon, 0, H);
    ground.addColorStop(0, "#0a0f18");
    ground.addColorStop(1, "#020306");
    g.fillStyle = ground;
    g.fillRect(0, horizon, W, H - horizon);
    g.save();
    g.beginPath();
    g.rect(0, horizon, W, H - horizon);
    g.clip();
    g.translate(fx, fy + 12 * u);
    g.scale(1, 0.3);
    const pool = g.createRadialGradient(0, 0, 0, 0, 0, 760 * u);
    pool.addColorStop(0, `rgba(255,158,78,${0.86 * k})`);
    pool.addColorStop(0.28, `rgba(255,122,52,${0.46 * k})`);
    pool.addColorStop(0.65, `rgba(190,74,28,${0.16 * k})`);
    pool.addColorStop(1, "rgba(160,60,20,0)");
    g.fillStyle = pool;
    g.fillRect(-800 * u, -800 * u, 1600 * u, 1600 * u);
    g.restore();

    // Near pines framing the clearing at both edges.
    {
      const [nc, ng] = layerCanvas();
      const nrand = mulberry32(1337);
      ng.fillStyle = "#010307";
      const spots = [-0.03, 0.05, 0.125, 0.2, 0.8, 0.875, 0.95, 1.03];
      for (const f of spots) {
        const edge = Math.abs(f - 0.5) * 2;
        const h = (430 + 380 * edge + nrand() * 120) * u;
        pine(ng, f * W + (nrand() - 0.5) * 30 * u, horizon + (40 + 90 * edge + nrand() * 20) * u, h, nrand);
      }
      warmTint(ng, 1000 * u, 0.3 * k);
      g.drawImage(nc, 0, 0, W, H);
    }

    // Two log benches and two stumps: somewhere to pull up a chair.
    const bench = (cx, cy, len, thick, dir) => {
      const body = new Path2D();
      body.roundRect(cx - len / 2, cy - thick / 2, len, thick, thick / 2);
      litShape(g, body, "#0a0806", cx - dir * len * 0.5, cy - thick * 0.9, len * 0.95, 0.85 * k);
      const endX = cx - dir * (len / 2 - thick * 0.2);
      const cap = new Path2D();
      cap.ellipse(endX, cy, thick * 0.3, thick * 0.47, 0, 0, Math.PI * 2);
      litShape(g, cap, "#130d08", fx, fy - 60 * u, Math.abs(endX - fx) * 1.5, 1.1 * k);
      g.fillStyle = "#040302";
      g.fillRect(cx - len * 0.3, cy + thick * 0.35, thick * 0.3, thick * 0.5);
      g.fillRect(cx + len * 0.24, cy + thick * 0.35, thick * 0.3, thick * 0.5);
    };
    bench(fx - 430 * u, fy + 6 * u, 290 * u, 46 * u, -1);
    bench(fx + 440 * u, fy + 14 * u, 300 * u, 48 * u, 1);

    const stump = (cx, cy, w, h) => {
      const body = new Path2D();
      body.moveTo(cx - w / 2, cy);
      body.lineTo(cx - w * 0.56, cy + h);
      body.lineTo(cx + w * 0.56, cy + h);
      body.lineTo(cx + w / 2, cy);
      body.closePath();
      litShape(g, body, "#060504", fx, cy - 10 * u, Math.abs(cx - fx) * 1.25, 0.5 * k);
      const top = new Path2D();
      top.ellipse(cx, cy, w / 2, w * 0.17, 0, 0, Math.PI * 2);
      litShape(g, top, "#16100a", fx, fy - 40 * u, Math.hypot(cx - fx, cy - fy) * 1.7, 1.15 * k);
    };
    stump(fx - 268 * u, fy + 118 * u, 104 * u, 78 * u);
    stump(fx + 300 * u, fy + 104 * u, 96 * u, 72 * u);

    // Back half of the stone ring (the front half is drawn over the flames, see paintFront).
    for (const s of ringStones()) {
      if (s.front) continue;
      litShape(g, stonePath(s.x, s.y, s.w, s.h, s.tilt), "#16171c", fx, fy + 6 * fu, 250 * fu, 1.25 * k);
    }

    // Coal bed and logs.
    g.save();
    g.translate(fx, fy + 2 * fu);
    g.scale(1, 0.26);
    const coals = g.createRadialGradient(0, 0, 0, 0, 0, 128 * fu);
    coals.addColorStop(0, `rgba(255,205,120,${0.95 * k + 0.05})`);
    coals.addColorStop(0.45, `rgba(255,120,44,${0.85 * k})`);
    coals.addColorStop(1, "rgba(150,40,10,0)");
    g.fillStyle = coals;
    g.fillRect(-140 * fu, -140 * fu, 280 * fu, 280 * fu);
    g.restore();
    const log = (angle, len, thick, ox, oy) => {
      g.save();
      g.translate(fx + ox * fu, fy + oy * fu);
      g.rotate(angle);
      const body = new Path2D();
      body.roundRect((-len / 2) * fu, (-thick / 2) * fu, len * fu, thick * fu, thick * 0.32 * fu);
      g.fillStyle = "#170d07";
      g.fill(body);
      g.save();
      g.clip(body);
      const edge = g.createLinearGradient(0, (-thick / 2) * fu, 0, (thick / 2) * fu);
      edge.addColorStop(0, `rgba(255,150,60,${0.9 * k})`);
      edge.addColorStop(0.35, `rgba(200,70,20,${0.35 * k})`);
      edge.addColorStop(1, "rgba(60,20,8,0)");
      g.fillStyle = edge;
      g.fillRect((-len / 2) * fu, (-thick / 2) * fu, len * fu, thick * fu);
      g.restore();
      g.restore();
    };
    log(Math.PI * 0.47, 96, 24, -6, -22);
    log(-0.3, 190, 28, -12, -12);
    log(0.26, 196, 30, 14, -6);

    // Vignette: keeps the eye on the fire and the edges quiet behind the hosts.
    const reach = Math.max(W, H);
    const vignette = g.createRadialGradient(fx, fy - 90 * u, reach * 0.34, fx, fy - 90 * u, reach * 0.78);
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(1, "rgba(0,0,0,0.46)");
    g.fillStyle = vignette;
    g.fillRect(0, 0, W, H);
    return c;
  }

  // The front stones sit in front of the flames: dark faces toward us, firelight on their tops.
  function paintFront(k) {
    const [c, g] = layerCanvas(front.w, front.h);
    g.translate(-front.x, -front.y);
    for (const s of ringStones()) {
      if (!s.front) continue;
      litShape(g, stonePath(s.x, s.y, s.w, s.h, s.tilt), "#0d0e12", fx, fy - 26 * fu, 60 * fu + Math.abs(s.x - fx) * 1.05, 1.2 * k);
    }
    return c;
  }

  // Chrome draws canvas gradients without dithering, so the dark sky and ground show faint contour
  // rings, most of all on a projector. A whisper of grain hides them. It is the same grain in the
  // dim and the lit image, so it holds still while the firelight flickers.
  function addGrain(c) {
    const g = c.getContext("2d");
    const image = g.getImageData(0, 0, c.width, c.height);
    const d = image.data;
    const rand = mulberry32(99);
    const noise = new Float32Array(4096);
    for (let i = 0; i < noise.length; i++) noise[i] = (rand() + rand() - 1) * 1.6;
    let seed = 777;
    for (let i = 0; i < d.length; i += 4) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const n = noise[seed >>> 20];
      d[i] += n; d[i + 1] += n; d[i + 2] += n;
    }
    g.putImageData(image, 0, 0);
    return c;
  }

  function buildSprites() {
    halo = document.createElement("canvas");
    halo.width = halo.height = 256;
    let g = halo.getContext("2d");
    let grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    grad.addColorStop(0, "rgba(255,170,90,0.85)");
    grad.addColorStop(0.25, "rgba(255,130,56,0.42)");
    grad.addColorStop(0.6, "rgba(255,100,40,0.1)");
    grad.addColorStop(1, "rgba(255,90,30,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);

    emberSprites = EMBER_COLORS.map((rgb) => {
      const s = document.createElement("canvas");
      s.width = s.height = 32;
      g = s.getContext("2d");
      grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
      grad.addColorStop(0, `rgba(${rgb},1)`);
      grad.addColorStop(0.22, `rgba(${rgb},0.85)`);
      grad.addColorStop(0.5, `rgba(${rgb},0.22)`);
      grad.addColorStop(1, `rgba(${rgb},0)`);
      g.fillStyle = grad;
      g.fillRect(0, 0, 32, 32);
      return s;
    });
  }

  function resize() {
    W = canvas.clientWidth || window.innerWidth;
    H = canvas.clientHeight || window.innerHeight;
    scale = Math.min(window.devicePixelRatio || 1, 1.5);
    while (W * H * scale * scale > 3.2e6 && scale > 0.75) scale -= 0.125;
    canvas.width = Math.round(W * scale);
    canvas.height = Math.round(H * scale);
    u = Math.min(W / 1920, H / 1080);
    fu = u * FIRE_SCALE;
    fx = W * FIRE_X;
    fy = H * FIRE_Y;

    dim = addGrain(paintScene(0.5));
    lit = addGrain(paintScene(1));
    front = { x: fx - 250 * fu, y: fy - 24 * fu, w: 500 * fu, h: 110 * fu };
    frontDim = paintFront(0.5);
    frontLit = paintFront(1);
    if (!halo) buildSprites();

    // Flame colours, bottom to top, in the fire's own coordinates.
    flameFills = LAYER_COLORS.map((stops, layer) => {
      const top = [300, 205, 140, 62][layer] * fu;
      const grad = ctx.createLinearGradient(0, 0, 0, -top);
      grad.addColorStop(0, stops[0]);
      grad.addColorStop(0.55, stops[1]);
      grad.addColorStop(1, stops[2]);
      return grad;
    });

    const rand = mulberry32(2026);
    twinkles = [];
    for (let i = 0; i < 34; i++) {
      twinkles.push({
        x: rand() * W,
        y: Math.pow(rand(), 1.2) * H * HORIZON * 0.62,
        r: (0.8 + rand() * 0.8) * Math.max(0.8, u),
        a: 0.35 + rand() * 0.45,
        spd: 0.3 + rand() * 0.8,
        ph: rand() * 6.28,
      });
    }
    for (let i = 0; i < MAX_EMBERS; i++) spawnEmber(i, true);
    draw();
  }

  // ---- Drawing a frame ------------------------------------------------------------------------

  function tonguePath(x, w, h, tipX, midX) {
    ctx.moveTo(x - w, 0);
    ctx.bezierCurveTo(x - w * 1.25, -h * 0.3, midX - w * 0.62, -h * 0.62, tipX, -h);
    ctx.bezierCurveTo(midX + w * 0.62, -h * 0.62, x + w * 1.25, -h * 0.3, x + w, 0);
    ctx.closePath();
  }

  function draw() {
    if (!W || !lit) return;
    const sway = reduced ? 0.3 : 1;
    const pace = reduced ? 0.5 : 1;
    const t = time * pace;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.globalCompositeOperation = "source-over";

    // Firelight flicker: three slow sine waves, never a strobe.
    const wobble = 0.2 * Math.sin(t * 1.7) + 0.12 * Math.sin(t * 3.1 + 1.3) + 0.06 * Math.sin(t * 5.3 + 0.7);
    const flicker = Math.min(1, Math.max(0, 0.64 + wobble * (reduced ? 0.4 : 1)));

    ctx.globalAlpha = 1;
    ctx.drawImage(dim, 0, 0, W, H);
    ctx.globalAlpha = flicker;
    ctx.drawImage(lit, 0, 0, W, H);

    ctx.fillStyle = "#eef3ff";
    for (const s of twinkles) {
      ctx.globalAlpha = s.a * (reduced ? 0.8 : 0.55 + 0.45 * Math.sin(s.ph + time * s.spd));
      ctx.fillRect(s.x - s.r, s.y - s.r, s.r * 2, s.r * 2);
    }

    // Glow in the air around the flames.
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.24 + 0.14 * flicker;
    const hr = 520 * fu;
    ctx.drawImage(halo, fx - hr, fy - 110 * fu - hr, hr * 2, hr * 2);
    ctx.globalCompositeOperation = "source-over";

    // Flames.
    ctx.save();
    ctx.translate(fx, fy - 8 * fu);
    for (let layer = 0; layer < 4; layer++) {
      ctx.globalAlpha = layer === 0 ? 0.94 : 1;
      ctx.fillStyle = flameFills[layer];
      ctx.beginPath();
      for (const f of TONGUES) {
        if (f.l !== layer) continue;
        const s1 = Math.sin(t * 1.9 + f.ph), s2 = Math.sin(t * 3.1 + f.ph * 1.7);
        const s3 = Math.sin(t * 1.3 + f.ph * 2.3), s4 = Math.sin(t * 2.3 + f.ph * 0.6);
        const h = f.h * fu * (1 + (0.09 * s3 + 0.05 * s2) * sway);
        const tipX = f.x * fu + 0.11 * f.h * fu * (0.7 * s1 + 0.3 * s2) * sway;
        const midX = f.x * fu + 0.05 * f.h * fu * s4 * sway;
        tonguePath(f.x * fu, f.w * fu, h, tipX, midX);
      }
      ctx.fill();
    }
    if (!reduced) {
      ctx.fillStyle = "#f4682a";
      for (let i = 0; i < LICKS.length; i++) {
        const lick = LICKS[i];
        const p = ((time + lick.offset) / lick.period) % 1;
        const size = Math.pow(1 - p, 1.3);
        const x = (lick.x + 16 * Math.sin(p * 5 + i * 2)) * fu;
        const y = -(214 + i * 16 + 120 * p) * fu;
        ctx.globalAlpha = 0.85 * (1 - p) * Math.min(1, p * 8);
        ctx.beginPath();
        ctx.save();
        ctx.translate(x, y);
        tonguePath(0, 13 * fu * size, 40 * fu * size, 4 * fu * Math.sin(p * 7 + i), 0);
        ctx.restore();
        ctx.fill();
      }
    }
    ctx.restore();

    // Front stones, over the base of the flames.
    ctx.globalAlpha = 1;
    ctx.drawImage(frontDim, front.x, front.y, front.w, front.h);
    ctx.globalAlpha = flicker;
    ctx.drawImage(frontLit, front.x, front.y, front.w, front.h);

    // Embers.
    ctx.globalCompositeOperation = "lighter";
    const n = emberCount();
    for (let i = 0; i < n; i++) {
      const f = eage[i] / elife[i];
      const alpha = Math.pow(Math.sin(Math.PI * Math.min(1, f)), 0.6) * 0.95;
      if (alpha <= 0.01) continue;
      const sprite = emberSprites[f < 0.3 ? 0 : f < 0.65 ? 1 : 2];
      const r = esize[i] * 4;
      ctx.globalAlpha = alpha;
      ctx.drawImage(sprite, ex[i] - r, ey[i] - r, r * 2, r * 2);
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
  }

  function step(dt) {
    const pace = reduced ? 0.5 : 1;
    const n = emberCount();
    for (let i = 0; i < n; i++) {
      eage[i] += dt * pace;
      if (eage[i] >= elife[i] || ey[i] < -20) { spawnEmber(i, false); continue; }
      ex[i] += (evx[i] + Math.sin(eage[i] * 1.6 + eseed[i]) * 14 * fu) * dt * pace;
      ey[i] += evy[i] * dt * pace;
      evy[i] *= 1 - 0.1 * dt * pace;
    }
  }

  function loop(now) {
    if (!running) return;
    raf = requestAnimationFrame(loop);
    if (now - lastDraw < FRAME_MS) return;
    // A hidden tab pauses the loop; clamp the step so nothing lurches when it comes back.
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    lastDraw = now;
    time += dt;
    step(dt);
    draw();
  }

  return {
    resize,
    start() {
      if (running) return;
      running = true;
      last = lastDraw = performance.now();
      raf = requestAnimationFrame(loop);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
    },
    setReduced(value) { reduced = !!value; },
    get running() { return running; },
  };
}

window.CampfireParts = Object.assign(window.CampfireParts || {}, { createCampfire });
})();
