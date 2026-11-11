/* sfx.js — realistic procedural sound effects with Web Audio. No files, no music, no 8-bit.
 * Every sound is built in layers (transient + body + tail) from filtered noise, pitched sines and
 * inharmonic partials, with random variation so repeats never sound identical.
 *
 *   const sfx = new SFX();            // settings (volume, mute) persist in localStorage
 *   sfx.autoUnlock();                 // audio starts on the first tap/click/key (required on iOS and in-app browsers)
 *   sfx.play('gun_pistol');           // options: { vol: 0..2, pitch: 0.5..2, pan: -1..1, dist: 0..1, surface: 'stone' }
 *   sfx.setVolume(0.8); sfx.setMuted(true); sfx.muted; sfx.volume
 *   SFX.names                          // every sound name
 *   SFX.renderOffline(name, opts, seconds) -> Promise<AudioBuffer>   (tests)
 *
 * Game sounds: gun_pistol gun_rifle gun_shotgun gun_reload gun_empty sword_slash sword_slash_heavy sword_draw sword_cut sword_swing sword_clash sword_hit
 *   hit_body hit_heavy impact_wood impact_stone impact_metal footstep (opts.surface: stone|grass|wood|gravel|metal)
 *   explosion bow_release arrow_hit pickup reward jump land door_open
 * UI sounds (dry, quiet, tactile, never chimes): ui_click ui_hover ui_toggle_on ui_toggle_off ui_open ui_close ui_success ui_error ui_notify
 * Real recordings beat synthesis: SFX.loadSamples() layers CC0 files on top of (or instead of) these recipes.
 * Add your own with SFX.define(name, (a, t, o) => endTime, { bus: 'sfx'|'ui', level, maxVoices }).
 */
(function (root) {
  'use strict';
  var AC = root.AudioContext || root.webkitAudioContext;
  var OAC = root.OfflineAudioContext || root.webkitOfflineAudioContext;
  var R = {};            // recipes
  var S = {};            // loaded sample banks (real recordings)
  var rnd = function (a, b) { return a + Math.random() * (b - a); };
  var vary = function (x, pct) { return x * (1 + rnd(-pct, pct)); };

  /* ---------- graph ---------- */
  function makeNoise(ctx, kind) {
    var len = Math.floor(ctx.sampleRate * 2), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    var b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (var i = 0; i < len; i++) {
      var white = Math.random() * 2 - 1;
      if (kind === 'pink') { // Paul Kellet's refined method
        b0 = 0.99886 * b0 + white * 0.0555179; b1 = 0.99332 * b1 + white * 0.0750759; b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856; b4 = 0.55000 * b4 + white * 0.5329522; b5 = -0.7616 * b5 - white * 0.0168980;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11; b6 = white * 0.115926;
      } else if (kind === 'brown') { last = (last + 0.02 * white) / 1.02; d[i] = last * 3.5; }
      else d[i] = white;
    }
    return buf;
  }
  function makeIR(ctx, seconds, decay) {
    var len = Math.floor(ctx.sampleRate * seconds), buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (var c = 0; c < 2; c++) {
      var d = buf.getChannelData(c), lp = 0;
      for (var i = 0; i < len; i++) {
        var t = i / ctx.sampleRate, n = Math.random() * 2 - 1;
        lp += (n - lp) * (0.55 - 0.4 * Math.min(1, t / seconds));   // darker as it decays, like a real room
        d[i] = lp * Math.exp(-t / decay) * (t < 0.004 ? t / 0.004 : 1);
      }
      [0.011, 0.019, 0.027, 0.041].forEach(function (er, k) { var j = Math.floor((er + c * 0.003) * ctx.sampleRate); if (j < len) d[j] += 0.5 / (k + 1); });
    }
    return buf;
  }
  function shaperCurve(k) {
    var n = 1024, c = new Float32Array(n), norm = Math.tanh(k);
    for (var i = 0; i < n; i++) { var x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(k * x) / norm; }
    return c;
  }
  function build(ctx, reverbAmount) {
    var g = { ctx: ctx };
    g.master = ctx.createGain();
    g.limiter = ctx.createDynamicsCompressor();
    g.limiter.threshold.value = -3; g.limiter.knee.value = 0; g.limiter.ratio.value = 20; g.limiter.attack.value = 0.001; g.limiter.release.value = 0.08;
    g.comp = ctx.createDynamicsCompressor();
    g.comp.threshold.value = -16; g.comp.knee.value = 8; g.comp.ratio.value = 3; g.comp.attack.value = 0.004; g.comp.release.value = 0.2;
    g.comp.connect(g.master); g.master.connect(g.limiter); g.limiter.connect(ctx.destination);
    g.sfx = ctx.createGain(); g.sfx.connect(g.comp);
    g.ui = ctx.createGain(); g.ui.connect(g.master);
    g.verb = ctx.createConvolver(); g.verb.buffer = makeIR(ctx, 1.6, 0.32);
    g.verbIn = ctx.createGain(); g.verbIn.gain.value = reverbAmount;
    g.verbIn.connect(g.verb); g.verb.connect(g.comp);
    g.noise = { white: makeNoise(ctx, 'white'), pink: makeNoise(ctx, 'pink'), brown: makeNoise(ctx, 'brown') };
    g.curve = shaperCurve(2.6);
    return g;
  }

  /* ---------- per-voice toolkit handed to recipes ---------- */
  function Voice(g, bus, o) {
    var ctx = g.ctx;
    this.ctx = ctx; this.g = g; this.o = o; this.p = o.pitch || 1; this.end = ctx.currentTime;
    this.out = ctx.createGain(); this.out.gain.value = o.vol == null ? 1 : o.vol;
    var node = this.out;
    if (o.dist) { // distance: quieter, darker, wetter
      var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 16000 * Math.pow(1 - o.dist, 2) + 900;
      this.out.gain.value *= 1 - 0.75 * o.dist; node.connect(lp); node = lp;
    }
    if (ctx.createStereoPanner && o.pan) { var pn = ctx.createStereoPanner(); pn.pan.value = Math.max(-1, Math.min(1, o.pan)); node.connect(pn); node = pn; }
    node.connect(bus === 'ui' ? g.ui : g.sfx);
    this.send = ctx.createGain(); this.send.gain.value = bus === 'ui' ? 0 : 0.6 + (o.dist || 0) * 1.4;
    node.connect(this.send); this.send.connect(g.verbIn);
  }
  Voice.prototype.chain = function (src, nodes, dest) {
    var n = src; for (var i = 0; i < nodes.length; i++) { n.connect(nodes[i]); n = nodes[i]; } n.connect(dest || this.out); return n;
  };
  Voice.prototype.filter = function (type, freq, Q, gain) {
    var f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; if (Q != null) f.Q.value = Q; if (gain != null) f.gain.value = gain; return f;
  };
  Voice.prototype.drive = function () { var s = this.ctx.createWaveShaper(); s.curve = this.g.curve; s.oversample = '2x'; return s; };
  Voice.prototype.envGain = function (t, attack, peak, tau, hold) {
    var e = this.ctx.createGain(), gg = e.gain; hold = hold || 0;
    gg.setValueAtTime(0, t); gg.linearRampToValueAtTime(peak, t + attack);
    if (hold) gg.setValueAtTime(peak, t + attack + hold);
    gg.setTargetAtTime(0, t + attack + hold, tau);
    var stop = t + attack + hold + tau * 7;
    if (stop > this.end) this.end = stop;
    return { node: e, stop: stop };
  };
  /* filtered noise burst. o: {type, attack, tau, gain, hold, filters:[...], rate, drive, wet} */
  Voice.prototype.noise = function (t, o) {
    var src = this.ctx.createBufferSource(); src.buffer = this.g.noise[o.type || 'white']; src.loop = true;
    src.playbackRate.value = (o.rate || 1) * Math.sqrt(this.p);
    var env = this.envGain(t, o.attack || 0.001, o.gain == null ? 1 : o.gain, o.tau || 0.05, o.hold);
    var nodes = (o.filters || []).slice(); if (o.drive) nodes.push(this.drive()); nodes.push(env.node);
    var last = this.chain(src, nodes, this.out);
    if (o.wet) { var w = this.ctx.createGain(); w.gain.value = o.wet; last.connect(w); w.connect(this.g.verbIn); }
    src.start(t, rnd(0, 1.5)); src.stop(env.stop);
    return { src: src, env: env, filters: o.filters || [] };
  };
  /* pitched oscillator, optional glide f0 -> f1 over glide seconds */
  Voice.prototype.tone = function (t, o) {
    var osc = this.ctx.createOscillator(); osc.type = o.type || 'sine';
    var f0 = o.f0 * this.p; osc.frequency.setValueAtTime(f0, t);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1 * this.p), t + (o.glide || 0.1));
    if (o.detune) osc.detune.value = o.detune;
    var env = this.envGain(t, o.attack || 0.002, o.gain == null ? 1 : o.gain, o.tau || 0.1, o.hold);
    var nodes = (o.filters || []).slice(); if (o.drive) nodes.push(this.drive()); nodes.push(env.node);
    this.chain(osc, nodes, this.out);
    osc.start(t); osc.stop(env.stop);
    return osc;
  };
  /* inharmonic partials (metal, glass, bells). ratios, amps, taus arrays; beat = Hz detune pair for shimmer */
  Voice.prototype.partials = function (t, base, ratios, amps, taus, gain, beat) {
    for (var i = 0; i < ratios.length; i++) {
      var f = base * ratios[i];
      if (f * this.p > 18000) continue;
      this.tone(t, { f0: vary(f, 0.004), attack: 0.0008, tau: taus[i], gain: amps[i] * gain });
      if (beat) this.tone(t, { f0: f + beat * (i + 1) * 0.5, attack: 0.0008, tau: taus[i] * 0.9, gain: amps[i] * gain * 0.5 });
    }
  };
  /* many tiny bursts (grass, gravel, debris, crackle) */
  Voice.prototype.grains = function (t, count, span, o) {
    for (var i = 0; i < count; i++) {
      var tt = t + Math.pow(Math.random(), o.skew || 1) * span;
      this.noise(tt, { type: 'white', tau: rnd(o.tauMin || 0.003, o.tauMax || 0.012), gain: rnd(0.4, 1) * o.gain,
        filters: [this.filter('bandpass', rnd(o.fMin, o.fMax), o.Q || 1.2)] });
    }
  };

  /* ---------- recipes: (a: Voice, t: start time, o: options) -> end time ---------- */
  function gun(a, t, k) {
    // k: crack, body, thumpF, thumpTau, tail, tailTau, slap
    a.noise(t, { type: 'white', tau: 0.0035, gain: 0.35, filters: [a.filter('bandpass', 3800, 3)] });                 // mechanism
    a.noise(t, { type: 'white', attack: 0.0004, tau: k.crackTau, gain: k.crack, filters: [a.filter('highpass', 1400), a.filter('peaking', 3200, 1, 6)], drive: true }); // supersonic crack / muzzle blast
    a.noise(t, { type: 'white', attack: 0.0008, tau: k.bodyTau, gain: k.body, filters: [a.filter('lowpass', 2600)], drive: true });   // blast body
    a.tone(t, { f0: k.thumpF, f1: k.thumpF * 0.3, glide: 0.09, attack: 0.001, tau: k.thumpTau, gain: k.thump, drive: true });          // chest thump
    var tail = a.noise(t + 0.008, { type: 'pink', attack: 0.012, tau: k.tailTau, gain: k.tail, filters: [a.filter('lowpass', 1400)], wet: 0.8 });
    tail.filters[0].frequency.setTargetAtTime(380, t + 0.03, k.tailTau);
    if (k.slap) a.noise(t + k.slap, { type: 'pink', attack: 0.004, tau: k.tailTau * 0.6, gain: k.tail * 0.45, filters: [a.filter('lowpass', 900)], wet: 1 }); // echo off a wall
    return a.end;
  }
  R.gun_pistol = { level: 1.75, max: 6, fn: function (a, t) { return gun(a, t, { crack: 1.0, crackTau: 0.011, body: 0.7, bodyTau: 0.035, thumpF: 170, thumpTau: 0.05, thump: 0.8, tail: 0.28, tailTau: 0.16, slap: 0 }); } };
  R.gun_rifle = { level: 1.89, max: 8, fn: function (a, t) { return gun(a, t, { crack: 1.2, crackTau: 0.014, body: 0.85, bodyTau: 0.05, thumpF: 130, thumpTau: 0.07, thump: 0.95, tail: 0.38, tailTau: 0.3, slap: rnd(0.09, 0.14) }); } };
  R.gun_shotgun = { level: 1.25, max: 4, fn: function (a, t) { return gun(a, t, { crack: 1.0, crackTau: 0.02, body: 1.1, bodyTau: 0.085, thumpF: 105, thumpTau: 0.095, thump: 1.1, tail: 0.45, tailTau: 0.38, slap: rnd(0.1, 0.16) }); } };
  function click(a, t, f, g) { a.noise(t, { type: 'white', tau: 0.0035, gain: g, filters: [a.filter('bandpass', f, 4)] }); a.tone(t, { f0: f * 0.62, attack: 0.0005, tau: 0.012, gain: g * 0.25 }); }
  R.gun_reload = { level: 0.389, max: 2, fn: function (a, t) {
    click(a, t, 2600, 0.7); a.noise(t + 0.03, { type: 'white', tau: 0.03, gain: 0.12, filters: [a.filter('bandpass', 4500, 2)] });  // slide scrape
    click(a, t + 0.17, 3400, 0.9); a.partials(t + 0.17, 2300, [1, 2.76, 5.4], [0.5, 0.3, 0.15], [0.05, 0.03, 0.02], 0.12);
    return a.end; } };
  R.gun_empty = { level: 3.19, max: 2, fn: function (a, t) { click(a, t, 3000, 0.8); return a.end; } };

  R.sword_swing = { level: 0.871, max: 4, fn: function (a, t, o) {
    var dur = vary(0.26, 0.15) / (o.speed || 1), peak = t + dur * 0.45;
    var bp = a.filter('bandpass', 420, 1.4), air = a.filter('highpass', 3800);
    [[bp, 'pink', 1.0], [air, 'white', 0.18]].forEach(function (L) {
      var src = a.ctx.createBufferSource(); src.buffer = a.g.noise[L[1]]; src.loop = true;
      var e = a.ctx.createGain(); e.gain.setValueAtTime(0.0001, t); e.gain.exponentialRampToValueAtTime(L[2], peak); e.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      a.chain(src, [L[0], e], a.out); src.start(t, rnd(0, 1.5)); src.stop(t + dur + 0.02);
    });
    bp.frequency.setValueAtTime(380, t); bp.frequency.exponentialRampToValueAtTime(vary(1700, 0.1) * a.p, peak); bp.frequency.exponentialRampToValueAtTime(520, t + dur);
    if (a.end < t + dur + 0.05) a.end = t + dur + 0.05;
    return a.end; } };
  var BAR = [1, 2.756, 5.404, 8.933, 13.344];
  R.sword_clash = { level: 0.883, max: 4, fn: function (a, t, o) {
    var base = vary(1050, 0.12), ring = o.ring || 1;
    a.noise(t, { type: 'white', attack: 0.0003, tau: 0.005, gain: 0.9, filters: [a.filter('highpass', 2500)] });              // contact
    a.noise(t + 0.002, { type: 'white', tau: 0.045, gain: 0.12, filters: [a.filter('bandpass', 5200, 1.5)] });                  // scrape
    a.tone(t, { f0: 240, f1: 170, glide: 0.04, tau: 0.03, gain: 0.3 });                                                         // weight
    a.partials(t, base, BAR, [1, 0.75, 0.5, 0.32, 0.2], [0.16 * ring, 0.11 * ring, 0.08 * ring, 0.06, 0.04], 0.32, 3.1);        // blade ring
    return a.end; } };
  R.sword_hit = { level: 1.06, max: 4, fn: function (a, t) {
    a.noise(t, { type: 'white', attack: 0.0006, tau: 0.03, gain: 0.7, filters: [a.filter('bandpass', 1800, 0.9)] });           // cut
    a.noise(t + 0.004, { type: 'pink', tau: 0.06, gain: 0.6, filters: [a.filter('lowpass', 1100)] });                         // flesh
    a.tone(t, { f0: 130, f1: 60, glide: 0.08, tau: 0.05, gain: 0.7, drive: true });
    return a.end; } };
  R.hit_body = { level: 0.857, max: 5, fn: function (a, t) {
    a.noise(t, { type: 'white', tau: 0.003, gain: 0.25, filters: [a.filter('highpass', 2000)] });
    a.noise(t, { type: 'pink', attack: 0.001, tau: 0.04, gain: 0.7, filters: [a.filter('lowpass', 900)] });
    a.tone(t, { f0: 115, f1: 55, glide: 0.07, tau: 0.055, gain: 1, drive: true });
    return a.end; } };
  R.hit_heavy = { level: 0.667, max: 4, fn: function (a, t) {
    a.noise(t, { type: 'white', tau: 0.004, gain: 0.3, filters: [a.filter('highpass', 1600)] });
    a.noise(t, { type: 'brown', attack: 0.002, tau: 0.09, gain: 1.0, filters: [a.filter('lowpass', 700)], drive: true });
    a.tone(t, { f0: 85, f1: 38, glide: 0.12, tau: 0.09, gain: 1.1, drive: true });
    return a.end; } };
  R.impact_wood = { level: 5.24, max: 5, fn: function (a, t) {
    a.noise(t, { type: 'white', tau: 0.004, gain: 0.5, filters: [a.filter('highpass', 1800)] });
    [vary(190, 0.08), vary(430, 0.08), vary(780, 0.08)].forEach(function (f, i) {
      a.noise(t, { type: 'white', tau: [0.07, 0.05, 0.03][i], gain: [1.3, 1.0, 0.7][i], filters: [a.filter('bandpass', f, 9)] });
    });
    return a.end; } };
  R.impact_stone = { level: 1.51, max: 5, fn: function (a, t) {
    a.noise(t, { type: 'white', tau: 0.006, gain: 0.6, filters: [a.filter('bandpass', 2400, 0.8)] });
    a.noise(t, { type: 'pink', tau: 0.035, gain: 0.7, filters: [a.filter('bandpass', 900, 1)] });
    a.tone(t, { f0: 95, f1: 70, glide: 0.04, tau: 0.035, gain: 0.5 });
    a.grains(t + 0.01, 5, 0.12, { gain: 0.15, fMin: 2000, fMax: 5000, skew: 2 });
    return a.end; } };
  R.impact_metal = { level: 0.452, max: 4, fn: function (a, t, o) {
    a.noise(t, { type: 'white', tau: 0.004, gain: 0.7, filters: [a.filter('highpass', 2000)] });
    a.partials(t, vary(520, 0.15), [1, 2.32, 4.25, 6.63, 9.38], [1, 0.7, 0.5, 0.35, 0.2], [0.5, 0.32, 0.2, 0.12, 0.08], 0.3, 1.7);
    a.tone(t, { f0: 160, f1: 110, glide: 0.05, tau: 0.04, gain: 0.4 });
    return a.end; } };
  R.footstep = { level: 0.677, max: 4, fn: function (a, t, o) {
    var s = o.surface || 'stone', toe = t + vary(0.055, 0.2);
    if (s === 'grass') { a.noise(t, { type: 'pink', tau: 0.025, gain: 0.45, filters: [a.filter('lowpass', 380)] }); a.grains(t, 9, 0.11, { gain: 0.45, fMin: 2500, fMax: 7000, Q: 0.8 }); }
    else if (s === 'gravel') { a.noise(t, { type: 'pink', tau: 0.03, gain: 0.4, filters: [a.filter('lowpass', 500)] }); a.grains(t, 14, 0.14, { gain: 0.65, fMin: 1000, fMax: 3500, Q: 1.5, skew: 1.6 }); }
    else if (s === 'wood') { [t, toe].forEach(function (tt, i) { var k = i ? 0.6 : 1; a.noise(tt, { type: 'white', tau: 0.03, gain: 2.4 * k, filters: [a.filter('bandpass', vary(380, 0.1), 5)] }); a.noise(tt, { type: 'white', tau: 0.004, gain: 0.5 * k, filters: [a.filter('highpass', 2500)] }); }); }
    else if (s === 'metal') { a.noise(t, { type: 'white', tau: 0.005, gain: 0.5, filters: [a.filter('bandpass', 2200, 1)] }); a.partials(t, vary(700, 0.1), [1, 2.32, 4.25], [1, 0.6, 0.3], [0.12, 0.08, 0.05], 0.12, 2); }
    else { [t, toe].forEach(function (tt, i) { var k = i ? 0.65 : 1; a.noise(tt, { type: 'white', tau: 0.012, gain: 0.55 * k, filters: [a.filter('bandpass', vary(1700, 0.15), 1.2)] }); a.tone(tt, { f0: 90, tau: 0.02, gain: 0.35 * k }); }); }
    return a.end; } };
  R.explosion = { level: 0.646, max: 3, fn: function (a, t) {
    a.noise(t, { type: 'white', attack: 0.0005, tau: 0.02, gain: 0.8, filters: [a.filter('highpass', 900)], drive: true });
    var body = a.noise(t, { type: 'brown', attack: 0.004, tau: 0.45, gain: 1.4, filters: [a.filter('lowpass', 2800)], drive: true, wet: 0.6 });
    body.filters[0].frequency.setTargetAtTime(160, t + 0.02, 0.35);
    a.tone(t, { f0: 72, f1: 26, glide: 0.6, attack: 0.003, tau: 0.35, gain: 1.2, drive: true });
    a.grains(t + 0.05, 26, 1.1, { gain: 0.18, fMin: 800, fMax: 4500, skew: 2.2 });                                               // debris
    return a.end; } };
  R.bow_release = { level: 8, max: 3, fn: function (a, t) {
    var ctx = a.ctx, f = vary(150, 0.08) * a.p;                     // string pluck, Karplus-Strong loop
    var exc = a.noise(t, { type: 'white', tau: 0.003, gain: 0.8, filters: [a.filter('lowpass', 3000)] });
    var dl = ctx.createDelay(0.05); dl.delayTime.value = 1 / f;
    var fb = ctx.createGain(); fb.gain.value = 0.9; var lp = a.filter('lowpass', 2200, -6);   // Q in dB: no resonance, keeps the loop below unity gain
    var env = a.envGain(t, 0.001, 0.9, 0.12);
    exc.env.node.connect(dl); dl.connect(lp); lp.connect(fb); fb.connect(dl); lp.connect(env.node); env.node.connect(a.out);
    fb.gain.setValueAtTime(0.9, env.stop - 0.05); fb.gain.linearRampToValueAtTime(0, env.stop);
    a.noise(t + 0.01, { type: 'pink', attack: 0.02, tau: 0.06, gain: 0.25, filters: [a.filter('bandpass', 900, 1.2)] });    // arrow whoosh
    return a.end; } };
  R.arrow_hit = { level: 2.05, max: 4, fn: function (a, t) {
    a.noise(t, { type: 'white', tau: 0.005, gain: 0.6, filters: [a.filter('bandpass', 2600, 1)] });
    a.noise(t, { type: 'white', tau: 0.05, gain: 0.7, filters: [a.filter('bandpass', vary(320, 0.1), 7)] });                // shaft quiver
    a.tone(t, { f0: 140, f1: 90, glide: 0.05, tau: 0.03, gain: 0.4 });
    return a.end; } };
  /* serious blade work: heavy air + steel "shing" + optional bite */
  function bladeAir(a, t, dur, lo, hi, gain) {
    var peak = t + dur * 0.42, bp = a.filter('bandpass', lo, 1.1), lp = a.filter('lowpass', 2600);
    [[bp, 'pink', gain], [a.filter('bandpass', lo * 0.6, 0.9), 'brown', gain * 0.9]].forEach(function (L) {
      var src = a.ctx.createBufferSource(); src.buffer = a.g.noise[L[1]]; src.loop = true;
      var e = a.ctx.createGain(); e.gain.setValueAtTime(0.0001, t); e.gain.exponentialRampToValueAtTime(L[2], peak); e.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      a.chain(src, [L[0], lp, e], a.out); src.start(t, rnd(0, 1.5)); src.stop(t + dur + 0.02);
    });
    bp.frequency.setValueAtTime(lo, t); bp.frequency.exponentialRampToValueAtTime(hi * a.p, peak); bp.frequency.exponentialRampToValueAtTime(lo * 1.2, t + dur);
    if (a.end < t + dur + 0.05) a.end = t + dur + 0.05;
    return peak;
  }
  function steel(a, t, dur, gain) {   // edge cutting air: bright filtered noise through tight resonances, no ringing tail
    var n = a.noise(t, { type: 'white', attack: dur * 0.35, tau: dur * 0.3, gain: gain, filters: [a.filter('highpass', 3800), a.filter('peaking', vary(6200, 0.08), 6, 9), a.filter('peaking', vary(8900, 0.08), 8, 7)] });
    n.filters[1].frequency.exponentialRampToValueAtTime(7400, t + dur);
  }
  R.sword_slash = { level: 1.06, max: 4, fn: function (a, t, o) {
    var dur = vary(0.3, 0.1) / (o.speed || 1), peak = bladeAir(a, t, dur, 260, 1150, 1.0);
    steel(a, peak - 0.03, 0.11, 0.35);
    a.noise(t, { type: 'pink', attack: 0.01, tau: 0.03, gain: 0.25, filters: [a.filter('bandpass', 900, 1.2)] });          // cloth + grip at start
    return a.end; } };
  R.sword_slash_heavy = { level: 0.859, max: 3, fn: function (a, t, o) {
    var dur = vary(0.42, 0.08) / (o.speed || 1), peak = bladeAir(a, t, dur, 170, 820, 1.2);
    steel(a, peak - 0.04, 0.14, 0.3);
    a.tone(peak, { f0: 70, f1: 38, glide: 0.18, attack: 0.01, tau: 0.09, gain: 0.7, drive: true });                         // weight
    a.noise(peak, { type: 'brown', attack: 0.01, tau: 0.12, gain: 0.5, filters: [a.filter('lowpass', 400)], wet: 0.5 });
    return a.end; } };
  R.sword_draw = { level: 0.729, max: 2, fn: function (a, t) {
    var s1 = a.noise(t, { type: 'white', attack: 0.05, tau: 0.12, hold: 0.28, gain: 0.32, filters: [a.filter('bandpass', 3000, 3), a.filter('peaking', 5200, 5, 8)] });
    s1.filters[0].frequency.exponentialRampToValueAtTime(5600, t + 0.42);                                                        // scrape rising out of the sheath
    a.noise(t + 0.45, { type: 'white', tau: 0.004, gain: 0.7, filters: [a.filter('highpass', 3000)] });                          // clears the mouth
    a.partials(t + 0.45, 2650, [1, 1.47, 2.13], [0.6, 0.35, 0.2], [0.09, 0.06, 0.04], 0.16, 1.5);                            // short steel shimmer, damped
    return a.end; } };
  R.sword_cut = { level: 1.06, max: 4, fn: function (a, t) {                                                                    // blade biting into a body
    a.noise(t, { type: 'white', attack: 0.0006, tau: 0.018, gain: 0.8, filters: [a.filter('bandpass', 2400, 0.8)] });
    var tear = a.noise(t + 0.006, { type: 'pink', attack: 0.004, tau: 0.07, gain: 0.8, filters: [a.filter('bandpass', 1100, 0.9)] });
    var am = a.ctx.createOscillator(), amg = a.ctx.createGain(); am.frequency.value = rnd(55, 75); amg.gain.value = 0.35;   // wet tearing texture
    am.connect(amg); amg.connect(tear.env.node.gain); am.start(t); am.stop(t + 0.3);
    a.tone(t, { f0: 120, f1: 50, glide: 0.09, tau: 0.06, gain: 0.9, drive: true });
    return a.end; } };
  R.pickup = { level: 0.333, max: 3, fn: function (a, t) {          // grabbing an item: cloth/leather rustle + small object knock, no tone
    a.noise(t, { type: 'pink', attack: 0.01, tau: 0.04, gain: 0.5, filters: [a.filter('bandpass', 1500, 0.9)] });
    a.noise(t + 0.05, { type: 'white', tau: 0.008, gain: 0.6, filters: [a.filter('bandpass', vary(2200, 0.1), 2.5)] });
    a.tone(t + 0.05, { f0: 180, f1: 140, glide: 0.03, tau: 0.02, gain: 0.35 });
    return a.end; } };
  R.reward = { level: 0.206, max: 2, fn: function (a, t) {           // power-up: rising air swell into a deep, solid hit
    var sw = a.noise(t, { type: 'pink', attack: 0.3, tau: 0.06, gain: 0.6, filters: [a.filter('bandpass', 300, 1)] });
    sw.filters[0].frequency.exponentialRampToValueAtTime(2200, t + 0.32);
    a.tone(t + 0.32, { f0: 90, f1: 45, glide: 0.2, attack: 0.005, tau: 0.12, gain: 0.8, drive: true });
    a.noise(t + 0.32, { type: 'white', tau: 0.01, gain: 0.5, filters: [a.filter('highpass', 2500)] });
    a.noise(t + 0.33, { type: 'brown', tau: 0.25, gain: 0.5, filters: [a.filter('lowpass', 900)], wet: 0.7 });
    return a.end; } };
  R.jump = { level: 1.71, max: 3, fn: function (a, t) {
    a.noise(t, { type: 'pink', attack: 0.004, tau: 0.035, gain: 0.5, filters: [a.filter('lowpass', 600)] });                 // push-off
    a.noise(t + 0.01, { type: 'pink', attack: 0.02, tau: 0.05, gain: 0.18, filters: [a.filter('bandpass', 1200, 1)] });     // cloth
    return a.end; } };
  R.land = { level: 0.809, max: 3, fn: function (a, t, o) {
    a.noise(t, { type: 'brown', tau: 0.05, gain: 0.9, filters: [a.filter('lowpass', 500)] });
    a.tone(t, { f0: 80, f1: 50, glide: 0.06, tau: 0.04, gain: 0.6 });
    a.grains(t, 6, 0.08, { gain: 0.12, fMin: 1500, fMax: 5000 });
    return a.end; } };
  R.door_open = { level: 3.67, max: 2, fn: function (a, t) {
    click(a, t, 1800, 0.6);                                                                                                       // latch
    var cr = a.noise(t + 0.08, { type: 'white', attack: 0.05, tau: 0.25, hold: 0.25, gain: 0.25, filters: [a.filter('bandpass', 700, 12), a.filter('bandpass', 700, 6)] }); // hinge creak
    cr.filters[0].frequency.linearRampToValueAtTime(980, t + 0.6); cr.filters[1].frequency.linearRampToValueAtTime(980, t + 0.6);
    return a.end; } };

  /* UI: tactile and short like a premium app or console menu. No pitched chimes or bells. */
  function tick(a, t, f, g, q) { a.noise(t, { type: 'white', attack: 0.0004, tau: 0.003, gain: g, filters: [a.filter('bandpass', f, q || 1.6)] }); }
  function thud(a, t, f, g) { a.noise(t, { type: 'pink', attack: 0.001, tau: 0.018, gain: g, filters: [a.filter('lowpass', f)] }); }
  R.ui_click = { bus: 'ui', level: 1.62, max: 4, fn: function (a, t) { tick(a, t, 3000, 0.9); thud(a, t, 500, 0.35); return a.end; } };
  R.ui_hover = { bus: 'ui', level: 0.555, max: 2, fn: function (a, t) { tick(a, t, 5200, 0.6, 2); return a.end; } };
  R.ui_toggle_on = { bus: 'ui', level: 0.451, max: 2, fn: function (a, t) { tick(a, t, 2200, 0.8); tick(a, t + 0.035, 3600, 0.9); thud(a, t + 0.035, 600, 0.3); return a.end; } };
  R.ui_toggle_off = { bus: 'ui', level: 0.622, max: 2, fn: function (a, t) { tick(a, t, 3600, 0.8); tick(a, t + 0.035, 2000, 0.9); thud(a, t + 0.035, 400, 0.3); return a.end; } };
  R.ui_success = { bus: 'ui', level: 0.215, max: 2, fn: function (a, t) {      // firm confirm: double tap + soft low thump
    tick(a, t, 2600, 0.8); tick(a, t + 0.06, 3400, 0.9); a.tone(t + 0.06, { f0: 140, f1: 90, glide: 0.06, tau: 0.04, gain: 0.5 }); return a.end; } };
  R.ui_error = { bus: 'ui', level: 0.687, max: 2, fn: function (a, t) {        // blocked: two dull knocks
    [0, 0.11].forEach(function (d) { thud(a, t + d, 350, 0.8); tick(a, t + d, 900, 0.4, 1); }); return a.end; } };
  R.ui_notify = { bus: 'ui', level: 0.707, max: 2, fn: function (a, t) {      // attention: soft knock-knock
    [0, 0.13].forEach(function (d) { tick(a, t + d, 1500, 0.7, 1.2); thud(a, t + d, 700, 0.5); }); return a.end; } };
  function swish(a, t, f0, f1, dur, g) {
    var n = a.noise(t, { type: 'pink', attack: dur * 0.4, tau: dur * 0.25, gain: g, filters: [a.filter('bandpass', f0, 1.4)] });
    n.filters[0].frequency.exponentialRampToValueAtTime(f1, t + dur);
  }
  R.ui_open = { bus: 'ui', level: 0.593, max: 2, fn: function (a, t) { swish(a, t, 700, 2400, 0.12, 0.8); return a.end; } };
  R.ui_close = { bus: 'ui', level: 0.696, max: 2, fn: function (a, t) { swish(a, t, 2200, 650, 0.11, 0.8); return a.end; } };

  /* ---------- engine ---------- */
  function SFX(opts) {
    opts = opts || {};
    this.key = opts.storageKey || 'sfx.settings';
    var s = {}; try { s = JSON.parse(root.localStorage.getItem(this.key)) || {}; } catch (e) {}
    this._vol = s.volume == null ? (opts.volume == null ? 0.8 : opts.volume) : s.volume;
    this._muted = !!s.muted;
    this.reverb = opts.reverb == null ? 0.22 : opts.reverb;
    this.ctx = null; this.g = null; this.voices = [];
    var self = this;
    if (root.document) root.document.addEventListener('visibilitychange', function () {
      if (!self.ctx) return;
      if (root.document.hidden) self.ctx.suspend(); else if (self._unlocked) self.ctx.resume();
    });
  }
  SFX.prototype._save = function () { try { root.localStorage.setItem(this.key, JSON.stringify({ volume: this._vol, muted: this._muted })); } catch (e) {} };
  SFX.prototype._applyVol = function () { if (this.g) this.g.master.gain.setTargetAtTime(this._muted ? 0 : this._vol, this.ctx.currentTime, 0.02); };
  SFX.prototype._ensure = function () {
    if (!AC) return false;
    if (!this.ctx) {
      try { this.ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { this.ctx = new AC(); }
      this.g = build(this.ctx, this.reverb); this._applyVol();
    }
    return true;
  };
  /* Real recordings. map: { name: ['a.mp3', 'b.mp3'] } or { name: { urls: [...], level: 1, layer: false, max: 4 } }
   * Several files = random variation per play. Give .mp3 (plays everywhere, iOS included); .ogg alone fails on old iOS.
   * layer: true also plays the synth recipe of the same name underneath (e.g. real whoosh + synth weight).
   * Unknown names become new sounds. Returns a Promise; playing before it resolves uses the synth recipe. */
  SFX.prototype.loadSamples = function (map) {
    var self = this; if (!this._ensure()) return Promise.resolve();
    function decode(u) {
      return fetch(u).then(function (r) { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
        .then(function (b) { return new Promise(function (res, rej) { self.ctx.decodeAudioData(b, res, rej); }); })
        .catch(function (e) { console.warn('sfx: could not load ' + u, e); return null; });
    }
    return Promise.all(Object.keys(map).map(function (name) {
      var e = Array.isArray(map[name]) ? { urls: map[name] } : map[name];
      return Promise.all(e.urls.map(decode)).then(function (bufs) {
        bufs = bufs.filter(Boolean); if (!bufs.length) return;
        S[name] = { bufs: bufs, level: e.level == null ? 1 : e.level, layer: !!e.layer, max: e.max || (R[name] && R[name].max) || 4,
          bus: e.bus || (R[name] && R[name].bus) || (name.indexOf('ui_') === 0 ? 'ui' : 'sfx') };
      });
    }));
  };
  SFX.prototype.unlock = function () {
    if (!this._ensure()) return;
    if (this.ctx.state !== 'running') this.ctx.resume();
    try { var b = this.ctx.createBuffer(1, 1, 22050), s = this.ctx.createBufferSource(); s.buffer = b; s.connect(this.ctx.destination); s.start(0); } catch (e) {} // iOS unlock
    this._unlocked = true;
  };
  SFX.prototype.autoUnlock = function (target) {
    var self = this, t = target || root, evs = ['pointerdown', 'touchend', 'keydown', 'mousedown'];
    function go() { self.unlock(); if (self.ctx && self.ctx.state === 'running') evs.forEach(function (e) { t.removeEventListener(e, go, true); }); }
    evs.forEach(function (e) { t.addEventListener(e, go, true); });
  };
  function sampleRecipe(entry, synth) {
    return { bus: entry.bus, level: entry.level, max: entry.max, fn: function (a, t, o) {
      var src = a.ctx.createBufferSource(); src.buffer = entry.bufs[Math.floor(Math.random() * entry.bufs.length)];
      src.playbackRate.value = a.p; src.connect(a.out); src.start(t);
      var end = t + src.buffer.duration / a.p; if (end > a.end) a.end = end;
      if (synth) { a.out.gain.value *= 1; synth.fn(a, t, o); }
      return a.end;
    } };
  }
  SFX.prototype.play = function (name, o) {
    var r = S[name] ? sampleRecipe(S[name], S[name].layer ? R[name] : null) : R[name];
    if (!r) { console.warn('sfx: unknown sound ' + name); return; }
    if (!this.ctx || this._muted || this.ctx.state !== 'running') return;
    return playOn(this.g, this.voices, name, r, o || {}, this.ctx.currentTime + 0.005);
  };
  function playOn(g, voices, name, r, o, t) {
    var now = g.ctx.currentTime;
    for (var i = voices.length - 1; i >= 0; i--) if (voices[i].end < now) voices.splice(i, 1);
    var same = voices.filter(function (v) { return v.name === name; });
    if (same.length >= (r.max || 4)) kill(same[0], voices, now);
    if (voices.length >= 32) kill(voices[0], voices, now);
    var opts = {}; for (var k in o) opts[k] = o[k];
    opts.pitch = (o.pitch || 1) * vary(1, 0.05);
    opts.vol = (o.vol == null ? 1 : o.vol) * (r.level || 0.7) * vary(1, 0.1);
    var v = new Voice(g, r.bus || 'sfx', opts);
    var end = r.fn(v, t, opts) || v.end;
    var rec = { name: name, v: v, end: end }; voices.push(rec);
    return rec;
  }
  function kill(rec, voices, now) {
    try { rec.v.out.gain.cancelScheduledValues(now); rec.v.out.gain.setTargetAtTime(0, now, 0.008); } catch (e) {}
    var i = voices.indexOf(rec); if (i > -1) voices.splice(i, 1);
  }
  SFX.prototype.setVolume = function (v) { this._vol = Math.max(0, Math.min(1, v)); this._applyVol(); this._save(); };
  SFX.prototype.setMuted = function (m) { this._muted = !!m; this._applyVol(); this._save(); };
  Object.defineProperty(SFX.prototype, 'volume', { get: function () { return this._vol; } });
  Object.defineProperty(SFX.prototype, 'muted', { get: function () { return this._muted; } });

  SFX.define = function (name, fn, meta) { meta = meta || {}; R[name] = { fn: fn, bus: meta.bus, level: meta.level, max: meta.maxVoices }; };
  Object.defineProperty(SFX, 'names', { get: function () { return Object.keys(R); } });
  SFX.renderOffline = function (name, o, seconds, sampleRate) {
    sampleRate = sampleRate || 48000; seconds = seconds || 2;
    var ctx = new OAC(2, Math.ceil(seconds * sampleRate), sampleRate);
    var g = build(ctx, 0.22); g.master.gain.value = 0.8;
    playOn(g, [], name, R[name], o || {}, 0.01);
    return ctx.startRendering();
  };
  root.SFX = SFX;
})(typeof window !== 'undefined' ? window : globalThis);
