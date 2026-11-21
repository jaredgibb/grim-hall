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
  let weaponMesh, flashMesh, muzzleLight, muzzlePos, exitMesh, exitLight, flashLight, eFlash;
  let torches = [], flames = [], cones = [], embers = [], coneGeo = null;
  let msgDiv, lastMini = 0, popDiv, popUntil = 0, lastKills = 0, dmgDiv;
  const Input = { fwd: 0, back: 0, left: 0, right: 0, turn: 0, fire: 0, fireEdge: 0, wantW: -1, sprint: 0 };
  NS.input = Input;      // game.js reads GH.input
  window.Input = Input;  // handy for debugging from the console
  const keys = {};
  const WOUND_ON = !location.search.includes('nowound');   // A/B switch for wounded sprites

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
    buildWeapon();
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
  const VIEW = { w: 0.50, h: 0.375, z: -0.5 };
  const HUD_FRAC = 0.2;                    // HUD bar = canvasWidth/8 = 20% of canvas height
  function viewAnchor() {
    const halfH = Math.tan(camera.fov * Math.PI / 360) * -VIEW.z;
    const halfW = halfH * (VW / VH);
    return { x: halfW - VIEW.w / 2, y: -halfH + HUD_FRAC * 2 * halfH + VIEW.h / 2 };
  }
  function buildWeapon() {
    weaponMesh = new THREE.Mesh(new THREE.PlaneGeometry(VIEW.w, VIEW.h),
      new THREE.MeshBasicMaterial({ map: ART.weapons[0].idle, transparent: true, alphaTest: 0.4, depthTest: false }));
    weaponMesh.position.set(VIEW.w / 2, 0, VIEW.z);
    weaponMesh.renderOrder = 10;
    camera.add(weaponMesh);
    // the flash is a child of the gun, so it always sits on that gun's muzzle
    flashMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: ART.flash, transparent: true, depthWrite: false, depthTest: false }));
    flashMesh.renderOrder = 11;
    flashMesh.visible = false;
    weaponMesh.add(flashMesh);
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
    const bobY = p.moving ? Math.sin(p.bob) * 0.035 : 0;
    const bobX = p.moving ? Math.cos(p.bob * 0.5) * 0.02 : 0;
    const shk = G.shake * 0.02;
    if (G.state === 'dead') deadT += dt; else deadT = 0;
    const eyeY = Math.max(0.12, EYE + bobY - deadT * 0.75);
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
    // weapon viewmodel: bob + recoil + switch dip + fire frame
    const wm = ART.weapons[p.w];
    const firing = p.fireCd > WEAPONS[p.w].rate - 0.09;
    weaponMesh.material.map = firing ? wm.fire : wm.idle;
    const ky = p.moving ? Math.sin(p.bob) * 0.012 : 0;
    const kx = p.moving ? Math.cos(p.bob * 0.5) * 0.008 : 0;
    const sw = (p.switchT || 0) > 0 ? Math.sin((0.3 - p.switchT) / 0.3 * Math.PI) : 0;
    const kick = p.kick || 0;
    const anchor = viewAnchor();
    weaponMesh.position.set(anchor.x + kx, anchor.y + ky - sw * 0.14 + kick * 1.2, VIEW.z + kick * 0.45);
    weaponMesh.rotation.z = -kick * 2.4 - sw * 0.3;            // twists in the hand on recoil, dips on switch
    // pin the bloom to this gun's muzzle pixel and let it ride with the recoil
    const [mx, my] = wm.muzzle;
    flashMesh.position.set((mx / 128 - 0.5) * VIEW.w, (0.5 - (my + (firing ? 3 : 0)) / 96) * VIEW.h, 0.02);
    if (firing) {
      const s = (wm.bloom * 2 / 96) * VIEW.h * (0.9 + Math.random() * 0.25);
      flashMesh.scale.set(s, s, 1);
      flashMesh.rotation.z = Math.random() * 0.7;
      flashMesh.visible = true;
      flashMesh.getWorldPosition(muzzlePos);   // light comes from the actual muzzle
      muzzleLight.position.copy(muzzlePos);
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
  // Sprites are flat art, so the scene's lights have to be faked on them: torch
  // pools, the player's own glow and the muzzle flash all push the tint up.
  function spriteLight(x, y) {
    let lit = 0.5;
    for (const l of torches) {
      const d = Math.hypot(l.position.x - x, l.position.z - y);
      if (d < 7) lit += l.intensity * (1 - d / 7) * 0.55;
    }
    const dp = Math.hypot(camera.position.x - x, camera.position.z - y);
    if (dp < 8) lit += 0.3 * (1 - dp / 8);
    if (muzzleLight.intensity > 0) {
      const dm = Math.hypot(muzzleLight.position.x - x, muzzleLight.position.z - y);
      if (dm < 12) lit += muzzleLight.intensity * (1 - dm / 12) * 0.9;
    }
    return Math.min(1.4, lit);
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
        const s = mkSprite(ART.spr[e.t].f[0].walk, e.def.h * asp, e.def.h);
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
      o.grp.position.set(e.x, 0, e.y);
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
      o.spr.material.map = e.flash > 0 ? set.flash : (WOUND_ON && Game.wounded(e) ? set.hurt : set.walk);
      o.spr.material.color.setScalar(spriteLight(e.x, e.y));
      o.spr.scale.set(e.def.h * asp, e.def.h, 1);
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
        o.spr.material.opacity = 1 - k * k;
        o.spr.material.transparent = true;
        o.shadow.scale.set(e.def.h * asp * 1.25 * (0.4 + k * 0.6), e.def.h * 0.6 * (0.4 + k * 0.6), 1);
        o.shadow.material.opacity = 0.55 * (0.35 + k * 0.65);
      } else {
        o.grp.rotation.x = 0; o.grp.position.y = 0;
        o.spr.material.opacity = 1;
        o.shadow.material.opacity = 0.55;
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
          const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(f.x0, 1.0, f.y0), new THREE.Vector3(f.x1, 1.0, f.y1)]);
          o = { f, line: new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffcc66, transparent: true })) };
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
    $('hud').classList.toggle('hidden', G.state === 'title');
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
  // ---- overlays ----
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
    ov.classList.remove('hidden');
    if (kind === 'title') {
      box.innerHTML = '<h1>GRIM HALL</h1><h2>' + LEVELS[G.level].name + ' &mdash; level ' + (G.level + 1) + ' of ' + LEVELS.length + '</h2>' +
        '<div class="ctl"><b>WASD</b> move &nbsp; <b>Shift</b> sprint &nbsp; <b>mouse</b> look &nbsp; <b>click / space</b> fire<br>' +
        '<b>1 2 3</b> weapons &nbsp; <b>M</b> map &nbsp; new guns auto-equip &nbsp; ESC pauses<br>' +
        'kill all ' + G.total + ' horrors, then reach the green <b>EXIT</b> &mdash; a secret hides in these walls</div>' +
        '<div class="go">[ CLICK TO ENTER ]</div>';
    } else if (kind === 'dead') {
      box.innerHTML = '<h1 style="color:#a00">YOU DIED</h1><h2>the hall keeps you</h2>' +
        '<div class="stat">' + statLine() + '</div>' +
        '<div class="go">[ CLICK TO TRY AGAIN ]</div>';
    } else if (kind === 'pause') {
      box.innerHTML = '<h1 style="font-size:34px">PAUSED</h1><div class="go">[ CLICK TO RESUME ]</div>';
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
    if (!q.get('auto') && cv.requestPointerLock) cv.requestPointerLock();
  }
  // ---- input ----
  function bindInput() {
    const KEYMAP = { w: 'fwd', arrowup: 'fwd', s: 'back', arrowdown: 'back', a: 'left', d: 'right' };
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
    sndBtn.addEventListener('mousedown', e => {
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
      if (k === 'm') G.mini = !G.mini;
      if (k === 'shift') Input.sprint = 1;
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
    });
    const cv = () => renderer.domElement;
    document.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
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
    });
    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement && G.state === 'play' && !location.search.includes('auto')) {
        G.state = 'pause'; showOverlay('pause');
      }
    });
    window.addEventListener('mouseup', e => { if (e.button === 0) Input.fire = 0; });
    document.addEventListener('mousemove', e => {
      if (document.pointerLockElement === cv() && G.state === 'play') G.player.a += e.movementX * 0.0022;
    });
    cv().addEventListener('contextmenu', e => e.preventDefault());
    // arrow-key turning
    setInterval(() => {
      Input.turn = (keys.arrowleft ? -1 : 0) + (keys.arrowright ? 1 : 0);
    }, 16);
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