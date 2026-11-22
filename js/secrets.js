// ================= SECRET VAULTS =================
// Wolfenstein-style secret rooms, carved into every authored level before the
// sim ever sees it, so the maps in data.js stay readable by hand.
//
// The rules are lifted from period mapping practice (Mapedit tips and the
// "From Column to Column" level-design bible):
//  * a pushwall slides two squares, so a vault needs two clear cells directly
//    behind it; the panel ends up standing inside the room it opened
//  * nothing a player needs may sit in the wall's travel path - guards, corpses
//    and props all jam a sliding wall
//  * design so the room works whether the wall stops at two squares or (the old
//    engine bug) three: the chamber is three deep, so the panel never wedges
//    into the far wall and can always be walked around
//  * a vault is one enclosed chamber whose only entrance is the pushwall; an
//    unreachable pocket of floor is a mapping bug, so sealed pockets go back to
//    masonry
//  * pushwalls are kept clear of doors so a sliding wall never jams a doorway
//  * guards stashed behind a pushwall are "deaf": they do not hear gunfire
//    until the wall actually moves (the 6a floor-code trick)
//  * treasure follows the Wolfenstein hierarchy - crosses anywhere, chalices
//    moderate, chests and crowns only in secret chambers
//  * every level needs at least one enemy, one secret and one treasure, and no
//    more than three secrets (too many secrets is fatigue, not content)
//  * a deep chamber (five squares) leaves room for the chain pushwall: a panel
//    that jammed, or that hit the far wall, can be shoved again from inside the
//    room - and shoved back, since Wolfenstein panels are not one-way. The bible's
//    "push a wall from two directions to get through" is this same tile twice
//  * crosses belong out in the open; chests and crowns only ever sit behind a
//    pushwall, so the treasure percentage is chaseable without secrets
//  * the episode's first floor hides the secret elevator: an 'E' tile deep
//    inside the biggest vault, and the only way to reach the secret level
(function () {
  const NS = (typeof GH !== 'undefined') ? GH :
             (typeof module !== 'undefined' ? require('./data.js') : globalThis.GH);

  const PAD = 4;                       // solid margin every level is grown into
  const MIN_SECRETS = 2, MAX_SECRETS = 3;
  const SOLID = c => c === '#' || c === 'T' || c === '~';
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  // Chamber footprints behind a pushwall. Depth is never less than 3: the panel
  // travels two squares and must still leave a cell of room behind it.
  const SHAPES = [
    { w: 5, d: 3, kind: 'treasure vault' },
    { w: 3, d: 3, kind: 'reliquary' },
    { w: 7, d: 3, kind: 'gold hall' },
    { w: 5, d: 5, kind: 'bullion hall' },      // deep enough to be shoved twice
  ];

  function makeRng(seed) {
    let s = (seed >>> 0) || 0x9E3779B9;
    return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  }

  // Fisher-Yates, so a level's secrets land in different places per seed while
  // staying deterministic (the tests replay a run from its seed).
  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = (rng() * (i + 1)) | 0;
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  // Wolfenstein floors are 64x64 with a thick solid perimeter; grow the authored
  // map into that shape so a chamber can be carved without cutting into a room.
  function pad(map) {
    const H = map.length, W = map[0].length, g = [];
    for (let y = 0; y < H + PAD * 2; y++) {
      const row = new Array(W + PAD * 2).fill('#');
      if (y >= PAD && y < PAD + H) {
        const src = map[y - PAD];
        for (let x = 0; x < W; x++) row[PAD + x] = src[x];
      }
      g.push(row);
    }
    return g;
  }

  // Anything the player can never walk to is masonry, not floor. This wipes the
  // one-row alcoves the old maps used for their single "secret".
  function sealUnreachable(g) {
    const H = g.length, W = g[0].length;
    let start = null;
    for (let y = 0; y < H && !start; y++)
      for (let x = 0; x < W; x++) if (g[y][x] === 'P') { start = [x, y]; break; }
    if (!start) return g;
    const seen = Array.from({ length: H }, () => new Array(W).fill(false));
    const q = [start]; seen[start[1]][start[0]] = true;
    while (q.length) {
      const [x, y] = q.pop();
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || seen[ny][nx]) continue;
        if (SOLID(g[ny][nx]) || g[ny][nx] === 'W') continue;
        seen[ny][nx] = true; q.push([nx, ny]);
      }
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
      if (!seen[y][x] && !SOLID(g[y][x]) && g[y][x] !== 'W') g[y][x] = '#';
    return g;
  }

  // Interior cells of a vault whose entrance is (ex,ey) and which slides along
  // (dx,dy).
  function footprint(ex, ey, dx, dy, shape) {
    const cells = [], half = shape.w >> 1;
    for (let a = 1; a <= shape.d; a++)
      for (let b = -half; b <= half; b++)
        cells.push([ex + dx * a + (dx ? 0 : b), ey + dy * a + (dy ? 0 : b)]);
    return cells;
  }

  // A vault can only be carved where the chamber fits entirely inside solid
  // masonry, the player can reach the entrance, and no door is next to it.
  function canCarve(g, ex, ey, dx, dy, shape) {
    const H = g.length, W = g[0].length;
    if (!(SOLID(g[ey][ex]) || g[ey][ex] === 'W')) return false;
    const ox = ex - dx, oy = ey - dy;
    if (ox < 0 || oy < 0 || ox >= W || oy >= H || SOLID(g[oy][ox])) return false;
    // the wall the panel sits in must be a continuous run, not a lone block
    const ax = dy ? 1 : 0, ay = dx ? 1 : 0;
    for (const s of [-1, 1]) {
      const nx = ex + ax * s, ny = ey + ay * s;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || !SOLID(g[ny][nx])) return false;
    }
    for (const [x, y] of footprint(ex, ey, dx, dy, shape)) {
      if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) return false;
      if (!SOLID(g[y][x])) return false;
    }
    // Wolfenstein rule: never put a pushwall next to a doorway - a sliding panel
    // jams against a door frame, and a panel beside a door is a mapping bug
    for (let sx = -2; sx <= 2; sx++)
      for (let sy = -2; sy <= 2; sy++) {
        if (!sx && !sy) continue;
        const nx = ex + sx, ny = ey + sy;
        if (nx >= 0 && ny >= 0 && nx < W && ny < H && g[ny][nx] === 'D') return false;
      }
    return true;
  }


  // Every cell in the padded grid that could hide a chamber: solid masonry with
  // a walkable room on one side and a full chamber of solid behind it. Existing
  // pushwalls get promoted into real vaults first - the shallow one-row alcoves
  // behind them were never rooms to begin with.
  function candidates(g) {
    const H = g.length, W = g[0].length, out = [];
    for (let ey = 1; ey < H - 1; ey++)
      for (let ex = 1; ex < W - 1; ex++)
        for (const [dx, dy] of DIRS)
          for (const shape of SHAPES)
            if (canCarve(g, ex, ey, dx, dy, shape)) out.push({ ex, ey, dx, dy, shape });
    return out;
  }

  // Fill a chamber: gold-veined floor, metal lining, one pushwall, and the loot
  // that makes it worth hunting for.
  function carve(g, cand, rng, id, twin) {
    const { ex, ey, dx, dy, shape } = cand;
    const W = g[0].length;
    const cells = footprint(ex, ey, dx, dy, shape);
    const inVault = new Set(cells.map(([x, y]) => y * W + x));
    for (const [x, y] of cells) g[y][x] = 'A';
    for (const [x, y] of cells)
      for (const [sx, sy] of DIRS) {
        const nx = x + sx, ny = y + sy;
        if (nx === ex && ny === ey) continue;
        if (!inVault.has(ny * W + nx) && g[ny][nx] === '#') g[ny][nx] = 'T';
      }
    g[ey][ex] = 'W';

    // Wolfenstein's mapping rule: nothing the player needs may sit in a panel's
    // travel path. A four-square corridor is kept bare so the wall can be shoved
    // twice - the chain pushwall that gets you into the back of a deep chamber.
    const path = new Set();
    for (let a = 1; a <= Math.min(shape.d, 4); a++) path.add((ey + dy * a) * W + (ex + dx * a));
    const spots = cells.filter(([x, y]) => !path.has(y * W + x));
    for (let i = spots.length - 1; i > 0; i--) {
      const j = (rng() * (i + 1)) | 0;
      const t = spots[i]; spots[i] = spots[j]; spots[j] = t;
    }
    const put = ch => {
      if (!spots.length) return null;
      const [x, y] = spots.pop();
      g[y][x] = ch;
      return { x, y, ch };
    };

    const guards = [], loot = [];
    // a guard behind the wall is deaf until the wall moves - the classic trick
    if (rng() < 0.55) { const p = put(rng() < 0.5 ? 'g' : 'u'); if (p) guards.push(p); }
    // treasure: chests and crowns only ever appear behind a pushwall
    const n = (shape.w >= 7 || shape.d >= 5) ? 6 : shape.w >= 5 ? 4 : 3;
    let big = false;
    for (let i = 0; i < n && spots.length; i++) {
      const r = rng();
      let ch = r < 0.45 ? 'c' : r < 0.7 ? 'v' : r < 0.9 ? 'x' : 'C';
      if (!big && i === n - 1 && (ch === 'c' || ch === 'v')) ch = rng() < 0.5 ? 'x' : 'C';
      if (ch === 'x' || ch === 'C') big = true;
      const p = put(ch);
      if (p) loot.push(p);
    }
    // the bible's "essential items behind pushwalls": a vault is a good place to
    // hide the guns and supplies a restart needs
    if (rng() < 0.6) { const p = put(rng() < 0.5 ? 'h' : 'k'); if (p) loot.push(p); }
    if (rng() < 0.55) { const p = put(rng() < 0.5 ? '2' : '1'); if (p) loot.push(p); }

    return { id, ex, ey, dx, dy, w: shape.w, d: shape.d, twin: !!twin, kind: shape.kind,
      cells, guards, loot,
      value: loot.reduce((a, l) => a + (NS.treasure[l.ch] || 0), 0) };
  }

  // Crosses belong out in the open: Wolfenstein scatters them through the rooms
  // so the treasure percentage is chaseable without finding every secret. They
  // never go in a pushwall's travel path, and never in a sealed pocket.
  function sprinkleCrosses(g, rng, vaults) {
    const H = g.length, W = g[0].length;
    const blocked = new Set();
    for (const v of vaults) {
      for (const [x, y] of v.cells) blocked.add(y * W + x);
      for (let a = 0; a <= 2; a++) blocked.add((v.ey + v.dy * a) * W + (v.ex + v.dx * a));
    }
    const open = [];
    for (let y = 1; y < H - 1; y++)
      for (let x = 1; x < W - 1; x++)
        if ((g[y][x] === '.' || g[y][x] === 'X') && !blocked.has(y * W + x)) open.push([x, y]);
    for (let i = open.length - 1; i > 0; i--) {
      const j = (rng() * (i + 1)) | 0;
      const t = open[i]; open[i] = open[j]; open[j] = t;
    }
    const placed = [];
    for (let i = 0; i < Math.min(6, open.length); i++) {
      const [x, y] = open[i];
      g[y][x] = rng() < 0.75 ? 'c' : 'v';
      placed.push({ x, y, ch: g[y][x] });
    }
    return placed;
  }

  // The secret elevator, hidden in the biggest vault of the level that owns it.
  // In Wolfenstein it is the only way to reach the secret floor, so it must sit
  // behind a pushwall and out of the panel's travel path.
  function placeElevator(g, vaults, to) {
    if (!vaults.length) return null;
    const best = vaults.slice().sort((a, b) => b.cells.length - a.cells.length)[0];
    const W = g[0].length;
    // out of the panel's travel corridor: an elevator the wall crushes is no
    // elevator at all
    const path = new Set();
    for (let a = 1; a <= Math.min(best.d, 4); a++) path.add((best.ey + best.dy * a) * W + (best.ex + best.dx * a));
    const spots = best.cells.filter(([x, y]) => !path.has(y * W + x) && g[y][x] === 'A');
    if (!spots.length) return null;
    const [x, y] = spots[0];
    g[y][x] = 'E';
    return { x, y, to, vault: best.id };
  }

  function generate(level, seed) {
    const g = sealUnreachable(pad(level.map));
    const rng = makeRng(seed);
    const pool = candidates(g);
    // id's own floors put the biggest secret first, and the bible is explicit that
    // a deep chamber is worth more than a shallow one: it is the only wall the
    // player can shove twice. Promoted authored pushwalls rank above new panels,
    // deep chambers above shallow ones, and the rest is seeded variety.
    for (const c of pool)
      c.score = (g[c.ey][c.ex] === 'W' ? 3 : 0) + (c.shape.d >= 5 ? 1.5 : c.shape.d >= 3 ? 0.6 : 0) + rng() * 0.9;
    pool.sort((a, b) => b.score - a.score);
    const want = Math.min(MAX_SECRETS, Math.max(MIN_SECRETS, pool.filter(c => g[c.ey][c.ex] === 'W').length + 2));
    const vaults = [];
    for (const c of pool) {
      if (vaults.length >= want) break;
      if (!canCarve(g, c.ex, c.ey, c.dx, c.dy, c.shape)) continue;      // overlaps one already carved
      // spread the secrets out: two panels in the same wall run are one puzzle,
      // not two, and a player counting secrets should see them clearly apart
      if (vaults.some(v => Math.abs(v.ex - c.ex) + Math.abs(v.ey - c.ey) < 12)) continue;
      vaults.push(carve(g, c, rng, vaults.length));
    }
    const crosses = sprinkleCrosses(g, rng, vaults);
    const elevator = level.secretLevel === undefined ? null :
      placeElevator(g, vaults, level.secretLevel);
    // Marking a pushwall (bible 4.69): the original mappers hint a secret with a
    // different texture on the panel itself - the eagle tapestry on the first
    // secret in E1M1 is the classic. We mark the richest vault of every floor,
    // and always the vault that hides the elevator, so the hunt has a visual tell.
    let marquee = -1, bestValue = -1;
    for (const v of vaults) if (v.value > bestValue) { bestValue = v.value; marquee = v.id; }
    for (const v of vaults)
      v.hint = v.id === marquee || (elevator && elevator.vault === v.id);
    // a pushwall that ended up with no chamber behind it can never open: that is
    // a mapping bug, so it goes back to plain masonry
    for (let y = 0; y < g.length; y++)
      for (let x = 0; x < g[y].length; x++)
        if (g[y][x] === 'W' && !vaults.some(v => v.ex === x && v.ey === y)) g[y][x] = '#';
    return { map: g.map(r => r.join('')), vaults, crosses, elevator };
  }

  function apply(levels) {
    levels.forEach((level, i) => {
      if (level.vaults) return;                  // idempotent: generated once
      const r = generate(level, (i + 1) * 0x51 + 0x9E37);
      level.map = r.map;
      level.vaults = r.vaults;
      level.crosses = r.crosses;
      if (r.elevator) level.elevator = r.elevator;
    });
    return levels;
  }

  const VaultGen = { apply, generate, pad, sealUnreachable, footprint, canCarve, candidates,
    sprinkleCrosses, placeElevator, PAD, SHAPES, MIN_SECRETS, MAX_SECRETS };
  NS.vaults = VaultGen;
  if (typeof module !== 'undefined') module.exports = VaultGen;
  // loading the module is enough: every authored level gets its vaults in the
  // browser as well as under Node, and apply() is a no-op on a level that has
  // already been carved.
  if (NS.levels) apply(NS.levels);
  return VaultGen;
})();
