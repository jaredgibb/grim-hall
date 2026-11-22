// ================= PROCEDURAL AUDIO =================
// All sound is synthesised on the fly. Attached to GH.sound so the sim can
// swap in a silent stub when it runs headless.
(function () {
  const NS = (typeof GH !== 'undefined') ? GH :
             (typeof module !== 'undefined' ? require('./data.js') : globalThis.GH);

  let AC = null, MASTER = null, VOLUME = 0.8, MUTED = false;

  function ac() {
    if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)();
    if (AC.state === 'suspended') AC.resume();
    if (!MASTER) { MASTER = AC.createGain(); MASTER.gain.value = MUTED ? 0 : VOLUME; MASTER.connect(AC.destination); }
    return AC;
  }
  const bus = () => { ac(); return MASTER; };

  function applyVolume() { if (MASTER) MASTER.gain.value = MUTED ? 0 : VOLUME; }

  function tone(f0, dur, type, vol, f1, delay) {
    try {
      const a = ac(), t = a.currentTime + (delay || 0);
      const o = a.createOscillator(), g = a.createGain();
      o.type = type || 'square';
      o.frequency.setValueAtTime(f0, t);
      if (f1) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
      g.gain.setValueAtTime(vol || 0.15, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g).connect(bus());
      o.start(t); o.stop(t + dur + 0.02);
    } catch (e) {}
  }
  function noiseBurst(dur, vol, fc, delay) {
    try {
      const a = ac(), t = a.currentTime + (delay || 0);
      const n = a.sampleRate * dur, buf = a.createBuffer(1, n, a.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const src = a.createBufferSource(); src.buffer = buf;
      const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = fc || 1200;
      const g = a.createGain(); g.gain.setValueAtTime(vol || 0.3, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(f).connect(g).connect(bus());
      src.start(t);
    } catch (e) {}
  }

  const Sound = {
    pistol() { noiseBurst(0.12, 0.5, 2500); tone(220, 0.1, 'square', 0.22, 60); },
    shotgun() { noiseBurst(0.3, 0.7, 1400); tone(120, 0.25, 'sawtooth', 0.3, 40); },
    pump(delay) { noiseBurst(0.05, 0.3, 900); tone(200, 0.07, 'square', 0.14, 110, delay || 0.03); noiseBurst(0.04, 0.2, 600, 0.1); },
    mg() { noiseBurst(0.07, 0.35, 2000); tone(300, 0.06, 'square', 0.14, 90); },
    click() { tone(900, 0.04, 'square', 0.1); },
    hurt() { tone(160, 0.18, 'sawtooth', 0.25, 70); noiseBurst(0.1, 0.2, 500); },
    kill() { tone(300, 0.12, 'square', 0.2, 80); tone(150, 0.2, 'sawtooth', 0.2, 50, 0.08); },
    die() { tone(220, 0.9, 'sawtooth', 0.3, 40); noiseBurst(0.6, 0.3, 400, 0.1); },
    pickup() { tone(660, 0.08, 'square', 0.18); tone(880, 0.1, 'square', 0.18, null, 0.07); },
    boom(d) { const v = Math.max(0.2, 1 - (d || 0) / 14); noiseBurst(0.5, 0.8 * v, 500); tone(70, 0.4, 'sine', 0.5 * v, 30); },
    door() { tone(90, 0.3, 'sawtooth', 0.12, 140); noiseBurst(0.2, 0.1, 300); },
    // a pushwall grinding sideways through masonry: low, long, dusty
    rumble() { noiseBurst(0.5, 0.4, 260); tone(60, 0.5, 'sawtooth', 0.16, 40); },
    // a pushwall grinding sideways through masonry: low, long, dusty
    pushwall() { noiseBurst(0.6, 0.28, 300); tone(70, 0.6, 'sawtooth', 0.14, 45);
                 tone(210, 0.18, 'square', 0.06, 120, 0.2); },
    // the panel hits rock and stops: a short, hard clank
    jam() { tone(140, 0.12, 'square', 0.2, 60); noiseBurst(0.15, 0.25, 900); },
    // secret elevator: chain clanking overhead, then a long descending whoosh
    elevator() { [180, 240, 300].forEach((f, i) => tone(f, 0.08, 'square', 0.12, null, i * 0.12));
                 tone(300, 1.2, 'sawtooth', 0.16, 60, 0.35); noiseBurst(1.2, 0.22, 500, 0.3); },
    enemyShot(d) { const v = Math.max(0.2, 1 - (d || 0) / 18); tone(500, 0.08, 'square', 0.12 * v, 200); },
    step() { noiseBurst(0.05, 0.08, 300 + Math.random() * 200); },
    wade() { noiseBurst(0.12, 0.1, 700 + Math.random() * 300); tone(180, 0.1, 'sine', 0.07, 90); },
    splash() { noiseBurst(0.22, 0.3, 1200); tone(420, 0.18, 'sine', 0.12, 120); },
    unlock() { tone(440, 0.1, 'square', 0.2); tone(660, 0.1, 'square', 0.2, null, 0.1); tone(880, 0.25, 'square', 0.22, null, 0.2); },
    win() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.22, 'square', 0.2, null, i * 0.16)); },

    setVolume(v) { VOLUME = Math.max(0, Math.min(1, v)); applyVolume(); return VOLUME; },
    mute(on) { MUTED = !!on; applyVolume(); return MUTED; },
    get volume() { return VOLUME; },
    get muted() { return MUTED; },
  };

  // dark music: A-minor bass line + sparse high arp, 32 steps, lookahead-scheduled
  // (no drift). main.js starts/stops it when the sim state changes.
  const Music = {
    timer: null, step: 0, nextT: 0, drone: null, stepDur: 0.23,
    bass: [55, 55, 0, 55, 0, 55, 65.41, 0, 55, 55, 0, 82.41, 0, 73.42, 0, 55,
           55, 0, 55, 0, 65.41, 0, 49, 0, 58.27, 0, 65.41, 0, 73.42, 0, 49, 0],
    arp:  [220, 0, 261.6, 329.6, 0, 220, 0, 261.6, 196, 0, 246.9, 329.6, 0, 220, 0, 261.6,
           220, 0, 261.6, 329.6, 0, 220, 0, 174.6, 196, 0, 261.6, 329.6, 0, 293.7, 0, 196],
    playStep(i, t) {
      const off = t - ac().currentTime;
      const b = this.bass[i];
      if (b) { tone(b, 0.24, 'sawtooth', 0.13, null, off); tone(b * 2, 0.2, 'square', 0.045, null, off); }
      const ar = this.arp[i];
      if (ar && i % 2 === 0) tone(ar, 0.1, 'triangle', 0.05, null, off);
      if (i % 8 === 0) noiseBurst(0.09, 0.13, 180, off);          // kick
      if (i % 8 === 4) tone(1400, 0.04, 'square', 0.04, null, off); // hat
    },
    start() {
      if (this.timer) return;
      try {
        const a = ac();
        this.nextT = a.currentTime + 0.05;
        const o = a.createOscillator(), g = a.createGain(), f = a.createBiquadFilter();
        o.type = 'sawtooth'; o.frequency.value = 27.5; g.gain.value = 0.045;
        f.type = 'lowpass'; f.frequency.value = 110;
        o.connect(f).connect(g).connect(bus()); o.start();
        this.drone = { o, g, f };
      } catch (e) {}
      this.timer = setInterval(() => {
        if (MUTED) return;
        const now = ac().currentTime;
        if (this.nextT < now) this.nextT = now + 0.01;         // resync after a pause
        while (this.nextT < now + 0.5) {                       // schedule half a second ahead
          this.playStep(this.step % 32, this.nextT);
          this.nextT += this.stepDur; this.step++;
        }
      }, 120);
    },
    stop() {
      if (this.timer) { clearInterval(this.timer); this.timer = null; }
      if (this.drone) { try { this.drone.o.stop(); } catch (e) {} this.drone = null; }
    },
  };

  Sound.music = Music;
  NS.sound = Sound;
  NS.music = Music;
  if (typeof module !== 'undefined') module.exports = Sound;
})();
