// ================= GAME LOGIC (pure simulation: no DOM, no THREE) =================
// Everything hangs off the single GH namespace. The sim reads GH.input and is
// driven by update(dt), so it runs headless in tests exactly as it does in the
// browser.
(function () {
  // data.js declares GH as a top-level const in the browser; under Node we
  // require it directly. (typeof guard avoids a self-referential TDZ error.)
  const NS = (typeof GH !== 'undefined') ? GH :
             (typeof module !== 'undefined' ? require('./data.js') : globalThis.GH);

  const TAU = NS.tau;
  const WEAPONS = NS.weapons;
  const ENEMY = NS.enemy;

  // ---- deterministic RNG: same seed -> same run (tests, replays) ----
  function makeRng(seed) {
    let s = (seed >>> 0) || 0x9E3779B9;
    return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  }
  let rng = makeRng(1);

  // Audio is injected by audio.js as GH.sound; headless runs get a silent stub.
  const SILENT = new Proxy({}, { get: () => () => {} });
  let AUDIO = NS.sound || SILENT;

  // Active tuning = base GH.tune + the current level's tune overrides.
  let TUNE = NS.tune;

  // ---- world representation: flat arrays beat nested ones in hot paths ----
  const G = {
    state: 'title', level: 0, seed: 0, time: 0, kills: 0, total: 0, score: 0,
    noise: 0,                      // residual gunfire noise, decays each tick
    shake: 0, dmgFlash: 0, mini: true, hitT: 0,
    hitDir: 0, hitDirT: 0, stats: { shots: 0, hits: 0 },
    player: { x: 0, y: 0, a: 0, hp: 100, armor: 0, w: 0, ammo: { sg: 6, mg: 30 }, owns: { sg: false, mg: false },
              fireCd: 0, bob: 0, moving: false, stepT: 0, kick: 0, switchT: 0 },
    enemies: [], items: [], projs: [], fx: [], doors: [], exit: { x: 0, y: 0, active: false },
    secrets: { found: 0, total: 0 },
    pendingOverlay: null, overlayTimer: 0,   // death/win panels are timed by the sim
  };

  let W = 0, H = 0;
  let grid = [];                     // level rows as characters (minimap / renderer)
  let solid = new Uint8Array(0);     // 1 = blocks movement & sight, updated as doors slide
  let doorAt = [];                   // flat: door object or null
  let FLOW = null;                   // flat: FLOW[i] = next cell toward the player
  let flowT = 0;

  const EMPTY_INPUT = { fwd: 0, back: 0, left: 0, right: 0, turn: 0, fire: 0, fireEdge: 0, wantW: -1, sprint: 0 };
  const IN = () => NS.input || EMPTY_INPUT;
  const idx = (cx, cy) => cy * W + cx;
  const isWallCh = c => c === '#' || c === 'T' || c === '~';
  // Both the sim and the renderer read this: below woundFrac of its health a
  // figure limps and is painted with blood work.
  const wounded = e => e.hp < e.def.hp * TUNE.woundFrac;

  function cell(x, y) {
    const cx = Math.floor(x), cy = Math.floor(y);
    if (cx < 0 || cx >= W || cy < 0 || cy >= H) return '#';
    return grid[cy][cx];
  }
  function cellSolid(cx, cy) {
    if (cx < 0 || cy < 0 || cx >= W || cy >= H) return true;
    return solid[idx(cx, cy)] === 1;
  }
  // squared distance from a point to the cell rect [wx,wx+1] x [wy,wy+1]
  function rectDist2(x, y, wx, wy) {
    const dx = Math.max(wx - x, 0, x - (wx + 1));
    const dy = Math.max(wy - y, 0, y - (wy + 1));
    return dx * dx + dy * dy;
  }
  function isBlocked(x, y, r) {
    const cx = Math.floor(x), cy = Math.floor(y), r2 = r * r;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const wx = cx + ox, wy = cy + oy;
        if (wx < 0 || wy < 0 || wx >= W || wy >= H) {
          if (rectDist2(x, y, wx, wy) < r2) return true;
          continue;
        }
        if (solid[idx(wx, wy)] && rectDist2(x, y, wx, wy) < r2) return true;
      }
    }
    return false;
  }
  // slide along walls: each axis applied independently; true if anything moved
  function moveEnt(e, dx, dy, r) {
    let moved = false;
    if (dx && !isBlocked(e.x + dx, e.y, r)) { e.x += dx; moved = true; }
    if (dy && !isBlocked(e.x, e.y + dy, r)) { e.y += dy; moved = true; }
    return moved;
  }
  function collidePlayer() {   // push the player out of living enemies
    const p = G.player;
    for (const e of G.enemies) {
      if (e.dead) continue;
      const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy), min = TUNE.playerR + e.def.r;
      if (d > 0.001 && d < min) {
        const ux = dx / d, uy = dy / d, push = min - d;
        if (!isBlocked(p.x + ux * push, p.y + uy * push, TUNE.playerR)) { p.x += ux * push; p.y += uy * push; }
      }
    }
  }
  // DDA grid raycast. rayHit returns the distance plus the wall cell and the face
  // normal it struck (needed for bullet decals); castRay is the distance-only form.
  function rayHit(x, y, rdx, rdy) {
    let mx = Math.floor(x), my = Math.floor(y);
    const ddx = Math.abs(1 / (rdx || 1e-9)), ddy = Math.abs(1 / (rdy || 1e-9));
    const sx = rdx < 0 ? -1 : 1, sy = rdy < 0 ? -1 : 1;
    let tdx = (rdx < 0 ? (x - mx) : (mx + 1 - x)) * ddx;
    let tdy = (rdy < 0 ? (y - my) : (my + 1 - y)) * ddy;
    for (let i = 0; i < 64; i++) {
      if (tdx < tdy) { mx += sx; tdx += ddx; if (cellSolid(mx, my)) return { d: tdx - ddx, cx: mx, cy: my, nx: -sx, ny: 0 }; }
      else { my += sy; tdy += ddy; if (cellSolid(mx, my)) return { d: tdy - ddy, cx: mx, cy: my, nx: 0, ny: -sy }; }
    }
    return { d: 64, cx: mx, cy: my, nx: 0, ny: 0 };
  }
  function castRay(x, y, rdx, rdy) { return rayHit(x, y, rdx, rdy).d; }
  function hasLOS(x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0, d = Math.hypot(dx, dy) || 0.001;
    if (d < 0.05) return true;
    return castRay(x0, y0, dx / d, dy / d) >= d - 0.02;
  }
  // BFS from the player cell: FLOW[i] = the neighbouring cell one step closer
  function computeFlow() {
    FLOW = new Array(W * H).fill(null);
    const px = Math.floor(G.player.x), py = Math.floor(G.player.y);
    if (px < 0 || py < 0 || px >= W || py >= H) return FLOW;
    FLOW[idx(px, py)] = { tx: px, ty: py };
    const q = [idx(px, py)];
    for (let head = 0; head < q.length; head++) {
      const c = q[head], x = c % W, y = (c / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const n = idx(nx, ny);
        if (FLOW[n] !== null) continue;
        const ch = grid[ny][nx];
        if (isWallCh(ch) || ch === 'W') continue;   // secrets stay secret
        FLOW[n] = { tx: x, ty: y };                 // ordinary doors are routable
        q.push(n);
      }
    }
    return FLOW;
  }

  function buildWorld(levelIdx = 0) {
    const level = NS.levels[levelIdx] || NS.levels[0];
    G.level = levelIdx;
    TUNE = level.tune ? Object.assign({}, NS.tune, level.tune) : NS.tune;
    AUDIO = NS.sound || SILENT;
    grid = level.map; W = grid[0].length; H = grid.length;
    solid = new Uint8Array(W * H);
    doorAt = new Array(W * H).fill(null);
    rng = makeRng(G.seed || Date.now());
    G.enemies = []; G.items = []; G.doors = []; G.projs = []; G.fx = [];
    let px = 1.5, py = 1.5;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const c = grid[y][x], i = idx(x, y);
        solid[i] = isWallCh(c) ? 1 : 0;
        if (c === 'P') { px = x + 0.5; py = y + 0.5; }
        else if (c === 'D' || c === 'W') {
          const dr = { cx: x, cy: y, open: 0, push: c === 'W', found: false };
          G.doors.push(dr); doorAt[i] = dr; solid[i] = 1;      // shut until it slides open
        } else if (c === 'X') G.exit = { x: x + 0.5, y: y + 0.5, active: false };
        else if (ENEMY[c]) {
          const d = ENEMY[c];
          G.enemies.push({ t: c, def: d, x: x + 0.5, y: y + 0.5, hp: d.hp, a: rng() * TAU,
            cd: 1 + rng(), flash: 0, mz: 0, dead: false, deadT: 0, wa: rng() * TAU, wt: 0, anim: rng() * 9,
            mode: 'wander', lx: 0, ly: 0, flinch: 0, strafe: 1, stT: 0, tele: 0, charging: 0, moving: false });
        } else if ('12abhkH'.includes(c)) {
          const key = { '1': 'i1', '2': 'i2', 'a': 'ia', 'b': 'ib', 'h': 'ih', 'H': 'iH', 'k': 'ik' }[c];
          G.items.push({ key, x: x + 0.5, y: y + 0.5, taken: false, bob: rng() * 9 });
        }
      }
    }
    // face the exit (or fall back to "east" if the level has none)
    const faceA = G.exit.x ? Math.atan2(G.exit.y - py, G.exit.x - px) : 0;
    Object.assign(G.player, { x: px, y: py, a: faceA, hp: TUNE.maxHp, armor: 0, w: 0,
      ammo: { sg: 6, mg: 30 }, owns: { sg: false, mg: false }, fireCd: 0, bob: 0,
      moving: false, stepT: 0.38, kick: 0, switchT: 0 });
    G.time = 0; G.kills = 0; G.score = 0; G.shake = 0; G.dmgFlash = 0; G.noise = 0;
    G.total = G.enemies.length;
    G.stats = { shots: 0, hits: 0 }; G.hitDirT = 0; G.hitT = 0;
    G.secrets = { found: 0, total: G.doors.filter(d => d.push).length };
    G.pendingOverlay = null; G.overlayTimer = 0;
    computeFlow();
  }

  // A door's openness is the only thing that changes the solid grid, so keep
  // the two in lockstep here rather than re-deriving it on every collision.
  function setDoorOpen(d, v) {
    d.open = Math.max(0, Math.min(1, v));
    solid[idx(d.cx, d.cy)] = d.open < TUNE.doorPassFrac ? 1 : 0;
  }

  // torch positions derived from the level, so new maps light themselves up
  function torchCells() {
    const cells = [];
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const c = grid[y][x];
      if (c !== '.' && c !== 'X') continue;
      let walls = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ch = grid[y + dy][x + dx];
        if (isWallCh(ch) || ch === 'D' || ch === 'W') walls++;
      }
      if (walls >= 1) cells.push([x, y]);
    }
    return cells.filter((_, i) => i % 3 === 0).slice(0, TUNE.torchCount);
  }

  // Death/win panels are timed inside the sim clock, not with setTimeout, so
  // the UI state is deterministic and testable at a fixed dt.
  function queueOverlay(kind) {
    G.pendingOverlay = kind;
    G.overlayTimer = TUNE.overlayDelay;
  }

  function damagePlayer(d, sx, sy) {
    const p = G.player;
    if (G.state !== 'play' || d <= 0) return;
    if (p.armor > 0) { const ab = Math.min(p.armor, Math.ceil(d * TUNE.armorAbsorb)); p.armor -= ab; d -= ab; }
    p.hp -= d;
    G.dmgFlash = Math.min(1, G.dmgFlash + d / 40);
    G.shake = Math.min(8, G.shake + d * 0.25);
    if (sx !== undefined) { G.hitDir = Math.atan2(sy - p.y, sx - p.x); G.hitDirT = 0.7; }
    AUDIO.hurt();
    if (p.hp <= 0) {
      p.hp = 0; G.state = 'dead'; AUDIO.die();
      queueOverlay('dead');
    }
  }

  function killEnemy(e) {
    if (e.dead) return;
    e.dead = true; e.deadT = 0.6;
    G.kills++; G.score += TUNE.scorePerKill;
    G.fx.push({ kind: 'splat', x: e.x, y: e.y, t: TUNE.splatLife, max: TUNE.splatLife });
    G.fx.push({ kind: 'blood', x: e.x, y: e.y, t: 0.4, max: 0.4 });
    AUDIO.kill();
    const roll = rng();
    if (roll < TUNE.dropHealth) G.items.push({ key: 'ih', x: e.x, y: e.y, taken: false, bob: 0 });
    else if (roll < TUNE.dropHealth + TUNE.dropAmmo)
      G.items.push({ key: (e.t === 'u' || e.t === 'O') ? 'ib' : 'ia', x: e.x, y: e.y, taken: false, bob: 0 });
    if (G.kills >= G.total) {
      G.exit.active = true;
      AUDIO.unlock();
      G.fx.push({ kind: 'msg', text: 'THE EXIT IS OPEN', t: 3, max: 3 });
    }
  }

  function explode(x, y) {
    G.fx.push({ kind: 'boom', x, y, t: 0.32, max: 0.32 });
    const p = G.player, d = Math.hypot(p.x - x, p.y - y);
    AUDIO.boom(d);
    if (d < TUNE.boomRadius && hasLOS(x, y, p.x, p.y))
      damagePlayer(Math.round(TUNE.boomDamage * (1 - d / (TUNE.boomRadius + 0.2))), x, y);
  }

  function tryFire() {
    const p = G.player, w = WEAPONS[p.w];
    if (p.fireCd > 0) return;
    if (w.ammo && p.ammo[w.ammo] <= 0) { AUDIO.click(); p.fireCd = 0.25; return; }
    if (w.ammo) p.ammo[w.ammo]--;
    p.fireCd = w.rate; p.kick = w.kick; G.noise = 1;
    G.stats.shots++;
    // a gunshot alerts every enemy in earshot
    for (const e of G.enemies) {
      if (!e.dead && Math.hypot(e.x - p.x, e.y - p.y) < TUNE.gunAlarmRadius) {
        e.mode = 'chase'; e.lx = p.x; e.ly = p.y;
      }
    }
    if (p.w === 1) AUDIO.pump(0.22);            // pump action, offset in the audio layer
    const shoot = ang => {
      const rdx = Math.cos(ang), rdy = Math.sin(ang);
      const hit = rayHit(p.x, p.y, rdx, rdy);
      let best = null, bd = hit.d;
      for (const e of G.enemies) {
        if (e.dead) continue;
        const dx = e.x - p.x, dy = e.y - p.y;
        const dep = dx * rdx + dy * rdy, lat = -dx * rdy + dy * rdx;
        if (dep > 0.25 && dep < bd && Math.abs(lat) < e.def.r * 0.9) { bd = dep; best = e; }
      }
      if (best) {
        best.hp -= w.dmg; best.flash = 0.12; best.mode = 'chase'; best.lx = p.x; best.ly = p.y;
        G.stats.hits++;
        if (best.hp > 0) best.flinch = TUNE.flinchTime;
        G.fx.push({ kind: 'blood', x: best.x + (rng() - 0.5) * 0.4, y: best.y + (rng() - 0.5) * 0.4, t: 0.25, max: 0.25 });
        G.hitT = 0.12;
        if (best.hp <= 0) killEnemy(best);
      } else {
        // the bullet ended in masonry: leave a crater on the face it struck. A door
        // is a thin plane in the middle of its cell, so the crater goes on that plane
        // rather than on the cell boundary the ray stopped at.
        const dr = doorAt[hit.cy * W + hit.cx];
        const hx = (dr ? hit.cx + 0.5 : p.x + rdx * hit.d) + hit.nx * 0.03;
        const hy = (dr ? hit.cy + 0.5 : p.y + rdy * hit.d) + hit.ny * 0.03;
        const holes = G.fx.filter(f => f.kind === 'hole');
        if (holes.length >= 40) G.fx.splice(G.fx.indexOf(holes[0]), 1);
        G.fx.push({ kind: 'hole', x: hx, y: hy, nx: hit.nx, ny: hit.ny, t: 14, max: 14 });
      }
      G.fx.push({ kind: 'spark', x: p.x + rdx * Math.min(bd, 6), y: p.y + rdy * Math.min(bd, 6), t: 0.08, max: 0.08 });
    };
    for (let i = 0; i < w.pellets; i++)
      shoot(p.a + (i - (w.pellets - 1) / 2) * w.spread + (rng() - 0.5) * 0.012);
    if (p.w === 0) AUDIO.pistol(); else if (p.w === 1) AUDIO.shotgun(); else AUDIO.mg();
  }

  function tickPlayer(dt) {
    const p = G.player, inp = IN();
    p.fireCd -= dt;
    if (inp.wantW >= 0 && inp.wantW <= 2) {
      const own = inp.wantW === 0 || (inp.wantW === 1 && p.owns.sg) || (inp.wantW === 2 && p.owns.mg);
      if (own && p.w !== inp.wantW) { p.w = inp.wantW; p.switchT = 0.3; AUDIO.click(); }
      inp.wantW = -1;
    }
    p.a += inp.turn * TUNE.turnSpeed * dt;
    if (p.a > TAU || p.a < -TAU) p.a = ((p.a % TAU) + TAU) % TAU;   // keep the angle bounded
    const f = inp.fwd - inp.back, s = inp.right - inp.left;
    const cosA = Math.cos(p.a), sinA = Math.sin(p.a);
    let mx = cosA * f - sinA * s, my = sinA * f + cosA * s;
    const len = Math.hypot(mx, my);
    p.moving = len > 0;
    if (len > 0) {
      mx /= len; my /= len;
      const spd = TUNE.playerSpeed * (inp.sprint ? 1.55 : 1);
      moveEnt(p, mx * spd * dt, my * spd * dt, TUNE.playerR);
      p.bob += dt * 9;
      p.stepT -= dt;
      if (p.stepT <= 0) { p.stepT = 0.38; AUDIO.step(); }
    }
    const auto = WEAPONS[p.w].auto;
    if (inp.fire) {
      if ((auto || inp.fireEdge) && p.fireCd <= 0) tryFire();
      if (!auto) inp.fireEdge = 0;
    } else inp.fireEdge = 0;
    for (const it of G.items) {
      if (it.taken) continue;
      if (Math.hypot(it.x - p.x, it.y - p.y) > TUNE.pickupRadius) continue;
      let ok = true;
      if (it.key === 'i1') { p.ammo.sg += 4; if (!p.owns.sg) { p.owns.sg = true; p.w = 1; p.switchT = 0.3; } }
      else if (it.key === 'i2') { p.ammo.mg += 12; if (!p.owns.mg) { p.owns.mg = true; p.w = 2; p.switchT = 0.3; } }
      else if (it.key === 'ia') p.ammo.sg += 4;
      else if (it.key === 'ib') p.ammo.mg += 8;
      else if (it.key === 'ik') { if (p.armor >= TUNE.armorMax) ok = false; else p.armor = Math.min(TUNE.armorMax, p.armor + 50); }
      else if (it.key === 'ih') { if (p.hp >= TUNE.maxHp) ok = false; else p.hp = Math.min(TUNE.maxHp, p.hp + 30); }
      else if (it.key === 'iH') { if (p.hp >= TUNE.maxHp) ok = false; else p.hp = Math.min(TUNE.maxHp, p.hp + 60); }
      if (ok) { it.taken = true; AUDIO.pickup(); }
    }
    if (G.exit.active && Math.hypot(G.exit.x - p.x, G.exit.y - p.y) < TUNE.exitTouchDist) {
      G.state = 'win';
      G.score += Math.max(0, TUNE.winBonusTime - Math.floor(G.time) * TUNE.winBonusPerSec) + p.hp * TUNE.winBonusHp;
      AUDIO.win();
      queueOverlay('win');
    }
  }

  function tickEnemy(e, dt) {
    if (e.dead) { e.deadT -= dt; return; }
    e.cd -= dt; e.flash -= dt; if (e.mz > 0) e.mz -= dt;
    if (e.flinch > 0) { e.flinch -= dt; return; }          // staggered by a bullet hit
    const p = G.player;
    const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy) || 0.001;
    const limp = wounded(e) ? TUNE.woundSlow : 1;
    const sees = d < e.def.range && hasLOS(e.x, e.y, p.x, p.y);
    if (sees) { e.mode = 'chase'; e.lx = p.x; e.ly = p.y; }
    if (e.mode === 'chase' && !sees && d > 0.5) {
      // follow the flow field so enemies round corners instead of hugging walls
      const f = FLOW ? FLOW[idx(Math.floor(e.y), Math.floor(e.x))] : null;
      let mx = e.lx - e.x, my = e.ly - e.y;
      if (f) { mx = f.tx + 0.5 - e.x; my = f.ty + 0.5 - e.y; }
      const ld = Math.hypot(mx, my);
      if (ld > 0.3) {
        if (moveEnt(e, mx / ld * e.def.spd * dt * 0.9 * limp, my / ld * e.def.spd * dt * 0.9 * limp, e.def.r * 0.9)) e.anim += dt * 6 * limp;
        e.moving = true;
        return;
      }
      if (!f) { e.mode = 'wander'; e.wt = 1 + rng() * 2; }
    }
    if (e.mode === 'wander') {
      e.wt -= dt;
      if (e.wt <= 0) { e.wt = 1 + rng() * 2.5; e.wa = rng() * TAU; e.moving = rng() < 0.6; }
      if (e.moving && moveEnt(e, Math.cos(e.wa) * e.def.spd * 0.4 * limp * dt, Math.sin(e.wa) * e.def.spd * 0.4 * limp * dt, e.def.r * 0.9))
        e.anim += dt * 4 * limp;
      return;
    }
    e.a = Math.atan2(dy, dx);
    if (e.tele > 0) {                                       // brute charge telegraph
      e.tele -= dt; e.flash = 0.22; e.moving = false;
      if (e.tele <= 0) e.charging = TUNE.chargeTime;
      return;
    }
    if (e.charging > 0) {                                   // charged lunge
      e.charging -= dt;
      if (moveEnt(e, dx / d * TUNE.chargeSpeed * limp * dt, dy / d * TUNE.chargeSpeed * limp * dt, e.def.r * 0.9)) e.anim += dt * 10 * limp;
      e.moving = true;
      if (d < TUNE.meleeRange) { damagePlayer(Math.round(e.def.melee * 1.5), e.x, e.y); e.charging = 0; e.cd = e.def.rate; }
      return;
    }
    if (d > e.def.r + 0.6) {
      if (e.def.strafe && sees && d > TUNE.strafeMinDist) {
        // gunner strafes sideways while holding its preferred distance
        e.stT -= dt;
        if (e.stT <= 0) { e.stT = TUNE.strafeTimer + rng(); e.strafe *= -1; }
        const ux = dx / d, uy = dy / d;
        const keep = d > TUNE.strafeFar ? 1 : d < TUNE.strafeNear ? -1 : 0;
        const mx2 = ux * keep * 0.7 - uy * e.strafe * 0.8;
        const my2 = uy * keep * 0.7 + ux * e.strafe * 0.8;
        const l2 = Math.hypot(mx2, my2) || 1;
        if (moveEnt(e, mx2 / l2 * e.def.spd * limp * dt, my2 / l2 * e.def.spd * limp * dt, e.def.r * 0.9)) e.anim += dt * 7 * limp;
        e.moving = true;
      } else if (moveEnt(e, dx / d * e.def.spd * limp * dt, dy / d * e.def.spd * limp * dt, e.def.r * 0.9)) { e.anim += dt * 6 * limp; e.moving = true; }
      else e.moving = false;
    } else e.moving = false;
    if (e.cd <= 0 && sees) {
      e.flash = 0.15;
      if (e.def.charge && d > TUNE.chargeRangeMin && d < TUNE.chargeRangeMax) {
        e.tele = TUNE.chargeTelegraph; e.cd = e.def.rate + TUNE.chargeCdExtra; AUDIO.enemyShot(d);
      } else if (d < TUNE.meleeRange) {
        e.cd = TUNE.meleeCd; damagePlayer(e.def.melee, e.x, e.y);
      } else if (e.def.proj) {
        e.cd = e.def.rate; e.mz = 0.16;
        const n = e.t === 'r' ? 3 : 1;
        for (let i = 0; i < n; i++) {
          const an = e.a + (i - (n - 1) / 2) * 0.22 + (rng() - 0.5) * 0.08;
          G.projs.push({ x: e.x, y: e.y, vx: Math.cos(an) * TUNE.projSpeed, vy: Math.sin(an) * TUNE.projSpeed,
            t: e.def.proj, dmg: e.def.dmg, life: TUNE.projLife });
        }
        AUDIO.enemyShot(d);
      } else {
        e.cd = e.def.rate; e.mz = 0.16;
        const chance = Math.max(TUNE.hitChanceMin, TUNE.hitChanceBase - d * TUNE.hitChancePerDist);
        if (rng() < chance) {
          damagePlayer(e.def.dmg, e.x, e.y);
          G.fx.push({ kind: 'tracer', x0: e.x, y0: e.y, x1: p.x, y1: p.y, t: 0.09, max: 0.09 });
        }
        AUDIO.enemyShot(d);
      }
    }
  }

  // Enemy separation is bucketed by cell so it stays near-linear as a level
  // fills up, instead of checking every pair every tick.
  const SEP_BUCKET = 1;
  let sepPairs = 0;                 // pairs actually examined (useful for tests)
  function separateEnemies() {
    const buckets = new Map();
    const live = [];
    sepPairs = 0;
    for (const e of G.enemies) {
      if (e.dead) continue;
      const i = live.length;
      live.push(e);
      const key = ((e.x / SEP_BUCKET) | 0) * 1000 + ((e.y / SEP_BUCKET) | 0);
      const arr = buckets.get(key);
      if (arr) arr.push(i); else buckets.set(key, [i]);
    }
    for (let ai = 0; ai < live.length; ai++) {
      const a = live[ai];
      const bx = (a.x / SEP_BUCKET) | 0, by = (a.y / SEP_BUCKET) | 0;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const arr = buckets.get((bx + ox) * 1000 + (by + oy));
          if (!arr) continue;
          for (const bi of arr) {
            if (bi <= ai) continue;          // each pair handled exactly once
            sepPairs++;
            const b = live[bi];
            const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), min = a.def.r + b.def.r;
            if (d >= min) continue;
            if (d <= 0.001) {                      // perfectly stacked: nudge apart deterministically
              const ang = (ai * 0.7 + bi * 1.3) % TAU, half = min / 2;
              const nx = Math.cos(ang), ny = Math.sin(ang);
              if (!isBlocked(a.x - nx * half, a.y - ny * half, a.def.r * 0.8)) { a.x -= nx * half; a.y -= ny * half; }
              if (!isBlocked(b.x + nx * half, b.y + ny * half, b.def.r * 0.8)) { b.x += nx * half; b.y += ny * half; }
              continue;
            }
            const push = (min - d) / 2, ux = dx / d, uy = dy / d;
            if (!isBlocked(a.x - ux * push, a.y - uy * push, a.def.r * 0.8)) { a.x -= ux * push; a.y -= uy * push; }
            if (!isBlocked(b.x + ux * push, b.y + uy * push, b.def.r * 0.8)) { b.x += ux * push; b.y += uy * push; }
          }
        }
      }
    }
    return sepPairs;
  }


  function tickProjs(dt) {
    for (let i = G.projs.length - 1; i >= 0; i--) {
      const pr = G.projs[i];
      pr.life -= dt;
      // sub-step fast movers so a shell can't skip through a wall
      const steps = Math.max(1, Math.ceil(Math.hypot(pr.vx, pr.vy) * dt / 0.2));
      const sdt = dt / steps;
      let hit = false;
      for (let s = 0; s < steps; s++) {
        pr.x += pr.vx * sdt; pr.y += pr.vy * sdt;
        if (isBlocked(pr.x, pr.y, 0.1)) { hit = true; break; }
        const p = G.player;
        if (Math.hypot(p.x - pr.x, p.y - pr.y) < TUNE.playerR + 0.15) { hit = true; break; }
      }
      if (hit || pr.life <= 0) { explode(pr.x, pr.y); G.projs.splice(i, 1); }
    }
  }

  function tickDoors(dt) {
    const p = G.player;
    for (const d of G.doors) {
      const cx = d.cx + 0.5, cy = d.cy + 0.5;
      let near = Math.hypot(p.x - cx, p.y - cy) < TUNE.doorTriggerDist;
      if (!near) {
        for (const e of G.enemies) {
          if (!e.dead && e.mode === 'chase' && Math.hypot(e.x - cx, e.y - cy) < TUNE.doorTriggerDist) { near = true; break; }
        }
      }
      const want = near ? 1 : 0;
      if (want && d.open < 0.05) AUDIO.door();
      setDoorOpen(d, d.open + (want - d.open) * Math.min(1, dt * TUNE.doorOpenSpeed));
      if (d.push && !d.found && d.open > 0.5) {
        d.found = true; G.secrets.found++;
        AUDIO.unlock();
        G.fx.push({ kind: 'msg', text: 'SECRET FOUND!', t: 2.2, max: 2.2 });
      }
    }
  }

  function update(dt) {
    // Panels are driven by the sim clock, and the countdown keeps running even
    // after the sim stops (the player is already dead/won).
    if (G.pendingOverlay) {
      G.overlayTimer -= dt;
      if (G.overlayTimer <= 0) {
        const kind = G.pendingOverlay;
        G.pendingOverlay = null;
        if (typeof NS.onOverlay === 'function') NS.onOverlay(kind);
      }
    }
    if (G.state !== 'play') return;
    G.time += dt;
    G.noise = Math.max(0, G.noise - dt * 1.5);
    G.shake = Math.max(0, G.shake - dt * 14);
    G.dmgFlash = Math.max(0, G.dmgFlash - dt * 1.2);
    G.hitT = Math.max(0, G.hitT - dt);
    G.hitDirT = Math.max(0, G.hitDirT - dt);
    flowT -= dt;
    if (flowT <= 0) { computeFlow(); flowT = 0.4; }
    tickPlayer(dt);
    collidePlayer();
    for (const e of G.enemies) tickEnemy(e, dt);
    separateEnemies();
    tickProjs(dt);
    tickDoors(dt);
    for (let i = G.fx.length - 1; i >= 0; i--) { G.fx[i].t -= dt; if (G.fx[i].t <= 0) G.fx.splice(i, 1); }
    const p = G.player;
    p.kick = Math.max(0, (p.kick || 0) - dt * 0.25);
    p.switchT = Math.max(0, (p.switchT || 0) - dt);
  }

  const Game = {
    G, NS,
    tune: () => TUNE,
    buildWorld, update, tryFire, damagePlayer, killEnemy, explode, computeFlow,
    castRay, rayHit, hasLOS, isBlocked, cell, cellSolid, doorAt, torchCells, setDoorOpen,
    moveEnt, collidePlayer, separateEnemies, makeRng, wounded,
    width: () => W, height: () => H, grid: () => grid,
    levelCount: () => NS.levels.length,
    nextLevel: () => { buildWorld((G.level + 1) % NS.levels.length); return G.level; },
    hud: () => ({
      hp: Math.round(G.player.hp), armor: Math.round(G.player.armor),
      ammo: G.player.ammo, weapon: G.player.w, gun: WEAPONS[G.player.w].name,
      kills: G.kills, total: G.total, score: G.score, time: G.time,
      secrets: G.secrets, exit: G.exit.active, state: G.state,
      accuracy: G.stats.shots ? G.stats.hits / G.stats.shots : 0,
    }),
  };
  NS.game = Game;
  if (typeof module !== 'undefined') module.exports = Game;
  return Game;
})();
