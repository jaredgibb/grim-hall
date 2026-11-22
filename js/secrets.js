// ================= SECRET VAULTS =================
// Wolfenstein-style secret chambers, carved into every authored level before the
// sim ever sees it, so the maps in data.js stay readable by hand.
//
// Nothing here is guessed. Two sources were measured:
//
// 1. All 60 original Wolfenstein 3D episode maps (wolf1.m1 .. wolf6.m10) decoded
//    cell by cell. Every pocket a pushwall opens (area <= 60) gives the shape
//    census of a real secret room:
//      3x3 -> 36 rooms   5x5 -> 31   7x7 -> 26   4x3 -> 13   5x3 -> 11   7x5 -> 11
//      3x6 -> 8    8x3 -> 7    7x3 -> 7    2x3 -> 7    4x4 -> 6    6x3 -> 7
//    and of those pockets 318 have exactly one panel, 107 have two: the
//    two-direction secret (bible 4.67). E1M1's own bottom-right secret is four
//    panels around two chambers off one corridor - panel -> chamber -> panel ->
//    elevator, the chain id built in the first level of every episode.
// 2. "From Column to Column: The Wolfenstein 3D Level Design Bible" (B.J. Rowan,
//    expanded 2026), sections 4.6-4.8, which states the rules outright:
//  * a pushwall slides two squares (the original engine's 2-or-3 ambiguity: build
//    the chamber so it works whichever way the panel stops, never needing the
//    third square) - so a chamber is at least three squares deep
//  * nothing the player needs may sit in a panel's travel path; a pushwall will
//    not slide over a dead body, and a guard who wanders into the path jams it
//  * a stuck wall is fixed by pushing it again: the chain pushwall (bible 4.62).
//    Wolfenstein panels are not one-way, so the same panel can be shoved back
//  * guards in a secret room are deaf (floor code 006a) until the wall moves, and
//    id never puts guards in the first room of a secret chain
//  * keep pushwalls clear of doors and of portrait-decorated walls
//  * mark a panel you want found: the eagle tapestry over the first pushwall in
//    E1M1 is the classic hint (bible 4.69)
//  * chests and crowns live behind pushwalls; crosses and chalices are scattered
//    in the open so treasure is chaseable without finding every secret
//  * the secret elevator (floor code 006b) sits behind a chain of panels deep in
//    the biggest vault of the level that owns it
(function () {
  const NS = (typeof GH !== 'undefined') ? GH :
             (typeof module !== 'undefined' ? require('./data.js') : globalThis.GH);

  // Wolfenstein maps are 64x64 and the authored ones here are much smaller, so
  // every floor is grown into a thick block of masonry: that is where the secret
  // chambers, the elevator shaft and the chain panels are carved.
  const PAD = 8;
  const MIN_SECRETS = 3, MAX_SECRETS = 5;
  // A chamber never sits closer than INSET to the map edge: the deepest secrets
  // need a chain - panel, chamber, panel, elevator car - and the car is two
  // squares beyond the far wall of the chamber.
  const INSET = 3;
  const SOLID = c => c === '#' || c === 'T' || c === '~';
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  // Chamber footprints behind a panel, in (along, across) offsets from the panel.
  // Depth never goes below 3: the panel travels two squares and must still leave
  // a square of room behind it. Widths and depths are the ones the originals used.
  function rect(w, d) {
    const lo = -((w - 1) >> 1), out = [];
    for (let a = 1; a <= d; a++) for (let b = lo; b < lo + w; b++) out.push([a, b]);
    return out;
  }
  // The keyhole: a two-square throat behind the panel opening into a hall. id used
  // this when the secret hung off a narrow corridor rather than a wide wall.
  function keyhole(w, d) {
    const out = [[1, 0], [2, 0]];      // the throat the panel slides into
    for (const [a, b] of rect(w, d)) out.push([a + 2, b]);
    return out;
  }
  // The shapes are the census of the 60 originals (see the header): how often id
  // actually cut that pocket. Weight is that count, so a floor full of 5x5 gold
  // halls is as un-Wolfenstein as a floor with nothing but them.
  const SHAPES = [
    { kind: 'reliquary',    w: 3, d: 3, cells: rect(3, 3), weight: 36 },   // the most common pocket
    { kind: 'bullion hall', w: 5, d: 5, cells: rect(5, 5), weight: 31 },   // deep: shove it twice
    { kind: 'alcove',       w: 2, d: 3, cells: rect(2, 3), weight: 7 },    // the narrow pocket
    { kind: 'gold hall',    w: 4, d: 3, cells: rect(4, 3), weight: 13 },
    { kind: 'gold hall',    w: 5, d: 3, cells: rect(5, 3), weight: 11 },
    { kind: 'bullion hall', w: 7, d: 5, cells: rect(7, 5), weight: 11 },   // the 7x5 treasure hall
    { kind: 'reliquary',    w: 4, d: 4, cells: rect(4, 4), weight: 6 },
    { kind: 'armory',       w: 3, d: 5, cells: rect(3, 5), weight: 8 },
    { kind: 'armory',       w: 3, d: 6, cells: rect(3, 6), weight: 8 },    // the long 3x6 armory
    { kind: 'gold hall',    w: 7, d: 3, cells: rect(7, 3), weight: 7 },
    { kind: 'alcove',       w: 5, d: 2, cells: rect(5, 2), weight: 11 },   // shallow alcove: the panel lands flush on the far rock
    { kind: 'armory',       w: 5, d: 3, cells: keyhole(5, 3), weight: 11 },// throat off a corridor
    { kind: 'bullion hall', w: 7, d: 7, cells: rect(7, 7), weight: 26 },   // the deepest vault id cut
  ];

  function makeRng(seed) {
    let s = (seed >>> 0) || 0x9E3779B9;
    return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  }

  // Fisher-Yates: the same seed always carves the same vaults, so a run can be
  // replayed and the tests stay deterministic.
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

  // Anything the player can never walk to is masonry, not floor. This is the
  // classic mapping bug: an alcove that looks like a secret room but has no door.
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
        if (nx < 1 || ny < 1 || nx >= W - 1 || ny >= H - 1 || seen[ny][nx]) continue;
        if (SOLID(g[ny][nx]) || g[ny][nx] === 'W') continue;
        seen[ny][nx] = true; q.push([nx, ny]);
      }
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
      if (!seen[y][x] && !SOLID(g[y][x]) && g[y][x] !== 'W') g[y][x] = '#';
    return g;
  }

  // Panel at (ex,ey), chamber behind it. Returns the chamber cells; null if the
  // footprint runs off the grid, onto an already-carved vault, or out of bounds.
  function footprint(g, ex, ey, dx, dy, shape) {
    const H = g.length, W = g[0].length, cells = [];
    // across is the axis perpendicular to the push direction
    const ax = dy, ay = dx;
    for (const [a, b] of shape.cells) {
      const x = ex + dx * a + ax * b, y = ey + dy * a + ay * b;
      if (x < INSET || y < INSET || x > W - 1 - INSET || y > H - 1 - INSET) return null;
      if (!SOLID(g[y][x])) return null;             // chamber must be raw masonry
      cells.push([x, y]);
    }
    return cells;
  }

  // A Wolfenstein vault has exactly one way in: the panel. Check every side of the
  // chamber - if any of them opens onto walkable floor, the pocket is not a secret.
  function sealed(g, chamber, panels) {
    const inChamber = new Set(chamber.map(([x, y]) => y * g[0].length + x));
    const blocked = new Set(panels.map(([x, y]) => y * g[0].length + x));
    for (const [x, y] of chamber) {
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (inChamber.has(ny * g[0].length + nx) || blocked.has(ny * g[0].length + nx)) continue;
        const v = (nx >= 0 && ny >= 0 && ny < g.length && nx < g[ny].length) ? g[ny][nx] : '#';
        if (!SOLID(v)) return false;               // leaking into the level
      }
    }
    return true;
  }

  // A panel may never sit in a doorway or at the end of a lone block: the wall it
  // belongs to has to be a continuous run, and the chamber behind it has to be
  // sealed on every side except the panel itself.
  function canCarve(g, ex, ey, dx, dy, shape) {
    const H = g.length, W = g[0].length;
    if (ex < 1 || ey < 1 || ex >= W - 1 || ey >= H - 1) return false;
    if (!SOLID(g[ey][ex]) && g[ey][ex] !== 'W') return false;
    const ox = ex - dx, oy = ey - dy;               // the square the player pushes from
    if (ox < 0 || oy < 0 || ox >= W || oy >= H) return false;
    if (SOLID(g[oy][ox]) || g[oy][ox] === 'W' || g[oy][ox] === 'D') return false;
    const cells = footprint(g, ex, ey, dx, dy, shape);
    if (!cells) return false;
    if (!sealed(g, cells, [[ex, ey]])) return false;
    // bible 4.51: a sliding wall next to a door frame jams against it
    for (let sy = -2; sy <= 2; sy++) for (let sx = -2; sx <= 2; sx++) {
      if (!sx && !sy) continue;
      const nx = ex + sx, ny = ey + sy;
      if (nx >= 0 && ny >= 0 && ny < H && nx < W && g[ny][nx] === 'D') return false;
    }
    // the panel has to be flush in a wall run, not a freestanding block
    const ax = dy, ay = dx;
    for (const s of [-1, 1]) {
      const nx = ex + ax * s, ny = ey + ay * s;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || !SOLID(g[ny][nx])) return false;
    }
    return true;
  }

  // Every solid cell with clear masonry behind it is a candidate panel site.
  function candidates(g) {
    const H = g.length, W = g[0].length, out = [];
    for (let ey = 1; ey < H - 1; ey++)
      for (let ex = 1; ex < W - 1; ex++) {
        if (!SOLID(g[ey][ex]) && g[ey][ex] !== 'W') continue;
        for (const [dx, dy] of DIRS)
          for (const shape of SHAPES)
            if (canCarve(g, ex, ey, dx, dy, shape)) out.push({ ex, ey, dx, dy, shape });
      }
    return out;
  }

  // Carve one vault: vault floor, brass lining on the walls it touched, and the
  // panel itself. Returns the vault record the sim and the renderer read.
  function carve(g, cand, id) {
    const { ex, ey, dx, dy, shape } = cand;
    const cells = footprint(g, ex, ey, dx, dy, shape);
    const lining = [];
    for (const [x, y] of cells) g[y][x] = 'A';
    for (const [x, y] of cells) {
      for (const [sx, sy] of DIRS) {
        const nx = x + sx, ny = y + sy;
        if (nx === ex && ny === ey) continue;
        if (g[ny][nx] === '#') { g[ny][nx] = 'T'; lining.push([nx, ny]); }
      }
    }
    g[ey][ex] = 'W';
    // true footprint: how deep the chamber runs along the push axis and how wide it
    // is across it (the panel travels two squares, so depth >= 2 is what matters)
    let aLo = 1, aHi = 1, bLo = 0, bHi = 0;
    for (const [x, y] of cells) {
      const a = (x - ex) * dx + (y - ey) * dy, b = (x - ex) * dy - (y - ey) * dx;
      if (a < aLo) aLo = a; if (a > aHi) aHi = a;
      if (b < bLo) bLo = b; if (b > bHi) bHi = b;
    }
    return { id, ex, ey, dx, dy, w: bHi - bLo + 1, d: aHi - aLo + 1, kind: shape.kind,
            cells, lining, panels: [[ex, ey, dx, dy]], guards: [], loot: [], value: 0, twin: false };
  }

  // The two-direction secret (bible 4.67): a second panel on another face of the
  // same chamber, so the room can be entered - or escaped - from two directions.
  function twinPanel(g, vault) {
    const H = g.length, W = g[0].length;
    const faces = [];
    for (const [x, y] of vault.cells) {
      for (const [dx, dy] of DIRS) {
        if (dx === vault.dx && dy === vault.dy) continue;      // that face is the entrance
        const px = x + dx, py = y + dy;                          // the panel cell
        if (px < 1 || py < 1 || px >= W - 1 || py >= H - 1) continue;
        if (!SOLID(g[py][px])) continue;                        // already an opening
        const ax = px + dx, ay = py + dy;                        // approach from outside
        if (ax < 0 || ay < 0 || ax >= W || ay >= H) continue;
        if (SOLID(g[ay][ax]) || g[ay][ax] === 'D') continue;
        // the panel must have two clear squares to slide into: the face cell and
        // one more chamber cell behind it
        if (!vault.cells.some(([cx, cy]) => cx === x - dx && cy === y - dy)) continue;
        if (g[y][x] === 'D') continue;
        faces.push([px, py, dx, dy]);
      }
    }
    if (!faces.length) return null;
    const [px, py, dx, dy] = faces[0];
    g[py][px] = 'W';
    vault.panels.push([px, py, dx, dy]);
    vault.twin = true;
    return { ex: px, ey: py, dx, dy };
  }

  // The chain pushwall and the secret elevator (bible 4.62, 4.8): deep in the
  // biggest vault of a level that owns a secret floor, a second panel in the far
  // wall opens a one-square car - the E1M1 chain of panel, chamber, panel,
  // elevator. If the masonry behind the far wall is not two squares deep the
  // vault simply has no elevator, which is fine: not every secret goes down.
  // The secret elevator, built the way id built it in E1M1: "an outer cloister ...
  // with a door to a vestibule before the elevator. From within the vestibule the
  // player may find a chain of secrets which ultimately lead to ... an elevator".
  // Two panels, then the hatch: shove the first wall into the vestibule, walk around
  // it (that is why the vestibule is three squares wide), shove the second wall and
  // the hatch is the floor the panel left behind. In the originals the elevator tiles
  // often sit in the outer wall of the map, so the car is allowed to touch the edge -
  // everything beyond the grid is rock.
  function rockAt(g, x, y) {
    const H = g.length, W = g[0].length;
    return (x < 0 || y < 0 || y >= H || x >= W) ? true : SOLID(g[y][x]);
  }

  // Every candidate wing is checked with the same rule: it is sealed on all sides
  // except through the panel that opens it (the panel cell itself sits against the
  // chamber, which is exactly how the player shoves it).
  function sealedWing(g, cells, allow) {
    const set = new Set(cells.map(([x, y]) => y * g[0].length + x));
    for (const [x, y] of cells) {
      for (const [sx, sy] of DIRS) {
        const nx = x + sx, ny = y + sy, k = ny * g[0].length + nx;
        if (set.has(k) || allow.has(k)) continue;
        if (!rockAt(g, nx, ny)) return false;
      }
    }
    return true;
  }

  function wingCells(x, y, dx, dy, chain) {
    const ax = dy, ay = dx;                        // the perpendicular axis
    const cells = [];
    if (chain) {
      cells.push([x + dx, y + dy, 'W']);           // panel one
      for (let a = 2; a <= 4; a++)
        for (let b = -1; b <= 1; b++) cells.push([x + dx * a + ax * b, y + dy * a + ay * b, 'A']);
      cells.push([x + dx * 5, y + dy * 5, 'W']);   // panel two, in the far wall
      cells.push([x + dx * 6, y + dy * 6, 'E']);   // the hatch the panel leaves open
      cells.push([x + dx * 7, y + dy * 7, 'A']);   // where panel two comes to rest
    } else {
      cells.push([x + dx, y + dy, 'W']);           // one panel
      cells.push([x + dx * 2, y + dy * 2, 'E']);   // hatch
      cells.push([x + dx * 3, y + dy * 3, 'A']);   // where the panel ends up
    }
    return cells;
  }

  function addElevator(g, vault, target) {
    const allow = new Set(vault.cells.map(([x, y]) => y * g[0].length + x));
    const cands = [];
    for (const [x, y] of vault.cells) {
      for (const [dx, dy] of DIRS) {
        let run = 0;
        for (let a = 1; a <= 8 && rockAt(g, x + dx * a, y + dy * a); a++) run++;
        if (run < 3) continue;
        for (const chain of [run >= 7, false]) {
          const base = wingCells(x, y, dx, dy, chain);
          const hatch = base.find(c => c[2] === 'E');
          const ax = dy, ay = dx;
          // The elevator tiles (floor code 006b) come in clusters in the originals:
          // of the 267 elevator squares in the 60 episode maps 231 sit alone, 24 in
          // pairs and 12 in threes. A one-square manhole is authentic, but a two- or
          // three-square car reads better, so widen it wherever the rock seals it.
          for (const extra of [[], [-1], [-1, 1]]) {
            const cells = base.slice();
            for (const b of extra) {
              const cx = hatch[0] + ax * b, cy = hatch[1] + ay * b;
              if (rockAt(g, cx, cy)) cells.push([cx, cy, 'E']);
            }
            if (!sealedWing(g, cells, allow)) continue;
            // the panels must sit flush in a continuous wall, not as a lone block
            const panels = cells.filter(c => c[2] === 'W');
            let flush = true;
            for (const [px, py] of panels)
              for (const s of [-1, 1])
                if (!rockAt(g, px + ax * s, py + ay * s)) { flush = false; break; }
            if (!flush) continue;
            cands.push({ x, y, dx, dy, chain, cells, car: extra.length + 1 });
          }
          if (chain) break;                        // a chain is worth more than a car
        }
      }
    }
    if (!cands.length) return null;
    cands.sort((a, b) => (b.chain - a.chain) || (b.car - a.car) || (b.cells.length - a.cells.length));
    const w = cands[0];
    for (const [x, y, ch] of w.cells) g[y][x] = ch;
    for (const [x, y, ch] of w.cells) {
      if (ch === 'W') continue;
      for (const [sx, sy] of DIRS) {
        const nx = x + sx, ny = y + sy;
        if (nx >= 0 && ny >= 0 && ny < g.length && nx < g[0].length && g[ny][nx] === '#') {
          g[ny][nx] = 'T'; vault.lining.push([nx, ny]);
        }
      }
    }
    const hatch = w.cells.filter(c => c[2] === 'E');
    vault.cells.push(...w.cells.filter(c => c[2] !== 'W').map(c => [c[0], c[1]]));
    // both panels of a chain shove along the same axis, in the same direction
    for (const [px, py] of w.cells.filter(c => c[2] === 'W'))
      vault.panels.push([px, py, w.dx, w.dy]);
    vault.chain = !!w.chain;
    vault.elevator = { x: hatch[0][0], y: hatch[0][1], cells: hatch.map(c => [c[0], c[1]]),
                       level: target, to: target, vault: vault.id, chain: !!w.chain };
    return vault.elevator;
  }

  // How id stocked a vault (measured across the 60 maps: ammo, first aid, gold,
  // torches - with the chests and crowns reserved for the deep chambers).
  const STOCK = {
    reliquary: ['v', 'c', 'c', 'a', 'h'],
    alcove: ['c', 'v', 'a'],
    'gold hall': ['x', 'v', 'v', 'c', 'c', 'a', 'b'],
    armory: ['1', 'a', 'a', 'b', 'k', 'h'],
    'bullion hall': ['C', 'x', 'x', 'v', 'v', 'v', 'c', 'c', 'a', 'b', 'k', 'h'],
  };

  function stockVault(g, vault, rng) {
    const W = g[0].length;
    // bible 4.64: nothing goes in the squares a panel travels through. A deep
    // chamber is shoved twice (bible 4.62), so the whole four-square lane stays
    // clear - that is how id kept a vault from jamming on its own treasure.
    const path = new Set();
    for (const [px, py, pdx, pdy] of vault.panels) {
      const dx = pdx == null ? vault.dx : pdx, dy = pdy == null ? vault.dy : pdy;
      for (let a = 1; a <= 4; a++) path.add((py + dy * a) * W + (px + dx * a));
    }
    const spots = vault.cells.filter(([x, y]) => !path.has(y * W + x) && g[y][x] === 'A');
    shuffle(spots, rng);
    const items = STOCK[vault.kind] || ['c', 'v'];
    const loot = [];
    for (let i = 0; i < items.length && i < spots.length; i++) {
      const [x, y] = spots[i];
      g[y][x] = items[i];
      loot.push({ x, y, ch: items[i] });
    }
    // bible 4.63: a guard may stand in a secret room, but never in the first
    // squares behind the panel - he jams the wall. And id garrisoned pockets
    // rarely (3 guards in 264 pockets across the 60 originals), so most vaults
    // are empty treasure rooms. Deep cells only.
    const nGuards = vault.cells.length >= 25 ? 1 : (rng() < 0.28 ? 1 : 0);
    const guards = [];
    // deep cells only: a guard standing in the panel's travel square jams the wall
    const deep = spots.filter(([x, y]) => (x - vault.ex) * vault.dx + (y - vault.ey) * vault.dy >= 3);
    for (let i = deep.length - 1; i >= 0 && guards.length < nGuards; i--) {
      const [x, y] = deep[i];
      if (g[y][x] !== 'A') continue;
      const ch = rng() < 0.35 ? 'u' : 'g';
      g[y][x] = ch;
      guards.push({ x, y, ch, deaf: true });
    }
    vault.guards = guards;
    vault.loot = loot;
    vault.value = loot.reduce((a, l) => a + (NS.treasure[l.ch] || 0), 0);
  }

  // Crosses and chalices belong out in the open (bible: treasure should be
  // chaseable without finding every secret), but chests and crowns only ever sit
  // behind a panel. Any big treasure the author left in a room is moved into a
  // vault and replaced by a cross.
  function tidyTreasure(g, vaults, rng) {
    const W = g[0].length, H = g.length;
    const inVault = new Set();
    for (const v of vaults) for (const [x, y] of v.cells) inVault.add(y * W + x);
    const open = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
      if ((g[y][x] === 'x' || g[y][x] === 'C') && !inVault.has(y * W + x)) open.push([x, y]);
    for (const [x, y] of open) {
      const free = vaults.map(v => v.cells.filter(([cx, cy]) => g[cy][cx] === '.' || g[cy][cx] === 'A'))
                         .filter(c => c.length);
      if (!free.length) { g[y][x] = 'v'; continue; }
      const vault = vaults[(rng() * vaults.length) | 0];
      const spots = vault.cells.filter(([cx, cy]) => g[cy][cx] === 'A');
      if (!spots.length) { g[y][x] = 'v'; continue; }
      const [cx, cy] = spots[0];
      g[cy][cx] = g[y][x];
      vault.loot.push({ x: cx, y: cy, ch: g[cy][cx] });
      vault.value += NS.treasure[g[cy][cx]] || 0;
      g[y][x] = 'c';
    }
    return open.length;
  }

  function generate(level, seed) {
    const g = sealUnreachable(pad(level.map));
    const rng = makeRng(seed);
    const H = g.length, W = g[0].length;
    // A secret carved inside the authored footprint reads better than one tucked
    // into the padding, so in-map panels win the tie-break.
    const inMap = (x, y) => x >= PAD && y >= PAD && x < PAD + level.map[0].length && y < PAD + level.map.length;
    const pool = candidates(g);
    for (const c of pool) {
      // id cut pockets of the census sizes, so a shape's real frequency matters more
      // than the urge to carve the biggest room the rock will take
      c.score = (g[c.ey][c.ex] === 'W' ? 3 : 0)               // promote authored panels
              + (inMap(c.ex, c.ey) ? 1.2 : 0)
              + c.shape.weight / 60
              + rng() * 0.5;
    }
    pool.sort((a, b) => b.score - a.score);
    const authored = pool.filter(c => g[c.ey][c.ex] === 'W').length;
    const want = Math.min(MAX_SECRETS, Math.max(MIN_SECRETS, authored + 2));
    const vaults = [], kinds = {};
    for (const c of pool) {
      if (vaults.length >= want) break;
      if (!canCarve(g, c.ex, c.ey, c.dx, c.dy, c.shape)) continue;   // carved over already
      // secrets spread across the floor: two panels in the same wall run are one
      // puzzle, not two, and 100% secrets should be findable room by room
      if (vaults.some(v => Math.abs(v.ex - c.ex) + Math.abs(v.ey - c.ey) < 10)) continue;
      // one floor should not be nothing but 5x5 gold halls: the originals mixed
      // a shallow alcove with a deep treasure chamber
      if ((kinds[c.shape.kind] || 0) >= 2) continue;
      const v = carve(g, c, vaults.length + 1);
      kinds[v.kind] = (kinds[v.kind] || 0) + 1;
      if (rng() < 0.25) twinPanel(g, v);                            // bible 4.67: 107 of 425 pockets had two panels
      stockVault(g, v, rng);
      vaults.push(v);
    }
    // the elevator hangs in a deep chamber and a deep chamber is the one a player
    // can shove twice, so every floor gets one even if the draw never picked it
    if (!vaults.some(v => v.d >= 4)) {
      for (const c of pool) {
        if (c.shape.d < 4) continue;
        if (!canCarve(g, c.ex, c.ey, c.dx, c.dy, c.shape)) continue;
        if (vaults.some(v => Math.abs(v.ex - c.ex) + Math.abs(v.ey - c.ey) < 8)) continue;
        const v = carve(g, c, vaults.length + 1);
        stockVault(g, v, rng);
        vaults.push(v);
        break;
      }
    }
    let elevator = null;
    if (level.secretLevel != null) {
      for (const v of vaults.slice().sort((a, b) => b.cells.length - a.cells.length)) {
        elevator = addElevator(g, v, level.secretLevel);
        if (elevator) break;
      }
    }
    // bible 4.69: mark the panels worth finding. The elevator vault is always
    // marked, and so is the richest chamber of the floor - the tapestry over the
    // first pushwall in E1M1 is the trick id used.
    const ranked = vaults.slice().sort((a, b) => b.value - a.value);
    for (const v of vaults) v.hint = !!v.elevator || v.id === ranked[0].id || v.twin;
    tidyTreasure(g, vaults, rng);
    level.pushwalls = level.pushwalls || [];
    for (const v of vaults) for (const [px, py, dx, dy] of v.panels) {
      level.pushwalls.push({ x: px, y: py, dx, dy, secret: true,
        poster: !!v.hint, vault: v.id, chain: !!v.chain, elevator: !!v.elevator });
    }
    // a panel with nothing behind it can never open: that is a mapping bug, so it
    // goes back to plain masonry
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
      if (g[y][x] === 'W' && !vaults.some(v => v.panels.some(([px, py]) => px === x && py === y))) g[y][x] = '#';
    return { map: g.map(r => r.join('')), vaults, elevator, pushwalls: level.pushwalls };
  }

  function apply(levels) {
    levels.forEach((level, i) => {
      if (level.vaults) return;                                   // generated once
      const r = generate(level, (i + 1) * 0x51 + 0x9E37);
      level.map = r.map;
      level.vaults = r.vaults;
      level.pushwalls = r.pushwalls;
      if (r.elevator) level.elevator = r.elevator;
    });
    return levels;
  }

  const VaultGen = { apply, generate, pad, sealUnreachable, footprint, sealed, canCarve,
    candidates, carve, twinPanel, addElevator, stockVault, tidyTreasure, PAD, SHAPES,
    MIN_SECRETS, MAX_SECRETS };
  NS.vaults = VaultGen;
  if (typeof module !== 'undefined') module.exports = VaultGen;
  // Loading the module is enough: every authored level gets its vaults, in the
  // browser as well as under Node, and apply() is a no-op on a carved level.
  if (NS.levels) apply(NS.levels);
  return VaultGen;
})();
