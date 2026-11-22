# GRIM HALL — Build Plan (agent handoff)

Five independent features, ordered small → large. Each section is self-contained:
goal, files, implementation steps, tests, acceptance criteria. Implement them one
at a time, run the full verification suite after each, and stop for review between
features. Sections can be dropped without affecting the others.

---

## 0. Context — read this first

### What this is
A Wolfenstein 3D-style retro FPS. 18 floors (index 17 `THE GILDED HALL` is
`secret: true`, reached only by elevator), 3 guns, 4 enemy types, 100% procedural
art and audio. The only vendored file is `lib/three.min.js` (Three.js r147).
**No runtime dependencies, no build step, no external assets — keep it that way.**
It must keep working from `file://` (double-click `index.html`).

### Commands
- `npm test` — node:test suite, headless sim (`test/game.test.js`) + boot/source
  checks (`test/boot.test.js`). Currently **47/47**. Must stay green.
- `npm run test:touch` — drives the real pointer handlers in Chrome via
  `agent-browser` against a generated `.debug-touch.html`. Currently **71/71**.
  Must stay green. Takes ~40 s.
- `npm run serve` — python http.server on :8080 for manual smoke tests.
- Debug query flags: `?auto=1` (skip title, no pointer lock), `?touch=1` (force
  touch mode), `?level=N`, `?tp=x,y,a`, `?fire=1`, `?mv=fwd`. `window.__G()`
  returns the live sim state; `window.Input` is the input object.

### Architecture
Everything hangs off one global namespace `GH` declared in `js/data.js`.
Script order in `index.html` matters: `three.min.js → data.js → secrets.js →
art.js → audio.js → game.js → main.js`.

| File | Role |
|------|------|
| `js/data.js` | static content: levels, weapons, enemy stats, `tune` |
| `js/secrets.js` | carves vaults/elevators into every map at load (grows the grid) |
| `js/art.js` | procedural textures/sprites, cached per level seed (`GH.art`) |
| `js/audio.js` | WebAudio SFX + music (`GH.sound`, `GH.music`) |
| `js/game.js` | **pure sim** — no DOM, no THREE. `GH.game`, state in `Game.G` |
| `js/main.js` | Three.js renderer, input, HUD, overlays (IIFE `Main`) |
| `index.html` | page shell, HUD DOM, all CSS |

Sim/renderer contract: the sim reads `GH.input` and is driven by `update(dt)`;
the renderer writes input and mirrors `G` into meshes each frame. Timed UI
(overlay panels, the tap-fire queue) runs on the **sim clock**, never
`setTimeout`/`performance.now()` — this is deliberate and load-bearing.

### Current state
A bug-fix pass just landed (flow-field index fix, secret-floor rotation via
`Game.nextIndex()`, audio volume null-guard, touch-action zoom fix, GPU disposal,
sim-clock tap queue, CI test gate, `.assetsignore`). **Changes may be uncommitted
in the working tree — run `git status` first, treat existing modifications as
user-owned, and do not revert or commit them unless asked.**

### Conventions & guardrails (violating these breaks the game or the tests)
1. **Assist channel rule** (`.clinerules/learned.md`): raw turn lives in
   `stickTurn`, written only via `setTurn()`. `Input.turn` is the *blended output*
   the aim assist writes. Never read `Input.turn` back into an assist or you get
   a feedback spin. New turn sources (gamepad) write through `setTurn()`.
2. **Sim stays pure**: no DOM/THREE/localStorage in `js/game.js`. UI persistence
   belongs in a separate module or `main.js`.
3. **Pushwall test rule**: tests that shove a panel must clear its two-square
   travel lane first (`freeForWall`); see the "deep chamber shove" tests.
4. **Touch test rule**: call the harness's staging helper before any
   position-dependent assertion; levels are procedural per seed.
5. Comments explain *why* (constraints, invariants), not *what*. Match the
   existing voice. No decorative comments.
6. New browser modules attach to `GH`, load after `data.js`, and export via
   `module.exports` under Node so they are unit-testable (see `audio.js`).
7. `test/boot.test.js` asserts script order and that `main.js` boots in a `vm`
   sandbox with only `THREE` + `GH` in scope. If you add a script, add it to the
   order check. Top-level code in `main.js` must not construct THREE objects
   (the boot test stubs `THREE = {}`); build them lazily inside functions.
8. **Do not push to `main`** — every push auto-deploys to Cloudflare Pages
   (`.github/workflows/deploy.yml`, now test-gated). Leave commits/pushes to the
   user unless explicitly instructed.

---

## 1. Feature A — Keyboard-accessible overlays (Enter / Space)

**Goal.** Title, pause, death and win panels are click-only today. A keyboard
user cannot start or resume. Add Enter (and Space when not playing) as confirm,
plus minimal dialog semantics.

**Files:** `js/main.js`, `index.html`, `test/touch-harness.js`.

**Steps**
1. In `bindInput()`, the `canvasClick()` closure holds the state-transition
   logic (pause → resume; win → `G.level = Game.nextIndex()` then `startGame()`;
   title/dead → `startGame()`). Extract that logic into a module-scope function
   `advance()` so mouse, keyboard and (later) gamepad share one path.
   `canvasClick()` keeps the pointer-lock request and the in-play fire behavior.
2. In the existing `window` `keydown` handler: when `G.state !== 'play'`,
   `Enter` or `Space` calls `advance()` + `e.preventDefault()` and returns
   before the fire binding. In play, Space keeps firing exactly as today.
   `requestPointerLock()` from a keydown is a valid user activation.
3. `index.html`: give `#ov` `role="dialog"` and `aria-modal="true"`; give
   `#ovBox` an `aria-label` that tracks the panel kind (set in `showOverlay`).
   The `.go` prompt text should mention Enter, e.g. `[ CLICK OR PRESS ENTER ]`.

**Tests**
- Harness: pause via `pauseBtn`, dispatch `new KeyboardEvent('keydown',
  {key:'Enter', bubbles:true})` on `window`, assert `G.state === 'play'`.
- Harness: from a fresh load (title), Enter starts the game.
- Existing "overlay tap resumes" and "option buttons do not also resume" must
  stay green (the `.opts` mousedown guard is untouched).

**Acceptance.** Enter starts/resumes/advances every panel; Space still fires in
play; pointer lock still engages on desktop start; 71/71 + new checks green.

**Risk.** Low. Watch the Space double-binding: the `state !== 'play'` branch
must return early so a title-screen Space doesn't also queue `Input.fire`.

---

## 2. Feature B — Overlord boss bar

**Goal.** Levels with an Overlord (`e.t === 'O'`, 240 hp) get a boss health bar
so the fight reads as a set piece.

**Files:** `index.html`, `js/main.js`, `test/touch-harness.js`.

**Steps**
1. `index.html`: add `<div id="boss" class="hidden"><span>OVERLORD</span>
   <div class="bar"><div id="bossFill"></div></div></div>`. Style: fixed,
   top-center, ~40% width, below `#sysbar`/`#mini` traffic (top: ~56px desktop;
   on touch keep it clear of the corner buttons — check both mirrors). Dark
   panel, red fill, pixel font, `pointer-events:none`, `z-index:4`.
2. `main.js` `updateHUD(t)`: find the first living `O` in `G.enemies`. If none,
   hide. If present, show and set `bossFill.style.width` to
   `100 * e.hp / e.def.hp + '%'` **only when the fraction changes** (cache the
   last value, same pattern as the face-canvas cache). Tint the fill when
   `Game.wounded(e)` is true.
3. No sim changes — `G.enemies`, `e.hp`, `e.def.hp` already exist.

**Tests**
- Harness: on a level with an `O` (level 0 has one), assert `#boss` visible and
  fill width 100%; damage it via `Game.damagePlayer`? No — damage the enemy
  directly (`e.hp -= 60`, then a frame) and assert the width drops; kill it via
  `Game.killEnemy(e)` and assert hidden after the corpse collapse.
- Layout: assert the bar does not overlap `#sysbar` buttons or `#mini` in touch
  mode, both mirrors (the harness already has an `overlap()` helper).

**Acceptance.** Bar appears only while an Overlord lives, drains smoothly,
hides on death, never collides with touch chrome.

**Risk.** Low. Pure renderer feature; keep it out of the sim.

---

## 3. Feature C — Progress persistence + level select

**Goal.** A refresh currently loses the run. Persist the highest unlocked floor
and per-floor best results; let the player pick any unlocked floor from the
title screen. The secret floor stays out of the rotation.

**Files:** new `js/progress.js`, `index.html`, `js/main.js`,
`test/progress.test.js` (new), `test/boot.test.js`, `test/touch-harness.js`.

**Steps**
1. **Pure module** `js/progress.js` attaching `GH.progress`, storage injected so
   it is node-testable (pattern: `audio.js`):
   ```js
   // shape: { unlocked: 0, best: { [levelIndex]: {score, time, accuracy, rank, secrets} } }
   load(storage)            // tolerant parse of 'gh.progress', defaults on garbage
   save(storage, prog)
   recordWin(prog, levelIndex, stats, levels)  // returns new prog, idempotent
   ```
   `recordWin` rules:
   - `best[levelIndex]` keeps the **higher score** (tie → faster time).
   - Unlock: for a non-secret win, `unlocked = max(unlocked, next)` where `next`
     is the next non-secret index after `levelIndex`. **Wrap case:** clearing the
     last normal floor (16) computes next = 0; in that case set `unlocked` to the
     highest non-secret index instead. A secret-floor win records `best` but
     never changes `unlocked`.
   - Take `levels` (the array) as a parameter so the module never imports game
     state; compute the secret skip from `levels[i].secret` directly.
2. `index.html`: load `js/progress.js` after `data.js` (before `main.js`).
   Extend the `boot.test.js` order check to include it.
3. `main.js`:
   - Load once at boot: `const prog = GH.progress.load(localStorage)` wrapped in
     try/catch (private-mode safe, same as the existing prefs reads).
   - Hook recording into `showOverlay('win')` (the sim-timed, deterministic
     moment): build stats from `G` (reuse `statLine()`'s inputs), call
     `recordWin`, save. Must be idempotent — `refreshPanel()` can re-render.
   - Title panel: render a level-select row — one button per floor `0..unlocked`,
     numbered, current selection highlighted, locked floors rendered as disabled
     buttons. Show the selected floor's best score/rank beneath. Buttons carry
     `data-level="N"` and live in a `.lvls` container.
   - Extend the document `mousedown` guard from `.opts` to `.opts,.lvls`, and
     handle `button[data-level]` in the existing `#ovBox` `pointerdown` handler
     (preventDefault + stopPropagation, set `G.level`, re-render title). Add a
     START button (or keep click-anywhere) that calls `advance()` at the
     selected level.
   - `startGame()` already builds `G.level` — no change needed there.
4. Keep the existing "click anywhere to enter" behavior working when no level
   button was tapped.

**Tests**
- `test/progress.test.js` (pure node): default load; garbage-tolerant load;
  recordWin unlocks sequentially; **wrap case** (win 16 → unlocked = 16, not 0);
  secret win leaves `unlocked` untouched; best keeps higher score; idempotent
  double-record; save/load roundtrip through a fake storage object.
- Harness: win a level (stage: kill all enemies via `Game.killEnemy`, touch the
  exit or set state and call the overlay path), reload the page, assert the
  title shows the next floor unlocked; tap a level button, assert `G.level`
  matches and the game starts there; assert a locked button does nothing.

**Acceptance.** Refresh keeps progress; level select works by touch and mouse;
secret floor never appears in the select row; best stats survive; 47+ node
tests green including the new file.

**Risk.** Medium. The unlock wrap case and the overlay event guards are the two
places this goes wrong — both have explicit tests above. Do not put any of this
logic in `js/game.js`.

---

## 4. Feature D — Gamepad support

**Goal.** Standard-mapping gamepad: left stick move (analog, sprint at full
push), right stick turn, RT fire, LB/RB weapon cycle, A confirm on overlays,
Start pause. Additive — keyboard/mouse keep working simultaneously.

**Files:** `js/main.js`, `test/touch-harness.js`.

**Steps**
1. Module-scope state in `Main`: `let padIndex = null;` listen for
   `gamepadconnected`/`disconnected` on `window` to set/clear it.
2. Poll once per frame in the rAF loop, **after `TouchUI.update(dt)` and before
   `aimAssist()`** (so the assist blending order is preserved; the assist is
   touch-only anyway). Skip entirely when `padIndex === null`.
3. Mapping (standard layout):
   - `axes[0/1]` → move. Deadzone 0.2, radial. Convert to `fwd/back/left/right`
     exactly like the touch move stick (analog magnitude, sprint ≥ 0.85).
   - `axes[2]` → turn through **`setTurn()`** (guardrail #1), deadzone 0.15,
     optional response curve. When the stick is idle, call `setTurn(0)` *only if
     no arrow key is held* (derive from the `keys` map; `arrowTurn()` owns that
     channel otherwise).
   - `buttons[7]` (RT) → fire. Held: `Input.fire = 1` and re-edge
     `Input.fireEdge = 1` each frame for semi-autos (the sim's `fireCd` gates
     cadence — same mechanism as touch auto-fire). Release: `Input.fire = 0`.
   - `buttons[4/5]` (LB/RB) edge → cycle weapon. Reuse the `swapGun()` logic
     (hoist it out of the touch-only section so desktop can call it).
   - `buttons[0]` (A) edge → when `G.state !== 'play'`, call `advance()`
     (Feature A). In play, A can also fire as an alternative.
   - `buttons[9]` (Start) edge → `pauseGame()` / resume via `advance()`.
4. **Coexistence with keyboard:** derive the keyboard contribution from `keys`
   each frame and combine (`Input.fwd = max(keyHeld ? 1 : 0, padFwd)`, etc.) so
   neither device clobbers the other. Mouse look writes `G.player.a` directly
   and is unaffected by the turn channel.
5. Edge detection: keep a `prevButtons` array; fire actions on 0→1 transitions.
6. Title/pause panels: add a line "gamepad supported" to the controls text when
   a pad is connected (optional, cheap).

**Tests**
- Harness: stub the API —
  `Object.defineProperty(navigator, 'getGamepads', {value: () => [fakePad]})`
  with a mutable fake `{axes, buttons}` and dispatch `gamepadconnected`. Assert:
  stick deflection walks analog; full push sprints; right stick turns via
  `stickTurn` (assert `Input.turn` settles, not spins — guardrail #1); RT fires
  at the pistol cadence; A starts from title; Start pauses; disconnect leaves
  keyboard control intact. Restore the stub afterwards.
- Existing keyboard/touch checks must stay green (the combine logic is the risk).

**Acceptance.** A connected pad plays the game start-to-finish without touching
the keyboard; keyboard+pad simultaneous input works; no assist feedback spin;
71/71 + new checks green.

**Risk.** Medium. Input-channel ownership is the hard part — respect guardrail
#1 and the keyboard-combine rule. Polling must be a no-op when no pad is
connected (zero cost on desktop without one).

---

## 5. Feature E — PWA / offline install

**Goal.** Installable on mobile, playable offline after first visit. The game
is fully self-contained, so this is mostly plumbing. Must not break `file://`.

**Files:** new `manifest.webmanifest`, new `sw.js`, new `tools/make-icons.js`,
`index.html`, `test/boot.test.js` (or a new `test/pwa.test.js`).

**Steps**
1. **Icons without dependencies:** `tools/make-icons.js` (node, run manually,
   output committed) generates `icons/icon-192.png` and `icons/icon-512.png`.
   Draw procedurally into a raw RGBA buffer (brick courses + "GH" monogram,
   palette from the hall theme) and encode PNG with node's built-in `zlib`
   (`deflateSync` over filtered scanlines + CRC32 chunks — ~50 lines, no deps).
   Do not add a canvas/sharp dependency.
2. `manifest.webmanifest`: name "GRIM HALL", short_name "GRIM HALL",
   `display: "fullscreen"`, `orientation: "landscape"`,
   `background_color`/`theme_color` `#0a0505`, `start_url: "./index.html"`,
   `scope: "./"`, the two icons (`purpose: "any maskable"`).
3. `sw.js`: versioned cache (e.g. `grim-hall-v1`). Install: precache
   `index.html`, `manifest.webmanifest`, both icons, `js/*.js`,
   `lib/three.min.js`. Fetch: cache-first, fall back to network, put successful
   same-origin GETs. Activate: delete old caches, `clients.claim()`.
   `self.skipWaiting()` for simplicity (note: a deploy mid-run swaps assets on
   next load — acceptable for this project).
4. `index.html`:
   - `<link rel="manifest" href="manifest.webmanifest">`,
     `<meta name="theme-color" content="#0a0505">`,
     `<meta name="description" ...>`,
     `<link rel="apple-touch-icon" href="icons/icon-192.png">`,
     `<meta name="apple-mobile-web-app-capable" content="yes">` +
     black-translucent status bar.
   - Register the SW **only when supported and not on file://**:
     `if ('serviceWorker' in navigator && location.protocol !== 'file:')
     navigator.serviceWorker.register('sw.js')` — inline script at the end of
     body or a tiny `js/pwa.js` (if a new file, respect script order + boot test).
5. `.assetsignore`: icons/manifest/sw **must ship** (they are not in the ignore
   list — verify). `tools/` should be added to `.assetsignore` (workshop, not
   game).

**Tests**
- Node: manifest parses as JSON and references existing icon files; icons are
   valid PNGs (magic bytes + IHDR dimensions); `node --check sw.js` passes;
   `index.html` contains the manifest link and the file:// guard.
- Manual (document in the PR/commit message): `npm run serve`, open
   http://localhost:8080, DevTools → Application → manifest installable, then
   offline mode → reload → game boots and plays. SW does not register on
   `file://` (no console error).

**Acceptance.** Install prompt on Android Chrome; full offline play after one
visit; `file://` double-click still works with zero console errors; deploy
serves the new files.

**Risk.** Medium-low. The only novel code is the PNG encoder — keep it minimal
and test the output bytes. Cache versioning mistakes show up as stale builds;
bump the cache version whenever shipped assets change.

---

## 6. Global verification (after every feature)

```bash
npm test                 # must be 47/47 + whatever you added
npm run test:touch       # must be 71/71 + whatever you added
node --check js/*.js     # syntax
```

Manual smoke: `npm run serve` → `http://localhost:8080/?auto=1` plays; title
screen → click → pointer lock → ESC pause → resume; on a phone (or
`?touch=1`): two-thumb play does not zoom the page, taps fire during cooldown.

Before finishing: `git status` — only your intended files changed; no
`tmp-*`/`.debug-*` artifacts committed (both gitignored); no new dependencies in
`package.json`; `docs/`, `test/`, `tools/` stay out of the deploy via
`.assetsignore`.

**Do not commit or push unless the user asks.** Pushing to `main` deploys to
https://grim-hall.pages.dev automatically.

## 7. Suggested order

A (Enter) → B (boss bar) → C (progress) → D (gamepad) → E (PWA).

A extracts `advance()`, which D reuses — doing A first avoids a refactor later.
Everything else is independent; each feature is separately shippable and
separately verifiable. Stop for user review between features.
