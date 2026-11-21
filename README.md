# GRIM HALL

A Wolfenstein 3D-style retro FPS. Eleven levels, 3 guns, 4 enemy types, 100% procedural
art and audio (no external assets — the only vendored file is the Three.js engine).

## Run it
Just double-click `index.html` (works from `file://`, no server needed).
Or `npm run serve` and open http://localhost:8080.

## Run the tests
`npm test` (plain `node --test`, no dependencies) — the game logic in `js/game.js` is
engine-independent and runs headless with a seeded RNG, so runs are reproducible.

## How to play
- **Click** the title screen to start (grabs mouse pointer lock; ESC pauses)
- **WASD** move, **Shift** sprint, **mouse** look, **left/right arrows** turn, **click / space** fire
- **1 / 2 / 3** switch weapons (picking up a new gun auto-equips it, with a dip animation)
- **M** toggle minimap, **V** mute, **- / +** volume, ESC pauses
- Clear a hall — kill every enemy, then touch the green **EXIT** — to advance to the next level
- **Secret pushwall** in the arena's south wall (brick that slides open) — big health, MG ammo,
  and **armor** inside; finding it plays a chime and counts on the end screen (secrets x/1)
- **Armor** (green vest, `k`) absorbs 50% of incoming damage until depleted; MG ammo is scarce — spend it wisely
- Enemies have **flinch** when hit, **Gunners strafe** at range, **Brutes telegraph then charge-lunge**
- Health/ammo drop from kills (with blood splats); doors open when you or a hunting enemy gets close
- HUD: health, the classic status **face** that degrades as you take damage, ammo
  (blinks red when low), gun, kills, timer, hit marker, +100 kill popup, damage vignette,
  and a red arc showing **which direction** you're being shot from

## Enemies
Enemies **hunt you with a flow-field pathfinder** (they path around corners and open doors),
and your gunshots **alarm every enemy within earshot**. All sprites have 4 directional views.

| Type | HP | Attack |
|------|----|--------|
| Grunt | 22 | hitscan rifle |
| Gunner | 48 | rapid hitscan |
| Brute | 100 | 3-spread shell projectiles + melee |
| Overlord (boss) | 240 | bombs + melee |

Death/win screens show score, time, accuracy (hits/shots) and a rank (HALLMASTER / SLAYER / SURVIVOR).

## Look
- **PBR masonry** — every level's brick, metal, floor and ceiling is generated as an
  albedo plus a tangent-space normal map built from a height field plus a roughness map,
  so torch light pools on stone and steel glints instead of washing flat.
- **Emissive slag** — forge and magma themes draw molten veins into an emissive map, so
  those halls light themselves.
- **Volumetric torch shafts** — additive cones driven by the same flicker value as the
  torch's point light, with embers spiralling down the beam.
- **Post pass** — bloom (quarter-res bright pass, separable Gaussian blur, composite),
  vignette, grain, scanlines, chromatic aberration and a per-theme colour grade, all
  hand-written GLSL.
- **Enemies** — four procedurally painted figures, four directional views each, a walk
  stride, an attack-telegraph pose, a muzzle flash, a contact shadow and a collapse on death.

## Debug switches
`?auto=1` skips the title screen and drops pointer lock, `?tp=x,y,angle` teleports,
`?mv=fwd` auto-walks, `?fire=1` auto-fires, and the render features can be turned off one
at a time for an A/B screenshot: `?post=0` (no bloom/composite), `?grade=0` (no theme
grade), `?nocone` (no torch shafts or embers), `?glow=0` (no emissive slag).

## Files
- `index.html` — page shell, HUD, overlays
- `js/data.js` — map, weapons, enemy stats
- `js/art.js` — all procedural textures/sprites (canvas-drawn)
- `js/audio.js` — WebAudio SFX + music loop
- `js/game.js` — game logic (engine-independent, unit-tested with node)
- `js/main.js` — Three.js renderer, input, HUD
- `lib/three.min.js` — Three.js r147 (vendored)
