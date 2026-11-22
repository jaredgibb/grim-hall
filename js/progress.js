// ================= RUN PROGRESS =================
// Which floors the player has unlocked and the best result on each. Storage is
// injected (localStorage in the browser, a plain object in the tests) so this
// module touches no browser state and can be unit-tested in node, exactly like
// audio.js.
(function () {
  const NS = (typeof GH !== 'undefined') ? GH :
             (typeof module !== 'undefined' ? require('./data.js') : globalThis.GH);

  const KEY = 'gh.progress';

  const int = (v, lo, hi) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.floor(n))) : lo;
  };

  // A save file is untrusted input: a hand-edited or half-written entry must not
  // take the title screen down with it.
  function normalize(p, levels) {
    const out = { unlocked: 0, best: {} };
    if (!p || typeof p !== 'object') return out;
    out.unlocked = int(p.unlocked, 0, levels.length - 1);
    const src = p.best && typeof p.best === 'object' ? p.best : {};
    for (const key of Object.keys(src)) {
      const i = Number(key);
      const b = src[key];
      if (!Number.isInteger(i) || i < 0 || i >= levels.length || !b || typeof b !== 'object') continue;
      out.best[i] = {
        score: int(b.score, 0, 1e9),
        time: int(b.time, 0, 1e6),
        accuracy: int(b.accuracy, 0, 100),
        secrets: int(b.secrets, 0, 99),
        rank: typeof b.rank === 'string' ? b.rank : '',
      };
    }
    return out;
  }

  const isSecret = (levels, i) => !!levels[i] && !!levels[i].secret;

  // The next floor in the rotation, skipping the hidden one. Pure index math,
  // so a save can be written without building any world.
  function nextNormal(levels, i) {
    let n = (i + 1) % levels.length;
    while (isSecret(levels, n)) n = (n + 1) % levels.length;
    return n;
  }

  const highestNormal = levels => {
    for (let i = levels.length - 1; i >= 0; i--) if (!isSecret(levels, i)) return i;
    return 0;
  };

  function load(storage, levels = NS.levels) {
    let raw = null;
    try { raw = storage && storage.getItem ? storage.getItem(KEY) : null; } catch (e) { raw = null; }
    let parsed = null;
    try { parsed = raw === null || raw === undefined ? null : JSON.parse(raw); } catch (e) { parsed = null; }
    return normalize(parsed, levels);
  }

  function save(storage, prog) {
    try { if (storage && storage.setItem) storage.setItem(KEY, JSON.stringify(prog)); } catch (e) {}
  }

  // Called when a hall is cleared. Returns a new progress object; recording the
  // same win twice changes nothing, so the win panel can be re-rendered safely.
  function recordWin(prog, levelIndex, stats, levels = NS.levels) {
    const p = normalize(prog, levels);
    const i = int(levelIndex, 0, levels.length - 1);
    const cand = {
      score: int(stats && stats.score, 0, 1e9),
      time: int(stats && stats.time, 0, 1e6),
      accuracy: int(stats && stats.accuracy, 0, 100),
      secrets: int(stats && stats.secrets, 0, 99),
      rank: stats && typeof stats.rank === 'string' ? stats.rank : '',
    };
    const prev = p.best[i];
    // the better run wins; on a tie the faster one does
    if (!prev || cand.score > prev.score || (cand.score === prev.score && cand.time < prev.time)) {
      p.best[i] = cand;
    }
    // The secret floor is a reward stage, not a rung: clearing it records a score
    // but never opens anything new.
    if (!isSecret(levels, i)) {
      let next = nextNormal(levels, i);
      // Clearing the last normal floor wraps the rotation back to 0. "Unlocked"
      // means every floor you can play, so the wrap has to read as the top of the
      // ladder, not as a fall to the bottom.
      if (next <= i) next = highestNormal(levels);
      p.unlocked = Math.max(p.unlocked, next);
    }
    return p;
  }

  const Progress = { load, save, recordWin, nextNormal, highestNormal, KEY };
  NS.progress = Progress;
  if (typeof module !== 'undefined') module.exports = Progress;
  return Progress;
})();
