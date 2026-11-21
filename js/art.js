// ================= PROCEDURAL ART =================
// Everything is drawn at runtime on canvases - no external assets.
// Exposed as GH.art, so nothing but the namespace touches the global scope.
(function () {
  const NS = (typeof GH !== 'undefined') ? GH :
             (typeof module !== 'undefined' ? require('./data.js') : globalThis.GH);
  const TAU = NS.tau;

  // Deterministic: the same seed always paints the same textures and sprites.
  function makeRng(seed) {
    let s = (seed >>> 0) || 0x9E3779B9;
    return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  }
  const SPRITE_SEED = 0x9E3779B9;   // enemies/items/fx look the same every run
  let rnd = makeRng(SPRITE_SEED);   // level decor re-seeds this per level
  function setSeed(seed) { rnd = makeRng(seed); }

  function mkc(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function px(g, x, y, w, h, col) { g.fillStyle = col; g.fillRect(x, y, w, h); }

  /* ---- pools: a keyed texture is uploaded to the GPU once, and materials are
     shared by every mesh that uses the same texture + kind. ---- */
  const TEX = new Map();
  const MAT = new Map();

  function tex(c, rep, key, filter) {
    const k = (key || 'anon') + (rep ? '#rep' : '#clamp');
    let t = TEX.get(k);
    if (!t) {
      t = new THREE.CanvasTexture(c);
      // viewmodels are the only art painted above native screen resolution;
      // everything else stays nearest for the chunky retro look.
      t.magFilter = filter || THREE.NearestFilter;
      t.minFilter = filter || THREE.NearestFilter;
      t.encoding = THREE.sRGBEncoding;
      if (rep) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
      t.userData = { key: k };
      TEX.set(k, t);
    }
    return t;
  }

  // kind: 'spr' = billboard sprite, 'quad' = unlit transparent quad,
  //       'lit' = lit quad, 'line' = tracer line
  function mat(t, kind = 'spr') {
    const k = kind + '|' + t.userData.key;
    let m = MAT.get(k);
    if (!m) {
      if (kind === 'spr') m = new THREE.SpriteMaterial({ map: t, alphaTest: 0.35, transparent: true });
      else if (kind === 'quad') m = new THREE.MeshBasicMaterial({ map: t, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, depthWrite: false });
      else if (kind === 'lit') m = new THREE.MeshLambertMaterial({ map: t, side: THREE.DoubleSide });
      else if (kind === 'line') m = new THREE.LineBasicMaterial({ color: 0xffcc66 });
      MAT.set(k, m);
    }
    return m;
  }

  function noise(g, w, h, n, a0, a1, s) {
    for (let i = 0; i < n; i++) { g.globalAlpha = a0 + rnd() * (a1 - a0); g.fillRect(rnd() * w | 0, rnd() * h | 0, s, s); }
    g.globalAlpha = 1;
  }
  // ---- PBR surface sets: albedo + height (turned into a normal map) + roughness ----
  // 128 px tiles so surfaces have real grain. MeshStandardMaterial takes all three
  // maps, which is what makes torch light pool on the stone instead of the flat
  // lambert wash the retro look used.
  const TS = 128;
  const THEMES = {
    hall:  { brick: [74, 38, 32], mortar: [34, 22, 18], metal: [61, 71, 84], accent: '#8a5a3a' },
    crypt: { brick: [52, 54, 60], mortar: [22, 24, 28], metal: [48, 52, 60], accent: '#4a5568' },
    forge: { brick: [66, 44, 30], mortar: [26, 20, 16], metal: [78, 60, 42], accent: '#b06a2a' },
    vault: { brick: [44, 52, 62], mortar: [18, 22, 26], metal: [40, 46, 54], accent: '#2f6b7a' },
    // cistern: damp salt-green stone; bone: pale ash-lime masonry
    cistern: { brick: [46, 62, 66], mortar: [20, 28, 30], metal: [56, 72, 78], accent: '#3f7a86',
               drip: 'rgba(214,226,218,0.20)' },
    bone:    { brick: [86, 82, 72], mortar: [38, 34, 28], metal: [96, 92, 80], accent: '#c8b78a',
               drip: 'rgba(232,222,200,0.16)' },
  };
  function mkSet() {
    const a = mkc(TS, TS), h = mkc(TS, TS), r = mkc(TS, TS);
    return { a, g: a.getContext('2d'), h, hg: h.getContext('2d'), r, rg: r.getContext('2d') };
  }
  // tangent-space normal map from a grayscale height field; sampled with wrap so
  // the map tiles seamlessly across the instanced wall blocks
  function normalMap(hc, strength) {
    const w = hc.width, hh = hc.height;
    const src = hc.getContext('2d').getImageData(0, 0, w, hh).data;
    const out = mkc(w, hh), og = out.getContext('2d');
    const img = og.createImageData(w, hh);
    const at = (x, y) => src[(((y + hh) % hh) * w + ((x + w) % w)) * 4];
    for (let y = 0; y < hh; y++) {
      for (let x = 0; x < w; x++) {
        const nx = (at(x - 1, y) - at(x + 1, y)) * strength / 255;
        const ny = (at(x, y - 1) - at(x, y + 1)) * strength / 255;
        const len = Math.hypot(nx, ny, 1);
        const i = (y * w + x) * 4;
        img.data[i] = ((nx / len) * 0.5 + 0.5) * 255;
        img.data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
        img.data[i + 2] = (1 / len * 0.5 + 0.5) * 255;
        img.data[i + 3] = 255;
      }
    }
    og.putImageData(img, 0, 0);
    return out;
  }
  function pbr(set, key, rep) {
    return {
      map: tex(set.a, rep, key + '#a'),
      normal: tex(normalMap(set.h, 2.6), rep, key + '#n'),
      rough: tex(set.r, rep, key + '#r'),
    };
  }

  function brick(theme) {
    const s = mkSet(), g = s.g, hg = s.hg, rg = s.rg;
    const pal = THEMES[theme] || THEMES.hall;
    const bh = 16, bw = 32;
    g.fillStyle = 'rgb(' + pal.mortar.join(',') + ')'; g.fillRect(0, 0, TS, TS);
    hg.fillStyle = '#202020'; hg.fillRect(0, 0, TS, TS);   // mortar sits low
    rg.fillStyle = '#f0f0f0'; rg.fillRect(0, 0, TS, TS);   // mortar is rough
    for (let y = 0; y < TS / bh; y++) {
      const off = (y % 2) * bw / 2;
      for (let x = -1; x < TS / bw + 1; x++) {
        const x0 = x * bw + off, y0 = y * bh;
        const v = 26 + rnd() * 24;
        g.fillStyle = 'rgb(' + (pal.brick[0] + v) + ',' + (pal.brick[1] + v * 0.55) + ',' + (pal.brick[2] + v * 0.45) + ')';
        g.fillRect(x0 + 2, y0 + 2, bw - 4, bh - 4);
        hg.fillStyle = 'rgb(' + (110 + v) + ',0,0)'; hg.fillRect(x0 + 2, y0 + 2, bw - 4, bh - 4);
        rg.fillStyle = 'rgb(' + (160 + (rnd() * 40 | 0)) + ',0,0)'; rg.fillRect(x0 + 2, y0 + 2, bw - 4, bh - 4);
        g.fillStyle = 'rgba(255,225,190,0.10)'; g.fillRect(x0 + 2, y0 + 2, bw - 4, 2);
        g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(x0 + 2, y0 + bh - 4, bw - 4, 2);
        for (let i = 0; i < 4; i++) {                        // pits in the face
          const px0 = x0 + 3 + (rnd() * (bw - 6) | 0), py0 = y0 + 3 + (rnd() * (bh - 6) | 0);
          g.fillStyle = 'rgba(0,0,0,0.32)'; g.fillRect(px0, py0, 2, 2);
          hg.fillStyle = '#404040'; hg.fillRect(px0, py0, 2, 2);
        }
      }
    }
    noise(g, TS, TS, 220, 0.05, 0.16, 2);
    g.fillStyle = pal.drip || 'rgba(10,6,4,0.35)';
    for (let i = 0; i < 8; i++) g.fillRect(rnd() * TS | 0, 0, 2 + rnd() * 3 | 0, 30 + rnd() * 90 | 0);
    g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      g.beginPath(); let x = rnd() * TS | 0, y = rnd() * 60 | 0;
      g.moveTo(x, y);
      for (let s2 = 0; s2 < 6; s2++) { x += rnd() * 10 - 5; y += 8 + rnd() * 8; g.lineTo(x, y); }
      g.stroke();
    }
    return s;
  }
  function metal(theme) {
    const s = mkSet(), g = s.g, hg = s.hg, rg = s.rg;
    const pal = THEMES[theme] || THEMES.hall;
    g.fillStyle = 'rgb(' + pal.metal.join(',') + ')'; g.fillRect(0, 0, TS, TS);
    hg.fillStyle = '#808080'; hg.fillRect(0, 0, TS, TS);
    rg.fillStyle = '#606060'; rg.fillRect(0, 0, TS, TS);    // bare steel is fairly smooth
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
      const x0 = x * 64, y0 = y * 64, v = 12 + rnd() * 20;
      g.fillStyle = 'rgb(' + (pal.metal[0] + v) + ',' + (pal.metal[1] + v) + ',' + (pal.metal[2] + v) + ')';
      g.fillRect(x0 + 3, y0 + 3, 58, 58);
      hg.fillStyle = '#b0b0b0'; hg.fillRect(x0 + 3, y0 + 3, 58, 58);
      g.fillStyle = 'rgba(255,255,255,0.10)'; g.fillRect(x0 + 3, y0 + 3, 58, 3);
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x0 + 3, y0 + 60, 58, 2);
      hg.fillStyle = '#303030'; hg.fillRect(x0 + 3, y0 + 60, 58, 2);   // seam is a groove
      for (let i = 6; i < 60; i += 12) {                              // rivets
        g.fillStyle = '#8a94a2'; g.beginPath(); g.arc(x0 + i, y0 + 8, 3, 0, TAU); g.fill();
        g.beginPath(); g.arc(x0 + i, y0 + 56, 3, 0, TAU); g.fill();
        hg.fillStyle = '#e0e0e0';
        hg.beginPath(); hg.arc(x0 + i, y0 + 8, 3, 0, TAU); hg.fill();
        hg.beginPath(); hg.arc(x0 + i, y0 + 56, 3, 0, TAU); hg.fill();
        rg.fillStyle = '#303030';
        rg.beginPath(); rg.arc(x0 + i, y0 + 8, 3, 0, TAU); rg.fill();
        rg.beginPath(); rg.arc(x0 + i, y0 + 56, 3, 0, TAU); rg.fill();
      }
    }
    // rust blooms roughen the surface and darken it
    for (let i = 0; i < 10; i++) {
      const x = rnd() * TS, y = rnd() * TS, rr2 = 6 + rnd() * 14;
      g.fillStyle = 'rgba(120,58,26,0.45)';
      g.beginPath(); g.arc(x, y, rr2, 0, TAU); g.fill();
      rg.fillStyle = '#d8d8d8';
      rg.beginPath(); rg.arc(x, y, rr2, 0, TAU); rg.fill();
      hg.fillStyle = '#606060';
      hg.beginPath(); hg.arc(x, y, rr2, 0, TAU); hg.fill();
    }
    px(g, 68, 88, 52, 16, '#8a7420');
    g.fillStyle = '#14181e';
    for (let x = 70; x < 118; x += 16) { g.beginPath(); g.moveTo(x, 104); g.lineTo(x + 8, 88); g.lineTo(x + 16, 88); g.lineTo(x + 8, 104); g.fill(); }
    noise(g, TS, TS, 160, 0.06, 0.2, 2);
    return s;
  }
  function door(theme) {
    const s = mkSet(), g = s.g, hg = s.hg, rg = s.rg;
    g.fillStyle = '#241a12'; g.fillRect(0, 0, TS, TS);
    hg.fillStyle = '#404040'; hg.fillRect(0, 0, TS, TS);
    rg.fillStyle = '#b4b4b4'; rg.fillRect(0, 0, TS, TS);
    for (let i = 0; i < 5; i++) {                            // planks
      const x0 = 12 + i * 21, v = 18 + rnd() * 22;
      g.fillStyle = 'rgb(' + (92 + v) + ',' + (69 + v * 0.6) + ',' + (38 + v * 0.4) + ')';
      g.fillRect(x0, 8, 19, 112);
      hg.fillStyle = 'rgb(' + (140 + v) + ',0,0)'; hg.fillRect(x0, 8, 19, 112);
      g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(x0 + 19, 8, 2, 112);
      hg.fillStyle = '#181818'; hg.fillRect(x0 + 19, 8, 2, 112);
      g.strokeStyle = 'rgba(20,12,6,0.5)'; g.lineWidth = 1;
      for (let k = 0; k < 4; k++) {
        const y = 12 + rnd() * 100;
        g.beginPath(); g.moveTo(x0 + 1, y); g.lineTo(x0 + 18, y + (rnd() - 0.5) * 4); g.stroke();
      }
    }
    for (const y0 of [22, 74]) {                            // iron bands
      g.fillStyle = '#3a4049'; g.fillRect(6, y0, 116, 10);
      hg.fillStyle = '#c0c0c0'; hg.fillRect(6, y0, 116, 10);
      g.fillStyle = 'rgba(255,255,255,0.14)'; g.fillRect(6, y0, 116, 2);
      rg.fillStyle = '#404040'; rg.fillRect(6, y0, 116, 10);
      for (let x = 12; x < 118; x += 20) {
        g.fillStyle = '#8a94a2'; g.beginPath(); g.arc(x, y0 + 5, 3, 0, TAU); g.fill();
        hg.beginPath(); hg.arc(x, y0 + 5, 3, 0, TAU); hg.fill();
      }
    }
    // handle: brass knob with a shadowed recess
    g.fillStyle = '#b8b0a0'; g.beginPath(); g.arc(92, 60, 8, 0, TAU); g.fill();
    hg.fillStyle = '#e0e0e0'; hg.beginPath(); hg.arc(92, 60, 8, 0, TAU); hg.fill();
    g.fillStyle = '#222'; g.beginPath(); g.arc(92, 60, 3.5, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,240,200,0.5)'; g.beginPath(); g.arc(89, 57, 2.4, 0, TAU); g.fill();
    rg.fillStyle = '#202020'; rg.beginPath(); rg.arc(92, 60, 8, 0, TAU); rg.fill();
    px(g, 14, 14, 24, 12, '#7a1f1f'); px(g, 18, 17, 16, 6, '#e8d75a');
    noise(g, TS, TS, 90, 0.08, 0.22, 2);
    return s;
  }
  function floor(theme) {
    const s = mkSet(), g = s.g, hg = s.hg, rg = s.rg;
    const pal = THEMES[theme] || THEMES.hall;
    g.fillStyle = 'rgb(' + pal.mortar.join(',') + ')'; g.fillRect(0, 0, TS, TS);
    hg.fillStyle = '#202020'; hg.fillRect(0, 0, TS, TS);
    rg.fillStyle = '#d0d0d0'; rg.fillRect(0, 0, TS, TS);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const v = 22 + rnd() * 20;
      g.fillStyle = 'rgb(' + (pal.brick[0] + v) + ',' + (pal.brick[1] + v) + ',' + (pal.brick[2] + v + 4) + ')';
      g.fillRect(x * 32 + 2, y * 32 + 2, 28, 28);
      hg.fillStyle = 'rgb(' + (100 + v * 2) + ',0,0)'; hg.fillRect(x * 32 + 2, y * 32 + 2, 28, 28);
      // wear: the centre of each flagstone is polished smooth and reflects more
      const wg = g.createRadialGradient(x * 32 + 16, y * 32 + 16, 2, x * 32 + 16, y * 32 + 16, 14);
      wg.addColorStop(0, 'rgba(255,255,255,0.10)'); wg.addColorStop(1, 'rgba(0,0,0,0.10)');
      g.fillStyle = wg; g.fillRect(x * 32 + 2, y * 32 + 2, 28, 28);
      rg.fillStyle = 'rgba(0,0,0,0.45)';
      rg.beginPath(); rg.arc(x * 32 + 16, y * 32 + 16, 9, 0, TAU); rg.fill();
    }
    noise(g, TS, TS, 200, 0.05, 0.18, 2);
    g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 1;
    for (let i = 0; i < 5; i++) { g.beginPath(); let x = rnd() * TS, y = rnd() * TS; g.moveTo(x, y); for (let k = 0; k < 4; k++) { x += rnd() * 12 - 6; y += rnd() * 12 - 6; g.lineTo(x, y); } g.stroke(); }
    return s;
  }
  function ceil(theme) {
    const s = mkSet(), g = s.g, hg = s.hg, rg = s.rg;
    g.fillStyle = '#1c1a18'; g.fillRect(0, 0, TS, TS);
    hg.fillStyle = '#606060'; hg.fillRect(0, 0, TS, TS);
    rg.fillStyle = '#c8c8c8'; rg.fillRect(0, 0, TS, TS);
    for (let i = 0; i < 4; i++) {
      const y0 = i * 32, v = 10 + rnd() * 14;
      g.fillStyle = 'rgb(' + (28 + v) + ',' + (24 + v) + ',' + (20 + v) + ')';
      g.fillRect(0, y0 + 2, TS, 28);
      hg.fillStyle = 'rgb(' + (110 + v * 2) + ',0,0)'; hg.fillRect(0, y0 + 2, TS, 28);
      g.fillStyle = 'rgba(0,0,0,0.4)'; g.fillRect(0, y0 + 30, TS, 2);
      hg.fillStyle = '#202020'; hg.fillRect(0, y0 + 30, TS, 2);
    }
    noise(g, TS, TS, 120, 0.05, 0.15, 2);
    return s;
  }
  // ---- enemy sprites: articulated, gradient-shaded humanoids ----
  // Four views x two walk frames, painted with the same part kit the guns use, so
  // enemies share the light direction, outline weight and wear marks instead of
  // being stamped out of 4px blocks.
  function ramp(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    return '#' + [16, 8, 0].map(s => Math.min(255, Math.max(0, Math.round(((n >> s) & 255) * k)))
      .toString(16).padStart(2, '0')).join('');
  }
  // a limb: a shaded bar between two points, rounded at both ends
  function seg(g, x0, y0, x1, y1, wid, lit, mid, dark, mat) {
    part(g, (x0 + x1) / 2, (y0 + y1) / 2, Math.hypot(x1 - x0, y1 - y0), wid,
      Math.atan2(y1 - y0, x1 - x0), wid * 0.4, lit, mid, dark, mat);
  }
  // a tapered panel (torso, helmet, pack), lit from the upper left
  function panel(g, x0, y0, x1, y1, taper, lit, mid, dark, mat) {
    const inset = taper * (x1 - x0);
    g.beginPath();
    g.moveTo(x0, y0); g.lineTo(x1, y0); g.lineTo(x1 - inset, y1); g.lineTo(x0 + inset, y1);
    g.closePath();
    const gr = g.createLinearGradient(x0, y0, x1, y1);
    gr.addColorStop(0, lit); gr.addColorStop(0.42, mid); gr.addColorStop(1, dark);
    g.fillStyle = gr; g.fill();
    g.lineWidth = 2.2; g.strokeStyle = OUTLINE; g.stroke();
    if (mat === 'cloth') {
      g.lineWidth = 1; g.strokeStyle = 'rgba(14,16,20,0.26)';
      for (let i = 0; i < 5; i++) {
        const y = y0 + 3 + rnd() * Math.max(1, y1 - y0 - 6);
        g.beginPath(); g.moveTo(x0 + 2, y); g.lineTo(x1 - 2, y + (rnd() - 0.5) * 4); g.stroke();
      }
    }
  }
  function blob(g, cx, cy, rx, ry, lit, mid, dark) {
    g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, TAU);
    const gr = g.createLinearGradient(cx - rx, cy - ry, cx + rx, cy + ry);
    gr.addColorStop(0, lit); gr.addColorStop(0.5, mid); gr.addColorStop(1, dark);
    g.fillStyle = gr; g.fill();
    g.lineWidth = 2; g.strokeStyle = OUTLINE; g.stroke();
  }
  // A figure is authored facing the camera (front/back) or to the left (profile).
  // bulk scales the body, frame 0/1 is the stride.
  function enemyFigure(W, H, view, fr, p, pose) {
    const c = mkc(W, H), g = c.getContext('2d');
    const B = p.bulk, HB = 1 + (B - 1) * 0.35, cx = W / 2;
    const profile = view === 'l' || view === 'r';
    const SK = [ramp(p.skin, 1.26), p.skin, ramp(p.skin, 0.60)];
    const CL = [ramp(p.cloth, 1.22), p.cloth, ramp(p.cloth, 0.56)];
    const HT = [ramp(p.hat, 1.32), p.hat, ramp(p.hat, 0.52)];
    const BT = [ramp(p.boot, 1.20), p.boot, ramp(p.boot, 0.48)];
    const MT = [ramp(p.metal, 1.40), p.metal, ramp(p.metal, 0.45)];
    const AC = [ramp(p.accent, 1.30), p.accent, ramp(p.accent, 0.55)];
    const headY = 22, headRx = 10.5 * HB, headRy = 12.5 * HB;
    const shY = 35, shW = 22 * B * (profile ? 0.62 : 1);
    const waistY = 72, waistW = 16.5 * B;
    // pose 1 = attack telegraph: hips drop, weight goes onto the front foot
    const lunge = pose ? 5 : 0, crouch = pose ? 5 : 0;
    const hipY = 80 + crouch * 0.5, kneeY = 102 + crouch, footY = 124;
    if (view === 'r') { g.translate(W, 0); g.scale(-1, 1); }

    // legs: the stride swings one leg forward, the other back
    for (const s of [-1, 1]) {
      const fwd = pose ? (profile ? -1 : s * 0.7) : (s === (fr ? 1 : -1) ? -1 : 1);
      const hx = cx + (profile ? 0 : s * waistW * 0.5) - lunge * (profile ? 1 : 0);
      const kx = hx + fwd * (profile ? 10 : 4);
      const ky = kneeY - (fwd < 0 ? 2 : 0);
      const fx = kx + fwd * 6, fy = footY - (fwd < 0 ? 5 : 0);
      seg(g, hx, hipY - 6, kx, ky, 13 * B, CL[0], CL[1], CL[2], 'cloth');
      seg(g, kx, ky, fx, fy - 3, 10 * B, CL[0], CL[1], CL[2], 'cloth');
      part(g, fx + 5, fy - 2, 22, 9, 0, 3, BT[0], BT[1], BT[2], 'metal');
    }
    // upper body: an attack pose leans it toward the target
    g.save();
    if (pose) g.translate(-lunge, 2);
    // torso, belt, shoulder pads
    panel(g, cx - shW, shY, cx + shW, waistY + 6, 0.14, CL[0], CL[1], CL[2], 'cloth');
    part(g, cx, waistY + 4, 2 * waistW + 8, 7, 0, 2, BT[0], BT[1], BT[2], 'metal');
    part(g, cx, waistY + 4, 8, 7, 0, 2, AC[0], AC[1], AC[2], 'metal');
    for (const s of [-1, 1])
      part(g, cx + s * shW * 0.86, shY + 1, 15, 10, s * 0.4, 4, HT[0], HT[1], HT[2], 'metal');

    // arms + weapon
    if (view === 'b') {
      panel(g, cx - shW * 0.72, shY + 8, cx + shW * 0.72, waistY - 2, 0.08, CL[1], CL[2], ramp(p.cloth, 0.42), 'cloth');
      seg(g, cx - 24, waistY - 8, cx + 16, shY + 8, 7, MT[0], MT[1], MT[2], 'metal');
      seg(g, cx + 16, shY + 8, cx + 26, shY + 16, 9, WOOD_L, WOOD, WOOD_D, 'wood');
      for (const s of [-1, 1])
        seg(g, cx + s * shW * 0.8, shY + 6, cx + s * shW * 0.95, waistY - 8, 10 * B, CL[0], CL[1], CL[2], 'cloth');
    } else {
      // the attack pose raises the rifle to shoulder height and braces it
      const by = shY + (pose ? 10 : 24), ex = cx - (profile ? 20 : 14) - (pose ? 6 : 0);
      const bx = cx - (profile ? 40 : 30) - (pose ? 6 : 0);
      seg(g, cx - shW * 0.7, shY + 6, ex, by - 2, 10 * B, CL[0], CL[1], CL[2], 'cloth');
      seg(g, cx + shW * 0.7, shY + 6, cx + 10, by + 8, 10 * B, CL[0], CL[1], CL[2], 'cloth');
      seg(g, bx, by, cx + 8, by + 6, 7, MT[0], MT[1], MT[2], 'metal');
      seg(g, cx + 8, by + 6, cx + 22, by + 14, 9, WOOD_L, WOOD, WOOD_D, 'wood');
      part(g, ex, by - 2, 12, 9, 0.2, 3, SK[0], SK[1], SK[2], 'skin');
      part(g, cx + 10, by + 8, 11, 9, 0.4, 3, SK[0], SK[1], SK[2], 'skin');
    }

    // head
    blob(g, cx, headY, headRx, headRy, SK[0], SK[1], SK[2]);
    if (p.helm) {
      panel(g, cx - headRx - 2, headY - headRy - 4, cx + headRx + 2, headY - 2, 0.05, HT[0], HT[1], HT[2], 'metal');
      g.lineWidth = 2; g.strokeStyle = 'rgba(255,255,255,0.22)';
      g.beginPath(); g.arc(cx - 2, headY - 6, headRx * 0.8, Math.PI * 1.1, Math.PI * 1.7); g.stroke();
    } else {
      panel(g, cx - headRx - 1, headY - headRy - 2, cx + headRx + 1, headY - 4, 0.04, HT[0], HT[1], HT[2], 'cloth');
    }
    if (p.horns) {
      for (const s of [-1, 1])
        seg(g, cx + s * (headRx + 1), headY - headRy, cx + s * (headRx + 8), headY - headRy - 10, 5, AC[0], AC[1], AC[2], 'metal');
    }
    if (view === 'f') {
      for (const s of [-1, 1]) {
        const ex = cx + s * headRx * 0.42, ey = headY + 4;
        blob(g, ex, ey, 2.8, 2.1, '#1a1c22', '#101216', '#080a0e');
        g.beginPath(); g.ellipse(ex - 0.7, ey - 0.6, 1.2, 0.9, 0, 0, TAU);
        g.fillStyle = p.eye; g.fill();
      }
      g.strokeStyle = 'rgba(24,16,10,0.45)'; g.lineWidth = 1.6;
      g.beginPath(); g.moveTo(cx - 4, headY + 1); g.lineTo(cx + 4, headY + 1); g.stroke();
      g.beginPath(); g.moveTo(cx, headY + 5); g.lineTo(cx, headY + 9); g.stroke();
      g.beginPath(); g.moveTo(cx - 3, headY + 10); g.lineTo(cx + 3, headY + 10); g.stroke();
    }
    g.restore();
    return c;
  }
  // all four views x two frames for one enemy type, cached as textures
  function enemySprites(pal, W, H, key) {
    const out = {};
    for (const view of ['f', 'b', 'l', 'r']) {
      out[view] = [0, 1].map(fr => {
        const c = enemyFigure(W, H, view, fr, pal, 0);
        return { walk: tex(c, false, key + view + fr), flash: tex(flashify(c), false, key + view + fr + 'f') };
      });
      const a = enemyFigure(W, H, view, 0, pal, 1);
      out[view].atk = { walk: tex(a, false, key + view + 'a'), flash: tex(flashify(a), false, key + view + 'af') };
    }
    return out;
  }
  function flashify(c) { // white hit-flash variant
    const f = mkc(c.width, c.height), g = f.getContext('2d');
    g.drawImage(c, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = 'rgba(255,240,220,0.92)'; g.fillRect(0, 0, c.width, c.height);
    return f;
  }
  // ---- item sprites (64x64) ----
  function itemGun(kind) {
    const c = mkc(64, 64), g = c.getContext('2d');
    if (kind === 'sg') { // shotgun: wooden + double barrel
      px(g, 10, 26, 44, 10, '#5c3a1e'); px(g, 10, 26, 44, 3, '#7a5230');
      px(g, 14, 14, 36, 13, '#26262c'); px(g, 14, 14, 36, 4, '#3a3a44');
      px(g, 22, 10, 6, 6, '#111'); px(g, 32, 10, 6, 6, '#111');
    } else { // machine gun: boxy + drum
      px(g, 12, 24, 40, 20, '#2e3138'); px(g, 12, 24, 40, 5, '#454a55');
      px(g, 24, 12, 16, 12, '#1c1e24'); px(g, 20, 44, 24, 12, '#22242a');
      g.fillStyle = '#565c68'; g.beginPath(); g.arc(32, 50, 9, 0, 7); g.fill();
      px(g, 30, 8, 4, 8, '#111');
    }
    return c;
  }
  function itemBox(kind) { // ammo
    const c = mkc(64, 64), g = c.getContext('2d');
    px(g, 14, 22, 36, 26, kind === 'sg' ? '#5c3a1e' : '#2e3138');
    px(g, 14, 22, 36, 5, kind === 'sg' ? '#7a5230' : '#454a55');
    px(g, 20, 30, 24, 10, '#c9b458');
    g.fillStyle = '#3a2c10'; g.font = 'bold 10px monospace'; g.textAlign = 'center';
    g.fillText(kind === 'sg' ? '12G' : 'MG', 32, 38);
    return c;
  }
  function itemHealth(big) {
    const c = mkc(64, 64), g = c.getContext('2d');
    px(g, 16, 16, 32, 32, '#d8d8d8'); px(g, 16, 16, 32, 4, '#ffffff'); px(g, 16, 44, 32, 4, '#9a9a9a');
    px(g, 27, 21, 10, big ? 22 : 16, '#c02020'); px(g, big ? 21 : 24, 27, big ? 22 : 16, 10, '#c02020');
    return c;
  }
  function itemArmor() {
    const c = mkc(64, 64), g = c.getContext('2d');
    px(g, 14, 14, 36, 36, '#3f5a2f'); px(g, 14, 14, 36, 6, '#557a42'); px(g, 14, 44, 36, 6, '#2c401f');
    px(g, 22, 14, 6, 20, '#2c401f'); px(g, 36, 14, 6, 20, '#2c401f'); // straps
    px(g, 14, 26, 36, 4, '#c9c9c9'); px(g, 29, 24, 6, 8, '#8a8a8a');   // zipper + buckle
    noise(g, 64, 64, 30, 0.05, 0.16, 2);
    return c;
  }
  // soft contact shadow that grounds a billboard sprite on the floor
  function shadowBlob() {
    const c = mkc(64, 64), g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    gr.addColorStop(0, 'rgba(0,0,0,0.8)');
    gr.addColorStop(0.55, 'rgba(0,0,0,0.38)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return c;
  }
  // ---- torch flame: 3 flicker frames ----
  function flameFrames() {
    return [0, 1, 2].map(i => {
      const c = mkc(32, 48), g = c.getContext('2d');
      const w = [10, 13, 9][i], h = [30, 38, 26][i];
      g.fillStyle = '#ff9a2a';
      g.beginPath(); g.moveTo(16 - w / 2, 46); g.quadraticCurveTo(16 - w, 46 - h * 0.6, 16 + (i - 1) * 2, 46 - h); g.quadraticCurveTo(16 + w, 46 - h * 0.6, 16 + w / 2, 46); g.fill();
      g.fillStyle = '#ffe98a';
      g.beginPath(); g.moveTo(16 - w / 4, 46); g.quadraticCurveTo(16 - w / 2, 46 - h * 0.4, 16, 46 - h * 0.65); g.quadraticCurveTo(16 + w / 2, 46 - h * 0.4, 16 + w / 4, 46); g.fill();
      return c;
    });
  }
  // ---- weapon viewmodels ----
  // Authored in a 128 x 96 design frame but painted at 2x. The viewmodel quad
  // is 0.50 x 0.375 world units at z = -0.5, which lands ~206 x 154 px on the
  // 480 x 300 buffer - a 128 x 96 sprite stretched that far turns every thin
  // stroke into mush, so each design unit is painted as SUP device pixels.
  const VW = 128, VH = 96, SUP = 2;
  const STEEL = '#47505c', STEEL_L = '#788391', STEEL_X = '#a3b0bd',
        STEEL_D = '#272d35', STEEL_DD = '#181c22', STEEL_E = '#0d1014';
  const WOOD = '#6b4423', WOOD_L = '#8d5c31', WOOD_D = '#3c2713', WOOD_DD = '#241609';
  const SKIN = '#c98b5e', SKIN_L = '#e0a878', SKIN_D = '#8c5b38', SKIN_E = '#5b3a20';
  const SUIT = '#5b5341', SUIT_L = '#7c7259', SUIT_D = '#373125';   // uniform sleeve
  const BRASS = '#c9b458', BRASS_L = '#e8d493';
  const EDGE = '#bcc7d4';                    // bright silhouette edge: the gun pops on dark walls
  const OUTLINE = '#12161d';                 // crisp dark edge on every part
  const SHADOW = [3.4, 2.4];                 // cast-shadow offset in design px: light from the upper left
  // muzzle pixel (design px) + bloom radius, consumed by main.js
  const MUZZLE = [[18, 30], [16, 32], [16, 28]];
  const MUZANG = [0.35, 0.32, 0.34];           // barrel axis, for the flash plume
  const FLASHR = [12, 14, 11];

  // Every gun is authored in a rotated frame: muzzle upper-left, barrel axis
  // running down-right into the hand. at(t, s) is the point t px along the axis
  // and s px across it (s > 0 is the underside, where the grip lives).
  function at(mx, my, a, t, s) {
    const ca = Math.cos(a), sa = Math.sin(a);
    return [mx + t * ca - s * sa, my + t * sa + s * ca];
  }

  // rounded-rect path in the current transform
  function rr(g, x0, y0, x1, y1, r) {
    r = Math.max(0, Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2));
    g.beginPath();
    g.moveTo(x0 + r, y0);
    g.lineTo(x1 - r, y0);
    g.arcTo(x1, y0, x1, y0 + r, r);
    g.lineTo(x1, y1 - r);
    g.arcTo(x1, y1, x1 - r, y1, r);
    g.lineTo(x0 + r, y1);
    g.arcTo(x0, y1, x0, y1 - r, r);
    g.lineTo(x0, y0 + r);
    g.arcTo(x0, y0, x0 + r, y0, r);
    g.closePath();
  }

  // one solid part, shaded like a real object rather than three flat bands: a
  // gradient body from the lit face to the shadow side, a broken specular streak
  // where the light catches the machined surface, a cast shadow that lands only
  // on parts already painted, and a crisp outline. The lit face is picked per
  // part so the light always comes from the upper-left, even on the near-vertical
  // grip and hand. mat: 'wood' paints grain, 'skin' softens the ramp.
  function part(g, cx, cy, len, wid, ang, r, lit, mid, dark, mat) {
    if (Math.sin(ang) > Math.cos(ang)) { const t = lit; lit = dark; dark = t; }
    g.save();
    g.translate(cx, cy); g.rotate(ang);
    // cast shadow, clipped to what is already there, so parts shade each other
    g.globalCompositeOperation = 'source-atop';
    rr(g, -len / 2 + SHADOW[0], -wid / 2 + SHADOW[1], len / 2 + SHADOW[0], wid / 2 + SHADOW[1], r);
    g.fillStyle = 'rgba(8,10,14,0.40)'; g.fill();
    g.globalCompositeOperation = 'source-over';
    rr(g, -len / 2, -wid / 2, len / 2, wid / 2, r);
    g.lineWidth = 2.2; g.strokeStyle = OUTLINE; g.stroke();   // dark edge, keeps parts separated
    const body = g.createLinearGradient(0, -wid / 2, 0, wid / 2);
    body.addColorStop(0, lit);
    body.addColorStop(mat === 'skin' ? 0.45 : 0.30, mid);
    body.addColorStop(0.86, dark);
    body.addColorStop(1, dark);
    g.fillStyle = body; g.fill();
    // specular streak: brightest mid-length, fading off both ends
    if (wid >= 8) {
      const sp = Math.max(1.6, wid * 0.24);
      const sg = g.createLinearGradient(-len / 2, 0, len / 2, 0);
      sg.addColorStop(0, 'rgba(255,255,255,0.04)');
      sg.addColorStop(0.42, 'rgba(255,255,255,0.22)');
      sg.addColorStop(1, 'rgba(255,255,255,0.05)');
      rr(g, -len / 2 + r, -wid / 2 + 0.6, len / 2 - r, -wid / 2 + 0.6 + sp, 1.2);
      g.fillStyle = sg; g.fill();
    }
    if (mat === 'wood' || mat === 'cloth') {                   // grain / sleeve folds along the length
      g.lineWidth = 1;
      g.strokeStyle = mat === 'wood' ? 'rgba(18,10,5,0.40)' : 'rgba(14,16,20,0.30)';
      for (let i = 0; i < 6; i++) {
        const y = -wid / 2 + 2 + rnd() * (wid - 4);
        g.beginPath(); g.moveTo(-len / 2 + 1, y);
        g.lineTo(len / 2 - 1, y + (rnd() - 0.5) * 3.4); g.stroke();
      }
    }
    // worn edges: a few bright micro-scratches on the lit face
    g.lineWidth = 0.8; g.strokeStyle = 'rgba(214,226,238,0.30)';
    for (let i = 0; i < 3; i++) {
      const x = -len / 2 + r + rnd() * Math.max(0, len - 2 * r);
      g.beginPath(); g.moveTo(x, -wid / 2 + 1.2);
      g.lineTo(x + 2 + rnd() * 3, -wid / 2 + 2.6); g.stroke();
    }
    g.restore();
  }

  // a flat machined face (slide top, receiver flank): chamfer, then a gradient
  // that runs along the part so the near end reads brighter than the far end
  function face(g, cx, cy, len, wid, ang, lit, mid, dark) {
    g.save();
    g.translate(cx, cy); g.rotate(ang);
    rr(g, -len / 2, -wid / 2, len / 2, wid / 2, 2);
    g.lineWidth = 2; g.strokeStyle = OUTLINE; g.stroke();
    const fg = g.createLinearGradient(-len / 2, 0, len / 2, 0);
    fg.addColorStop(0, lit); fg.addColorStop(1, mid);
    g.fillStyle = fg; g.fill();
    g.fillStyle = 'rgba(0,0,0,0.28)';
    g.fillRect(-len / 2, wid / 2 - 2, len, 2);
    g.restore();
  }

  // open loop (trigger guard): stroked only, so the space inside stays empty
  function guard(g, cx, cy, len, wid, ang, w, col) {
    g.save();
    g.translate(cx, cy); g.rotate(ang);
    rr(g, -len / 2, -wid / 2, len / 2, wid / 2, wid / 2);
    g.lineWidth = w; g.strokeStyle = col; g.stroke();
    g.restore();
  }

  // fingers wrapped around the grip: bands stacked along the grip axis
  // fingers wrapped around the grip: each is a separate knuckle with a ridge
  // catching the light and a shadow falling between it and the next finger
  function fingers(g, cx, cy, ang, n, len, wid) {
    for (let i = 0; i < n; i++) {
      const t = (i - (n - 1) / 2) * (wid + 1.6);
      const fx = cx + Math.cos(ang) * t, fy = cy + Math.sin(ang) * t;
      part(g, fx, fy, len, wid, ang + Math.PI / 2, 3, SKIN_L, SKIN, SKIN_D, 'skin');
      g.save(); g.translate(fx, fy); g.rotate(ang + Math.PI / 2);
      g.lineWidth = 1.4; g.strokeStyle = 'rgba(255,214,180,0.34)';
      g.beginPath(); g.arc(0, -wid / 2 + 3.4, wid * 0.55, Math.PI * 1.15, Math.PI * 1.85); g.stroke();
      g.restore();
    }
  }

  function line(g, x0, y0, x1, y1, w, col) {
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1);
    g.lineWidth = w; g.strokeStyle = col; g.stroke();
  }

  // a cut-away recess (ejection port, action opening, cooling slot): a dark inner
  // rectangle with a lit lip on the side facing the light
  function recess(g, cx, cy, len, wid, ang, inner) {
    g.save();
    g.translate(cx, cy); g.rotate(ang);
    rr(g, -len / 2, -wid / 2, len / 2, wid / 2, 1.6);
    g.fillStyle = inner || STEEL_E; g.fill();
    g.fillStyle = 'rgba(190,200,212,0.30)';
    g.fillRect(-len / 2, -wid / 2, len, 1.4);
    g.restore();
  }

  // muzzle face seen end-on: chamfered rim, deep bore, inner wall catching light,
  // hot glow down the barrel while firing
  function muzzleFace(g, mx, my, ang, wid, len, bores, hot) {
    const r = wid / 2;
    g.save();
    g.translate(mx, my); g.rotate(ang);
    g.lineWidth = 2.2; g.strokeStyle = OUTLINE; g.fillStyle = STEEL_L;
    g.beginPath(); g.ellipse(0, 0, r * 0.55, r, 0, 0, TAU); g.fill(); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.16)';
    g.beginPath(); g.ellipse(-r * 0.16, -r * 0.26, r * 0.30, r * 0.46, 0, 0, TAU); g.fill();
    for (let i = 0; i < bores; i++) {
      const s = bores === 1 ? 0 : (i - 0.5) * wid * 0.46;
      const br = bores === 1 ? r * 0.62 : r * 0.36;
      g.fillStyle = STEEL_E;
      g.beginPath(); g.ellipse(s * 0.4, s, br * 0.5, br, 0, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(122,134,148,0.55)'; g.lineWidth = 1;
      g.beginPath(); g.ellipse(s * 0.4, s, br * 0.5, br, 0, Math.PI * 1.05, Math.PI * 1.95); g.stroke();
      if (hot) {
        g.fillStyle = 'rgba(255,170,70,0.55)';
        g.beginPath(); g.ellipse(s * 0.4, s, br * 0.42, br * 0.8, 0, 0, TAU); g.fill();
      }
    }
    g.restore();
  }
  // checkered grip panel, painted in the grip's own rotated frame
  function checker(g, x0, x1, y0, y1, col) {
    for (let y = y0; y < y1; y += 4)
      for (let x = x0; x < x1; x += 4)
        if (((x >> 2) + (y >> 2)) % 2 === 0) px(g, x, y, 4, 4, col);
  }

  // the arm: a uniform sleeve running from the bottom-right corner of the frame
  // (off-screen) up to the hand, so the arm never ends in mid-air inside the quad
  function forearm(g, hx, hy) {
    const dx = 138 - hx, dy = 104 - hy, a = Math.atan2(dy, dx);
    part(g, hx + dx * 0.58, hy + dy * 0.58, Math.hypot(dx, dy) + 14, 26, a, 9, SUIT_L, SUIT, SUIT_D, 'cloth');
  }

  // the cuff where the hand comes out of the sleeve
  function cuff(g, hx, hy) {
    const dx = 138 - hx, dy = 104 - hy, a = Math.atan2(dy, dx);
    part(g, hx + dx * 0.2, hy + dy * 0.2, 12, 28, a, 5, SUIT_L, SUIT_D, SUIT_D, 'cloth');
  }

  // a compact flash painted on the muzzle itself, so the bloom always looks
  // anchored to the barrel and rides with the recoil
  function spriteFlash(g, mx, my, ang) {
    g.save();
    g.translate(mx, my);
    g.rotate(ang);
    g.fillStyle = '#ffd9a0';
    g.beginPath(); g.arc(0, 0, 6, 0, TAU); g.fill();
    g.fillStyle = '#ffb35c';
    g.beginPath(); g.moveTo(-2, -4); g.lineTo(17, 0); g.lineTo(-2, 4); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(-2, -4); g.lineTo(-13, 0); g.lineTo(-2, 4); g.closePath(); g.fill();
    g.fillStyle = '#fff4e2';
    g.beginPath(); g.arc(0, 0, 3, 0, TAU); g.fill();
    g.restore();
  }

  function pistolView(g, fire) {
    const A = 0.35, M = [18, 30];              // shallow barrel angle, muzzle at the left
    const p = (t, s) => at(M[0], M[1], A, t, s);
    const GA = A + 1.15;                       // grip axis, hanging down-right
    const gp = p(68, 24);                      // grip centre
    const hm = p(88, 34);                      // palm, tucked into the bottom-right corner
    forearm(g, hm[0], hm[1]);
    // barrel poking out of the slide, tapering toward the muzzle
    part(g, ...p(26, 0), 28, 11, A, 3, STEEL_L, STEEL, STEEL_D);
    // the slide: a machined block, flat on top, chamfered at the nose
    part(g, ...p(56, 0), 52, 26, A, 5, STEEL_L, STEEL, STEEL_D);
    face(g, ...p(54, -12), 48, 7, A, STEEL_X, STEEL_L, STEEL_D);
    muzzleFace(g, M[0], M[1], A, 16, 8, 1, fire);
    if (fire) spriteFlash(g, M[0], M[1], A);
    // serrations cut into the rear of the slide
    for (let i = 0; i < 5; i++) {
      const a = p(72 + i * 4, -11), b = p(72 + i * 4, 11);
      line(g, a[0], a[1], b[0], b[1], 2, STEEL_DD);
    }
    // sights: a post at the nose, a notched blade at the rear
    part(g, ...p(32, -17), 9, 8, A, 2, STEEL_X, STEEL_D, STEEL_E);
    part(g, ...p(74, -17), 15, 10, A, 3, STEEL_X, STEEL_D, STEEL_E);
    // ejection port: an open recess with a brass cartridge rim in it
    recess(g, ...p(54, 6), 18, 9, A);
    part(g, ...p(54, 6), 7, 6, A, 2, BRASS_L, BRASS, '#7a6321');
    // grip hanging under the rear of the slide, checkered panel
    part(g, gp[0], gp[1], 44, 24, GA, 6, WOOD_L, WOOD, WOOD_D, 'wood');
    g.save(); g.translate(gp[0], gp[1]); g.rotate(GA);
    checker(g, -16, 16, -8, 8, WOOD_DD);
    g.restore();
    // trigger guard: stroked loop, so the daylight shows through the space inside
    guard(g, ...p(46, 22), 22, 16, A + 0.95, 3.2, STEEL_D);
    part(g, ...p(47, 24), 6, 8, GA, 2, STEEL_DD, STEEL_E, STEEL_DD);   // trigger
    // hand: palm on the grip, four fingers wrapping it, thumb along the slide
    const fx = hm[0] - Math.cos(GA) * 6, fy = hm[1] - Math.sin(GA) * 6;
    part(g, hm[0], hm[1], 28, 21, GA, 7, SKIN_L, SKIN, SKIN_D, 'skin');
    fingers(g, fx, fy, GA, 4, 20, 7);
    part(g, ...p(58, 12), 18, 9, A + 0.3, 4, SKIN_L, SKIN, SKIN_D, 'skin');
    cuff(g, hm[0], hm[1]);
  }

  function shotgunView(g, fire) {
    const A = 0.32, M = [16, 32];
    const p = (t, s) => at(M[0], M[1], A, t, s);
    const hm = p(84, 34);
    forearm(g, hm[0], hm[1]);
    // twin barrels, choked (a narrow step at the muzzle end)
    part(g, ...p(38, -7), 70, 13, A, 4, STEEL_L, STEEL, STEEL_D);
    part(g, ...p(38, 7), 70, 13, A, 4, STEEL_L, STEEL, STEEL_D);
    part(g, ...p(24, -7), 12, 11, A, 3, STEEL_X, STEEL_L, STEEL_D);
    part(g, ...p(24, 7), 12, 11, A, 3, STEEL_X, STEEL_L, STEEL_D);
    // the rib between the barrels
    part(g, ...p(36, 0), 72, 6, A, 3, STEEL_DD, STEEL_E, STEEL_DD);
    muzzleFace(g, M[0], M[1], A, 24, 9, 2, fire);
    if (fire) spriteFlash(g, M[0], M[1], A);
    // band where the barrels meet the receiver
    part(g, ...p(66, 0), 6, 26, A, 3, STEEL_X, STEEL_L, STEEL_D);
    // pump fore-end with grip grooves
    part(g, ...p(44, 12), 34, 18, A, 6, WOOD_L, WOOD, WOOD_D, 'wood');
    for (let i = 0; i < 5; i++) {
      const a = p(30 + i * 7, -3), b = p(30 + i * 7, 21);
      line(g, a[0], a[1], b[0], b[1], 2, WOOD_D);
    }
    // receiver, action opening, bead sight
    part(g, ...p(74, 0), 44, 28, A, 6, STEEL_L, STEEL, STEEL_D);
    recess(g, ...p(68, 9), 16, 9, A);
    part(g, ...p(56, -17), 12, 8, A, 3, STEEL_X, STEEL_L, STEEL_D);
    // stock sweeping down to the shoulder, metal butt plate at the end
    part(g, ...p(92, 20), 44, 22, A + 0.5, 7, WOOD_L, WOOD, WOOD_D, 'wood');
    part(g, ...p(104, 28), 9, 21, A + 0.5, 4, STEEL_X, STEEL_D, STEEL_E);
    // hand on the grip
    const fx = hm[0] - Math.cos(A + 1.1) * 6, fy = hm[1] - Math.sin(A + 1.1) * 6;
    part(g, hm[0], hm[1], 28, 21, A + 1.1, 7, SKIN_L, SKIN, SKIN_D, 'skin');
    fingers(g, fx, fy, A + 1.1, 4, 20, 7);
    cuff(g, hm[0], hm[1]);
  }

  function mgView(g, fire) {
    const A = 0.34, M = [16, 28];
    const p = (t, s) => at(M[0], M[1], A, t, s);
    const hm = p(90, 34);
    forearm(g, hm[0], hm[1]);
    // barrel with cooling rings and the grooves between them
    part(g, ...p(22, 0), 44, 14, A, 3, STEEL_L, STEEL, STEEL_D);
    for (let i = 0; i < 6; i++) part(g, ...p(4 + i * 7, 0), 4, 18, A, 2, STEEL_X, STEEL_L, STEEL_D);
    for (let i = 0; i < 5; i++) {
      const a = p(9.5 + i * 7, -7), b = p(9.5 + i * 7, 7);
      line(g, a[0], a[1], b[0], b[1], 1.5, STEEL_DD);
    }
    muzzleFace(g, M[0], M[1], A, 16, 8, 1, fire);
    if (fire) spriteFlash(g, M[0], M[1], A);
    // receiver shroud with cooling slots
    part(g, ...p(68, 0), 48, 28, A, 6, STEEL_L, STEEL, STEEL_D);
    for (let i = 0; i < 4; i++) recess(g, ...p(50 + i * 10, -10), 8, 6, A);
    part(g, ...p(40, -17), 8, 9, A, 2, STEEL_X, STEEL_D, STEEL_E);   // front sight
    // drum magazine: a disc lit from the upper left, with a rim, axle and rivets
    const dr = p(56, 26);
    g.save(); g.translate(dr[0], dr[1]); g.rotate(A);
    g.lineWidth = 2.2; g.strokeStyle = OUTLINE;
    const dg = g.createRadialGradient(-7, -7, 2, 0, 0, 17);
    dg.addColorStop(0, STEEL_X); dg.addColorStop(0.45, STEEL); dg.addColorStop(1, STEEL_DD);
    g.fillStyle = dg; g.beginPath(); g.arc(0, 0, 16, 0, TAU); g.fill(); g.stroke();
    g.lineWidth = 1.6; g.strokeStyle = STEEL_DD;
    g.beginPath(); g.arc(0, 0, 11, 0, TAU); g.stroke();
    g.beginPath(); g.arc(0, 0, 5.5, 0, TAU); g.stroke();
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * TAU;
      g.fillStyle = STEEL_X;
      g.beginPath(); g.arc(Math.cos(a) * 13.5, Math.sin(a) * 13.5, 1.3, 0, TAU); g.fill();
    }
    g.restore();
    // pistol grip
    part(g, ...p(84, 22), 36, 22, A + 1.05, 6, STEEL_L, STEEL_D, STEEL_E);
    // hand on the grip
    const fx = hm[0] - Math.cos(A + 1.05) * 6, fy = hm[1] - Math.sin(A + 1.05) * 6;
    part(g, hm[0], hm[1], 28, 21, A + 1.05, 7, SKIN_L, SKIN, SKIN_D, 'skin');
    fingers(g, fx, fy, A + 1.05, 4, 20, 7);
    cuff(g, hm[0], hm[1]);
  }

  // starburst muzzle flash: the plume leaves the muzzle along the barrel axis,
  // so the star is biased back into the frame and fanned around that axis
  function flashAt(g, cx, cy, r, ang) {
    // the plume is centred on the muzzle opening but fanned back into the frame
    const bx = cx + Math.cos(ang) * r * 0.2, by = cy + Math.sin(ang) * r * 0.2;
    g.save();
    g.translate(bx, by);
    g.rotate(ang);
    g.fillStyle = 'rgba(255,110,25,0.55)';
    g.beginPath(); g.arc(0, 0, r * 1.0, 0, TAU); g.fill();
    for (let i = 0; i < 5; i++) {
      g.save();
      g.rotate(-Math.PI + (i - 2) * 0.68);
      g.fillStyle = i % 2 ? '#ffd75a' : '#ff9a2a';
      g.beginPath();
      g.moveTo(-r * 0.45, 0); g.lineTo(r * 0.35, -r * 0.32);
      g.lineTo(r * 1.15, 0); g.lineTo(r * 0.35, r * 0.32);
      g.closePath(); g.fill();
      g.restore();
    }
    g.fillStyle = '#fff6d8';
    g.beginPath(); g.arc(0, 0, r * 0.45, 0, TAU); g.fill();
    g.restore();
  }

  // dark rim around the silhouette so the gun reads against the hall
  // dark outline hugging the whole silhouette so the gun reads against lit walls
  function rim(c) {
    const o = mkc(c.width, c.height), og = o.getContext('2d');
    const halo = mkc(c.width, c.height), hg = halo.getContext('2d');
    for (const [dx, dy] of [[-SUP, 0], [SUP, 0], [0, -SUP], [0, SUP],
                            [-SUP, -SUP], [SUP, SUP], [-SUP, SUP], [SUP, -SUP]]) hg.drawImage(c, dx, dy);
    hg.globalCompositeOperation = 'source-in';
    hg.fillStyle = '#0a0c10';
    hg.fillRect(0, 0, c.width, c.height);
    og.drawImage(halo, 0, 0);
    og.drawImage(c, 0, 0);
    return o;
  }

  function weaponView(kind, fire) {
    const gun = mkc(VW * SUP, VH * SUP), g = gun.getContext('2d');
    g.save();
    g.scale(SUP, SUP);                       // author in design px, paint at 2x
    if (fire) g.translate(0, 3);             // recoil: the gun drops back toward the eye
    [pistolView, shotgunView, mgView][kind](g, fire);
    if (fire) {
      // the bloom is painted on top of the muzzle, so it rides with the recoil
      const [mx, my] = MUZZLE[kind];
      flashAt(g, mx, my, FLASHR[kind], MUZANG[kind]);
      g.fillStyle = 'rgba(150,150,150,0.22)';   // a wisp of smoke off the muzzle
      g.beginPath(); g.arc(mx + 16, my - 12, 3.5, 0, TAU); g.fill();
    }
    g.restore();
    // grit only lands on the gun itself, never on the empty frame
    g.globalCompositeOperation = 'source-atop';
    noise(g, VW * SUP, VH * SUP, 160, 0.05, 0.14, 2);
    g.globalCompositeOperation = 'source-over';
    return rim(gun);
  }
  // shared muzzle bloom used by the flash quad in front of the gun
  function muzzleFlash() {
    const c = mkc(64, 64), g = c.getContext('2d');
    g.translate(32, 32);

    // outer halo fades fully to transparent so it reads as light, not a decal
    const halo = g.createRadialGradient(0, 0, 0, 0, 0, 31);
    halo.addColorStop(0, 'rgba(255,150,50,0.90)');
    halo.addColorStop(0.35, 'rgba(255,110,30,0.45)');
    halo.addColorStop(0.72, 'rgba(215,70,15,0.16)');
    halo.addColorStop(1, 'rgba(170,45,10,0)');
    g.fillStyle = halo;
    g.beginPath(); g.arc(0, 0, 31, 0, TAU); g.fill();

    // feathered rays along the barrel axis
    g.fillStyle = 'rgba(255,175,75,0.50)';
    for (let i = 0; i < 6; i++) {
      g.save(); g.rotate(i * (TAU / 6) + 0.26);
      g.beginPath(); g.moveTo(0, 0);
      g.lineTo(23, -2.8); g.lineTo(26, 0); g.lineTo(23, 2.8);
      g.closePath(); g.fill();
      g.restore();
    }

    // hot core
    const core = g.createRadialGradient(0, 0, 0, 0, 0, 12);
    core.addColorStop(0, 'rgba(255,255,248,1)');
    core.addColorStop(0.5, 'rgba(255,226,140,0.85)');
    core.addColorStop(1, 'rgba(255,160,60,0)');
    g.fillStyle = core;
    g.beginPath(); g.arc(0, 0, 12, 0, TAU); g.fill();

    return c;
  }
  // ---- player face (wolf3d status face), 48x48, 5 damage stages ----
  function faceFrames() {
    return [0, 1, 2, 3, 4].map(st => {
      const c = mkc(48, 48), g = c.getContext('2d');
      g.fillStyle = '#3a2a22'; g.fillRect(0, 0, 48, 48);
      px(g, 8, 6, 32, 38, '#c98b5e'); px(g, 8, 6, 32, 5, '#8a5a38'); px(g, 36, 6, 4, 38, '#a06a44');
      px(g, 12, 16, 8, 6, '#e8e2d8'); px(g, 28, 16, 8, 6, '#e8e2d8');
      px(g, 15, 18, 3, 3, '#20242c'); px(g, 31, 18, 3, 3, '#20242c');
      px(g, 14, 12, 20, 3, '#6b4226'); // brow
      px(g, 20, 32, 8, 4, '#7a4030'); // mouth
      if (st >= 1) { px(g, 10, 24, 10, 3, '#a02020'); px(g, 30, 8, 3, 12, '#a02020'); }
      if (st >= 2) { px(g, 22, 10, 14, 4, '#a02020'); px(g, 12, 16, 8, 2, '#5c1010'); px(g, 28, 16, 8, 2, '#5c1010'); }
      if (st >= 3) { px(g, 8, 36, 32, 6, '#8a1818'); px(g, 16, 26, 16, 3, '#a02020'); }
      if (st >= 4) { px(g, 8, 6, 32, 38, '#8a6a52'); px(g, 14, 18, 4, 4, '#101010'); px(g, 30, 18, 4, 4, '#101010'); px(g, 18, 32, 12, 5, '#301010'); }
      noise(g, 48, 48, 30, 0.05, 0.15, 1);
      return c;
    });
  }
  // ---- explosion: 4 frames ----
  function boomFrames() {
    return [0, 1, 2, 3].map(i => {
      const c = mkc(64, 64), g = c.getContext('2d');
      const r = [26, 20, 13, 7][i], cols = ['#fff6d8', '#ffb02a', '#c04a10', '#3a3a3a'][i];
      g.fillStyle = cols; g.beginPath(); g.arc(32, 32, r, 0, 7); g.fill();
      if (i < 2) { g.fillStyle = '#ffd75a'; for (let k = 0; k < 8; k++) { const a = k / 8 * TAU + i; g.fillRect(32 + Math.cos(a) * (r + 4) - 2, 32 + Math.sin(a) * (r + 4) - 2, 4, 4); } }
      if (i === 3) noise(g, 64, 64, 40, 0.2, 0.5, 3);
      return c;
    });
  }
  function projSprites() {
    const shell = mkc(32, 32), sg = shell.getContext('2d');
    sg.fillStyle = '#ff9a2a'; sg.beginPath(); sg.arc(16, 16, 8, 0, 7); sg.fill();
    sg.fillStyle = '#fff0c8'; sg.beginPath(); sg.arc(16, 16, 4, 0, 7); sg.fill();
    const bomb = mkc(32, 32), bg = bomb.getContext('2d');
    bg.fillStyle = '#1c1e24'; bg.beginPath(); bg.arc(16, 18, 10, 0, 7); bg.fill();
    bg.fillStyle = '#3d4552'; bg.fillRect(13, 4, 6, 6);
    bg.fillStyle = '#ffe000'; bg.beginPath(); bg.arc(16, 3, 3, 0, 7); bg.fill();
    return { shell, bomb };
  }
  // ---- exit marker ----
  function exitSign() {
    const c = mkc(64, 64), g = c.getContext('2d');
    px(g, 8, 8, 48, 48, '#101010'); px(g, 8, 8, 48, 4, '#2a2a2a');
    g.fillStyle = '#c02020'; g.font = 'bold 26px monospace'; g.textAlign = 'center';
    g.fillText('EXIT', 32, 42);
    return c;
  }
  // ---- wall decorations ----
  function poster() {
    const c = mkc(64, 64), g = c.getContext('2d');
    px(g, 4, 2, 56, 60, '#c9bfa5'); px(g, 4, 2, 56, 4, '#8a8070');
    g.fillStyle = '#7a1f1f'; g.fillRect(8, 10, 48, 26);
    g.fillStyle = '#e8d75a'; g.font = 'bold 11px monospace'; g.textAlign = 'center';
    g.fillText('GRIM', 32, 22); g.fillText('HALL', 32, 33);
    g.fillStyle = '#c9bfa5'; g.beginPath(); g.arc(32, 48, 8, 0, 7); g.fill();
    g.fillStyle = '#222'; g.fillRect(28, 45, 3, 3); g.fillRect(34, 45, 3, 3);
    noise(g, 64, 64, 40, 0.06, 0.2, 2);
    return c;
  }
  function skull() {
    const c = mkc(64, 64), g = c.getContext('2d');
    px(g, 12, 8, 40, 44, '#ddd6c2'); px(g, 12, 40, 40, 12, '#b8b0a0');
    px(g, 22, 24, 8, 10, '#1a1a1a'); px(g, 36, 24, 8, 10, '#1a1a1a');
    px(g, 30, 36, 6, 8, '#1a1a1a');
    px(g, 24, 48, 4, 4, '#8a8474'); px(g, 32, 48, 4, 4, '#8a8474'); px(g, 40, 48, 4, 4, '#8a8474');
    px(g, 12, 8, 40, 3, '#f4efe0');
    noise(g, 64, 64, 30, 0.05, 0.18, 2);
    return c;
  }
  function pipes() {
    const c = mkc(64, 64), g = c.getContext('2d');
    g.fillStyle = '#20242a'; g.fillRect(0, 0, 64, 64);
    for (const [x, w] of [[10, 10], [28, 8], [44, 12]]) {
      px(g, x, 0, w, 64, '#4a525e'); px(g, x, 0, 3, 64, '#5d6672'); px(g, x + w - 3, 0, 3, 64, '#2c323a');
    }
    for (let y = 14; y < 64; y += 22) { px(g, 8, y, 50, 4, '#39414c'); }
    px(g, 46, 30, 8, 8, '#a03030');
    noise(g, 64, 64, 50, 0.05, 0.2, 2);
    return c;
  }
  function bloodSplat() {
    const c = mkc(64, 64), g = c.getContext('2d');
    g.fillStyle = 'rgba(140,10,10,0.85)';
    g.beginPath(); g.arc(32, 32, 12 + rnd() * 6, 0, 7); g.fill();
    for (let i = 0; i < 14; i++) {
      const a = rnd() * TAU, r = 10 + rnd() * 18;
      g.beginPath(); g.arc(32 + Math.cos(a) * r, 32 + Math.sin(a) * r, 1.5 + rnd() * 3.5, 0, 7); g.fill();
    }
    g.fillStyle = 'rgba(90,5,5,0.9)'; g.beginPath(); g.arc(32, 32, 6, 0, 7); g.fill();
    return c;
  }
  function bloodPuff() {
    const c = mkc(32, 32), g = c.getContext('2d');
    g.fillStyle = 'rgba(200,30,20,0.9)';
    for (let i = 0; i < 10; i++) { const a = rnd() * TAU, r = rnd() * 12; g.beginPath(); g.arc(16 + Math.cos(a) * r, 16 + Math.sin(a) * r, 2 + rnd() * 3, 0, 7); g.fill(); }
    return c;
  }
  function ceilLight() {
    const c = mkc(64, 64), g = c.getContext('2d');
    g.fillStyle = '#14161a'; g.fillRect(0, 0, 64, 64);
    px(g, 6, 18, 52, 28, '#e8e4d0'); px(g, 6, 18, 52, 4, '#fff'); px(g, 6, 42, 52, 4, '#9a9686');
    px(g, 2, 14, 60, 3, '#2a2e36'); px(g, 2, 47, 60, 3, '#2a2e36');
    return c;
  }
  // ---- build all ----
  // one palette per enemy type; bulk scales the body, helm/horns are the silhouette.
  // Sprite size is the figure's own bounding box, so the billboard never squashes it.
  const ENEMY_PAL = {
    g: { skin: '#c98b5e', cloth: '#6b7355', hat: '#4a5038', boot: '#2c2c26', metal: '#22242a',
      accent: '#c9b458', eye: '#ff4040', bulk: 1, helm: false },
    u: { skin: '#c98b5e', cloth: '#4a6ea8', hat: '#33507a', boot: '#1e2430', metal: '#181a20',
      accent: '#8fb2d8', eye: '#ffd000', bulk: 1.06, helm: true },
    r: { skin: '#6b8a4a', cloth: '#4a5a34', hat: '#2f3a22', boot: '#241a10', metal: '#8a8f96',
      accent: '#e8e2c8', eye: '#ff2200', bulk: 1.25, helm: false },
    O: { skin: '#b0784f', cloth: '#8a2a22', hat: '#5c1812', boot: '#2a1410', metal: '#c9c9d0',
      accent: '#e8b820', eye: '#ffe000', bulk: 1.4, helm: true, horns: true },
  };
  const ENEMY_SPR = { g: [100, 128], u: [104, 128], r: [118, 128], O: [126, 128] };
  const BUILD = new Map();
  function build(levelSeed = 0) {
    const seed = (levelSeed >>> 0);
    const ck = 'build#' + seed;
    if (BUILD.has(ck)) return BUILD.get(ck);
    const level = NS.levels[levelSeed];
    const theme = (level && level.theme) || 'hall';

    // 1. level decor is seeded per level: every hall paints differently, but the
    //    same level always paints the same way.
    setSeed(seed);
    const d = n => n + '#' + seed;
    const texTex = {
      brick: pbr(brick(theme), 'brick#' + seed, false), metal: pbr(metal(theme), 'metal#' + seed, false),
      door: pbr(door(theme), 'door#' + seed, false),
      floor: pbr(floor(theme), 'floor#' + seed, true), ceil: pbr(ceil(theme), 'ceil#' + seed, true),
      exit: tex(exitSign(), false, d('exit')),
      ceilLight: tex(ceilLight(), false, d('ceilLight')),
      poster: tex(poster(), false, d('poster')), skull: tex(skull(), false, d('skull')), pipes: tex(pipes(), false, d('pipes')),
    };

    // 2. characters, items and fx use the fixed sprite seed, so a grunt always
    //    looks like the same grunt in every level and every run.
    setSeed(SPRITE_SEED);
    const pr = projSprites();
    const A = {
      seed,
      tex: texTex,
      spr: Object.fromEntries(Object.keys(ENEMY_PAL).map(t =>
        [t, enemySprites(ENEMY_PAL[t], ENEMY_SPR[t][0], ENEMY_SPR[t][1], t)])),
      // sprite quads must match each figure's own aspect or the body is squashed
      sprAsp: Object.fromEntries(Object.entries(ENEMY_SPR).map(([t, [w, h]]) => [t, w / h])),
      items: { i1: tex(itemGun('sg'), false, 'i1'), i2: tex(itemGun('mg'), false, 'i2'), ia: tex(itemBox('sg'), false, 'ia'),
        ib: tex(itemBox('mg'), false, 'ib'), ih: tex(itemHealth(false), false, 'ih'), iH: tex(itemHealth(true), false, 'iH'),
        ik: tex(itemArmor(), false, 'ik') },
      weapons: [0, 1, 2].map(k => ({
        idle: tex(weaponView(k, false), false, 'w' + k, THREE.LinearFilter),
        fire: tex(weaponView(k, true), false, 'w' + k + 'f', THREE.LinearFilter),
        muzzle: MUZZLE[k],          // muzzle pixel in the 128x96 design frame
        bloom: FLASHR[k],           // flash radius in viewmodel pixels
      })),
      flame: flameFrames().map((c, i) => tex(c, false, 'fl' + i)),
      flash: tex(muzzleFlash(), false, 'flash'),
      face: faceFrames().map((c, i) => tex(c, false, 'face' + i)),
      boom: boomFrames().map((c, i) => tex(c, false, 'boom' + i)),
      proj: { shell: tex(pr.shell, false, 'shell'), bomb: tex(pr.bomb, false, 'bomb') },
      decor: { poster: texTex.poster, skull: texTex.skull, pipes: texTex.pipes },
      blood: tex(bloodPuff(), false, 'blood'), splat: tex(bloodSplat(), false, 'splat'),
      shadow: tex(shadowBlob(), false, 'shadow'),
      ceilLight: texTex.ceilLight,
    };
    BUILD.set(ck, A);
    return A;
  }

  const Art = {
    mkc, px, tex, mat, noise, build, setSeed,
    figure: enemyFigure, enemyPal: ENEMY_PAL, enemySpr: ENEMY_SPR,
    // handy for tests / debugging: how many GPU uploads the pools hold
    poolSize: () => ({ textures: TEX.size, materials: MAT.size, builds: BUILD.size }),
    clearPools: () => { TEX.clear(); MAT.clear(); BUILD.clear(); },
  };
  NS.art = Art;
  if (typeof module !== 'undefined') module.exports = Art;
})();