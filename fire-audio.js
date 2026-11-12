// Optional fire crackle, synthesized with the Web Audio API (no audio files, nothing to license).
// Off by default. It only ever starts after the presenter presses S, and it is only audible while
// the campfire is on screen.

// Plain script (not an ES module) so the page also works when index.html is opened straight from
// disk: browsers refuse to load modules from file:// addresses. Each file keeps its internals inside
// this function and shares only what the others need through window.CampfireParts.
(() => {
"use strict";

function createFireAudio() {
  let ctx = null, master = null, noise = null, crackleTimer = 0;
  let enabled = false, audible = false;

  function noiseBuffer(seconds, brown) {
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let lastValue = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      if (brown) { lastValue = (lastValue + 0.02 * white) / 1.02; data[i] = lastValue * 3.5; }
      else data[i] = white;
    }
    return buffer;
  }

  function build() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return false;
    ctx = new AudioCtx();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);

    // The low, steady roar of the fire.
    const roar = ctx.createBufferSource();
    roar.buffer = noiseBuffer(6, true);
    roar.loop = true;
    const roarFilter = ctx.createBiquadFilter();
    roarFilter.type = "lowpass";
    roarFilter.frequency.value = 420;
    const roarGain = ctx.createGain();
    roarGain.gain.value = 0.55;
    roar.connect(roarFilter).connect(roarGain).connect(master);
    roar.start();

    // A soft hiss on top.
    noise = noiseBuffer(2, false);
    const hiss = ctx.createBufferSource();
    hiss.buffer = noise;
    hiss.loop = true;
    const hissFilter = ctx.createBiquadFilter();
    hissFilter.type = "bandpass";
    hissFilter.frequency.value = 2600;
    hissFilter.Q.value = 0.4;
    const hissGain = ctx.createGain();
    hissGain.gain.value = 0.018;
    hiss.connect(hissFilter).connect(hissGain).connect(master);
    hiss.start();
    return true;
  }

  // One crackle: a very short burst of filtered noise with a sharp decay.
  function crackle() {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 1200 + Math.random() * 3800;
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    const loud = Math.random() < 0.15 ? 0.5 : 0.08 + Math.random() * 0.2;
    const length = 0.008 + Math.random() * 0.03;
    gain.gain.setValueAtTime(loud, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + length);
    src.connect(filter).connect(gain).connect(master);
    src.start(now, Math.random() * 1.5, length + 0.02);
    src.onended = () => { src.disconnect(); filter.disconnect(); gain.disconnect(); };
  }

  function scheduleCrackle() {
    clearTimeout(crackleTimer);
    if (!enabled || !audible || !ctx) return;
    crackle();
    if (Math.random() < 0.3) setTimeout(() => { if (enabled && audible) crackle(); }, 30 + Math.random() * 60);
    crackleTimer = setTimeout(scheduleCrackle, 70 + Math.random() * 420);
  }

  function apply() {
    if (!ctx) return;
    const on = enabled && audible;
    if (on && ctx.state === "suspended") ctx.resume();
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setTargetAtTime(on ? 0.5 : 0, ctx.currentTime, on ? 0.9 : 0.35);
    if (on) scheduleCrackle();
    else clearTimeout(crackleTimer);
  }

  return {
    // Called from the S key (a user gesture, which browsers require before audio can start).
    setEnabled(value) {
      enabled = !!value;
      if (enabled && !ctx && !build()) { enabled = false; return false; }
      apply();
      return enabled;
    },
    setAudible(value) {
      audible = !!value;
      apply();
    },
    get enabled() { return enabled; },
  };
}

window.CampfireParts = Object.assign(window.CampfireParts || {}, { createFireAudio });
})();
