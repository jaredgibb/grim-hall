// ================= THREE.JS RENDERER + INPUT + HUD =================
const Main = (() => {
  const VW = 480, VH = 300, WALL_H = 2.2, EYE = 0.62;
  // data.js declares the GH namespace; art/audio/game attach themselves to it.
  // THREE is the only real global (the vendored engine), everything else is
  // pulled off GH here so the renderer has local handles on the sim.
  const NS = GH;
  const Art = NS.art, Sound = NS.sound, Music = NS.music, Game = NS.game;
  const G = Game.G;                              // live sim state
  const TAU = NS.tau, WEAPONS = NS.weapons, LEVELS = NS.levels;
  let renderer, scene, camera, ART;
  let worldGroup = null, doorMeshes = [], enemyObjs = new Map(), itemObjs = new Map(), projObjs = new Map(), fxObjs = new Map(), corpseObjs = new Map();
  let waterMesh = null;
  let guns, gunLight, flashMesh, muzzleLight, muzzlePos, exitMesh, exitLight, flashLight, eFlash;
  let torches = [], flames = [], cones = [], embers = [], coneGeo = null;
  let msgDiv, lastMini = 0, popDiv, popUntil = 0, lastKills = 0, dmgDiv;
  const Input = { fwd: 0, back: 0, left: 0, right: 0, turn: 0, fire: 0, fireEdge: 0, wantW: -1, sprint: 0, autoFire: 0, aim: 0 };
  NS.input = Input;      // game.js reads GH.input
  window.Input = Input;  // handy for debugging from the console
  const keys = {};
  const WOUND_ON = !location.search.includes('nowound');   // A/B switch for wounded sprites
  // Touch device? Pointer-events alone are not enough: a laptop with a touchscreen
  // reports both. Coarse pointer is the honest signal, ?touch=1 forces it for tests.
  // Guarded because matchMedia/navigator are missing in the headless boot test.
  const TOUCH = (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) ||
                (typeof navigator === 'object' && navigator.maxTouchPoints > 0) ||
                (typeof window === 'object' && 'ontouchstart' in window) ||
                location.search.includes('touch=1');
  // Touch preferences, read once. Everything here is opt-in: an assist that is
  // forced on is an assist some players cannot turn off.
  const prefs = (() => { try { return JSON.parse(localStorage.getItem('gh.touch') || '{}'); } catch (e) { return {}; } })();
  const savePrefs = () => { try { localStorage.setItem('gh.touch', JSON.stringify(prefs)); } catch (e) {} };
  const TouchUI = { apply: () => {}, release: () => {} };
  NS.touch = TouchUI;   // the debug harness and console can reach the touch layer
  let lastHitDirT = 0;   // used to detect a *new* damage event for the haptic ping

  function init() {
    renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(1);
    renderer.setSize(VW, VH, false);
    renderer.outputEncoding = THREE.sRGBEncoding;
    document.getElementById('wrap').appendChild(renderer.domElement);
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x030303);
    scene.fog = new THREE.FogExp2(0x050505, 0.038);
    camera = new THREE.PerspectiveCamera(72, VW / VH, 0.05, 80);
    camera.rotation.order = 'YXZ';
    scene.add(camera);
    // lighting: dim ambient + player glow + flickering torches
    scene.add(new THREE.AmbientLight(0x3a4356, 0.85));
    const hemi = new THREE.HemisphereLight(0x2a2a33, 0x0a0805, 0.65); scene.add(hemi);
    flashLight = new THREE.PointLight(0xffe8b0, 0.9, 12, 1.4); scene.add(flashLight);
    muzzleLight = new THREE.PointLight(0xffc040, 0, 12, 2); scene.add(muzzleLight);
    eFlash = new THREE.PointLight(0xffaa40, 0, 7, 2); scene.add(eFlash);
    Game.buildWorld(G.level);
    buildWorldMeshes();
    POST.on = !location.search.includes('post=0');   // ?post=0 is the A/B switch
    buildPost();
    applyGrade();
    msgDiv = document.createElement('div');
    msgDiv.style.cssText = 'position:fixed;top:18%;width:100%;text-align:center;color:#ffd75e;font-size:22px;font-weight:bold;text-shadow:0 0 10px #a60;z-index:6;pointer-events:none;opacity:0;transition:opacity .2s';
    document.body.appendChild(msgDiv);
    popDiv = document.createElement('div');
    popDiv.style.cssText = 'position:fixed;left:50%;top:38%;transform:translateX(-50%);color:#7dff6a;font-size:20px;font-weight:bold;text-shadow:0 0 8px #0a0;z-index:6;pointer-events:none;opacity:0';
    document.body.appendChild(popDiv);
    dmgDiv = document.createElement('div');
    dmgDiv.id = 'dmgdir';
    document.body.appendChild(dmgDiv);
    bindInput();
    NS.onOverlay = showOverlay;   // the sim times the death/win panels (see update())
    syncExit();
    showOverlay('title');
    let last = performance.now(), lastState = G.state;
    requestAnimationFrame(function loop(t) {
      requestAnimationFrame(loop);
      const dt = Math.min(0.05, (t - last) / 1000 || 0.016);
      last = t;
      // A thumb resting on FIRE is not an edge. On a mouse you click again; on a
      // phone you just keep pushing, so a held trigger re-edges the semi-auto guns.
      if (Input.fire && Input.autoFire) Input.fireEdge = 1;
      aimAssist();
      Game.update(dt);
      if (G.state !== lastState) {              // music follows the game state
        if (G.state === 'play') Music.start(); else Music.stop();
        lastState = G.state;
      }
      syncScene(dt, t / 1000);
      renderFrame(t / 1000);
      updateHUD(t / 1000);
      if (location.search.includes('auto'))
        document.title = 'state=' + G.state + ' hp=' + Math.round(G.player.hp) + ' kills=' + G.kills + '/' + G.total +
          ' shots=' + G.stats.shots + ' hits=' + G.stats.hits +
          ' w=' + G.player.w + ' doorsOpen=' + G.doors.filter(d => d.open > 0.9).length + '/' + G.doors.length +
          ' projs=' + G.projs.length + ' draws=' + renderer.info.render.calls +
          ' x=' + G.player.x.toFixed(1) + ' y=' + G.player.y.toFixed(1);
    });
  }
  function buildWorldMeshes() {
    ART = Art.build(G.level);                 // per-level decor, cached by seed
    // the composite pass grades each level toward its own theme palette;
    // ?grade=0 turns the grade off for an A/B render
    applyGrade();
    const MAP = Game.grid(), MAPW = Game.width(), MAPH = Game.height();
    // rebuild-safe: tear the old level down so LEVELS can be swapped at runtime
    if (worldGroup) {
      worldGroup.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
      scene.remove(worldGroup);
    }
    doorMeshes = []; torches = []; flames = []; cones = []; embers = [];
    coneGeo = null; // the shared cone geometry was disposed with the old level
    worldGroup = new THREE.Group(); scene.add(worldGroup);

    // static walls: one InstancedMesh per material instead of ~256 meshes
    const geo = new THREE.BoxGeometry(1, WALL_H, 1);
    const brickCells = [], metalCells = [], plankCells = [];
    for (let y = 0; y < MAPH; y++) for (let x = 0; x < MAPW; x++) {
      const c = MAP[y][x];
      if (c === '#') brickCells.push([x, y]);
      else if (c === 'T') metalCells.push([x, y]);
      else if (c === '~') plankCells.push([x, y]);
    }
    const addInstanced = (cells, mat) => {
      if (!cells.length) return;
      const im = new THREE.InstancedMesh(geo, mat, cells.length);
      const d = new THREE.Object3D();
      for (let i = 0; i < cells.length; i++) {
        d.position.set(cells[i][0] + 0.5, WALL_H / 2, cells[i][1] + 0.5);
        d.updateMatrix();
        im.setMatrixAt(i, d.matrix);
      }
      im.instanceMatrix.needsUpdate = true;
      if (im.computeBoundingSphere) im.computeBoundingSphere();
      worldGroup.add(im);
    };
    // PBR surfaces: albedo + normal + roughness, so torch light actually pools
    // on the stone and the metal glints instead of washing flat
    const glowOn = !location.search.includes('glow=0');   // A/B switch for the slag glow
    const plankOn = !location.search.includes('noplink');  // A/B switch: render planks as brick
    const pbrMat = (set, rough, metal) => new THREE.MeshStandardMaterial({
      map: set.map, normalMap: set.normal, roughnessMap: set.rough,
      roughness: rough, metalness: metal,
      // slag-veined themes (forge, magma, glass, onyx) carry an emissive map, so
      // the walls glow in the dark instead of depending on a torch being nearby
      emissive: set.emi && glowOn ? new THREE.Color(set.glow) : 0x000000,
      emissiveMap: set.emi && glowOn ? set.emi : null,
      emissiveIntensity: set.emi && glowOn ? 1.15 : 0,
    });
    addInstanced(brickCells, pbrMat(ART.tex.brick, 0.92, 0.05));
    addInstanced(metalCells, pbrMat(ART.tex.metal, 0.45, 0.75));
    addInstanced(plankCells, pbrMat(ART.tex.plank, 0.78, 0.04));

    // doors and pushwalls animate individually, and keep a direct ref to their logic object
    for (let y = 0; y < MAPH; y++) for (let x = 0; x < MAPW; x++) {
      const c = MAP[y][x];
      if (c === 'W') { // pushwall: looks like brick, slides up when approached
        const m = new THREE.Mesh(geo, pbrMat(ART.tex.brick, 0.92, 0.05));
        m.position.set(x + 0.5, WALL_H / 2, y + 0.5);
        worldGroup.add(m);
        doorMeshes.push({ mesh: m, door: G.doors.find(d => d.cx === x && d.cy === y), baseY: WALL_H / 2 });
      } else if (c === 'D') {
        const g2 = new THREE.BoxGeometry(0.94, WALL_H, 0.12);
        const m = new THREE.Mesh(g2, pbrMat(ART.tex.door, 0.72, 0.12));
        m.position.set(x + 0.5, WALL_H / 2, y + 0.5);
        worldGroup.add(m);
        doorMeshes.push({ mesh: m, door: G.doors.find(d => d.cx === x && d.cy === y), baseY: WALL_H / 2 });
      }
    }
    // floor + ceiling: the three maps of a PBR set must tile together
    const tile = (set, n, m) => { set.map.repeat.set(n, m); set.normal.repeat.set(n, m); set.rough.repeat.set(n, m); if (set.emi) set.emi.repeat.set(n, m); };
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(MAPW, MAPH), pbrMat(ART.tex.floor, 0.85, 0.08));
    tile(ART.tex.floor, MAPW, MAPH);
    fl.rotation.x = -Math.PI / 2; fl.position.set(MAPW / 2, 0, MAPH / 2); worldGroup.add(fl);
    const ce = new THREE.Mesh(new THREE.PlaneGeometry(MAPW, MAPH), pbrMat(ART.tex.ceil, 0.95, 0.02));
    tile(ART.tex.ceil, MAPW, MAPH);
    ce.rotation.x = Math.PI / 2; ce.position.set(MAPW / 2, WALL_H, MAPH / 2); worldGroup.add(ce);
    // exit sign
    exitMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9),
      new THREE.MeshBasicMaterial({ map: ART.tex.exit, transparent: true, alphaTest: 0.4 }));
    worldGroup.add(exitMesh);
    exitLight = new THREE.PointLight(0xff2020, 0.7, 6, 1.5); worldGroup.add(exitLight);
    // torches: derived from the active level, so new maps light themselves up
    const cells = Game.torchCells();
    for (const [tx, ty] of cells) {
      const l = new THREE.PointLight(0xff7a20, 0.85, 7, 1.8);
      l.position.set(tx + 0.5, WALL_H - 0.25, ty + 0.5);
      l.userData.ph = Math.random() * 9;
      worldGroup.add(l); torches.push(l);
      const q2 = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.7),
        new THREE.MeshBasicMaterial({ map: ART.tex.ceilLight }));
      q2.rotation.x = Math.PI / 2; q2.position.set(tx + 0.5, WALL_H - 0.005, ty + 0.5);
      worldGroup.add(q2);
      const f2 = mkSprite(ART.flame[0], 0.2, 0.3);
      f2.position.set(tx + 0.5, WALL_H - 0.42, ty + 0.5);
      f2.userData.ph = Math.random() * 9;
      worldGroup.add(f2);
      flames.push(f2);
      // volumetric shaft hanging from the flame: apex at the torch, base just
      // above the floor. ?nocone turns the shafts and their embers off for an
      // A/B render.
      if (!location.search.includes('nocone')) {
        const c2 = mkCone(l.userData.ph);
        c2.position.set(tx + 0.5, WALL_H - 0.25 - 0.8, ty + 0.5);
        worldGroup.add(c2);
        cones.push(c2);
        // embers drifting down the shaft
        for (let k = 0; k < 3; k++) {
          const e = new THREE.Sprite(new THREE.SpriteMaterial({
            map: ART.ember[k % 2], transparent: true,
            blending: THREE.AdditiveBlending, depthWrite: false }));
          e.scale.set(0.07, 0.07, 1);
          e.position.set(tx + 0.5, WALL_H - 0.42, ty + 0.5);
          e.userData = { cx: tx + 0.5, cz: ty + 0.5, ph: Math.random() * 9, sp: 0.3 + Math.random() * 0.35 };
          worldGroup.add(e);
          embers.push(e);
        }
      }
    }
    // shallow water: every `w` cell gets a rippling shader surface, lit by the
    // torches above it. ?nowater drops it for an A/B render.
    const wcells = Game.waterCells();
    if (wcells.length && !location.search.includes('nowater')) {
      waterMesh = mkWater(wcells, (LEVELS[G.level] || {}).theme);
      if (waterMesh) worldGroup.add(waterMesh);
    }
    // wall decorations on wall faces that border floor
    const decorKeys = ['poster', 'skull', 'pipes'];
    const decorCount = Game.tune().decorCount || 14;
    let placed = 0, tries = 0;
    while (placed < decorCount && tries++ < 500) {
      const x = 1 + (Math.random() * (MAPW - 2)) | 0, y = 1 + (Math.random() * (MAPH - 2)) | 0;
      if (MAP[y][x] !== '#' && MAP[y][x] !== 'T' && MAP[y][x] !== '~') continue;
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => {
        const nx = x + dx, ny = y + dy;
        return MAP[ny] && MAP[ny][nx] !== '#' && MAP[ny][nx] !== 'T' && MAP[ny][nx] !== '~' && MAP[ny][nx] !== 'D';
      });
      if (!dirs.length) continue;
      const [dx, dy] = dirs[(Math.random() * dirs.length) | 0];
      const key = decorKeys[(Math.random() * decorKeys.length) | 0];
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8),
        new THREE.MeshLambertMaterial({ map: ART.decor[key] }));
      m.position.set(x + 0.5 + dx * 0.51, 1.0 + Math.random() * 0.4, y + 0.5 + dy * 0.51);
      m.rotation.y = dx !== 0 ? (dx > 0 ? Math.PI / 2 : -Math.PI / 2) : (dy > 0 ? 0 : Math.PI);
      worldGroup.add(m);
      placed++;
    }
    buildWeapon();   // the guns are rebuilt with each level's theme metal/wood
  }
  function syncExit() {
    exitMesh.position.set(G.exit.x, 1.1, G.exit.y);
    exitMesh.lookAt(camera.position.x, 1.1, camera.position.z);
    exitLight.position.set(G.exit.x, 1.4, G.exit.y);
    exitLight.color.setHex(G.exit.active ? 0x20ff50 : 0xff2020);
  }
  // The viewmodel quad is pinned to the bottom-right of the visible band: its
  // right edge is flush with the screen edge, so the forearm runs off-frame
  // instead of being sawn off in mid-air, and its bottom edge sits exactly on the
  // HUD line. Both anchors follow fov (which punches up on recoil), so the whole
  // gun - barrel, grip, trigger guard and hand - stays on screen.
  const VIEW = { w: 0.62, h: 0.24, z: -0.5 };
  const HUD_FRAC = 0.2;                    // HUD bar = canvasWidth/8 = 20% of canvas height
  function viewAnchor() {
    const halfH = Math.tan(camera.fov * Math.PI / 360) * -VIEW.z;
    const halfW = halfH * (VW / VH);
    return { x: halfW - VIEW.w / 2, y: -halfH + HUD_FRAC * 2 * halfH + VIEW.h / 2 };
  }
  // ---- viewmodel guns ----
  // Real geometry instead of a painted quad: a bored barrel, a forged slide, a
  // carved stock, a gloved hand. Because they are solid objects in the scene, the
  // hall lights them — a torch on the left catches the flank of the steel, and the
  // muzzle flash lights the gun itself for the shot.
  const GUN_YAW = 1.12;                   // the gun is held across the body, muzzle up-left
  const GUN_TILT = 0.12;
  const FWD = Math.PI / 2;                // tips a cylinder's +Y axis onto the forward (-Z) axis
  const cyl = (r, h, s = 20) => new THREE.CylinderGeometry(r, r, h, s);
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  // scratch objects for the muzzle-flash billboard; built lazily so the boot test
  // can load main.js against a stubbed THREE
  let UNIT_Y = null, ROLLQ = null;

  function gunTex(t, rep) {
    // the masonry maps are cut for a 1 m wall; a gun is a hand's width, so tile
    // them a few times across each face to get machined grain instead of bricks
    const out = {};
    for (const k of ['map', 'normal', 'rough']) {
      const c = t[k].clone();
      c.repeat = rep;
      out[k] = c;
    }
    return out;
  }

  function gunMaterials() {
    const m = gunTex(ART.tex.metal, 6), w = gunTex(ART.tex.plank, 3);
    const steel = new THREE.MeshStandardMaterial({ map: m.map, normalMap: m.normal, roughnessMap: m.rough,
      color: 0x9aa4ae, metalness: 0.55, roughness: 0.32, depthTest: false, depthWrite: false });
    const dark = new THREE.MeshStandardMaterial({ map: m.map, normalMap: m.normal, roughnessMap: m.rough,
      color: 0x3a4149, metalness: 0.4, roughness: 0.45, depthTest: false, depthWrite: false });
    const wood = new THREE.MeshStandardMaterial({ map: w.map, normalMap: w.normal, roughnessMap: w.rough,
      color: 0x7b5230, metalness: 0.08, roughness: 0.68, depthTest: false, depthWrite: false });
    const leather = new THREE.MeshStandardMaterial({ color: 0x5a4736, metalness: 0.05, roughness: 0.8,
      depthTest: false, depthWrite: false });
    return { steel, dark, wood, leather };
  }

  // depthTest is off (the gun must never be clipped by a wall you are pressed
  // against), so the parts are drawn back-to-front: the far end first.
  function gunMesh(parts) {
    const g = new THREE.Group();
    parts.sort((a, b) => a.z - b.z);
    for (const p of parts) {
      const mesh = new THREE.Mesh(p.geo, p.mat);
      mesh.position.set(p.x, p.y, p.z);
      mesh.rotation.set(p.rx || 0, p.ry || 0, p.rz || 0);
      mesh.renderOrder = 10;
      g.add(mesh);
      if (p.key) { g[p.key] = mesh; g[p.key + 'Z'] = p.z; }
    }
    return g;
  }

  // the shooting hand, shared by all three guns: palm on the grip, three fingers
  // curled over the front of it
  function hand(M, gx, gy, gz) {
    return [
      { geo: box(0.048, 0.086, 0.052), mat: M.leather, x: gx + 0.004, y: gy, z: gz, rx: -0.2 },
      { geo: box(0.012, 0.05, 0.02), mat: M.leather, x: gx - 0.028, y: gy + 0.012, z: gz - 0.012, rx: -0.3 },
      { geo: box(0.012, 0.046, 0.02), mat: M.leather, x: gx - 0.028, y: gy - 0.018, z: gz - 0.004, rx: -0.3 },
      { geo: box(0.012, 0.042, 0.02), mat: M.leather, x: gx - 0.028, y: gy - 0.046, z: gz + 0.006, rx: -0.3 },
    ];
  }

  function buildPistol(M) {
    const g = gunMesh([
      { geo: cyl(0.016, 0.022), mat: M.dark, x: 0, y: 0.022, z: -0.192, rx: FWD },     // muzzle
      { geo: cyl(0.012, 0.055), mat: M.steel, x: 0, y: 0.022, z: -0.162, rx: FWD },    // barrel
      { geo: box(0.012, 0.011, 0.014), mat: M.dark, x: 0, y: 0.04, z: -0.15 },         // front sight
      { geo: box(0.034, 0.034, 0.165), mat: M.steel, x: 0, y: 0.022, z: -0.082, key: 'slide' },  // slide
      { geo: box(0.036, 0.016, 0.05), mat: M.dark, x: 0.006, y: 0.024, z: -0.05 },     // ejection port
      { geo: box(0.014, 0.013, 0.018), mat: M.dark, x: 0, y: 0.041, z: -0.02 },        // rear sight
      { geo: new THREE.TorusGeometry(0.019, 0.005, 8, 20), mat: M.dark, x: 0, y: -0.016, z: -0.022, ry: Math.PI / 2 },
      { geo: box(0.010, 0.022, 0.012), mat: M.steel, x: 0, y: -0.02, z: -0.022 },      // trigger
      { geo: box(0.032, 0.115, 0.048), mat: M.wood, x: 0, y: -0.056, z: 0.022, rx: -0.2 },
      ...hand(M, 0, -0.056, 0.03),
    ]);
    g.muzzleTip = new THREE.Object3D();
    g.muzzleTip.position.set(0, 0.022, -0.205);
    g.add(g.muzzleTip);
    return g;
  }

  function buildShotgun(M) {
    const g = gunMesh([
      { geo: cyl(0.018, 0.022), mat: M.dark, x: -0.017, y: 0.03, z: -0.325, rx: FWD },
      { geo: cyl(0.018, 0.022), mat: M.dark, x: 0.017, y: 0.03, z: -0.325, rx: FWD },
      { geo: cyl(0.015, 0.29), mat: M.steel, x: -0.017, y: 0.03, z: -0.17, rx: FWD },   // barrels
      { geo: cyl(0.015, 0.29), mat: M.steel, x: 0.017, y: 0.03, z: -0.17, rx: FWD },
      { geo: box(0.034, 0.012, 0.28), mat: M.dark, x: 0, y: 0.046, z: -0.17 },          // rib
      { geo: box(0.042, 0.04, 0.09), mat: M.wood, x: 0, y: 0.004, z: -0.115, key: 'pump' },
      { geo: box(0.048, 0.056, 0.16), mat: M.steel, x: 0, y: 0.012, z: -0.02 },         // receiver
      { geo: box(0.042, 0.105, 0.20), mat: M.wood, x: 0.003, y: -0.042, z: 0.085, rx: 0.24 },
      ...hand(M, 0, -0.05, -0.005),
    ]);
    g.muzzleTip = new THREE.Object3D();
    g.muzzleTip.position.set(0, 0.03, -0.34);
    g.add(g.muzzleTip);
    return g;
  }

  function buildMachineGun(M) {
    const g = gunMesh([
      { geo: cyl(0.02, 0.03), mat: M.dark, x: 0, y: 0.02, z: -0.405, rx: FWD },
      { geo: cyl(0.014, 0.32), mat: M.steel, x: 0, y: 0.02, z: -0.24, rx: FWD },
      { geo: box(0.05, 0.028, 0.16), mat: M.dark, x: 0, y: 0.05, z: -0.19 },            // heat shield
      { geo: box(0.056, 0.076, 0.22), mat: M.steel, x: 0, y: 0.012, z: -0.05 },         // receiver
      { geo: cyl(0.05, 0.05), mat: M.dark, x: -0.052, y: 0.004, z: -0.05, rz: FWD },    // drum
      { geo: box(0.032, 0.11, 0.05), mat: M.wood, x: 0, y: -0.05, z: 0.055, rx: -0.2 },
      { geo: box(0.038, 0.085, 0.16), mat: M.wood, x: 0.003, y: -0.028, z: 0.13, rx: 0.16 },
      ...hand(M, 0, -0.05, 0.06),
    ]);
    g.muzzleTip = new THREE.Object3D();
    g.muzzleTip.position.set(0, 0.02, -0.42);
    g.add(g.muzzleTip);
    return g;
  }

  function buildWeapon() {
    UNIT_Y = new THREE.Vector3(0, 1, 0);
    ROLLQ = new THREE.Quaternion();
    muzzlePos = new THREE.Vector3();   // scratch for the muzzle's world position
    if (!gunLight) {
      // a shoulder lamp on the camera: the hall lights are metres away, and a
      // viewmodel 0.5 m from the eye needs its own key or it reads as a silhouette
      gunLight = new THREE.PointLight(0xd6e4f2, 0.7, 1.5, 1.3);
      gunLight.position.set(0.18, 0.42, 0.12);
      camera.add(gunLight);
    }
    if (guns) {
      for (const g of guns) {
        g.traverse(o => { if (o.geometry) o.geometry.dispose(); });
        camera.remove(g);
      }
    }
    const M = gunMaterials();
    guns = [buildPistol(M), buildShotgun(M), buildMachineGun(M)];
    for (const g of guns) {
      g.rotation.order = 'YXZ';
      g.visible = false;
      camera.add(g);
    }
    // the flash is a world-space billboard at the muzzle, so it always faces the eye
    if (!flashMesh) {
      flashMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ map: ART.flash, transparent: true, depthWrite: false, depthTest: false }));
      flashMesh.renderOrder = 11;
      flashMesh.visible = false;
      scene.add(flashMesh);
    } else {
      flashMesh.material.map = ART.flash;
    }
  }

  // ---- post-processing ----
  // r147 core ships no EffectComposer, so the passes are wired by hand:
  // scene -> full-res RT -> quarter-res bright pass -> separable Gaussian blur
  // (ping-pong, two iterations) -> composite to the screen. THREE renders into
  // a render target with LinearEncoding and defines linearToOutputTexel in every
  // non-raw shader prefix, so the grade is converted to sRGB exactly once, at the
  // end of the composite - the same conversion a direct renderer.render() applies.
  const POST = {
    on: true,
    bloom: 0.85, threshold: 0.42, knee: 0.30,
    vignette: 0.38, grain: 0.04, scan: 0.04, aberr: 1.6,
    blurIter: 3, blurRadius: 2.2, contrast: 0.30,
  };
  const QUAD_VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  let rtFull, rtA, rtB, postScene, postCam, postQuad, brightMat, blurMat, compMat;
  function buildPost() {
    const rtOpts = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat };
    const bw = Math.max(2, VW >> 2), bh = Math.max(2, VH >> 2);
    rtFull = new THREE.WebGLRenderTarget(VW, VH, rtOpts);
    rtA = new THREE.WebGLRenderTarget(bw, bh, Object.assign({ depth: false }, rtOpts));
    rtB = new THREE.WebGLRenderTarget(bw, bh, Object.assign({ depth: false }, rtOpts));
    postScene = new THREE.Scene();
    postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    postQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
    postQuad.frustumCulled = false;
    postScene.add(postQuad);

    brightMat = new THREE.ShaderMaterial({
      uniforms: { tex: { value: null }, threshold: { value: POST.threshold }, knee: { value: POST.knee } },
      vertexShader: QUAD_VS,
      fragmentShader: `
        uniform sampler2D tex; uniform float threshold; uniform float knee;
        varying vec2 vUv;
        void main() {
          vec3 c = texture2D(tex, vUv).rgb;
          float l = max(c.r, max(c.g, c.b));
          float k = clamp((l - threshold) / max(knee, 1e-4), 0.0, 1.0);
          gl_FragColor = vec4(c * k * k, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });

    blurMat = new THREE.ShaderMaterial({
      uniforms: { tex: { value: null }, dir: { value: new THREE.Vector2(1 / bw, 0) }, radius: { value: POST.blurRadius } },
      vertexShader: QUAD_VS,
      fragmentShader: `
        uniform sampler2D tex; uniform vec2 dir; uniform float radius;
        varying vec2 vUv;
        void main() {
          vec3 sum = vec3(0.0); float wsum = 0.0;
          for (int i = -4; i <= 4; i++) {
            float w = exp(-float(i * i) / 6.0);
            sum += texture2D(tex, vUv + dir * float(i) * radius).rgb * w;
            wsum += w;
          }
          gl_FragColor = vec4(sum / wsum, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });

    compMat = new THREE.ShaderMaterial({
      uniforms: {
        base: { value: null }, bloom: { value: null },
        strength: { value: POST.bloom }, vignette: { value: POST.vignette },
        grain: { value: POST.grain }, scan: { value: POST.scan },
        aberr: { value: POST.aberr }, phase: { value: 0 },
        grade: { value: new THREE.Vector3(1, 1, 1) }, contrast: { value: POST.contrast },
      },
      vertexShader: QUAD_VS,
      fragmentShader: `
        uniform sampler2D base; uniform sampler2D bloom;
        uniform float strength, vignette, grain, scan, aberr, phase, contrast;
        uniform vec3 grade;
        varying vec2 vUv;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main() {
          vec2 uv = vUv;
          vec2 d = uv - 0.5;
          float r2 = dot(d, d);
          // edges split their channels, the centre stays crisp
          vec2 off = d * aberr * r2 * 0.012;
          vec3 c = vec3(texture2D(base, uv + off).r, texture2D(base, uv).g, texture2D(base, uv - off).b);
          c += texture2D(bloom, uv).rgb * strength;
          c *= clamp(1.0 - vignette * r2 * 1.7, 0.25, 1.0);
          c *= grade;                                    // theme colour grade
          c = mix(c, c * c * (3.0 - 2.0 * c), contrast); // S-curve contrast lift
          c += (hash(floor(uv * vec2(480.0, 300.0)) + phase) - 0.5) * grain;
          c *= 1.0 - scan * (0.5 + 0.5 * sin(uv.y * 471.24));
          gl_FragColor = linearToOutputTexel(vec4(max(c, 0.0), 1.0));
        }`,
      depthTest: false, depthWrite: false,
    });
  }
  function applyGrade() {
    if (!compMat) return;
    if (location.search.includes('grade=0')) { compMat.uniforms.grade.value.set(1, 1, 1); return; }
    const gr = Art.grade(LEVELS[G.level].theme);
    compMat.uniforms.grade.value.set(gr[0], gr[1], gr[2]);
  }
  function renderFrame(t) {
    if (!POST.on || !rtFull) { renderer.render(scene, camera); return; }
    renderer.setRenderTarget(rtFull);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);

    brightMat.uniforms.tex.value = rtFull.texture;
    postQuad.material = brightMat;
    renderer.setRenderTarget(rtA);
    renderer.render(postScene, postCam);

    for (let i = 0; i < POST.blurIter; i++) {
      const r = POST.blurRadius * (1 + i * 0.7);
      blurMat.uniforms.tex.value = rtA.texture; blurMat.uniforms.dir.value.set(1 / rtA.width, 0); blurMat.uniforms.radius.value = r;
      renderer.setRenderTarget(rtB); renderer.render(postScene, postCam);
      blurMat.uniforms.tex.value = rtB.texture; blurMat.uniforms.dir.value.set(0, 1 / rtB.height); blurMat.uniforms.radius.value = r;
      renderer.setRenderTarget(rtA); renderer.render(postScene, postCam);
    }

    // render() does not reset the target, so this last pass must be pointed back
    // at the screen or it would draw into rtA while sampling rtA's own texture.
    renderer.setRenderTarget(null);
    compMat.uniforms.base.value = rtFull.texture;
    compMat.uniforms.bloom.value = rtA.texture;
    compMat.uniforms.phase.value = t * 60;
    postQuad.material = compMat;
    renderer.render(postScene, postCam);
  }

  let deadT = 0;
  function syncCamera(dt, t) {
    const p = G.player;
    const wade = Game.inWater(p.x, p.y) ? 0.26 : 0;   // standing in the shallows puts you knee-deep
    const bobY = p.moving ? Math.sin(p.bob) * (wade ? 0.02 : 0.035) : 0;
    const bobX = p.moving ? Math.cos(p.bob * 0.5) * 0.02 : 0;
    const shk = G.shake * 0.02;
    if (G.state === 'dead') deadT += dt; else deadT = 0;
    const eyeY = Math.max(0.12, EYE + bobY - wade - deadT * 0.75);
    camera.position.set(
      p.x + (Math.random() - 0.5) * shk,
      eyeY + (Math.random() - 0.5) * shk,
      p.y + (Math.random() - 0.5) * shk);
    camera.rotation.y = -p.a - Math.PI / 2 + bobX * 0.4;
    camera.rotation.x = (p.kick || 0) * 1.2;
    camera.rotation.z = Math.min(0.55, deadT * 0.9);
    const fov = 72 + (p.kick || 0) * 260;
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
    eFlash.intensity = Math.max(0, eFlash.intensity - dt * 7);
    flashLight.position.copy(camera.position);
    flashLight.color.setHex(p.hp < 30 ? 0xff5040 : 0xffe8b0);
    muzzleLight.position.set(p.x + Math.cos(p.a) * 0.6, EYE + 0.1, p.y + Math.sin(p.a) * 0.6);
    // weapon viewmodel: bob + recoil + switch dip, on real geometry
    const wm = ART.weapons[p.w];
    const firing = p.fireCd > WEAPONS[p.w].rate - 0.09;
    const gun = guns[p.w];
    for (let i = 0; i < guns.length; i++) guns[i].visible = i === p.w;
    const ky = p.moving ? Math.sin(p.bob) * 0.012 : 0;
    const kx = p.moving ? Math.cos(p.bob * 0.5) * 0.008 : 0;
    const sw = (p.switchT || 0) > 0 ? Math.sin((0.3 - p.switchT) / 0.3 * Math.PI) : 0;
    const kick = p.kick || 0;
    const anchor = viewAnchor();
    gun.position.set(anchor.x + kx, anchor.y + ky - sw * 0.14 + kick * 1.2, VIEW.z + kick * 0.45);
    gun.rotation.set(GUN_TILT + kick * 2.2 - sw * 0.1, GUN_YAW + sw * 0.35, -kick * 2.4 - sw * 0.3);
    // the working parts cycle on the shot
    if (gun.slide) gun.slide.position.z = gun.slideZ + (firing ? 0.024 : 0);
    if (gun.pump) gun.pump.position.z = gun.pumpZ + (firing ? 0.03 : 0);
    gun.muzzleTip.getWorldPosition(muzzlePos);
    // pin the bloom to the muzzle and let it ride with the recoil
    if (firing) {
      const s = (wm.bloom * 2 / 96) * VIEW.h * (2.4 + Math.random() * 0.6);
      flashMesh.position.copy(muzzlePos);
      flashMesh.quaternion.copy(camera.quaternion).multiply(ROLLQ.setFromAxisAngle(UNIT_Y, Math.random() * 0.7));
      flashMesh.scale.set(s, s, 1);
      flashMesh.visible = true;
      muzzleLight.position.copy(muzzlePos);   // light comes from the actual muzzle
      muzzleLight.intensity = 2.2;
    } else {
      flashMesh.visible = false;
      muzzleLight.intensity = 0;
    }
    // doors slide up (doorMeshes hold a direct ref to their logic object)
    for (const d of doorMeshes)
      d.mesh.position.y = d.baseY + (d.door ? d.door.open : 0) * WALL_H * Game.tune().doorSlideFrac;
    // torches flicker, and each shaft's cone carries the same flicker value
    for (let i = 0; i < torches.length; i++) {
      const l = torches[i];
      const fl = 0.7 + Math.sin(t * 11 + l.userData.ph) * 0.12 + Math.random() * 0.08;
      l.intensity = fl;
      if (cones[i]) cones[i].material.uniforms.flicker.value = fl;
    }
    // the water shader reads the clock, the torch flicker and the positions of
    // whatever is wading, so the wake follows the feet
    if (waterMesh) {
      const wu = waterMesh.material.uniforms;
      wu.time.value = t;
      for (let i = 0; i < torches.length && i < 16; i++) wu.flicker.value[i] = torches[i].intensity;
      const wakers = wu.wader.value;
      let n = 0;
      if (Game.inWater(G.player.x, G.player.y)) { wakers[n++].set(G.player.x, 0, G.player.y); }
      for (const e of G.enemies) {
        if (n >= 2) break;
        if (!e.dead && Game.inWater(e.x, e.y)) wakers[n++].set(e.x, 0, e.y);
      }
      wu.waderN.value = n;
    }
    // embers spiral down the shaft and fade out before they reach the floor
    for (const e of embers) {
      const u = e.userData;
      const s = (t * u.sp + u.ph) % 1;
      const r = 0.2 * (1 - s * 0.55);
      e.position.set(u.cx + Math.cos(u.ph + t * 1.9) * r, WALL_H - 0.42 - s * 1.3, u.cz + Math.sin(u.ph + t * 1.9) * r);
      e.material.opacity = (1 - s) * 0.8;
      e.scale.set(0.07 * (1 - s * 0.4), 0.07 * (1 - s * 0.4), 1);
    }
    for (const f of flames) {
      f.material.map = ART.flame[Math.floor(t * 12 + f.userData.ph) % 3];
      const s = 0.18 + Math.sin(t * 13 + f.userData.ph * 2) * 0.03 + Math.random() * 0.02;
      f.scale.set(s, s * 1.4, 1);
    }
  }
  function mkSprite(map, w, h) {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({ map, alphaTest: 0.4, transparent: true }));
    m.scale.set(w, h, 1);
    return m;
  }
  // Volumetric torch shaft: a cone of additive light whose brightness falls off
  // toward the floor and shimmers with the flame, so torches cast visible beams
  // instead of just a point light. Geometry is shared; only the uniforms differ.
  function mkCone(phase) {
    if (!coneGeo) coneGeo = new THREE.ConeGeometry(0.62, 1.6, 20, 1, true);
    const m = new THREE.ShaderMaterial({
      uniforms: {
        flicker: { value: 1 },
        phase: { value: phase },
        tint: { value: new THREE.Vector3(1.0, 0.52, 0.20) },
      },
      vertexShader: `
        varying vec3 vL;
        varying vec3 vW;
        void main() {
          vL = position;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vW = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: `
        uniform float flicker;
        uniform float phase;
        uniform vec3 tint;
        varying vec3 vL;
        varying vec3 vW;
        void main() {
          float h = clamp((0.8 - vL.y) / 1.6, 0.0, 1.0);   // 0 at the torch, 1 at the floor
          float fade = pow(1.0 - h, 1.7);
          float shimmer = 0.72 + 0.28 * sin(phase + vW.x * 4.0 + vW.z * 4.0 + h * 6.0);
          float a = fade * flicker * shimmer * 0.42;
          gl_FragColor = vec4(tint * a, a);
        }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    return new THREE.Mesh(coneGeo, m);
  }
  // Shallow water: one merged mesh over every flooded cell. The surface is a
  // hand-written ripple shader — wave height, torch glints, foam where the water
  // meets land and a wake around whatever is wading through it.
  function mkWater(cells, theme) {
    const MAP = Game.grid(), MAPW = Game.width(), MAPH = Game.height();
    const solid = (x, y) => x < 0 || y < 0 || x >= MAPW || y >= MAPH ||
      MAP[y][x] === '#' || MAP[y][x] === 'T' || MAP[y][x] === '~';
    const pal = ART.pal || (ART.themes && ART.themes[theme]) || {};
    const w = pal.water || [30, 46, 52];
    const gl = pal.glow ? [1, 1, 1] : [0.72, 0.86, 0.92];
    const pos = [], foam = [], idx = [];
    for (const [x, y] of cells) {
      const base = pos.length / 3;
      const corners = [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]];
      for (const [cx, cy] of corners) {
        pos.push(cx, 0.05, cy);
        // how much land touches this corner: 0 = open water, 1 = fully hemmed in
        let touch = 0;
        for (const [dx, dy] of [[-1, -1], [0, -1], [-1, 0], [0, 0]])
          if (solid(cx + dx, cy + dy)) touch++;
        foam.push(touch / 4);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('foam', new THREE.Float32BufferAttribute(foam, 1));
    geo.computeVertexNormals();
    // the shader declares fixed-size arrays, so the uniform arrays are always
    // padded to 16 — a short array makes the GL driver reject the program
    const torchU = [];
    for (const l of torches) torchU.push(new THREE.Vector3(l.position.x, l.position.y, l.position.z));
    while (torchU.length < 16) torchU.push(new THREE.Vector3(0, 0, 0));
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        tint: { value: new THREE.Color(w[0] / 255, w[1] / 255, w[2] / 255) },
        glint: { value: new THREE.Color(gl[0], gl[1], gl[2]) },
        torches: { value: torchU },
        flicker: { value: torchU.map(() => 1) },
        torchN: { value: torchU.length },
        wader: { value: [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 0)] },
        waderN: { value: 0 },
      },
      vertexShader: `
        uniform float time;
        attribute float foam;
        varying vec3 vW;
        varying float vFoam;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          float h = 0.022 * sin(wp.x * 3.1 + time * 1.4) * cos(wp.z * 2.7 - time * 1.1)
                  + 0.012 * sin((wp.x + wp.z) * 4.6 + time * 2.2);
          wp.y += h;
          vW = wp.xyz;
          vFoam = foam;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: `
        uniform float time;
        uniform vec3 tint;
        uniform vec3 glint;
        uniform vec3 torches[16];
        uniform float flicker[16];
        uniform int torchN;
        uniform vec3 wader[2];
        uniform int waderN;
        varying vec3 vW;
        varying float vFoam;
        void main() {
          vec2 p = vW.xz;
          float a = p.x * 3.1 + time * 1.4;
          float b = p.y * 2.7 - time * 1.1;
          float h = 0.022 * sin(a) * cos(b) + 0.012 * sin((p.x + p.y) * 4.6 + time * 2.2);
          // surface normal from the wave, so torches glint off the ripples
          vec3 n = normalize(vec3(-0.068 * cos(a) * cos(b) - 0.055 * cos((p.x + p.y) * 4.6 + time * 2.2),
                                 1.0,
                                 0.059 * sin(a) * sin(b) - 0.055 * cos((p.x + p.y) * 4.6 + time * 2.2)));
          vec3 toEye = normalize(cameraPosition - vW);
          float fresnel = pow(1.0 - max(dot(n, toEye), 0.0), 3.0);
          float lit = 0.0;
          vec3 col = tint * (0.55 + 20.0 * h);
          for (int i = 0; i < 16; i++) {
            if (i >= torchN) break;
            vec3 L = torches[i] - vW;
            float d = length(L);
            if (d > 8.0) continue;
            L /= d;
            float f = flicker[i] * (1.0 - d / 8.0);
            if (f > lit) lit = f;
            vec3 r = reflect(-L, n);
            float spec = pow(max(dot(r, toEye), 0.0), 22.0);
            col += glint * spec * f * 1.1;
            col += tint * f * 0.18;   // warm pool under each torch
          }
          // a water surface seen at a shallow angle mirrors whatever light is
          // nearby, so the reflection dies out in the dark corners of the basin
          col += glint * fresnel * 0.30 * lit;
          // foam along the shoreline, and a wake where something is wading
          float shore = vFoam * (0.55 + 0.45 * sin(time * 2.4 + p.x * 4.0 + p.y * 3.0));
          float wake = 0.0;
          for (int i = 0; i < 2; i++) {
            if (i >= waderN) break;
            float wd = distance(p, wader[i].xz);
            wake += exp(-wd * 2.4) * (0.5 + 0.5 * sin(wd * 9.0 - time * 5.5));
          }
          col += glint * min(shore * 0.4 + wake * 0.3, 0.6);
          gl_FragColor = vec4(col, 0.92);
        }`,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    return new THREE.Mesh(geo, mat);
  }
  // A figure is a billboard, but it is shaded as if it were a cylinder: the
  // dominant light direction sweeps across the body, so a torch on the left
  // lights the left side and the silhouette picks up a rim.
  let bbGeo = null;
  function mkBillboard(map, w, h) {
    if (!bbGeo) bbGeo = new THREE.PlaneGeometry(1, 1);
    const m = new THREE.Mesh(bbGeo, new THREE.ShaderMaterial({
      uniforms: {
        map: { value: map },
        light: { value: new THREE.Vector3(0, 0, 1) },
        lit: { value: 0.6 },
        amb: { value: 0.5 },
        fill: { value: 0.35 },
        tint: { value: new THREE.Vector3(1, 1, 1) },
        alpha: { value: 1 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform sampler2D map;
        uniform vec3 light;
        uniform float lit;
        uniform float amb;
        uniform float fill;
        uniform vec3 tint;
        uniform float alpha;
        varying vec2 vUv;
        void main() {
          vec4 t = texture2D(map, vUv);
          if (t.a < 0.4) discard;
          float u = vUv.x * 2.0 - 1.0;
          vec3 n = normalize(vec3(u, 0.25, 0.9));
          vec3 l = normalize(light);
          float ndl = max(dot(n, l), 0.0);
          float wrap = max(dot(n, -l), 0.0) * 0.4;   // a light behind the body still wraps around it
          float face = max(dot(n, vec3(0.0, 0.0, 1.0)), 0.0);
          float rim = 1.0 - face;
          vec3 col = t.rgb * (amb + (ndl + wrap) * lit + face * fill) * tint;
          col += vec3(1.0, 0.82, 0.55) * rim * rim * lit * 0.22;
          gl_FragColor = vec4(col, t.a * alpha);
        }`,
    }));
    m.scale.set(w, h, 1);
    return m;
  }
  // torch pools, the player's own glow and the muzzle flash all push light onto a
  // figure; this is the sum of them, in the billboard's own frame
  function lightDirAt(x, y, yaw) {
    let lx = 0, ly = 0, sum = 0;
    const add = (dx, dy, w) => {
      const d = Math.hypot(dx, dy) || 1e-6;
      lx += dx / d * w; ly += dy / d * w; sum += w;
    };
    for (const l of torches) {
      const d = Math.hypot(l.position.x - x, l.position.z - y);
      if (d < 7) add(l.position.x - x, l.position.z - y, l.intensity * (1 - d / 7) * 0.55);
    }
    const dp = Math.hypot(camera.position.x - x, camera.position.z - y);
    if (dp < 8) add(camera.position.x - x, camera.position.z - y, 0.3 * (1 - dp / 8));
    if (muzzleLight.intensity > 0) {
      const dm = Math.hypot(muzzleLight.position.x - x, muzzleLight.position.z - y);
      if (dm < 12) add(muzzleLight.position.x - x, muzzleLight.position.z - y, muzzleLight.intensity * (1 - dm / 12) * 0.9);
    }
    // world XZ -> local: the quad's normal is (sin yaw, 0, cos yaw)
    const cx = Math.cos(yaw), sx = Math.sin(yaw);
    return {
      dir: new THREE.Vector3(lx * cx - ly * sx, 0.2, Math.max(lx * sx + ly * cx, 0.05)),
      int: Math.max(0, Math.min(0.9, sum)),
    };
  }
  // a flat quad on the floor under a billboard, so the figure is not floating
  let shadowGeo = null;
  function mkShadow(w, h) {
    if (!shadowGeo) shadowGeo = new THREE.PlaneGeometry(1, 1);
    const m = new THREE.Mesh(shadowGeo, new THREE.MeshBasicMaterial({
      map: ART.shadow, transparent: true, opacity: 0.55, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.scale.set(w, h, 1);
    m.position.y = 0.02;
    return m;
  }
  function syncEntities(dt, t) {
    // enemies
    for (const e of G.enemies) {
      if (e.dead && e.deadT <= 0) {
        // the collapse finished: the billboard is gone and the body stays on the
        // floor as a sprawled decal
        const gone = enemyObjs.get(e);
        if (gone) { scene.remove(gone.grp); scene.remove(gone.shadow); enemyObjs.delete(e); }
        if (!corpseObjs.has(e)) {
          const m = new THREE.Mesh(new THREE.PlaneGeometry(e.def.h * 1.05, e.def.h * 0.62),
            new THREE.MeshStandardMaterial({ map: ART.corpses[e.t], transparent: true, roughness: 0.9, metalness: 0, depthWrite: false }));
          m.rotation.x = -Math.PI / 2;
          m.rotation.z = e.a + (e.x * 7.31 % 1) * 0.9;
          m.position.set(e.x, 0.014, e.y);
          scene.add(m); corpseObjs.set(e, m);
        }
        continue;
      }
      let o = enemyObjs.get(e);
      const asp = ART.sprAsp[e.t] || 0.92;   // each figure is painted at its own aspect
      if (!o) {
        const grp = new THREE.Group();
        const s = mkBillboard(ART.spr[e.t].f[0].walk, e.def.h * asp, e.def.h);
        s.position.y = e.def.h / 2;
        grp.add(s);
        // muzzle flash rides on the figure so a shot has a visible origin
        const muzzle = new THREE.Sprite(new THREE.SpriteMaterial({
          map: ART.ember[0], transparent: true, blending: THREE.AdditiveBlending,
          depthWrite: false, opacity: 0 }));
        muzzle.scale.set(0.2, 0.2, 1);
        grp.add(muzzle);
        grp.position.set(e.x, 0, e.y);
        scene.add(grp);
        o = { grp, spr: s, muzzle, shadow: mkShadow(e.def.h * asp * 1.25, e.def.h * 0.6) };
        scene.add(o.shadow);
        enemyObjs.set(e, o);
      }
      const wet = Game.inWater(e.x, e.y);
      const sink = wet ? 0.22 : 0;
      o.grp.position.set(e.x, -sink, e.y);
      o.shadow.position.set(e.x, 0.02, e.y);
      const fr = e.moving ? (Math.floor(e.anim) % 2) : 0;
      // pick 4-way view by angle from enemy facing to camera
      const toCam = Math.atan2(camera.position.z - e.y, camera.position.x - e.x);
      let rel = toCam - e.a;
      while (rel > Math.PI) rel -= TAU; while (rel < -Math.PI) rel += TAU;
      const view = Math.abs(rel) < Math.PI / 4 ? 'f' : Math.abs(rel) > 3 * Math.PI / 4 ? 'b' : (rel > 0 ? 'r' : 'l');
      const set = (e.tele > 0 || e.charging > 0) ? ART.spr[e.t][view].atk : ART.spr[e.t][view][fr];
      // a figure that has taken real damage shows its wounds until the hit flash
      // washes the whole sprite white for a frame
      const yaw = Math.atan2(camera.position.x - e.x, camera.position.z - e.y);
      o.spr.rotation.y = yaw;
      const u = o.spr.material.uniforms;
      u.map.value = e.flash > 0 ? set.flash : (WOUND_ON && Game.wounded(e) ? set.hurt : set.walk);
      const L = lightDirAt(e.x, e.y, yaw);
      u.light.value.copy(L.dir);
      u.lit.value = L.int;
      // a wading figure is soaked: cooled, darkened, and cut off at the waterline
      if (wet) u.tint.value.set(0.78, 0.86, 1.02);
      else u.tint.value.set(1, 1, 1);
      // the flash blooms for a beat after the shot, aimed at the player
      const mk = e.dead ? 0 : Math.max(0, e.mz || 0) / 0.16;
      o.muzzle.material.opacity = mk * 0.85;
      const ms = 0.14 + mk * 0.16;
      o.muzzle.scale.set(ms, ms, 1);
      o.muzzle.position.set(Math.cos(e.a) * 0.34, e.def.h * 0.52, Math.sin(e.a) * 0.34);
      if (e.dead) {
        const k = 1 - Math.max(0, e.deadT) / 0.6; // 0..1
        o.grp.rotation.x = -k * Math.PI / 2 * 0.92;
        o.grp.position.y = -k * 0.12;
        o.spr.material.uniforms.alpha.value = 1 - k * k;
        o.shadow.scale.set(e.def.h * asp * 1.25 * (0.4 + k * 0.6), e.def.h * 0.6 * (0.4 + k * 0.6), 1);
        o.shadow.material.opacity = 0.55 * (0.35 + k * 0.65);
      } else {
        o.grp.rotation.x = 0; o.grp.position.y = -sink;
        o.spr.material.uniforms.alpha.value = 1;
        o.shadow.material.opacity = wet ? 0.3 : 0.55;
        if (wet) o.shadow.scale.set(e.def.h * asp * 1.55, e.def.h * 0.78, 1);
        else o.shadow.scale.set(e.def.h * asp * 1.25, e.def.h * 0.6, 1);
        if (e.flash > 0.1) { eFlash.position.set(e.x, 1.3, e.y); eFlash.intensity = 1.5; }
      }
    }
    // items
    for (const it of G.items) {
      let o = itemObjs.get(it);
      if (!o) {
        if (it.taken) continue;
        o = mkSprite(ART.items[it.key], 0.5, 0.5);
        scene.add(o);
        itemObjs.set(it, o);
      }
      if (it.taken) { scene.remove(o); itemObjs.delete(it); continue; }
      o.position.set(it.x, 0.28 + Math.sin(t * 3 + it.bob) * 0.06, it.y);
    }
    // projectiles
    const seen = new Set();
    for (const pr of G.projs) {
      let o = projObjs.get(pr);
      if (!o) { o = mkSprite(pr.t === 'shell' ? ART.proj.shell : ART.proj.bomb, 0.32, 0.32); o.material.rotation = Math.random() * 9; scene.add(o); projObjs.set(pr, o); }
      o.position.set(pr.x, 0.55, pr.y);
      seen.add(pr);
    }
    for (const [pr, o] of projObjs) if (!seen.has(pr)) { scene.remove(o); projObjs.delete(pr); }
    // fx
    for (const f of G.fx) {
      let o = fxObjs.get(f);
      if (!o) {
        if (f.kind === 'boom') {
          o = { f, spr: mkSprite(ART.boom[0], 0.1, 0.1) };
          o.spr.position.set(f.x, 0.8, f.y);
          scene.add(o.spr);
        } else if (f.kind === 'spark') {
          o = { f, spr: mkSprite(ART.flash, 0.18, 0.18) };
          o.spr.position.set(f.x, 0.9, f.y);
          scene.add(o.spr);
        } else if (f.kind === 'tracer') {
          const h = f.h || 1.0;
          const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(f.x0, h, f.y0), new THREE.Vector3(f.x1, h, f.y1)]);
          o = { f, line: new THREE.Line(g, new THREE.LineBasicMaterial({ color: f.h ? 0xffe0a0 : 0xffcc66, transparent: true })) };
          scene.add(o.line);
        } else if (f.kind === 'blood') {
          o = { f, spr: mkSprite(ART.blood, 0.35, 0.35) };
          o.spr.position.set(f.x, 0.7, f.y);
          scene.add(o.spr);
        } else if (f.kind === 'splat') {
          const m = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9),
            new THREE.MeshBasicMaterial({ map: ART.splat, transparent: true, depthWrite: false }));
          m.rotation.x = -Math.PI / 2; m.rotation.z = Math.random() * 9;
          m.position.set(f.x, 0.012, f.y);
          scene.add(m);
          o = { f, line: m };
        } else if (f.kind === 'splash') {
          const m = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2),
            new THREE.MeshBasicMaterial({ map: ART.splash, transparent: true, depthWrite: false }));
          m.rotation.x = -Math.PI / 2; m.rotation.z = Math.random() * 9;
          m.position.set(f.x, 0.06, f.y);
          scene.add(m);
          o = { f, ring: m };
        } else if (f.kind === 'hole') {
          // a bullet that missed lands in the masonry: a decal on the exact face
          // the ray struck, oriented by the face normal
          const m = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34),
            new THREE.MeshBasicMaterial({ map: ART.hole, transparent: true, depthWrite: false }));
          m.position.set(f.x + f.nx * 0.03, 0.62, f.y + f.ny * 0.03);
          m.rotation.y = Math.atan2(f.nx, f.ny);
          scene.add(m);
          o = { f, decal: m };
        } else if (f.kind === 'msg') {
          msgDiv.textContent = f.text;
          msgDiv.style.opacity = 1;
          o = { f, line: null };
        }
        if (o) fxObjs.set(f, o);
      }
      const k = 1 - f.t / f.max;
      if (o.spr) { const sc = f.kind === 'boom' ? 0.4 + k * 1.8 : f.kind === 'blood' ? 0.3 + k * 0.55 : 0.18; o.spr.scale.set(sc, sc, 1); if (f.kind === 'boom') o.spr.material.map = ART.boom[Math.min(3, Math.floor(k * 4))]; o.spr.material.opacity = 1 - k * 0.6; }
      if (o.line && f.kind === 'tracer') o.line.material.opacity = 1 - k;
      if (o.line && f.kind === 'splat') o.line.material.opacity = f.t < 3 ? Math.max(0, f.t / 3) : 1;
      if (o.ring) { const s = 0.3 + k * 1.1; o.ring.scale.set(s, s, 1); o.ring.material.opacity = (1 - k) * 0.85; }
      if (o.decal) o.decal.material.opacity = f.t < 2.5 ? f.t / 2.5 : 1;
      if (f.kind === 'msg' && k > 0.8) msgDiv.style.opacity = 1 - (k - 0.8) * 5;
    }
    const live = new Set(G.fx);
    for (const [f, o] of fxObjs) {
      if (live.has(f)) continue;
      if (o.spr) scene.remove(o.spr);
      if (o.line) scene.remove(o.line);
      if (o.decal) scene.remove(o.decal);
      fxObjs.delete(f);
    }
  }
  function syncScene(dt, t) {
    syncCamera(dt, t);
    syncEntities(dt, t);
    exitMesh.lookAt(camera.position.x, exitMesh.position.y, camera.position.z);
  }
  // ---- HUD ----
  const $ = id => document.getElementById(id);
  function updateHUD(t) {
    const p = G.player, w = WEAPONS[p.w];
    $('hHp').textContent = Math.ceil(p.hp);
    $('hArm').textContent = Math.ceil(p.armor);
    $('hAmmo').textContent = w.ammo ? p.ammo[w.ammo] : '--';
    $('hGun').textContent = w.name;
    $('hKills').textContent = G.kills + '/' + G.total;
    const sec = Math.floor(G.time), mm = Math.floor(sec / 60);
    $('hTime').textContent = mm + ':' + String(sec % 60).padStart(2, '0');
    $('hit').style.opacity = G.hitT > 0 ? 1 : 0;
    // damage direction arc
    // haptics: a buzz when the hall hits you. navigator.vibrate is Chrome/Android
    // only, so it is a bonus, never a requirement.
    if (G.hitDirT > lastHitDirT && TOUCH && prefs.haptics !== false &&
        typeof navigator === 'object' && navigator.vibrate) navigator.vibrate(18);
    lastHitDirT = G.hitDirT;
    if (G.hitDirT > 0) {
      let rel = G.hitDir - G.player.a;
      while (rel > Math.PI) rel -= TAU; while (rel < -Math.PI) rel += TAU;
      dmgDiv.style.transform = 'rotate(' + rel.toFixed(3) + 'rad)';
      dmgDiv.style.opacity = Math.min(1, G.hitDirT * 2);
    } else dmgDiv.style.opacity = 0;
    if (G.kills > lastKills) { lastKills = G.kills; popUntil = t + 0.8; popDiv.textContent = '+' + Game.tune().scorePerKill; }
    popDiv.style.opacity = t < popUntil ? 1 : 0;
    const ammoEl = $('hAmmo');
    if (w.ammo && p.ammo[w.ammo] <= 2 && G.state === 'play') ammoEl.style.color = (t % 0.5 < 0.25) ? '#ff4030' : '#ffd75e';
    else ammoEl.style.color = '';
    const st = p.hp > 75 ? 0 : p.hp > 50 ? 1 : p.hp > 30 ? 2 : p.hp > 12 ? 3 : 4;
    const fg = $('face').getContext('2d');
    fg.imageSmoothingEnabled = false;
    fg.clearRect(0, 0, 48, 48);
    fg.drawImage(ART.face[st].image, 0, 0);
    $('vig').style.opacity = Math.min(1, G.dmgFlash + (p.hp < 30 ? (1 - p.hp / 30) * 0.35 * (0.6 + 0.4 * Math.sin(t * 6)) : 0));
    // The touch sticks are laid out against the HUD, so showing or hiding the
    // bar has to re-lay them out - otherwise the sticks end up buried under it.
    const hudHidden = G.state === 'title';
    if (TOUCH && $('hud').classList.contains('hidden') !== hudHidden) TouchUI.apply();
    $('hud').classList.toggle('hidden', hudHidden);
    if (G.mini && t - lastMini > 0.12) { lastMini = t; drawMini(); }
    $('mini').style.display = G.mini && G.state === 'play' ? 'block' : 'none';
  }
  function drawMini() {
    const c = $('mini'), g = c.getContext('2d'), MAP = Game.grid(), MAPW = Game.width(), MAPH = Game.height();
    const s = c.width / MAPW;
    g.fillStyle = 'rgba(0,0,0,0.7)'; g.fillRect(0, 0, c.width, c.height);
    for (let y = 0; y < MAPH; y++) for (let x = 0; x < MAPW; x++) {
      const ch = MAP[y][x];
      if (ch === '~') { g.fillStyle = '#8a6a44'; g.fillRect(x * s, y * s, s, s); }
      else if (ch === 'w') { g.fillStyle = '#2b4c57'; g.fillRect(x * s, y * s, s, s); }
      else if (ch === '#' || ch === 'T' || ch === 'W') { g.fillStyle = '#666'; g.fillRect(x * s, y * s, s, s); }
      else if (ch === 'D') { g.fillStyle = '#a80'; g.fillRect(x * s, y * s, s, s); }
    }
    for (const it of G.items) if (!it.taken) { g.fillStyle = '#4af'; g.fillRect(it.x * s - 1, it.y * s - 1, 3, 3); }
    for (const e of G.enemies) if (!e.dead) { g.fillStyle = '#f33'; g.fillRect(e.x * s - 1.5, e.y * s - 1.5, 3, 3); }
    g.fillStyle = G.exit.active ? '#3f6' : '#f80';
    g.fillRect(G.exit.x * s - 2, G.exit.y * s - 2, 4, 4);
    const p = G.player;
    g.save(); g.translate(p.x * s, p.y * s); g.rotate(-p.a);
    g.fillStyle = '#ffd75e'; g.beginPath(); g.moveTo(4, 0); g.lineTo(-3, -3); g.lineTo(-3, 3); g.fill(); g.restore();
  }
  // ---- touch aiming assist (opt-in) ----
  // A thumb cannot aim like a mouse, so the option nudges the heading toward the
  // nearest visible enemy. It only engages when the player is not already turning,
  // and it never fires the gun: it buys time, not kills.
  function aimAssist() {
    if (!TOUCH || !Input.aim || G.state !== 'play' || Input.turn) return;
    const p = G.player;
    let best = null, bd = 90;                 // ~9.5 tiles: aiming past that is pointless
    for (const e of G.enemies) {
      if (e.dead) continue;
      const dx = e.x - p.x, dy = e.y - p.y, d2 = dx * dx + dy * dy;
      if (d2 < bd && Game.hasLOS(p.x, p.y, e.x, e.y)) { bd = d2; best = e; }
    }
    if (!best) return;
    let rel = Math.atan2(best.y - p.y, best.x - p.x) - p.a;
    while (rel > Math.PI) rel -= TAU;
    while (rel < -Math.PI) rel += TAU;
    if (Math.abs(rel) < 0.04) return;         // already roughly on target
    Input.turn = Math.max(-0.4, Math.min(0.4, rel * 0.8));
  }
  // ---- overlays ----
  function toggleMap() {
    G.mini = !G.mini;
    const b = $('mapBtn');
    if (b) b.textContent = G.mini ? '\u25AA ON' : '\u25AA OFF';
  }
  function pauseGame() {
    if (G.state !== 'play') return;
    Input.fwd = Input.back = Input.left = Input.right = Input.turn = Input.sprint = Input.fire = 0;
    G.state = 'pause'; showOverlay('pause');
  }
  // ---- touch option panel: every assist is opt-in and lives in one place ----
  let lastOverlay = 'title';
  const gyroOK = typeof DeviceOrientationEvent !== 'undefined';
  function optPanel() {
    if (!TOUCH) return '';
    const b = (id, label, on) => `<button data-opt="${id}" class="${on ? '' : 'off'}">${label}</button>`;
    return '<div class="opts">' +
      b('mode', (prefs.one ? 'ONE-THUMB' : 'TWO-THUMB') + ' MODE', true) +
      b('mirror', 'SWAP SIDES', prefs.mirror === true) +
      b('autofire', 'AUTO-FIRE', prefs.autofire !== false) +
      b('aim', 'AIM ASSIST', prefs.aim === true) +
      (gyroOK ? b('gyro', 'GYRO AIM', prefs.gyro === true) : '') +
      b('haptics', 'HAPTICS', prefs.haptics !== false) +
      '</div>';
  }
  function refreshPanel() {
    if (!$('ov').classList.contains('hidden')) showOverlay(lastOverlay);
  }
  function toggleOpt(id) {
    if (id === 'mode') prefs.one = !prefs.one;
    else if (id === 'mirror') prefs.mirror = !prefs.mirror;
    else if (id === 'autofire') prefs.autofire = prefs.autofire === false;
    else if (id === 'aim') prefs.aim = !prefs.aim;
    else if (id === 'haptics') prefs.haptics = prefs.haptics === false;
    else if (id === 'gyro') {
      prefs.gyro = !prefs.gyro;
      // iOS needs a real tap to grant the sensor, and this handler is one.
      if (prefs.gyro && typeof DeviceOrientationEvent.requestPermission === 'function') {
        DeviceOrientationEvent.requestPermission()
          .then(s => { if (s !== 'granted') prefs.gyro = false; refreshPanel(); })
          .catch(() => { prefs.gyro = false; refreshPanel(); });
      }
    } else return;
    Input.autoFire = prefs.autofire !== false;
    Input.aim = prefs.aim === true;
    savePrefs();
    TouchUI.release();
    TouchUI.apply();
    refreshPanel();
  }
  function statLine() {
    const st = G.stats, acc = st.shots ? Math.round(100 * st.hits / st.shots) : 0;
    const t = Math.floor(G.time);
    let rank;
    if (G.kills >= G.total) rank = t < 90 ? 'HALLMASTER' : t < 150 ? 'SLAYER' : 'SURVIVOR';
    else rank = G.kills >= Math.ceil(G.total * 0.7) ? 'SO CLOSE' : 'FEED FOR THE HALL';
    return 'score ' + G.score + ' &nbsp; time ' + Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0') +
      ' &nbsp; accuracy ' + acc + '% (' + st.hits + '/' + st.shots + ')' +
      ' &nbsp; secrets ' + G.secrets.found + '/' + G.secrets.total + '<br>rank: <b style="color:#ffd75e">' + rank + '</b>';
  }
  function showOverlay(kind) {
    const ov = $('ov'), box = $('ovBox');
    lastOverlay = kind;
    ov.classList.remove('hidden');
    if (kind === 'title') {
      box.innerHTML = '<h1>GRIM HALL</h1><h2>' + LEVELS[G.level].name + ' &mdash; level ' + (G.level + 1) + ' of ' + LEVELS.length + '</h2>' +
        '<div class="ctl"><b>WASD</b> move &nbsp; <b>Shift</b> sprint &nbsp; <b>mouse</b> look &nbsp; <b>click / space</b> fire<br>' +
        '<b>1 2 3</b> weapons &nbsp; <b>M</b> map &nbsp; new guns auto-equip &nbsp; ESC pauses<br>' +
        (TOUCH ? '<b>left thumb</b> drag to walk &amp; strafe &nbsp; <b>right thumb</b> drag to turn &nbsp; <b>FIRE</b> hold to shoot<br>'
               : '<b>touch</b> on a phone: two-thumb sticks appear at the bottom of the screen<br>') +
        'kill all ' + G.total + ' horrors, then reach the green <b>EXIT</b> &mdash; a secret hides in these walls</div>' +
        optPanel() +
        '<div class="go">[ CLICK TO ENTER ]</div>';
    } else if (kind === 'dead') {
      box.innerHTML = '<h1 style="color:#a00">YOU DIED</h1><h2>the hall keeps you</h2>' +
        '<div class="stat">' + statLine() + '</div>' +
        '<div class="go">[ CLICK TO TRY AGAIN ]</div>';
    } else if (kind === 'pause') {
      box.innerHTML = '<h1 style="font-size:34px">PAUSED</h1>' + optPanel() +
        '<div class="go">[ CLICK TO RESUME ]</div>';
    } else if (kind === 'win') {
      box.innerHTML = '<h1 style="color:#3f6">HALL CLEARED</h1><h2>' + LEVELS[G.level].name +
        ' is empty &mdash; on to ' + LEVELS[(G.level + 1) % LEVELS.length].name + '</h2>' +
        '<div class="stat">' + statLine() + ' &nbsp; hp left ' + Math.ceil(G.player.hp) + '</div>' +
        '<div class="go">[ CLICK TO PLAY AGAIN ]</div>';
    }
  }
  function clearEntities() {
    for (const [, o] of enemyObjs) { scene.remove(o.grp); if (o.shadow) scene.remove(o.shadow); }
    for (const m of corpseObjs.values()) scene.remove(m);
    corpseObjs.clear();
    for (const [, o] of itemObjs) scene.remove(o);
    for (const [, o] of projObjs) scene.remove(o);
    for (const [, o] of fxObjs) { if (o.spr) scene.remove(o.spr); if (o.line) scene.remove(o.line); if (o.decal) scene.remove(o.decal); }
    enemyObjs.clear(); itemObjs.clear(); projObjs.clear(); fxObjs.clear();
  }
  function startGame() {
    clearEntities();
    Game.buildWorld(G.level);   // meshes must be rebuilt whenever the level changes
    buildWorldMeshes();
    syncExit();
    lastKills = 0; popUntil = 0;
    G.state = 'play';
    $('ov').classList.add('hidden');
    Music.start();
    const q = new URLSearchParams(location.search);
    if (q.get('tp')) { const [x, y, a] = q.get('tp').split(',').map(Number); G.player.x = x; G.player.y = y; G.player.a = a || 0; }
    const cv = renderer.domElement;
    if (!q.get('auto') && cv.requestPointerLock) { try { cv.requestPointerLock(); } catch (e) {} }
  }
  // ---- input ----
  function bindInput() {
    const KEYMAP = { w: 'fwd', arrowup: 'fwd', s: 'back', arrowdown: 'back', a: 'left', d: 'right' };
    let lastTouch = 0;   // a tap also raises mousedown; this keeps it from firing twice
    // sound controls (V mutes, - / + adjust volume); preference survives reloads
    const sndBtn = $('sndBtn');
    const refreshSound = () => {
      sndBtn.textContent = Sound.muted ? '\u266a OFF' : '\u266a ON';
      sndBtn.classList.toggle('off', Sound.muted);
    };
    try {
      const v = Number(localStorage.getItem('gh.vol'));
      if (Number.isFinite(v)) Sound.setVolume(v);
      Sound.mute(localStorage.getItem('gh.mute') === '1');
    } catch (e) {}
    sndBtn.addEventListener('pointerdown', e => {
      e.stopPropagation();
      Sound.mute(!Sound.muted);
      try { localStorage.setItem('gh.mute', Sound.muted ? '1' : '0'); } catch (err) {}
      refreshSound();
    });
    refreshSound();

    window.addEventListener('keydown', e => {
      const k = e.key.toLowerCase();
      keys[k] = 1;
      if (KEYMAP[k]) { Input[KEYMAP[k]] = 1; e.preventDefault(); }
      if (k === ' ') { Input.fire = 1; Input.fireEdge = 1; e.preventDefault(); }
      if (k === '1') Input.wantW = 0;
      if (k === '2') Input.wantW = 1;
      if (k === '3') Input.wantW = 2;
      if (k === 'm') toggleMap();
      if (k === 'shift') Input.sprint = 1;
      if (k === 'arrowleft' || k === 'arrowright') { arrowTurn(); e.preventDefault(); }
      if (k === 'escape') pauseGame();
      if (k === 'v') {
        Sound.mute(!Sound.muted);
        try { localStorage.setItem('gh.mute', Sound.muted ? '1' : '0'); } catch (err) {}
        refreshSound();
      }
      if (k === '-' || k === '+') {
        Sound.setVolume(Sound.volume + (k === '-' ? -0.1 : 0.1));
        try { localStorage.setItem('gh.vol', String(Sound.volume)); } catch (err) {}
      }
    });
    window.addEventListener('keyup', e => {
      const k = e.key.toLowerCase();
      keys[k] = 0;
      if (KEYMAP[k]) Input[KEYMAP[k]] = 0;
      if (k === ' ') Input.fire = 0;
      if (k === 'shift') Input.sprint = 0;
      if (k === 'arrowleft' || k === 'arrowright') arrowTurn();
    });
    const cv = () => renderer.domElement;
    // one click path shared by the mouse and a tap on the title/pause panels
    function canvasClick() {
      if (G.state === 'pause') {
        G.state = 'play'; $('ov').classList.add('hidden');
        if (cv().requestPointerLock) cv().requestPointerLock();
        return;
      }
      if (G.state !== 'play') {
        if (G.state === 'win') G.level = (G.level + 1) % LEVELS.length;   // cleared a hall -> next one
        startGame();
        return;
      }
      Input.fire = 1; Input.fireEdge = 1;
      if (document.pointerLockElement !== cv() && cv().requestPointerLock) cv().requestPointerLock();
    }
    document.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      // the option buttons in the panel are not a "resume" tap
      if (e.target && e.target.closest && e.target.closest('.opts')) return;
      // only canvas taps are duplicated by the touch stick; the overlay's
      // resume/start tap must never be swallowed by that guard
      if (e.target === cv() && performance.now() - lastTouch < 400) return;
      canvasClick();
    });
    // touch-only assist switches, all opt-in, all persisted
    $('ovBox').addEventListener('pointerdown', e => {
      const b = e.target.closest && e.target.closest('button[data-opt]');
      if (!b) return;
      e.preventDefault(); e.stopPropagation();
      toggleOpt(b.dataset.opt);
    });
    // a phone session is interrupted constantly (a call, a notification, the
    // browser tab switching). Come back to a paused hall, never a dead run.
    document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });
    // only a lost lock pauses: a phone never gets one in the first place
    let hadLock = false;
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement === cv()) hadLock = true;
      else if (hadLock && G.state === 'play' && !location.search.includes('auto')) {
        G.state = 'pause'; showOverlay('pause');
      }
    });
    window.addEventListener('mouseup', e => { if (e.button === 0) Input.fire = 0; });
    document.addEventListener('mousemove', e => {
      if (document.pointerLockElement === cv() && G.state === 'play') G.player.a += e.movementX * 0.0022;
    });
    cv().addEventListener('contextmenu', e => e.preventDefault());

    // arrow-key turning (no polling interval: it would overwrite the touch stick)
    const arrowTurn = () => { Input.turn = (keys.arrowleft ? -1 : 0) + (keys.arrowright ? 1 : 0); };

    // ---- touch: a visible two-thumb control surface --------------------------
    // Left thumb  = floating move stick (walk/strafe, sprint at full push)
    // Right thumb = look stick (turn), tap = fire fallback
    // Bottom right= FIRE pad (hold = continuous fire)
    // ONE-THUMB mode (option panel): the whole screen is one floating stick —
    // drag toward where you want to go, the camera swings to it and you walk.
    // Pointer Events instead of touch events: one pointerId per finger, so move +
    // look + fire can happen at once, pointercancel catches fingers that vanish
    // under a notification shade, and cancelling the touch pointerdown kills the
    // phantom compatibility mousedown that made mouse+touch code double-fire.
    if (!TOUCH) {
      $('gunCell').addEventListener('mousedown', swapGun);
      return;
    }
    document.body.classList.add('touch');
    Input.autoFire = prefs.autofire !== false;
    Input.aim = prefs.aim === true;

    const moveEl = $('moveStick'), moveKnob = moveEl.firstElementChild;
    const lookEl = $('lookStick'), lookKnob = lookEl.firstElementChild, firePad = $('firePad');
    const tip = $('tip');
    $('touchUI').classList.remove('hidden');
    const TAP_MS = 320;                       // a tap that never dragged is a trigger pull
    const FIRE_W = 66;                        // fire pad size (>= the 44 px minimum)
    let R = 44, DEAD = 11, STEER = 34;        // stick radius, its dead zone, drag for full turn
    let tipTimer = 0;

    // read the safe-area insets once (they only exist with viewport-fit=cover)
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;left:0;top:0;margin:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
    document.body.appendChild(probe);
    const pc = getComputedStyle(probe);
    const SAFE = { t: +pc.marginTop || 0, r: +pc.marginRight || 0, b: +pc.marginBottom || 0, l: +pc.marginLeft || 0 };
    probe.remove();

    function layoutTouch() {
      // big enough to feel like a stick, small enough not to eat the screen
      R = Math.max(30, Math.min(64, 0.13 * Math.min(innerWidth, innerHeight)));
      DEAD = R * 0.25;                        // a thumb jittering inside this is not a step
      STEER = Math.max(22, R * 0.7);          // turn rate scales with the stick, not the screen
      for (const el of [moveEl, lookEl]) el.style.width = el.style.height = (2 * R) + 'px';
      // Rest the controls in the empty letterbox bars, clear of the HUD and the
      // notch. A hidden HUD reports nothing, so fall back to the height CSS gives
      // it (1/8 of the canvas) instead of letting the sticks sit under it.
      const hudH = Math.min(innerWidth, innerHeight * 1.6) / 8;
      const hudTop = $('hud').classList.contains('hidden') ? innerHeight - hudH - SAFE.b
                                                           : $('hud').getBoundingClientRect().top;
      const floor = Math.min(innerHeight - SAFE.b, hudTop) - 12;
      if (prefs.mirror) {
        // left-handed: move stick bottom right, fire pad bottom left
        moveEl.style.left = (innerWidth - SAFE.r - 12 - 2 * R) + 'px';
        firePad.style.left = (SAFE.l + 12) + 'px';
      } else {
        moveEl.style.left = (SAFE.l + 12) + 'px';
        firePad.style.left = (innerWidth - SAFE.r - 12 - FIRE_W) + 'px';
      }
      moveEl.style.top = (floor - 2 * R) + 'px';
      firePad.style.top = (floor - FIRE_W) + 'px';
      if (tip) {
        const L = prefs.mirror ? 'RIGHT THUMB' : 'LEFT THUMB';
        const Rt = prefs.mirror ? 'LEFT THUMB' : 'RIGHT THUMB';
        tip.textContent = prefs.one
          ? 'DRAG WHERE YOU WANT TO GO · TAP TO SHOOT · FIRE: HOLD'
          : L + ' drag to move · ' + Rt + ' drag to turn · FIRE hold to shoot';
        tip.style.animation = 'none'; tip.style.opacity = '1';
        clearTimeout(tipTimer);
        tipTimer = setTimeout(() => { tip.style.opacity = '0'; }, 7000);
      }
    }
    layoutTouch();
    window.addEventListener('resize', layoutTouch);
    TouchUI.apply = layoutTouch;

    const move = { id: -1, ox: 0, oy: 0, dragged: false, t0: 0, combo: false };
    const look = { id: -1, ox: 0, oy: 0, dragged: false, t0: 0 };
    const zeroMove = () => { Input.fwd = Input.back = Input.left = Input.right = Input.sprint = 0; };

    function endMove() {
      if (move.id < 0) return;
      // one-thumb mode has no dedicated fire button in the way, so a flick-less
      // tap on the stick is the trigger
      if (move.combo && !move.dragged && performance.now() - move.t0 < TAP_MS) {
        Input.fire = 1; Input.fireEdge = 1;
        setTimeout(() => { Input.fire = 0; }, 120);   // long enough for one sim frame
      }
      move.id = -1; zeroMove();
      if (move.combo) Input.turn = 0;
      moveEl.classList.remove('on', 'sprint'); moveEl.classList.add('rest');
      moveKnob.style.transform = 'translate(0,0)';
    }
    function endLook() {
      if (look.id < 0) return;
      if (!look.dragged && performance.now() - look.t0 < TAP_MS) {
        Input.fire = 1; Input.fireEdge = 1;
        setTimeout(() => { Input.fire = 0; }, 120);   // long enough for one sim frame
      }
      look.id = -1; Input.turn = 0;
      lookEl.classList.remove('on');
      lookKnob.style.transform = 'translate(0,0)';
    }
    const endFire = () => { Input.fire = 0; firePad.classList.remove('down'); };
    TouchUI.release = () => { endMove(); endLook(); endFire(); };
    const releasePointer = e => {
      lastTouch = performance.now();
      if (e.pointerId === move.id) endMove();
      if (e.pointerId === look.id) endLook();
      if (e.target === firePad) endFire();
    };

    document.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' || e.pointerType === 'pen') return;   // desktop keeps the mouse path
      lastTouch = performance.now();
      const isFire = e.target === firePad;
      if (!isFire && e.target.closest && e.target.closest('#hud,#ov,#mini,#tip')) return;  // real buttons
      if (G.state !== 'play') {
        if (isFire || e.target === cv()) { e.preventDefault(); canvasClick(); }
        return;
      }
      e.preventDefault();                        // no page zoom, no phantom click
      if (isFire) {
        firePad.classList.add('down');
        Input.fire = 1; Input.fireEdge = 1;
        return;
      }
      // two-thumb: left half walks, right half looks (mirrored if the player
      // plays left-handed). one-thumb: every contact is the move stick, and
      // pointing it is the same as facing that way.
      const s = (!prefs.one && ((e.clientX >= innerWidth * 0.5) !== !!prefs.mirror)) ? look : move;
      move.combo = !!prefs.one;
      s.id = e.pointerId; s.ox = e.clientX; s.oy = e.clientY;
      s.dragged = false; s.t0 = lastTouch;
      const el = s === move ? moveEl : lookEl;
      el.classList.remove('rest'); el.classList.add('on');
      el.style.left = (e.clientX - R) + 'px';
      el.style.top = (e.clientY - R) + 'px';
    }, { passive: false });
    document.addEventListener('pointermove', e => {
      if (G.state !== 'play') return;
      if (e.pointerId === move.id) {
        let dx = e.clientX - move.ox, dy = e.clientY - move.oy, d = Math.hypot(dx, dy);
        if (d > DEAD) move.dragged = true;
        if (d <= DEAD) {                          // a resting thumb is not a step
          zeroMove(); if (move.combo) Input.turn = 0;
          moveEl.classList.remove('sprint');
          moveKnob.style.transform = 'translate(0,0)';
          return;
        }
        const ux = dx / d, uy = dy / d;
        // thumb drift: a thumb that keeps sliding takes the base with it, so
        // reversing direction is a flick, not a trek back across the screen
        if (d > R) {
          const ex = d - R;
          move.ox += ux * ex; move.oy += uy * ex;
          moveEl.style.left = Math.max(0, Math.min(innerWidth - 2 * R, move.ox - R)) + 'px';
          moveEl.style.top = Math.max(0, Math.min(innerHeight - 2 * R, move.oy - R)) + 'px';
          d = R;
        }
        const k = Math.min(1, d / R);             // analog, not binary
        if (move.combo) {
          let rel = Math.atan2(uy, ux) - G.player.a;
          while (rel > Math.PI) rel -= TAU;
          while (rel < -Math.PI) rel += TAU;
          Input.turn = Math.max(-1, Math.min(1, rel * 1.3));
          Input.fwd = k; Input.back = Input.left = Input.right = 0;
        } else {
          Input.fwd    = Math.max(0, -uy) * k;
          Input.back   = Math.max(0,  uy) * k;
          Input.right  = Math.max(0,  ux) * k;
          Input.left   = Math.max(0, -ux) * k;
        }
        Input.sprint = k >= 0.85 ? 1 : 0;
        moveEl.classList.toggle('sprint', Input.sprint === 1);
        const off = Math.min(d, R);
        moveKnob.style.transform = 'translate(' + (ux * off) + 'px,' + (uy * off) + 'px)';
      } else if (e.pointerId === look.id) {
        let dx = e.clientX - look.ox, dy = e.clientY - look.oy;
        if (Math.hypot(dx, dy) > DEAD) look.dragged = true;
        // the look anchor follows the thumb past STEER px, so a long sweep keeps
        // turning and flicking back reverses it immediately
        if (dx > STEER) { look.ox += dx - STEER; dx = STEER; }
        else if (dx < -STEER) { look.ox += dx + STEER; dx = -STEER; }
        Input.turn = Math.abs(dx) <= DEAD ? 0 : Math.max(-1, Math.min(1, dx / STEER));
        lookKnob.style.transform = 'translate(' + dx + 'px,' + Math.max(-R, Math.min(R, dy)) + 'px)';
      }
    }, { passive: false });

    document.addEventListener('pointerup', releasePointer);
    document.addEventListener('pointercancel', releasePointer);   // the finger can just vanish
    moveEl.classList.add('rest');

    // ---- optional gyro aim ----
    // Turning the phone is closer to 1:1 with looking than a thumb stick is, and
    // the touch-adaptation literature consistently rates gyro + stick together as
    // the better pair. But the sensor is not Baseline: iOS hides it behind a
    // permission prompt that needs a real tap (the GYRO option button is that tap),
    // so it is opt-in and the thumb stick stays the fallback.
    if (gyroOK) {
      let lastAlpha = null;
      window.addEventListener('deviceorientation', e => {
        if (!prefs.gyro) { lastAlpha = null; return; }
        if (G.state !== 'play') return;
        const a = e.alpha;
        if (a === null || a === undefined) return;
        if (lastAlpha === null) { lastAlpha = a; return; }
        let d = a - lastAlpha;
        if (d > 180) d -= 360; else if (d < -180) d += 360;
        lastAlpha = a;
        if (Math.abs(d) < 0.2) return;                  // sensor jitter is not a turn
        G.player.a += d * (Math.PI / 180) * 0.9;        // ~1:1 with the phone's yaw
      });
    }

    // ---- the buttons a thumb can actually reach ----
    function swapGun() {
      const p = G.player;
      for (let i = 1; i <= 3; i++) {
        const w = (p.w + i) % 3;
        if (w === 0 || (w === 1 && p.owns.sg) || (w === 2 && p.owns.mg)) { Input.wantW = w; break; }
      }
    }
    const hudBtn = (id, fn) => $(id).addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation(); fn();
    });
    hudBtn('gunCell', swapGun);
    hudBtn('mapBtn', toggleMap);
    hudBtn('pauseBtn', () => { endMove(); endLook(); endFire(); pauseGame(); });
  }
  // ---- boot ----
  window.addEventListener('load', () => {
    const q = new URLSearchParams(location.search);
    if (q.get('level')) G.level = Math.min(LEVELS.length - 1, Math.max(0, Number(q.get('level')) | 0));
    init();
    if (q.get('auto')) startGame();
    if (q.get('fire')) { Input.fire = 1; setInterval(() => { Input.fireEdge = 1; }, 250); }
    if (q.get('mv')) Input[q.get('mv')] = 1;
  });
  window.__G = () => G;
  return { init, showOverlay, startGame, Input };
})();
window.Main = Main;