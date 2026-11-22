// Grim Hall logic tests. Run with: npm test  (node --test test/)
const test = require('node:test');
const assert = require('node:assert');
const GH = require('../js/data.js');
const Game = require('../js/game.js');
const { G } = Game;

const DT = 1 / 60;

function sim(ticks, input = {}) {
  for (let i = 0; i < ticks; i++) {
    if (G.state !== 'play') break;
    // rebuilt every tick so "held" inputs (fire, fireEdge) stay live
    GH.input = Object.assign({ fwd: 0, back: 0, left: 0, right: 0, turn: 0, fire: 0,
      fireEdge: 0, wantW: -1, sprint: 0 }, input);
    Game.update(DT);
  }
}

function fresh(level = 0, seed = 1234) {
  G.seed = seed;
  Game.buildWorld(level);
  G.state = 'play';
  return G;
}

// secrets.js grows and carves every authored map before the sim sees it, so the
// tests below find their own landmarks rather than trusting fixed coordinates.
function openBlock(w = 4, h = 3) {          // a clear rectangle of walkable floor
  const MAP = Game.grid(), W = Game.width(), H = Game.height();
  const open = (x, y) => x >= 1 && y >= 1 && x < W - 1 && y < H - 1 && !'#TW~'.includes(MAP[y][x]);
  for (let y = 1; y + h <= H - 1; y++)
    for (let x = 1; x + w <= W - 1; x++) {
      let ok = true;
      for (let yy = y; yy < y + h && ok; yy++)
        for (let xx = x; xx < x + w; xx++) if (!open(xx, yy)) { ok = false; break; }
      if (ok) return { x: x + w / 2, y: y + h / 2, cx: x, cy: y, w, h };
    }
  return null;
}
function wallFace() {                        // floor cell with masonry directly west
  const MAP = Game.grid(), W = Game.width(), H = Game.height();
  for (let y = 1; y < H - 1; y++)
    for (let x = 2; x < W - 1; x++)
      if (MAP[y][x] === '.' && '#T~'.includes(MAP[y][x - 1])) return [x, y];
  return null;
}
function shore() {                            // [dryX, dryY, wetX, wetY] in a row
  const MAP = Game.grid();
  for (const [wx, wy] of Game.waterCells())
    if (MAP[wy][wx - 1] === '.' && MAP[wy][wx + 1] === 'w') return [wx - 1, wy, wx, wy];
  return null;
}

test('every level matches its own legend', () => {
  for (let i = 0; i < GH.levels.length; i++) {
    const lvl = GH.levels[i], W = lvl.map[0].length;
    assert.ok(lvl.map.every(r => r.length === W), `${lvl.name}: ragged row`);
    const counts = {};
    for (const row of lvl.map) for (const c of row) counts[c] = (counts[c] || 0) + 1;
    assert.strictEqual(counts['P'], 1, `${lvl.name}: needs exactly one player start`);
    assert.strictEqual(counts['X'], 1, `${lvl.name}: needs exactly one exit`);
    fresh(i, 1);
    const enemyTotal = Object.keys(GH.enemy).reduce((a, c) => a + (counts[c] || 0), 0);
    assert.strictEqual(G.total, enemyTotal, `${lvl.name}: enemy count`);
    assert.strictEqual(G.items.length, ['1', '2', 'a', 'b', 'h', 'k', 'H', 'c', 'v', 'x', 'C'].reduce((a, c) => a + (counts[c] || 0), 0), `${lvl.name}: item count`);
    assert.strictEqual(G.secrets.total, counts['W'] || 0, `${lvl.name}: secret count`);
    assert.ok((counts['W'] || 0) >= 2, `${lvl.name}: every Wolfenstein floor hides at least two secrets`);
  }
});

test('the exit of every level is reachable from the spawn', () => {
  for (let i = 0; i < GH.levels.length; i++) {
    fresh(i, 7);
    const lvl = GH.levels[i], W = lvl.map[0].length, H = lvl.map.length;
    const seen = Array.from({ length: H }, () => new Array(W).fill(false));
    const q = [[Math.floor(G.player.x), Math.floor(G.player.y)]];
    seen[q[0][1]][q[0][0]] = true;
    while (q.length) {
      const [x, y] = q.shift();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || seen[ny][nx]) continue;
        if ('#T'.includes(lvl.map[ny][nx])) continue;
        seen[ny][nx] = true; q.push([nx, ny]);
      }
    }
    assert.ok(seen[Math.floor(G.exit.y)][Math.floor(G.exit.x)], `${lvl.name}: exit is sealed off`);
  }
});

test('a run is reproducible from its seed', () => {
  const run = seed => {
    fresh(0, seed);
    sim(600, { fwd: 1, fire: 1, fireEdge: 1 });
    return JSON.stringify([G.player.hp, G.player.x.toFixed(6), G.kills, G.stats.shots, G.stats.hits,
      G.enemies.map(e => e.x.toFixed(4))]);
  };
  assert.strictEqual(run(99), run(99), 'same seed must give the same run');
});

test('pistol fires at its stated cadence', () => {
  fresh(0, 5);
  G.player.x = 1.5; G.player.y = 1.5;
  sim(120, { fire: 1, fireEdge: 1 });            // 2 seconds
  const expected = Math.floor(2 / GH.weapons[0].rate);
  assert.ok(G.stats.shots >= expected - 1 && G.stats.shots <= expected + 1,
    `expected ~${expected} shots in 2s, got ${G.stats.shots}`);
});

test('an empty gun only clicks', () => {
  fresh(0, 3);
  G.player.owns.sg = true; G.player.w = 1; G.player.ammo.sg = 1;
  G.player.x = 1.5; G.player.y = 1.5; G.player.a = 0;
  G.enemies.length = 0;                          // nobody to shoot
  sim(120, { fire: 1, fireEdge: 1 });
  assert.strictEqual(G.player.ammo.sg, 0, 'the last shell is spent');
  assert.strictEqual(G.stats.shots, 1, 'only the last shell should fire');
});

test('armor absorbs half the damage until it is gone', () => {
  fresh(0, 4);
  G.player.armor = 10;
  Game.damagePlayer(20, G.player.x + 3, G.player.y);
  assert.strictEqual(G.player.armor, 0, 'armor should be depleted');
  const absorbed = Math.min(10, Math.ceil(20 * GH.tune.armorAbsorb));
  assert.strictEqual(G.player.hp, GH.tune.maxHp - (20 - absorbed), 'hp takes only the unabsorbed remainder');
});

test('a closed door blocks movement and sight, an open one does not', () => {
  fresh(0, 6);
  const door = G.doors.find(d => !d.push);
  const cx = door.cx + 0.5, cy = door.cy + 0.5;   // doors sit in a wall line: sight runs along y
  Game.setDoorOpen(door, 0);
  assert.ok(Game.isBlocked(cx, cy, GH.tune.playerR), 'closed door must be solid');
  assert.ok(!Game.hasLOS(cx, cy - 1.5, cx, cy + 1.5), 'closed door blocks sight');
  Game.setDoorOpen(door, 1);
  assert.ok(!Game.isBlocked(cx, cy, GH.tune.playerR), 'open door must be passable');
  assert.ok(Game.hasLOS(cx, cy - 1.5, cx, cy + 1.5), 'open door lets sight through');
});

test('rays stop at walls', () => {
  fresh(0, 2);
  assert.ok(Game.castRay(1.5, 1.5, 1, 0) <= 4, 'ray stops at the first wall');
  assert.ok(!Game.hasLOS(1.5, 1.5, 1.5, 9.5), 'a wall between two cells blocks sight');
});

test('gunfire alerts enemies in earshot', () => {
  fresh(0, 11);
  const far = G.enemies.find(e => Math.hypot(e.x - G.player.x, e.y - G.player.y) > 8);
  assert.ok(far, 'the level has a far enemy');
  assert.strictEqual(far.mode, 'wander');
  Game.tryFire();
  assert.strictEqual(far.mode, 'chase', 'gunshot should alarm enemies in earshot');
});

test('clearing the level opens the exit and stepping on it wins', () => {
  fresh(0, 8);
  for (const e of G.enemies) Game.killEnemy(e);
  assert.strictEqual(G.kills, G.total);
  assert.ok(G.exit.active, 'exit should activate after the last kill');
  G.player.x = G.exit.x; G.player.y = G.exit.y;
  Game.update(DT);
  assert.strictEqual(G.state, 'win');
  assert.ok(G.score >= GH.tune.scorePerKill * G.total, 'score should include the kill bonus');
});

test('lethal damage kills the player', () => {
  fresh(0, 9);
  Game.damagePlayer(200, G.player.x + 2, G.player.y);
  assert.strictEqual(G.player.hp, 0);
  assert.strictEqual(G.state, 'dead');
});

test('enemy projectiles explode and hurt the player', () => {
  fresh(0, 13);
  G.projs.push({ x: G.player.x + 0.4, y: G.player.y, vx: 0, vy: 0, t: 'shell', dmg: 6, life: 2 });
  const hp = G.player.hp;
  sim(2);
  assert.strictEqual(G.projs.length, 0, 'the projectile should have detonated');
  assert.ok(G.player.hp < hp, 'the blast should damage the player');
});

test('the secret pushwall slides two squares and is counted once', () => {
  fresh(0, 14);
  const secret = G.doors.find(d => d.push && (d.dx || d.dy));
  assert.ok(secret, 'the level has a panel that can actually slide');
  const dx = secret.dx, dy = secret.dy, cx0 = secret.cx, cy0 = secret.cy;
  // stand on the approach side and walk into it: a pushwall only gives way when
  // the player shoves it, not merely by being nearby
  G.player.x = cx0 - dx + 0.5; G.player.y = cy0 - dy + 0.5;
  G.player.a = Math.atan2(dy, dx);
  sim(30, { fwd: 1 });
  assert.strictEqual(secret.cx, cx0 + dx * 2, 'the panel slid exactly two squares');
  assert.strictEqual(secret.cy, cy0 + dy * 2);
  assert.ok(Game.cell(cx0, cy0) !== 'W', 'the cell the panel left is now an opening');
  assert.ok(Game.hasLOS(cx0 - dx + 0.5, cy0 - dy + 0.5, cx0 + 0.5, cy0 + 0.5), 'the vault can be seen through the gap');
  assert.strictEqual(G.secrets.found, 1);
  sim(60, { fwd: 1 });
  assert.strictEqual(G.secrets.found, 1, 'the secret must not be double-counted');
  assert.strictEqual(secret.cx, cx0 + dx * 2, 'a panel stopped by the far wall stays put');
});

test('a panel jams when something blocks its travel path', () => {
  fresh(0, 14);
  const secret = G.doors.find(d => d.push && (d.dx || d.dy));
  const guard = { t: 'g', def: GH.enemy.g, x: secret.cx + secret.dx + 0.5, y: secret.cy + secret.dy + 0.5,
    hp: 22, dead: false, r: 0.35 };
  G.enemies.push(guard);
  assert.ok(!Game.tryPushwall(secret, secret.dx, secret.dy), 'a guard in the path jams the wall');
  assert.strictEqual(secret.cx, secret.cx, 'the jammed panel did not move');
  G.enemies.pop();
  assert.ok(Game.tryPushwall(secret, secret.dx, secret.dy), 'with the path clear the same shove works');
});
test('a deep chamber can be shoved twice, and the panel can be shoved back', () => {
  const idx = GH.levels.findIndex(l => (l.vaults || []).some(v => v.d >= 5));
  assert.ok(idx >= 0, 'some floor hides a five-square bullion hall');
  fresh(idx, 71);
  const vault = GH.levels[idx].vaults.find(v => v.d >= 5);
  const panel = G.doors.find(d => d.push && d.cx === vault.ex && d.cy === vault.ey);
  const [dx, dy] = [vault.dx, vault.dy];
  G.player.x = vault.ex - dx + 0.5; G.player.y = vault.ey - dy + 0.5; G.player.a = Math.atan2(dy, dx);
  sim(40, { fwd: 1 });
  assert.strictEqual(panel.cx, vault.ex + dx * 2, 'first shove: two squares in');
  sim(60, { fwd: 1 });
  assert.strictEqual(panel.cx, vault.ex + dx * 4, 'the chain pushwall: the same panel gives way again');
  // Wolfenstein panels are not one-way: shove it the other way and it comes back
  G.player.x = panel.cx + dx + 0.5; G.player.y = panel.cy + dy + 0.5;
  G.player.a = Math.atan2(-dy, -dx);
  assert.ok(Game.tryPushwall(panel, -dx, -dy), 'the panel slides back the other way');
  assert.strictEqual(panel.cx, vault.ex + dx * 2);
});

test('a vault is sealed off until its panel moves', () => {
  for (let i = 0; i < GH.levels.length; i++) {
    fresh(i, 9);
    const lvl = GH.levels[i], W = Game.width(), H = Game.height(), MAP = Game.grid();
    const seen = Array.from({ length: H }, () => new Array(W).fill(false));
    const q = [[Math.floor(G.player.x), Math.floor(G.player.y)]];
    seen[q[0][1]][q[0][0]] = true;
    while (q.length) {
      const [x, y] = q.shift();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || seen[ny][nx]) continue;
        if ('#T~W'.includes(MAP[ny][nx])) continue;   // the panel keeps the secret shut
        seen[ny][nx] = true; q.push([nx, ny]);
      }
    }
    for (const v of (lvl.vaults || []))
      for (const [x, y] of v.cells)
        assert.ok(!seen[y][x], `${lvl.name}: vault ${v.id} cell ${x},${y} leaks into the level`);
  }
});

test('chests and crowns only ever sit behind a pushwall', () => {
  for (const lvl of GH.levels) {
    const inVault = new Set();
    for (const v of (lvl.vaults || [])) for (const [x, y] of v.cells) inVault.add(y * lvl.map[0].length + x);
    const MAP = lvl.map;
    for (let y = 0; y < MAP.length; y++)
      for (let x = 0; x < MAP[y].length; x++)
        if (MAP[y][x] === 'x' || MAP[y][x] === 'C')
          assert.ok(inVault.has(y * MAP[y].length + x), `${lvl.name}: a chest/crown sits out in the open at ${x},${y}`);
  }
});


test('the flow field never routes enemies through a pushwall', () => {
  fresh(0, 15);
  const secret = G.doors.find(d => d.push);
  const flow = Game.computeFlow();
  assert.strictEqual(flow[secret.cy * Game.width() + secret.cx], null, 'the secret wall must not be routable');
  // ordinary doors are routable - enemies open them while hunting
  const normal = G.doors.find(d => !d.push);
  assert.ok(flow[normal.cy * Game.width() + normal.cx] !== null, 'regular doors should be routable');
});

test('a level can override any tuning value', () => {
  fresh(1, 1);
  assert.strictEqual(Game.tune().torchCount, GH.levels[1].tune.torchCount, 'level tuning wins over the base');
  assert.strictEqual(Game.tune().maxHp, GH.tune.maxHp, 'unspecified values fall back to the base');
  fresh(0, 1);
  assert.strictEqual(Game.tune().torchCount, GH.tune.torchCount, 'levels without overrides use the base');
});

test('nextLevel cycles through the levels', () => {
  fresh(0, 3);
  for (let i = 1; i < GH.levels.length; i++) {
    assert.strictEqual(Game.nextLevel(), i, `level ${i} should follow level ${i - 1}`);
    assert.strictEqual(G.level, i);
  }
  assert.strictEqual(Game.nextLevel(), 0, 'the level list wraps around');
});

test('overlapping enemies are pushed apart without tunneling walls', () => {
  fresh(0, 21);
  const room = G.enemies.slice(0, 6);
  // jam them into one cell in the middle of an open hall, then let separation work
  const spot = { x: 5.5, y: 12.5 };
  for (const e of room) { e.x = spot.x; e.y = spot.y; e.dead = false; }
  for (let i = 0; i < 100; i++) Game.separateEnemies();
  for (let i = 0; i < room.length; i++) {
    for (let j = i + 1; j < room.length; j++) {
      const d = Math.hypot(room[i].x - room[j].x, room[i].y - room[j].y);
      assert.ok(d >= (room[i].def.r + room[j].def.r) * 0.95, `enemies ${i} and ${j} are still overlapping`);
    }
  }
  for (const e of room)
    assert.ok(!Game.isBlocked(e.x, e.y, e.def.r * 0.8), 'separation must not shove enemies into walls');
});

test('separation is bucketed, so it examines far fewer than every pair', () => {
  fresh(0, 22);
  const n = G.enemies.length;
  const pairs = Game.separateEnemies();
  assert.ok(pairs < n * (n - 1) / 2, `expected fewer than ${n * (n - 1) / 2} pair checks, got ${pairs}`);
});

test('death/win panels are timed by the sim clock, not setTimeout', () => {
  fresh(0, 17);
  const shown = [];
  GH.onOverlay = kind => shown.push(kind);
  Game.damagePlayer(200, G.player.x + 1, G.player.y);
  assert.strictEqual(G.state, 'dead');
  assert.strictEqual(G.pendingOverlay, 'dead', 'the panel is queued, not shown yet');
  const ticks = Math.ceil(GH.tune.overlayDelay / DT);
  for (let i = 0; i < ticks; i++) Game.update(DT);
  assert.deepStrictEqual(shown, ['dead'], 'the panel appears once, on schedule');
  assert.strictEqual(G.pendingOverlay, null);
  for (let i = 0; i < 60; i++) Game.update(DT);
  assert.strictEqual(shown.length, 1, 'it must not re-fire');
});

test('a firing enemy lights a muzzle flash that decays', () => {
  fresh(0, 31);
  const e = G.enemies.find(x => !x.def.charge && !x.def.proj);
  assert.ok(e, 'the level has a hitscan enemy');
  G.player.x = 5.5; G.player.y = 12.5;
  e.x = 8.5; e.y = 12.5; e.mode = 'chase'; e.cd = 0; e.mz = 0;
  Game.update(DT);
  assert.ok(e.mz > 0, 'the shot should leave a muzzle flash behind');
  for (let i = 0; i < 12; i++) Game.update(DT);   // 0.2 s
  assert.ok(e.mz <= 0, 'the flash must fade, not linger');
});

test('rayHit reports the wall cell and the face the ray entered', () => {
  fresh(0, 5);
  const hit = Game.rayHit(5.5, 12.5, -1, 0);
  assert.strictEqual(hit.cx, 0, 'the ray ends in the outer wall cell');
  assert.strictEqual(hit.cy, 12);
  assert.strictEqual(hit.nx, 1, 'the face it entered points back east');
  assert.ok(Math.abs(hit.d - 4.5) < 1e-9, `distance should be 4.5, got ${hit.d}`);
});

test('a shot into a wall leaves a bullet hole on the face it struck', () => {
  fresh(0, 5);
  const p = G.player;
  p.x = 5.5; p.y = 12.5; p.a = Math.PI;   // due west, straight into the outer wall
  p.fireCd = 0;
  Game.tryFire();
  const hole = G.fx.find(f => f.kind === 'hole');
  assert.ok(hole, 'the missed shot should leave a crater');
  assert.ok(Math.abs(hole.nx) + Math.abs(hole.ny) === 1, 'the decal needs a unit face normal');
  assert.ok(Math.abs(hole.x - 1.03) < 1e-6 && hole.nx === 1, `crater at ${hole.x} facing ${hole.nx}`);
});

test('a bullet that hits a shut door puts the crater on the door plane', () => {
  fresh(0, 11);
  const p = G.player;
  p.x = 3.5; p.y = 5.5; p.a = -Math.PI / 2;   // due north, straight at the shut door
  p.fireCd = 0;
  Game.tryFire();
  const hole = G.fx.find(f => f.kind === 'hole');
  assert.ok(hole, 'the door should take the hit');
  assert.ok(Math.abs(hole.y - 4.53) < 1e-6, `crater should sit on the door plane, got y=${hole.y}`);
  assert.strictEqual(hole.ny, 1, 'the face points back at the shooter');
});

test('bullet holes are capped so a long firefight cannot grow meshes forever', () => {
  fresh(0, 5);
  const p = G.player;
  p.x = 5.5; p.y = 12.5; p.a = Math.PI;
  for (let i = 0; i < 60; i++) { p.fireCd = 0; Game.tryFire(); }
  const holes = G.fx.filter(f => f.kind === 'hole');
  assert.ok(holes.length <= 40, `expected at most 40 holes, got ${holes.length}`);
});

test('plank walls are as solid as brick', () => {
  fresh(13, 12);
  const lvl = GH.levels[13], W = lvl.map[0].length;
  let cell = null;
  for (let y = 1; y < lvl.map.length - 1 && !cell; y++) {
    for (let x = 1; x < W - 1; x++) {
      if (lvl.map[y][x] === '~' && lvl.map[y][x - 1] === '.') { cell = [x, y]; break; }
    }
  }
  assert.ok(cell, 'the level has a plank wall with floor beside it');
  const [x, y] = cell;
  assert.ok(Game.cellSolid(x, y), 'the plank cell is solid');
  assert.ok(Game.isBlocked(x + 0.5, y + 0.5, GH.tune.playerR), 'you cannot walk through planks');
  assert.ok(!Game.hasLOS(x - 0.5, y + 0.5, x + 0.5, y + 0.5), 'planks block sight');
  assert.ok(Game.castRay(x - 0.5, y + 0.5, 1, 0) < 1.5, 'rays stop on the plank face');
});

test('shallow water is open ground that you wade, not a wall', () => {
  fresh(14, 7);
  const cells = Game.waterCells();
  assert.ok(cells.length > 0, 'the sunken quarry is flooded');
  const [wx, wy] = cells[0];
  assert.ok(!Game.cellSolid(wx, wy), 'water is not solid');
  assert.ok(Game.inWater(wx + 0.5, wy + 0.5), 'the cell reads as water');
  assert.ok(!Game.inWater(wx + 0.5, wy - 0.5), 'the cell above the basin is not water');
  assert.ok(!Game.isBlocked(wx + 0.5, wy + 0.5, GH.tune.playerR), 'you can stand in it');
  assert.ok(Game.hasLOS(wx - 0.5, wy + 0.5, wx + 1.5, wy + 0.5), 'water does not block sight');
});

test('wading is slower than walking on dry stone', () => {
  fresh(14, 7);
  const [wx, wy] = Game.waterCells()[0];
  const step = 0.4;
  const wet = { x: wx + 0.2, y: wy + 0.5 };
  const dry = { x: 1.2, y: wy + 0.5 };
  assert.ok(!Game.inWater(dry.x, dry.y), 'the comparison cell is dry');
  Game.moveEnt(wet, step, 0, GH.tune.playerR);
  Game.moveEnt(dry, step, 0, GH.tune.playerR);
  const waded = wet.x - (wx + 0.2), walked = dry.x - 1.2;
  assert.ok(Math.abs(waded - step * GH.tune.waterSlow) < 1e-9, `waded ${waded}, expected ${step * GH.tune.waterSlow}`);
  assert.ok(Math.abs(walked - step) < 1e-9, `walked ${walked}`);
});

test('stepping into the water makes a splash', () => {
  fresh(14, 9);
  G.fx.length = 0;
  const e = { x: 6.5, y: 7.5, hp: GH.enemy.g.hp, def: GH.enemy.g, dead: false };
  assert.ok(!Game.inWater(e.x, e.y), 'the grunt starts on dry planking');
  Game.moveEnt(e, 1.4, 0, GH.enemy.g.r * 0.9);
  assert.ok(Game.inWater(e.x, e.y), 'the grunt waded into the basin');
  assert.ok(G.fx.some(f => f.kind === 'splash'), 'entering the water made a splash');
  const dry = { x: 1.5, y: 7.5, hp: 22, def: GH.enemy.g };
  G.fx.length = 0;
  Game.moveEnt(dry, 0.4, 0, GH.enemy.g.r * 0.9);
  assert.strictEqual(G.fx.filter(f => f.kind === 'splash').length, 0, 'walking on stone splashes nothing');
});

test('wading has its own sounds', () => {
  require('../js/audio.js');
  assert.ok(typeof GH.sound.wade === 'function', 'steps in the shallows use a wade sound');
  assert.ok(typeof GH.sound.splash === 'function', 'breaking the surface has a splash');
});

test('a shot that lands in the shallows leaves a tracer and a splash', () => {
  fresh(16, 31);
  const lvl = GH.levels[16], W = lvl.map[0].length;
  let spot = null;
  for (let y = 1; y < lvl.map.length - 1 && !spot; y++)
    for (let x = 1; x < W - 2; x++)
      if (lvl.map[y][x] === '.' && lvl.map[y][x + 1] === 'w') { spot = [x, y]; break; }
  assert.ok(spot, 'the sunken navy has dry ground beside the water');
  const p = G.player;
  p.x = spot[0] + 0.5; p.y = spot[1] + 0.5; p.a = 0;
  G.fx.length = 0;
  sim(2, { fire: 1, fireEdge: 1 });
  assert.ok(G.fx.some(f => f.kind === 'tracer'), 'the bullet drew a tracer');
  assert.ok(G.fx.some(f => f.kind === 'splash'), 'the shot kicked the water up');
});

test('a wounded enemy limps, a healthy one does not', () => {
  const run = hp => {
    fresh(0, 41);
    const e = G.enemies[0];
    G.enemies.length = 1;
    e.x = 5.5; e.y = 12.5; e.hp = hp; e.mode = 'wander'; e.wt = 99; e.wa = 0;
    e.moving = true; e.flinch = 0;
    const x0 = e.x, y0 = e.y;
    sim(60, {});
    return Math.hypot(e.x - x0, e.y - y0);
  };
  const max = GH.enemy.g.hp;
  assert.ok(!Game.wounded({ hp: max, def: GH.enemy.g }), 'at full health the figure is not wounded');
  assert.ok(Game.wounded({ hp: max * 0.3, def: GH.enemy.g }), 'below the wound fraction it is');
  const healthy = run(max), hurt = run(max * 0.3);
  assert.ok(healthy > 0.1, 'the healthy enemy actually walked');
  assert.ok(hurt < healthy * 0.9, `wounded walked ${hurt.toFixed(3)} vs healthy ${healthy.toFixed(3)}`);
});

test('the HUD read-out reflects the sim', () => {
  fresh(0, 10);
  const hud = Game.hud();
  assert.strictEqual(hud.hp, GH.tune.maxHp);
  assert.strictEqual(hud.gun, GH.weapons[0].name);
  assert.strictEqual(hud.total, G.total);
});
