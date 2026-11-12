// Walk-in starfield: a slow, living sky that can loop for hours.
// Everything is built once per resize (star arrays, a soft Milky Way texture); each frame only
// redraws from those, so nothing is allocated while it runs and memory stays flat.

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

const TILT = (-17 * Math.PI) / 180; // the sky drifts along a gentle diagonal
const STAR_COLORS = ["#e6eeff", "#bcd2ff", "#ffe9cf"];
const STAR_RGB = ["230,238,255", "188,210,255", "255,233,207"];
const FRAME_MS = 31;                // about 30 frames a second is plenty for motion this slow
const FIELD_CELL = 6;               // the Milky Way is worked out on a coarse grid, this many px per cell
const BACKDROP_PIXELS = 4.5e6;      // upper bound on the finished Milky Way image
const GLOW = 0.6;                   // overall brightness of the Milky Way

// Sky colour from the top of the tilted frame to the bottom.
const SKY = [[0, 1, 2, 10], [0.6, 4, 8, 23], [1, 7, 13, 34]];

function createStarfield(canvas, options = {}) {
  const ctx = canvas.getContext("2d", { alpha: false });
  let reduced = !!options.reducedMotion;
  const allowMeteors = options.shootingStars !== false;
  // Seconds between shooting stars, picked at random between the two numbers each time.
  const gap = Array.isArray(options.shootingStarEvery) && options.shootingStarEvery.length === 2
    ? options.shootingStarEvery.map(Number) : [90, 120];
  const gapMin = Math.max(5, Math.min(gap[0], gap[1]) || 90);
  const gapMax = Math.max(gapMin, Math.max(gap[0], gap[1]) || 120);
  const nextGap = () => gapMin + Math.random() * (gapMax - gapMin);

  let W = 0, H = 0, scale = 1, u = 1;
  let RW = 0, RH = 0;   // size of the tilted rectangle that covers the screen
  let tile = 0;         // the star pattern repeats past this width
  let bandTile = 0;     // the Milky Way texture repeats past this width
  let count = 0;
  let sx, sy, sr, sa, samp, sspd, sph, sdrift, scol;
  let backdrop = null, glowSprite = null, dotSprites = null;

  let running = false, raf = 0, last = 0, time = 0, lastDraw = 0;
  const meteor = { active: false, next: nextGap(), x: 0, y: 0, dx: 0, dy: 0, age: 0, life: 1 };

  function buildSprites() {
    const size = 64;
    glowSprite = document.createElement("canvas");
    glowSprite.width = glowSprite.height = size;
    let g = glowSprite.getContext("2d");
    let grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.18, "rgba(225,235,255,0.55)");
    grad.addColorStop(0.5, "rgba(190,210,255,0.12)");
    grad.addColorStop(1, "rgba(190,210,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);

    // Round, soft-edged dots for every star big enough to have a shape. Squares look harsh.
    dotSprites = STAR_RGB.map((rgb) => {
      const c = document.createElement("canvas");
      c.width = c.height = 32;
      g = c.getContext("2d");
      grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
      grad.addColorStop(0, `rgba(${rgb},1)`);
      grad.addColorStop(0.45, `rgba(${rgb},0.95)`);
      grad.addColorStop(0.8, `rgba(${rgb},0.25)`);
      grad.addColorStop(1, `rgba(${rgb},0)`);
      g.fillStyle = grad;
      g.fillRect(0, 0, 32, 32);
      return c;
    });
  }

  // The Milky Way band and the sky behind it, as one opaque image.
  //
  // The glow is added up in floating point on a coarse grid, enlarged smoothly, and only then
  // rounded to 8-bit colour with a little random dither. Building it the obvious way, by stacking
  // hundreds of faint translucent canvas gradients, rounds at every step: the errors pile up into a
  // visible weave once the image is enlarged and tilted (very noticeable in Chrome on a Retina
  // screen). Rounding once, with dither, leaves nothing for the eye to catch.
  function buildBackdrop(rand) {
    const gw = Math.ceil((RW * 1.5) / FIELD_CELL);
    const gh = Math.ceil(RH / FIELD_CELL) + 2;
    bandTile = gw * FIELD_CELL; // the texture wraps exactly on a cell boundary
    const red = new Float32Array(gw * gh), green = new Float32Array(gw * gh);
    const blue = new Float32Array(gw * gh), dust = new Float32Array(gw * gh);

    // Add one soft blob to the grid, wrapping around the tile horizontally.
    const splat = (x, y, r, wr, wg, wb, wd) => {
      const cx = x / FIELD_CELL, cy = y / FIELD_CELL, cr = Math.max(1.5, r / FIELD_CELL);
      const y0 = Math.max(0, Math.floor(cy - cr)), y1 = Math.min(gh - 1, Math.ceil(cy + cr));
      const x0 = Math.floor(cx - cr), x1 = Math.ceil(cx + cr);
      for (let gy = y0; gy <= y1; gy++) {
        const dy = (gy - cy) / cr;
        for (let gx = x0; gx <= x1; gx++) {
          const dx = (gx - cx) / cr;
          const d2 = dx * dx + dy * dy;
          if (d2 >= 1) continue;
          const f = (1 - d2) * (1 - d2);
          const i = gy * gw + (((gx % gw) + gw) % gw);
          red[i] += wr * f; green[i] += wg * f; blue[i] += wb * f; dust[i] += wd * f;
        }
      }
    };

    const bandY = RH * 0.57, spread = RH * 0.085;
    const gauss = () => (rand() + rand() + rand() + rand() - 2) / 1.15;
    const clump = (x) => 0.5 + 0.5 * Math.sin((x / bandTile) * Math.PI * 2 * 3 + 1.1) * Math.sin((x / bandTile) * Math.PI * 2 * 5 + 0.3);
    for (let i = 0; i < 520; i++) { // cool starlight
      const x = rand() * bandTile;
      if (rand() > 0.35 + 0.65 * clump(x)) continue;
      const a = (0.018 + rand() * 0.034) * 255 * GLOW;
      splat(x, bandY + gauss() * spread, (70 + rand() * 190) * u, 0.5 * a, 0.59 * a, 0.82 * a, 0);
    }
    for (let i = 0; i < 200; i++) { // a warmer core
      const x = rand() * bandTile;
      if (rand() > 0.3 + 0.7 * clump(x)) continue;
      const a = (0.012 + rand() * 0.026) * 255 * GLOW;
      splat(x, bandY + gauss() * spread * 0.45, (40 + rand() * 110) * u, 1.0 * a, 0.89 * a, 0.77 * a, 0);
    }
    for (let i = 0; i < 150; i++) { // soft dark dust lanes through the bright core
      const x = rand() * bandTile;
      const y = bandY + spread * 0.3 * Math.sin((x / bandTile) * Math.PI * 2 * 4 + 0.8) + gauss() * spread * 0.12;
      splat(x, y, (45 + rand() * 95) * u, 0, 0, 0, 0.05 + rand() * 0.08);
    }

    // Enlarge to the final size, add the sky colour, dither, and round once.
    const res = Math.min(scale, Math.sqrt(BACKDROP_PIXELS / (bandTile * RH)));
    const ow = Math.max(2, Math.round(bandTile * res)), oh = Math.max(2, Math.round(RH * res));
    const c = document.createElement("canvas");
    c.width = ow;
    c.height = oh;
    const g = c.getContext("2d");
    const image = g.createImageData(ow, oh);
    const out = image.data;
    const noise = new Float32Array(4096);
    for (let i = 0; i < noise.length; i++) noise[i] = rand() + rand() - 1; // dither: up to one level either way
    let seed = 12345;
    const stepX = gw / ow, stepY = (RH / FIELD_CELL) / oh;
    for (let y = 0; y < oh; y++) {
      const fy = y * stepY;
      const gy = Math.min(gh - 2, Math.floor(fy));
      const ty = fy - gy;
      const rowA = gy * gw, rowB = rowA + gw;
      // Sky colour for this row.
      const v = y / (oh - 1);
      const k = v < SKY[1][0] ? 0 : 1;
      const t = (v - SKY[k][0]) / (SKY[k + 1][0] - SKY[k][0]);
      const skyR = SKY[k][1] + (SKY[k + 1][1] - SKY[k][1]) * t;
      const skyG = SKY[k][2] + (SKY[k + 1][2] - SKY[k][2]) * t;
      const skyB = SKY[k][3] + (SKY[k + 1][3] - SKY[k][3]) * t;
      let o = y * ow * 4;
      for (let x = 0; x < ow; x++) {
        const fx = x * stepX;
        const gx = Math.floor(fx);
        const tx = fx - gx;
        const a = rowA + gx, b = rowA + (gx + 1 === gw ? 0 : gx + 1);
        const cc = rowB + gx, d = rowB + (gx + 1 === gw ? 0 : gx + 1);
        const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
        const clear = 1 - Math.min(0.7, dust[a] * w00 + dust[b] * w10 + dust[cc] * w01 + dust[d] * w11);
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const n = noise[seed >>> 20];
        out[o++] = skyR + (red[a] * w00 + red[b] * w10 + red[cc] * w01 + red[d] * w11) * clear + n;
        out[o++] = skyG + (green[a] * w00 + green[b] * w10 + green[cc] * w01 + green[d] * w11) * clear + n;
        out[o++] = skyB + (blue[a] * w00 + blue[b] * w10 + blue[cc] * w01 + blue[d] * w11) * clear + n;
        out[o++] = 255;
      }
    }
    g.putImageData(image, 0, 0);

    // A few distant galaxies, well away from the band. They are small and comparatively bright, so
    // ordinary canvas gradients are fine here.
    g.scale(res, res);
    for (let i = 0; i < 4; i++) {
      const r = (16 + rand() * 20) * u;
      const x = r * 3 + rand() * (bandTile - r * 6);
      const above = rand() < 0.6;
      const y = above ? RH * (0.1 + rand() * 0.24) : RH * (0.8 + rand() * 0.12);
      g.save();
      g.translate(x, y);
      g.rotate(rand() * Math.PI);
      g.scale(1, 0.38 + rand() * 0.25);
      const grad = g.createRadialGradient(0, 0, 0, 0, 0, r);
      grad.addColorStop(0, "rgba(236,240,255,0.5)");
      grad.addColorStop(0.25, "rgba(190,205,255,0.2)");
      grad.addColorStop(1, "rgba(150,175,255,0)");
      g.fillStyle = grad;
      g.fillRect(-r, -r, r * 2, r * 2);
      g.restore();
    }
    return c;
  }

  function buildStars(rand) {
    count = Math.round(Math.min(3200, 1500 * ((tile * RH) / (1920 * 1080 * 1.3))));
    sx = new Float32Array(count); sy = new Float32Array(count); sr = new Float32Array(count);
    sa = new Float32Array(count); samp = new Float32Array(count); sspd = new Float32Array(count);
    sph = new Float32Array(count); sdrift = new Float32Array(count); scol = new Uint8Array(count);
    const bandY = RH * 0.57, spread = RH * 0.1;
    const gauss = () => (rand() + rand() + rand() + rand() - 2) / 1.15;
    const stars = [];
    for (let i = 0; i < count; i++) {
      const inBand = rand() < 0.42;
      const pick = rand();
      stars.push({
        x: rand() * tile,
        y: inBand ? bandY + gauss() * spread : rand() * RH,
        r: (0.5 + 1.7 * Math.pow(rand(), 6)) * Math.max(0.8, u),
        a: 0.3 + 0.7 * Math.pow(rand(), 1.8),
        amp: 0.12 + rand() * 0.42,
        spd: 0.25 + rand() * 1.05,
        ph: rand() * Math.PI * 2,
        drift: [2.0, 2.7, 3.6][Math.floor(rand() * 3)] * u,
        col: pick < 0.7 ? 0 : pick < 0.86 ? 1 : 2,
      });
    }
    stars.sort((p, q) => p.col - q.col); // so the fill colour only changes twice per frame
    stars.forEach((s, i) => {
      sx[i] = s.x; sy[i] = s.y; sr[i] = s.r; sa[i] = s.a; samp[i] = s.amp;
      sspd[i] = s.spd; sph[i] = s.ph; sdrift[i] = s.drift; scol[i] = s.col;
    });
  }

  function resize() {
    W = canvas.clientWidth || window.innerWidth;
    H = canvas.clientHeight || window.innerHeight;
    scale = Math.min(window.devicePixelRatio || 1, 2);
    while (W * H * scale * scale > 5.2e6 && scale > 1) scale -= 0.25;
    canvas.width = Math.round(W * scale);
    canvas.height = Math.round(H * scale);
    u = Math.min(W / 1920, H / 1080);
    const cos = Math.abs(Math.cos(TILT)), sin = Math.abs(Math.sin(TILT));
    RW = W * cos + H * sin;
    RH = W * sin + H * cos;
    tile = RW * 1.3;
    const rand = mulberry32(20261110);
    buildStars(rand);
    backdrop = buildBackdrop(rand);
    if (!glowSprite) buildSprites();
    draw();
  }

  function draw() {
    if (!W) return;
    const speed = reduced ? 0 : 1;
    const twinkle = reduced ? 0.35 : 1;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.fillStyle = "#03050f"; // only ever seen as a hairline at the very corners
    ctx.fillRect(0, 0, W, H);

    ctx.translate(W / 2, H / 2);
    ctx.rotate(TILT);
    ctx.translate(-RW / 2, -RH / 2);

    const offset = (time * 2.0 * u * speed) % bandTile;
    ctx.drawImage(backdrop, -offset, -1, bandTile, RH + 2);
    ctx.drawImage(backdrop, bandTile - offset, -1, bandTile, RH + 2);

    const unit = Math.max(0.8, u);
    let color = -1;
    for (let i = 0; i < count; i++) {
      let x = (sx[i] - time * sdrift[i] * speed) % tile;
      if (x < 0) x += tile;
      if (x > RW + 6) continue;
      if (scol[i] !== color) { color = scol[i]; ctx.fillStyle = STAR_COLORS[color]; }
      const wave = 0.5 + 0.5 * Math.sin(sph[i] + time * sspd[i]);
      const alpha = sa[i] * (1 - samp[i] * twinkle * (1 - wave));
      const r = sr[i];
      ctx.globalAlpha = alpha;
      if (r < 0.72 * unit) {
        ctx.fillRect(x - r, sy[i] - r, r * 2, r * 2); // too small to have a shape
      } else {
        const d = r * 1.45;
        ctx.drawImage(dotSprites[color], x - d, sy[i] - d, d * 2, d * 2);
      }
      if (r > 1.25 * unit) {
        const g = r * 7;
        ctx.globalAlpha = alpha * 0.55;
        ctx.drawImage(glowSprite, x - g, sy[i] - g, g * 2, g * 2);
      }
    }

    if (meteor.active) {
      const p = meteor.age / meteor.life;
      const headX = meteor.x + meteor.dx * p, headY = meteor.y + meteor.dy * p;
      const tail = 0.22;
      const tailX = headX - meteor.dx * tail, tailY = headY - meteor.dy * tail;
      const grad = ctx.createLinearGradient(tailX, tailY, headX, headY);
      grad.addColorStop(0, "rgba(220,232,255,0)");
      grad.addColorStop(1, "rgba(235,242,255,0.75)");
      ctx.globalAlpha = Math.sin(Math.PI * p);
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.4 * unit;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(headX, headY);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function stepMeteor(dt) {
    if (!allowMeteors || reduced) { meteor.active = false; return; }
    if (meteor.active) {
      meteor.age += dt;
      if (meteor.age >= meteor.life) { meteor.active = false; meteor.next = time + nextGap(); }
    } else if (time >= meteor.next) {
      // One faint streak per gap (see shootingStarEvery). Never more than one at a time.
      const angle = 0.5 + Math.random() * 0.5;
      const length = (420 + Math.random() * 260) * u;
      meteor.active = true;
      meteor.age = 0;
      meteor.life = 0.9 + Math.random() * 0.4;
      meteor.x = RW * (0.15 + Math.random() * 0.6);
      meteor.y = RH * (0.08 + Math.random() * 0.3);
      meteor.dx = Math.cos(angle) * length;
      meteor.dy = Math.sin(angle) * length;
    }
  }

  function loop(now) {
    if (!running) return;
    raf = requestAnimationFrame(loop);
    if (now - lastDraw < FRAME_MS) return;
    // A hidden tab pauses the loop; clamp the step so the sky never jumps when it comes back.
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    lastDraw = now;
    time += dt;
    stepMeteor(dt);
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

window.CampfireParts = Object.assign(window.CampfireParts || {}, { createStarfield });
})();
