// ============================================================================
// Player Two: the deck. Eleven slides on a 1920x1080 stage, scaled to the viewport.
//
// Navigation: arrows / space / page keys / click / swipe, 1-9 to jump, F for fullscreen, A for autoplay.
// Every slide is deep-linkable as #1 .. #11 (and ?slide=N). ?still=1 (or prefers-reduced-motion)
// lands every slide in its final state with nothing moving; ?export=1 also pins the stage at 1:1.
// Media is optional: video and image sit over a drawn placeholder and only appear once they load.
// ============================================================================
(function () {
'use strict';
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
const q = new URLSearchParams(location.search);
const EXPORT = q.get('export') === '1';
const STILL = EXPORT || q.get('still') === '1' || matchMedia('(prefers-reduced-motion: reduce)').matches;

const C = { bg: '#07080b', ink: '#f4f6fa', dim: '#a3acbb', mute: '#5d6676', cyan: '#67e8f9', orange: '#fb923c', emerald: '#34d399', rose: '#fb7185' };
const MONO = '"Geist Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const D = Math.PI / 180, TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ss = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const easeOut = t => 1 - Math.pow(1 - t, 4);
const easeInOut = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

const deck = $('#deck'), stage = $('#stage'), slides = $$('.slide'), total = slides.length;
let at = -1, scale = 1, K = 1, T = 0, enteredAt = 0;

// ---------- text: headlines come up word by word (or letter by letter) ----------
function split(el) {
  const chars = el.dataset.split === 'chars'; let i = 0;
  (function walk(node) {
    [...node.childNodes].forEach(ch => {
      if (ch.nodeType === 1) return walk(ch);
      if (ch.nodeType !== 3) return;
      const frag = document.createDocumentFragment();
      (chars ? [...ch.textContent] : ch.textContent.split(/(\s+)/)).forEach(p => {
        if (!p) return;
        if (/^\s+$/.test(p)) return frag.append(' ');
        const w = document.createElement('span'), wi = document.createElement('span');
        w.className = 'w'; wi.className = 'wi'; wi.style.setProperty('--i', i++); wi.textContent = p;
        w.append(wi); frag.append(w);
      });
      ch.replaceWith(frag);
    });
  })(el);
}

// ---------- timers and tweens that belong to the slide on screen ----------
let timers = [], tweens = [];
function later(ms, fn) { if (STILL) return fn(); timers.push(setTimeout(fn, ms)); }
function every(ms, fn) { if (STILL) return; timers.push(setInterval(fn, ms)); }
function tween(delay, dur, fn) { if (STILL) return fn(1); fn(0); tweens.push({ t0: T + delay / 1000, dur: dur / 1000, fn }); }
function clearSlideWork() { timers.forEach(t => { clearTimeout(t); clearInterval(t); }); timers = []; tweens = []; }

// a monospace comma is a whole cell wide; pull it in so 100,000 reads as one number
const narrowCommas = str => str.replace(/,/g, '<span class="cm">,</span>');
function counters(slide) {
  $$('[data-count]', slide).forEach((el, n) => {
    const to = +el.dataset.count, from = +(el.dataset.from || 0), pre = el.dataset.prefix || '', comma = el.dataset.comma === '1';
    const fmt = v => pre + (comma ? narrowCommas(Math.round(v).toLocaleString('en-US')) : String(Math.round(v)));
    tween(850 + n * 140, 1700, p => { el.innerHTML = fmt(lerp(from, to, easeOut(p))); });
  });
}

// ============================================================================
// figures: one pose drives a human skeleton (cyan) and a robot (orange joints), mirrored
// ============================================================================
const armPose = (r, wv) => ({ a: (12 + 128 * r + 5 * wv) * D, b: (10 + 22 * Math.sin(r * Math.PI) + 8 * r + 16 * wv) * D });
const IDLE = t => ({ a: (12 + 2.5 * Math.sin(t * 0.9)) * D, b: (12 + 3 * Math.sin(t * 0.7 + 1)) * D });
function raise(u) { // a slow raise, a small wave at the top, and back down; u in [0,10)
  const r = ss(0.6, 2.6, u) - ss(4.4, 5.6, u);
  const wv = (ss(2.5, 3.0, u) - ss(3.9, 4.4, u)) * Math.sin((u - 2.5) * 5.2);
  return { r, wv };
}
function poseTitle(t) { // arm A raises; later arm B says hello
  const u = ((t % 10) + 10) % 10, k = raise(u);
  const hi = ss(6.2, 7.3, u) - ss(8.6, 9.7, u), wv = (ss(7.1, 7.5, u) - ss(8.3, 8.7, u)) * Math.sin((u - 7.1) * 7);
  return { A: armPose(k.r, k.wv), B: { a: (12 + 34 * hi) * D, b: (12 + 92 * hi + 14 * wv) * D },
    lean: (2 * Math.sin(t * 0.6) + 3 * k.r - 2 * hi) * D, breath: Math.sin(t * 1.4) };
}
function poseDemo(t) { // both arms take turns striking
  const u = ((t % 10) + 10) % 10, k = raise(u), k2 = raise((u + 5) % 10);
  return { A: armPose(k.r, k.wv), B: armPose(k2.r, k2.wv), lean: (1.5 * Math.sin(t * 0.6) + 3 * k.r - 3 * k2.r) * D, breath: Math.sin(t * 1.4) };
}
const REST = { lean: 0, breath: 0 };

// joints of an upper body whose pelvis is at (cx,cy); s is the torso unit. mirror swaps which side arm A is on.
function rig(cx, cy, s, p, mirror) {
  const m = mirror ? -1 : 1, lean = p.lean * m, cl = Math.cos(lean), sl = Math.sin(lean), br = (p.breath || 0) * 0.012;
  const P = (x, y) => [cx + (x * cl - y * sl) * s, cy + (x * sl + y * cl) * s + br * y * s];
  const arm = (sg, a) => {
    const sh = P(sg * 0.56, -1.42), a1 = a.a, a2 = a.a + a.b;
    const el = [sh[0] + sg * Math.sin(a1) * 0.72 * s, sh[1] + Math.cos(a1) * 0.72 * s];
    const wr = [el[0] + sg * Math.sin(a2) * 0.68 * s, el[1] + Math.cos(a2) * 0.68 * s];
    return { sh, el, wr };
  };
  return { s, lean, A: arm(-m, p.A), B: arm(m, p.B), pelvis: P(0, 0), neck: P(0, -1.5), head: P(0, -1.92),
    hipL: P(-0.3, 0), hipR: P(0.3, 0), kneeL: P(-0.36, 0.98), kneeR: P(0.36, 0.98),
    torso: [P(-0.62, -1.52), P(0.62, -1.52), P(0.42, -0.5), P(0.36, 0.06), P(-0.36, 0.06), P(-0.42, -0.5)] };
}
function seg(ctx, a, b) { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
function fadeSeg(ctx, a, b, col, a0) {
  const g = ctx.createLinearGradient(a[0], a[1], b[0], b[1]); g.addColorStop(0, rgba(col, a0)); g.addColorStop(1, rgba(col, 0));
  ctx.strokeStyle = g; seg(ctx, a, b);
}
function capsule(ctx, a, b, r) {
  const g = Math.atan2(b[1] - a[1], b[0] - a[0]);
  ctx.beginPath(); ctx.arc(a[0], a[1], r, g + Math.PI / 2, g - Math.PI / 2); ctx.arc(b[0], b[1], r, g - Math.PI / 2, g + Math.PI / 2); ctx.closePath();
}
function drawHuman(ctx, j, o) {
  const s = j.s, al = (o && o.alpha) || 1, lw = Math.max(1.4, s * 0.03), glow = !(o && o.flat);
  ctx.save(); ctx.globalAlpha = al; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = lw;
  if (glow) { ctx.shadowColor = rgba(C.cyan, .8); ctx.shadowBlur = s * 0.14; }
  fadeSeg(ctx, j.hipL, j.kneeL, C.cyan, .8); fadeSeg(ctx, j.hipR, j.kneeR, C.cyan, .8);
  ctx.strokeStyle = C.cyan;
  seg(ctx, j.hipL, j.hipR); seg(ctx, j.pelvis, j.neck); seg(ctx, j.A.sh, j.B.sh);
  [j.A, j.B].forEach(a => { seg(ctx, a.sh, a.el); seg(ctx, a.el, a.wr); });
  ctx.beginPath(); ctx.arc(j.head[0], j.head[1], s * 0.27, 0, TAU); ctx.stroke();
  ctx.shadowBlur = 0; ctx.fillStyle = C.bg;
  const dot = (p, r) => { ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, TAU); ctx.fill(); ctx.stroke(); };
  [j.A.sh, j.B.sh, j.A.el, j.B.el, j.hipL, j.hipR, j.neck].forEach(p => dot(p, s * 0.05));
  ctx.fillStyle = C.cyan; [j.A.wr, j.B.wr].forEach(p => dot(p, s * 0.055));
  ctx.restore();
}
function drawRobot(ctx, j, o) {
  const s = j.s, al = (o && o.alpha) || 1, lw = Math.max(1.2, s * 0.02), body = 'rgba(244,246,250,.9)', fill = 'rgba(244,246,250,.06)', hot = (o && o.tint) || C.orange, glow = !(o && o.tint);
  ctx.save(); ctx.globalAlpha = al; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = lw;
  // thighs fade out: the frame ends at the knees
  [[j.hipL, j.kneeL], [j.hipR, j.kneeR]].forEach(([a, b]) => {
    const g = ctx.createLinearGradient(a[0], a[1], b[0], b[1]); g.addColorStop(0, 'rgba(244,246,250,.7)'); g.addColorStop(1, 'rgba(244,246,250,0)');
    capsule(ctx, a, b, s * 0.12); ctx.strokeStyle = g; ctx.stroke();
  });
  ctx.strokeStyle = body; ctx.fillStyle = fill;
  ctx.beginPath(); j.torso.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath(); ctx.fill(); ctx.stroke();
  seg(ctx, j.torso[5], j.torso[2]);
  seg(ctx, j.neck, [lerp(j.neck[0], j.head[0], .45), lerp(j.neck[1], j.head[1], .45)]);
  [j.A, j.B].forEach(a => { capsule(ctx, a.sh, a.el, s * 0.095); ctx.fill(); ctx.stroke(); capsule(ctx, a.el, a.wr, s * 0.08); ctx.fill(); ctx.stroke(); });
  // head: a visor
  ctx.save(); ctx.translate(j.head[0], j.head[1]); ctx.rotate(j.lean);
  ctx.beginPath(); ctx.roundRect(-s * 0.28, -s * 0.25, s * 0.56, s * 0.48, s * 0.13); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = hot; ctx.lineWidth = lw * 1.8; if (glow) { ctx.shadowColor = rgba(hot, .9); ctx.shadowBlur = s * 0.12; }
  ctx.beginPath(); ctx.moveTo(-s * 0.15, -s * 0.03); ctx.lineTo(s * 0.15, -s * 0.03); ctx.stroke();
  ctx.restore();
  // servos
  ctx.strokeStyle = hot; ctx.lineWidth = lw * 1.3; if (glow) { ctx.shadowColor = rgba(hot, .7); ctx.shadowBlur = s * 0.1; }
  const servo = (p, r) => { ctx.fillStyle = C.bg; ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, TAU); ctx.fill(); ctx.stroke(); ctx.fillStyle = hot; ctx.beginPath(); ctx.arc(p[0], p[1], r * .36, 0, TAU); ctx.fill(); };
  [j.A.sh, j.B.sh].forEach(p => servo(p, s * 0.085)); [j.A.el, j.B.el].forEach(p => servo(p, s * 0.07)); [j.A.wr, j.B.wr].forEach(p => servo(p, s * 0.06));
  const core = [lerp(j.pelvis[0], j.neck[0], .66), lerp(j.pelvis[1], j.neck[1], .66)]; servo(core, s * 0.06);
  ctx.restore();
}

// a pendulum the robot can strike
function makePendulum(rest, L, dir, r) { return { px: rest[0], py: rest[1] - L, L, dir, r, th: 0, om: 0, cool: 0, flash: 0, rings: [] }; }
function bobOf(p) { return [p.px + p.L * Math.sin(p.th), p.py + p.L * Math.cos(p.th)]; }
function stepPendulum(p, dt, wrist) {
  const n = Math.max(1, Math.ceil(dt / 0.02)), hs = dt / n;
  for (let k = 0; k < n; k++) { p.om += (-9 * Math.sin(p.th) - 0.55 * p.om) * hs; p.th += p.om * hs; }
  p.cool -= dt; p.flash *= Math.exp(-3 * dt);
  p.rings.forEach(g => { g.t += dt; }); p.rings = p.rings.filter(g => g.t < 1);
  const b = bobOf(p);
  if (wrist && p.cool <= 0 && dist(wrist, b) < p.r * 2.4) { p.om += 1.9 * p.dir; p.cool = 1.6; p.flash = 1; p.rings.push({ t: 0, x: b[0], y: b[1] }); }
}
function drawPendulum(ctx, p) {
  const b = bobOf(p);
  ctx.save(); ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(244,246,250,.35)'; ctx.lineWidth = 1.5; seg(ctx, [p.px - 22, p.py], [p.px + 22, p.py]);
  ctx.strokeStyle = 'rgba(244,246,250,.28)'; ctx.lineWidth = 1.2; seg(ctx, [p.px, p.py], b);
  p.rings.forEach(g => { ctx.strokeStyle = rgba(C.emerald, (1 - g.t) * .9); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(g.x, g.y, p.r + g.t * p.r * 5, 0, TAU); ctx.stroke(); });
  ctx.shadowColor = rgba(C.emerald, .9); ctx.shadowBlur = 30 * p.flash;
  ctx.fillStyle = p.flash > .05 ? rgba(C.emerald, .2 + .6 * p.flash) : C.bg; ctx.strokeStyle = p.flash > .05 ? C.emerald : 'rgba(244,246,250,.85)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(b[0], b[1], p.r, 0, TAU); ctx.fill(); ctx.stroke();
  ctx.restore();
}
// where a pendulum should hang so that a rising arm meets it
function restFor(cx, cy, s, which, mirror) {
  const hit = armPose(0.86, 0), idle = { a: 12 * D, b: 12 * D };
  const j = rig(cx, cy, s, Object.assign({}, REST, { lean: (which === 'A' ? 2.6 : -2.6) * D, A: which === 'A' ? hit : idle, B: which === 'B' ? hit : idle }), mirror);
  const w = j[which].wr, out = Math.sign(w[0] - cx) || 1;
  return { rest: [w[0] + out * s * 0.1, w[1] - s * 0.05], dir: out };
}
function label(ctx, txt, x, y, col, size, align) {
  ctx.font = `500 ${size || 13}px ${MONO}`; ctx.textAlign = align || 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = col;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0.14em';
  ctx.fillText(txt, x, y);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
}

// ============================================================================
// scenes: each canvas names one. draw(ctx, w, h, t, dt, st, since) where since = seconds on this slide.
// ============================================================================
const LAG = 0.55; // the robot follows a beat later
const SCENES = {
  // 01: you on the left, the robot mirroring you on the right, one beat later
  title: {
    stillT: 3.35,
    init(st) {
      st.s = 142; st.cy = 776; st.xh = 1062; st.xr = 1548;
      const r = restFor(st.xr, st.cy, st.s, 'A', true); st.pend = makePendulum(r.rest, st.s * 1.25, r.dir, 17);
    },
    draw(ctx, w, h, t, dt, st) {
      const ph = poseTitle(t), pr = poseTitle(t - LAG), H = rig(st.xh, st.cy, st.s, ph, false), R = rig(st.xr, st.cy, st.s, pr, true);
      stepPendulum(st.pend, dt, R.A.wr);
      // pools of light under each player
      [[st.xh, C.cyan], [st.xr, C.orange]].forEach(([x, c]) => {
        const g = ctx.createRadialGradient(x, st.cy + 40, 0, x, st.cy + 40, 330); g.addColorStop(0, rgba(c, .1)); g.addColorStop(1, rgba(c, 0));
        ctx.fillStyle = g; ctx.fillRect(x - 340, st.cy - 300, 680, 680);
      });
      // the only thing that crosses: joint angles
      const y = st.cy + 34, x0 = st.xh + 176, x1 = st.xr - 176, mid = (x0 + x1) / 2;
      ctx.strokeStyle = 'rgba(244,246,250,.16)'; ctx.lineWidth = 1; ctx.setLineDash([3, 7]); seg(ctx, [x0, y], [x1, y]); ctx.setLineDash([]);
      for (let k = 0; k < 4; k++) {
        const f = ((t * 0.55 + k / 4) % 1), x = lerp(x0, x1, f), a = Math.sin(f * Math.PI);
        ctx.fillStyle = rgba(C.cyan, .85 * a); ctx.fillRect(x - 5, y - 1.5, 10, 3);
      }
      const deg = v => (v / D).toFixed(1).padStart(5, '0');
      label(ctx, 'JOINT ANGLES', mid, y - 62, C.mute, 11, 'center');
      ctx.font = `400 13px ${MONO}`; ctx.fillStyle = C.dim; ctx.textAlign = 'center';
      ctx.fillText('sh ' + deg(ph.A.a), mid, y - 38); ctx.fillText('el ' + deg(ph.A.b), mid, y - 18);
      drawPendulum(ctx, st.pend); drawHuman(ctx, H); drawRobot(ctx, R);
      label(ctx, 'PLAYER ONE', st.xh, st.cy + 186, C.cyan, 14, 'center'); label(ctx, 'WEBCAM POSE', st.xh, st.cy + 210, C.mute, 11, 'center');
      label(ctx, 'PLAYER TWO', st.xr, st.cy + 186, C.orange, 14, 'center'); label(ctx, 'SIMULATED HUMANOID', st.xr, st.cy + 210, C.mute, 11, 'center');
    },
  },

  // 02: one dot is 100 hours. 3.5 dots of DROID against a thousand.
  dots: {
    stillT: 2,
    draw(ctx, w, h, t, dt, st, since) {
      const cols = 100, rows = 10, px = w / cols, py = h / rows, r = Math.min(px, py) * 0.2, band = ((t * 16) % 150) - 25;
      for (let c = 0; c < cols; c++) {
        const shown = clamp((since - 1.3 - c / cols * 1.5) / 0.35, 0, 1); if (shown <= 0) continue;
        const sh = Math.exp(-Math.pow((c - band) / 7, 2));
        for (let k = 0; k < rows; k++) {
          const i = c * rows + k, x = (c + .5) * px, y = (k + .5) * py, tw = .5 + .5 * Math.sin(t * 1.3 + i * 2.399);
          if (i < 4) continue;
          ctx.fillStyle = `rgba(244,246,250,${(0.2 + 0.1 * tw + 0.5 * sh) * shown})`;
          ctx.beginPath(); ctx.arc(x, y, r * (1 + .25 * sh), 0, TAU); ctx.fill();
        }
      }
      const on = clamp((since - 1.1) / 0.5, 0, 1), pulse = .5 + .5 * Math.sin(t * 2.4);
      for (let i = 0; i < 4; i++) {
        const x = .5 * px, y = (i + .5) * py, R = r * 1.55;
        ctx.save(); ctx.globalAlpha = on;
        if (i === 3) { ctx.fillStyle = 'rgba(244,246,250,.25)'; ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.fill(); }
        ctx.shadowColor = C.cyan; ctx.shadowBlur = 10 + 8 * pulse; ctx.fillStyle = C.cyan;
        ctx.beginPath(); if (i === 3) ctx.arc(x, y, R, Math.PI / 2, Math.PI * 1.5); else ctx.arc(x, y, R, 0, TAU); ctx.fill();
        ctx.restore();
      }
      ctx.strokeStyle = rgba(C.cyan, .35 * on * (1 - pulse * .5)); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(px * .5 - 9 - pulse * 3, 1, 18 + pulse * 6, py * 4 - 2, 9); ctx.stroke();
    },
  },

  // 03: one rig, one operator, one robot. Now a thousand of them.
  grid: {
    stillT: 9,
    init(st) { const r = rng(7); st.order = Array.from({ length: 1000 }, () => r()); st.ph = st.order.map(() => r() * TAU); },
    draw(ctx, w, h, t, dt, st, since) {
      const cols = 50, rows = 20, px = w / cols, py = h / rows;
      const p = STILL ? 1 : easeInOut(clamp((since - 2.2) / 2.6, 0, 1)), over = STILL ? 1 : ss(5.2, 6.2, since);
      const m = $('#mult'), txt = 'x' + Math.round(1 + 999 * p).toLocaleString('en-US'); if (m && m.textContent !== txt) m.innerHTML = narrowCommas(txt);
      for (let i = 0; i < 1000; i++) {
        const first = i === 0; if (!first && st.order[i] > p) continue;
        const c = i % cols, k = (i / cols) | 0, x = (c + .5) * px, y = (k + .5) * py, tw = .65 + .35 * Math.sin(t * 1.7 + st.ph[i]);
        const a = (first ? 1 : tw) * lerp(1, .34, over);
        [[-5, C.cyan], [0, C.ink], [5, C.orange]].forEach(([dx, col], n) => {
          ctx.fillStyle = rgba(over > 0 ? mix(col, C.rose, over * .85) : col, a * (n === 1 ? .8 : 1));
          ctx.beginPath(); ctx.arc(x + dx, y, 1.9, 0, TAU); ctx.fill();
        });
      }
    },
  },

  // 04 placeholder: the robot strikes pendulums while a small webcam inset shows the pose that drives it
  demo: {
    stillT: 3.35,
    init(st, w, h) {
      st.s = h * 0.205; st.cx = w * 0.54; st.cy = h * 0.8;
      const a = restFor(st.cx, st.cy, st.s, 'A', true), b = restFor(st.cx, st.cy, st.s, 'B', true);
      st.pends = [makePendulum(a.rest, st.s * 1.25, a.dir, st.s * .12), makePendulum(b.rest, st.s * 1.25, b.dir, st.s * .12)];
    },
    draw(ctx, w, h, t, dt, st) {
      const g = ctx.createRadialGradient(st.cx, st.cy, 0, st.cx, st.cy, h * .9); g.addColorStop(0, 'rgba(251,146,60,.09)'); g.addColorStop(1, 'rgba(7,8,11,0)');
      ctx.fillStyle = '#06070a'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      floor(ctx, w, h, st.cy + st.s * .62, t);
      const R = rig(st.cx, st.cy, st.s, poseDemo(t - LAG), true);
      stepPendulum(st.pends[0], dt, R.A.wr); stepPendulum(st.pends[1], dt, R.B.wr);
      st.pends.forEach(p => drawPendulum(ctx, p)); drawRobot(ctx, R);
      // webcam inset: pose only
      const iw = w * .2, ih = iw * .75, ix = 46, iy = h - ih - 46;
      ctx.fillStyle = 'rgba(7,8,11,.85)'; ctx.strokeStyle = 'rgba(103,232,249,.4)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(ix, iy, iw, ih, 10); ctx.fill(); ctx.stroke();
      ctx.save(); ctx.beginPath(); ctx.roundRect(ix, iy, iw, ih, 10); ctx.clip();
      drawHuman(ctx, rig(ix + iw / 2, iy + ih * .98, ih * .3, poseDemo(t), true), { flat: true }); ctx.restore();
      label(ctx, 'YOU', ix + 12, iy + 22, C.cyan, 11);
      label(ctx, 'MUJOCO  250 Hz', 46, 46 + 8, C.dim, 12); label(ctx, 'PLAYER TWO', w - 46, 46 + 8, C.orange, 12, 'right');
    },
  },

  // 08 placeholder: skeleton in, robot out
  split: {
    stillT: 3.35,
    init(st, w, h) {
      st.s = h * 0.2; st.cy = h * 0.8;
      const a = restFor(w * .75, st.cy, st.s, 'A', true), b = restFor(w * .75, st.cy, st.s, 'B', true);
      st.pends = [makePendulum(a.rest, st.s * 1.25, a.dir, st.s * .12), makePendulum(b.rest, st.s * 1.25, b.dir, st.s * .12)];
    },
    draw(ctx, w, h, t, dt, st) {
      ctx.fillStyle = '#06070a'; ctx.fillRect(0, 0, w, h);
      const gl = ctx.createLinearGradient(0, 0, w / 2, h); gl.addColorStop(0, 'rgba(103,232,249,.07)'); gl.addColorStop(1, 'rgba(103,232,249,.01)');
      ctx.fillStyle = gl; ctx.fillRect(0, 0, w / 2, h);
      // a video frame with nothing in it but the skeleton
      ctx.strokeStyle = 'rgba(244,246,250,.06)'; ctx.lineWidth = 1;
      for (let y = ((t * 30) % 14); y < h; y += 14) seg(ctx, [0, y], [w / 2, y]);
      floor(ctx, w, h, st.cy + st.s * .62, t, w / 2);
      const R = rig(w * .75, st.cy, st.s, poseDemo(t - LAG), true);
      stepPendulum(st.pends[0], dt, R.A.wr); stepPendulum(st.pends[1], dt, R.B.wr); st.pends.forEach(p => drawPendulum(ctx, p));
      drawHuman(ctx, rig(w * .25, st.cy, st.s, poseDemo(t), true)); drawRobot(ctx, R);
      ctx.strokeStyle = 'rgba(244,246,250,.22)'; seg(ctx, [w / 2, 0], [w / 2, h]);
      ctx.fillStyle = C.bg; ctx.strokeStyle = 'rgba(244,246,250,.4)'; ctx.beginPath(); ctx.roundRect(w / 2 - 15, h / 2 - 15, 30, 30, 15); ctx.fill(); ctx.stroke();
      label(ctx, '>', w / 2 + 1, h / 2 + 5, C.dim, 14, 'center');
      label(ctx, 'POSE SKELETON, FROM VIDEO', 50, h - 78, C.cyan, 12); label(ctx, 'ROBOT, SAME MOTION', w / 2 + 34, h - 78, C.orange, 12);
    },
  },

  // 07a: the uploaded command trace shakes far outside the limit
  jerk: {
    stillT: 1,
    draw(ctx, w, h, t) {
      const mid = h * .5, amp = h * .2, ref = x => .9 * Math.sin(x * 1.5) + .35 * Math.sin(x * .7 + 1);
      const noise = x => .22 * Math.sin(x * 31) + .16 * Math.sin(x * 47 + 2) + .12 * Math.sin(x * 73 + 4);
      ctx.strokeStyle = 'rgba(255,255,255,.05)'; ctx.lineWidth = 1;
      for (let x = (-(t * 60) % 48); x < w; x += 48) seg(ctx, [x, 0], [x, h]);
      for (let y = mid % 48; y < h; y += 48) seg(ctx, [0, y], [w, y]);
      const path = f => { ctx.beginPath(); for (let x = 0; x <= w; x += 2) { const v = mid - f(x / w * 5 + t * 1.25) * amp; x ? ctx.lineTo(x, v) : ctx.moveTo(x, v); } };
      path(ref); ctx.strokeStyle = rgba(C.emerald, .16); ctx.lineWidth = 16; ctx.stroke();
      path(ref); ctx.strokeStyle = rgba(C.emerald, .75); ctx.lineWidth = 1.5; ctx.stroke();
      path(x => ref(x) + noise(x)); ctx.strokeStyle = C.rose; ctx.lineWidth = 2; ctx.shadowColor = rgba(C.rose, .7); ctx.shadowBlur = 10; ctx.stroke(); ctx.shadowBlur = 0;
      label(ctx, 'WITHIN LIMIT', 22, 34, C.emerald, 11); label(ctx, 'UPLOADED COMMAND', 22, 54, C.rose, 11);
    },
  },

  // 07b: the client said success. On replay, the hand never reaches the bob.
  miss: {
    stillT: 1.2,
    draw(ctx, w, h, t) {
      const bob = [w * .66, h * .56], piv = [w * .66, 36], E = [w * .14, h * .9], r = 17;
      const reach = dist(E, bob) - r - 44, to = Math.atan2(bob[1] - E[1], bob[0] - E[0]), g = to + .62 * Math.sin(t * 1.25);
      const W = [E[0] + Math.cos(g) * reach, E[1] + Math.sin(g) * reach];
      ctx.strokeStyle = 'rgba(244,246,250,.12)'; ctx.setLineDash([2, 7]); ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(E[0], E[1], reach, to - .62, to + .62); ctx.stroke(); ctx.setLineDash([]);
      drawPendulum(ctx, { px: piv[0], py: piv[1], L: bob[1] - piv[1], th: 0, r, flash: 0, rings: [] });
      const near = clamp(1 - (dist(W, bob) - r - 44) / 60, 0, 1);
      if (near > 0) {
        const u = [(bob[0] - W[0]) / dist(W, bob), (bob[1] - W[1]) / dist(W, bob)];
        ctx.strokeStyle = rgba(C.rose, near); ctx.lineWidth = 1.5; ctx.setLineDash([4, 5]);
        seg(ctx, [W[0] + u[0] * 14, W[1] + u[1] * 14], [bob[0] - u[0] * (r + 4), bob[1] - u[1] * (r + 4)]); ctx.setLineDash([]);
        label(ctx, 'NO CONTACT', bob[0] + 30, bob[1] + 5, rgba(C.rose, near), 11);
      }
      ctx.lineWidth = 2.4; ctx.strokeStyle = 'rgba(244,246,250,.9)'; ctx.fillStyle = 'rgba(244,246,250,.06)'; capsule(ctx, E, W, 13); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = C.orange; ctx.lineWidth = 2.6;
      [[E, 11], [W, 9]].forEach(([p, rr]) => { ctx.fillStyle = C.bg; ctx.beginPath(); ctx.arc(p[0], p[1], rr, 0, TAU); ctx.fill(); ctx.stroke(); ctx.fillStyle = C.orange; ctx.beginPath(); ctx.arc(p[0], p[1], rr * .36, 0, TAU); ctx.fill(); });
      label(ctx, 'SERVER REPLAY', 22, 34, C.dim, 11); label(ctx, 'FIRST CONTACT: NONE', 22, 54, C.rose, 11);
    },
  },

  // 09 placeholder: a wall of episodes arriving
  wall: {
    stillT: 4,
    init(st) { const r = rng(11); st.r = r; st.tiles = Array.from({ length: 24 }, (_, i) => ({ tp: r() * 10, ok: ![5, 14, 19].includes(i), born: -9 })); st.next = 0; st.last = 0; },
    draw(ctx, w, h, t, dt, st) {
      ctx.fillStyle = '#06070a'; ctx.fillRect(0, 0, w, h);
      if (t - st.last > 1.15) { st.last = t; const tl = st.tiles[st.next]; tl.tp = st.r() * 10; tl.ok = st.r() > .16; tl.born = t; st.next = (st.next * 7 + 5) % 24; }
      const cols = 6, rows = 4, pad = 26, gap = 14, tw = (w - pad * 2 - gap * (cols - 1)) / cols, th = (h - pad * 2 - gap * (rows - 1)) / rows;
      st.tiles.forEach((tl, i) => {
        const x = pad + (i % cols) * (tw + gap), y = pad + ((i / cols) | 0) * (th + gap), age = t - tl.born, fresh = clamp(1 - age / 1.2, 0, 1), col = tl.ok ? C.emerald : C.rose;
        ctx.fillStyle = rgba(col, .05 + .12 * fresh); ctx.strokeStyle = rgba(col, .35 + .65 * fresh); ctx.lineWidth = 1 + fresh;
        ctx.beginPath(); ctx.roundRect(x, y, tw, th, 8); ctx.fill(); ctx.stroke();
        ctx.save(); ctx.beginPath(); ctx.roundRect(x, y, tw, th, 8); ctx.clip();
        drawRobot(ctx, rig(x + tw / 2, y + th * .86, th * .24, poseDemo(age < 5 ? tl.tp + age : tl.tp + 5), true), { alpha: tl.ok ? .95 : .45, tint: col });
        ctx.restore();
        label(ctx, tl.ok ? 'ACCEPTED' : 'REJECTED', x + 10, y + 18, col, 9);
      });
    },
  },

  // 11: a human arm and the arm that arrives next week, mirrored
  arms: {
    stillT: 2,
    draw(ctx, w, h, t) {
      const tgt = tt => [450 + 90 * Math.sin(tt * .7), 800 + 90 * Math.sin(tt * .95 + 1)];
      const ik = (S, Tg, l1, l2, flip) => {
        const dx = Tg[0] - S[0], dy = Tg[1] - S[1], d = clamp(Math.hypot(dx, dy), Math.abs(l1 - l2) + 1, l1 + l2 - 1), a = Math.atan2(dy, dx);
        const b = Math.acos(clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1)) * flip, el = [S[0] + Math.cos(a + b) * l1, S[1] + Math.sin(a + b) * l1];
        return { el, wr: [S[0] + Math.cos(a) * d, S[1] + Math.sin(a) * d] };
      };
      ctx.save(); ctx.globalAlpha = .75; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      // the human arm, as a pose skeleton
      const S = [150, 1150], hm = ik(S, tgt(t), 340, 300, -1);
      ctx.strokeStyle = C.cyan; ctx.lineWidth = 4; ctx.shadowColor = rgba(C.cyan, .8); ctx.shadowBlur = 22;
      seg(ctx, S, hm.el); seg(ctx, hm.el, hm.wr); ctx.shadowBlur = 0; ctx.fillStyle = C.bg;
      [[hm.el, 9], [hm.wr, 10]].forEach(([p, r]) => { ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, TAU); ctx.fill(); ctx.stroke(); });
      // the robot arm on its base, one beat later
      const tr = tgt(t - LAG), B = [w - 200, 930], rb = ik(B, [w - tr[0], tr[1]], 250, 230, 1);
      ctx.strokeStyle = 'rgba(244,246,250,.9)'; ctx.fillStyle = 'rgba(244,246,250,.06)'; ctx.lineWidth = 2.6;
      ctx.beginPath(); ctx.roundRect(B[0] - 74, B[1] + 8, 148, 62, 10); ctx.fill(); ctx.stroke(); seg(ctx, [B[0] - 150, B[1] + 70], [B[0] + 150, B[1] + 70]);
      capsule(ctx, B, rb.el, 20); ctx.fill(); ctx.stroke(); capsule(ctx, rb.el, rb.wr, 16); ctx.fill(); ctx.stroke();
      const ga = Math.atan2(rb.wr[1] - rb.el[1], rb.wr[0] - rb.el[0]), open = .34 + .2 * Math.sin(t * 1.6);
      [-1, 1].forEach(sg => { const a1 = ga + sg * open; seg(ctx, rb.wr, [rb.wr[0] + Math.cos(a1) * 46, rb.wr[1] + Math.sin(a1) * 46]); });
      ctx.strokeStyle = C.orange; ctx.lineWidth = 3; ctx.shadowColor = rgba(C.orange, .7); ctx.shadowBlur = 16;
      [[B, 17], [rb.el, 14], [rb.wr, 11]].forEach(([p, r]) => { ctx.fillStyle = C.bg; ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, TAU); ctx.fill(); ctx.stroke(); ctx.fillStyle = C.orange; ctx.beginPath(); ctx.arc(p[0], p[1], r * .36, 0, TAU); ctx.fill(); });
      ctx.restore();
    },
  },
};
function mix(a, b, t) { const p = parseInt(a.slice(1), 16), q2 = parseInt(b.slice(1), 16), ch = sh => Math.round(lerp((p >> sh) & 255, (q2 >> sh) & 255, t)); return '#' + ((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1); }
function floor(ctx, w, h, y, t, xmax) {
  const x1 = xmax || w; ctx.save(); ctx.beginPath(); ctx.rect(0, y, x1, h - y); ctx.clip(); ctx.lineWidth = 1;
  for (let k = 0; k < 7; k++) { const f = Math.pow((k + ((t * .15) % 1)) / 7, 2.2); ctx.strokeStyle = `rgba(244,246,250,${.03 + .07 * f})`; seg(ctx, [0, y + f * (h - y)], [x1, y + f * (h - y)]); }
  ctx.restore();
}

// every canvas in the deck, with the slide it lives on
const canvases = $$('canvas[data-scene]').map(c => ({ c, ctx: c.getContext('2d'), def: SCENES[c.dataset.scene], slide: slides.indexOf(c.closest('.slide')), st: null, host: c.closest('[data-media]') }));
function paint(cv, t, dt) {
  if (!cv.def || (cv.host && cv.host.classList.contains('has-media'))) return;
  const w = cv.c.offsetWidth, h = cv.c.offsetHeight; if (!w || !h) return;
  const k = cv.c.classList.contains('full') ? Math.min(K, 1.5) : K, W = Math.round(w * k), H = Math.round(h * k);
  if (cv.c.width !== W || cv.c.height !== H) { cv.c.width = W; cv.c.height = H; }
  if (!cv.st || cv.st.w !== w || cv.st.h !== h) { cv.st = { w, h }; if (cv.def.init) cv.def.init(cv.st, w, h); }
  cv.ctx.setTransform(k, 0, 0, k, 0, 0); cv.ctx.clearRect(0, 0, w, h);
  cv.def.draw(cv.ctx, w, h, t, dt, cv.st, STILL ? 99 : T - enteredAt);
}
function paintStill() { canvases.forEach(cv => { if (cv.slide === at) paint(cv, cv.def.stillT || 0, 0); }); }

// ============================================================================
// what each slide does when it comes on
// ============================================================================
const LABELS = ['left hand, high pendulum', 'right hand, high pendulum', 'left hand, mid pendulum', 'right hand, mid pendulum', 'left hand, low pendulum', 'right hand, low pendulum'];
const ENTER = {
  s3(s) { s.classList.remove('over'); later(5400, () => s.classList.add('over')); },
  s5(s) {
    const nodes = $$('.node', s), conns = $$('.conn', s); [...nodes, ...conns].forEach(n => n.classList.remove('lit', 'pulse'));
    nodes.forEach((n, k) => later(1500 + k * 520, () => { n.classList.add('lit'); if (k) conns[k - 1].classList.add('lit'); }));
    let k = -1; later(1500 + 5 * 520 + 500, () => every(1250, () => { nodes.forEach(n => n.classList.remove('pulse')); k = (k + 1) % 6; if (k < 5) nodes[k].classList.add('pulse'); }));
  },
  s6(s) {
    const gates = $$('.gate:not(.sum)', s), sum = $('.gate.sum', s), count = $('#gateCount');
    [...gates, sum].forEach(g => g.classList.remove('ok')); count.textContent = '00 / 11';
    gates.forEach((g, k) => { g.style.setProperty('--k', k); later(1200 + k * 230, () => { g.classList.add('ok'); count.textContent = String(k + 1).padStart(2, '0') + ' / 11'; }); });
    later(1200 + 11 * 230 + 250, () => sum.classList.add('ok'));
  },
  s7(s) { const cs = $$('.case', s); cs.forEach(c => c.classList.remove('hit')); later(2000, () => cs[0].classList.add('hit')); later(2900, () => cs[1].classList.add('hit')); },
  s9(s) {
    const cells = $$('#cover i', s), tally = $('#tally'), ask = $('#ask'), r = rng(3), GOAL = 4;
    const n = STILL ? [4, 4, 4, 3, 4, 1] : [0, 0, 0, 0, 0, 0]; let want = 0;
    const pick = () => { const lo = Math.min(...n), c = n.map((v, i) => v === lo ? i : -1).filter(i => i >= 0); return c[(r() * c.length) | 0]; };
    const render = () => {
      cells.forEach((c, i) => { c.style.setProperty('--f', Math.min(1, n[i] / GOAL)); $('b', c).textContent = n[i]; c.classList.toggle('want', i === want); c.classList.toggle('full', n[i] >= GOAL); });
      tally.textContent = String(n.reduce((a, b) => a + b, 0)).padStart(3, '0'); ask.textContent = 'asking for: ' + LABELS[want];
    };
    want = pick(); render();
    later(1700, () => every(900, () => { n[want]++; want = pick(); render(); }));
  },
  s11(s) { s.classList.remove('b1', 'b2', 'b3', 'b4'); later(350, () => s.classList.add('b1')); later(2500, () => s.classList.add('b2')); later(4100, () => s.classList.add('b3')); later(5900, () => s.classList.add('b4')); },
};
function enter(i) {
  const s = slides[i]; enteredAt = T; counters(s);
  const key = [...s.classList].find(c => ENTER[c]); if (key) ENTER[key](s);
  if (!STILL) $$('video', s).forEach(v => { const p = v.play(); if (p && p.catch) p.catch(() => {}); });
  if (STILL) requestAnimationFrame(paintStill);
}
function leave(i) { clearSlideWork(); if (i >= 0) $$('video', slides[i]).forEach(v => v.pause()); }

// ============================================================================
// navigation
// ============================================================================
const pad2 = n => String(n).padStart(2, '0');
function show(i, silent) {
  const n = clamp(i, 0, total - 1); if (n === at) return;
  const back = n < at, first = at < 0; leave(at); at = n;
  slides.forEach((s, k) => s.classList.toggle('on', k === at));
  const s = slides[at];
  stage.dataset.chrome = s.dataset.chrome || 'full';
  $('#kick').innerHTML = `<span>${s.dataset.kick || ''}</span>`;
  $('#numA').textContent = pad2(at + 1); $('#numB').textContent = pad2(total);
  $('#cNum').textContent = `${pad2(at + 1)} / ${pad2(total)}`; $('#cKick').textContent = s.dataset.kick || ''; $('#cLine').textContent = s.dataset.line || '';
  $$('#segs button').forEach((b, k) => { b.classList.toggle('done', k < at); b.classList.toggle('cur', k === at); b.setAttribute('aria-current', k === at ? 'true' : 'false'); });
  if (!first && !STILL) { const wp = $('#wipe'); wp.classList.remove('go', 'back'); void wp.offsetWidth; wp.classList.add('go'); if (back) wp.classList.add('back'); }
  if (!EXPORT && !silent) { try { history.replaceState(null, '', '#' + (at + 1)); } catch (e) { location.hash = String(at + 1); } }
  enter(at);
  if (autoOn) armAuto();
}
const fromHash = () => { const m = /(\d+)/.exec(location.hash); return m ? +m[1] - 1 : (+q.get('slide') || 1) - 1; };
function fit() {
  const W = innerWidth, H = innerHeight, dpr = window.devicePixelRatio || 1;
  if (EXPORT) { scale = 1; K = dpr; return; }
  const portrait = H > W * 1.2; deck.classList.toggle('portrait', portrait);
  if (portrait) {
    scale = W / 1920; const top = Math.round(Math.max(20, H * 0.09));
    stage.style.transform = `translate(-50%,${top}px) scale(${scale})`;
    $('#companion').style.top = Math.round(top + 1080 * scale) + 'px';
  } else { scale = Math.min(W / 1920, H / 1080); stage.style.transform = `translate(-50%,-50%) scale(${scale})`; }
  K = clamp(scale * dpr, 1, 2);
  if (STILL && at >= 0) paintStill();
}

let autoOn = false, autoT = 0;
function armAuto() { clearTimeout(autoT); if (!autoOn) return; autoT = setTimeout(() => { if (at < total - 1) show(at + 1); else setAuto(false); }, (+slides[at].dataset.dwell || 12) * 1000); }
function setAuto(on) { autoOn = on; $('#auto').setAttribute('aria-pressed', String(on)); $('#auto').textContent = on ? 'STOP' : 'AUTO'; armAuto(); }
function fullscreen() { const d = document, el = d.documentElement; if (d.fullscreenElement) d.exitFullscreen(); else if (el.requestFullscreen) el.requestFullscreen().catch(() => {}); }

function boot() {
  const root = document.documentElement;
  if (STILL) root.classList.add('still'); if (EXPORT) root.classList.add('export');
  $$('[data-split]').forEach(split);
  $$('.n').forEach(el => { if (!el.children.length && el.textContent.includes(',')) el.innerHTML = narrowCommas(el.textContent); });
  $('#segs').innerHTML = slides.map((s, k) => `<button type="button" aria-label="Slide ${k + 1}: ${s.dataset.kick || ''}"></button>`).join('');
  $$('#segs button').forEach((b, k) => b.addEventListener('click', e => { e.stopPropagation(); show(k); }));

  // media is optional: the drawn placeholder stays until the real file has actually loaded
  $$('[data-media]').forEach(host => {
    const v = $('video', host), im = $('img', host);
    if (v) { v.muted = true; v.defaultMuted = true; if (STILL) v.controls = true;
      v.addEventListener('loadeddata', () => host.classList.add('has-media'), { once: true }); v.src = v.dataset.src; }
    if (im) { im.addEventListener('load', () => { if (im.naturalWidth > 1) host.classList.add('has-media'); }, { once: true }); im.src = im.dataset.src; }
  });

  fit(); show(clamp(fromHash(), 0, total - 1), !location.hash);
  addEventListener('resize', fit); addEventListener('orientationchange', fit);
  addEventListener('hashchange', () => show(fromHash(), true));
  addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Spacebar', 'Enter'].includes(k)) { e.preventDefault(); show(at + 1); }
    else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(k)) { e.preventDefault(); show(at - 1); }
    else if (k === 'Home') show(0); else if (k === 'End') show(total - 1);
    else if (/^[1-9]$/.test(k)) show(+k - 1); else if (k === '0') show(9);
    else if (k === 'f' || k === 'F') fullscreen(); else if (k === 'a' || k === 'A') setAuto(!autoOn);
  });
  // click or tap anywhere to advance; swipe either way
  let swipedAt = 0, t0 = null;
  const advance = e => { if (Date.now() - swipedAt < 450 || e.target.closest('a,button,video[controls]')) return; show(at + 1); };
  stage.addEventListener('click', advance); $('#companion').addEventListener('click', advance);
  addEventListener('touchstart', e => { const p = e.changedTouches[0]; t0 = [p.clientX, p.clientY]; }, { passive: true });
  addEventListener('touchend', e => {
    if (!t0) return; const p = e.changedTouches[0], dx = p.clientX - t0[0], dy = p.clientY - t0[1]; t0 = null;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4) { swipedAt = Date.now(); show(at + (dx < 0 ? 1 : -1)); }
  }, { passive: true });
  $('#next').onclick = $('#cNext').onclick = e => { e.stopPropagation(); show(at + 1); };
  $('#prev').onclick = $('#cPrev').onclick = e => { e.stopPropagation(); show(at - 1); };
  $('#auto').onclick = () => setAuto(!autoOn); $('#full').onclick = fullscreen;
  // the pointer and the controls step aside when nothing moves
  let idleT = 0; const wake = () => { deck.classList.remove('idle'); clearTimeout(idleT); idleT = setTimeout(() => deck.classList.add('idle'), 2400); };
  deck.classList.add('idle'); addEventListener('mousemove', wake);

  const ready = () => { root.dataset.ready = '1'; if (STILL) paintStill(); };
  (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(() => setTimeout(ready, 60));
  if (STILL) return;
  let last = 0;
  requestAnimationFrame(function frame(ts) {
    const dt = last ? Math.min(0.25, (ts - last) / 1000) : 0; last = ts; T += dt;
    tweens = tweens.filter(tw => { const p = clamp((T - tw.t0) / tw.dur, 0, 1); if (T >= tw.t0) tw.fn(p); return p < 1; });
    canvases.forEach(cv => { if (cv.slide === at) paint(cv, T, dt); });
    requestAnimationFrame(frame);
  });
}
window.P2 = { show: i => show(i), count: () => total, at: () => at };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
