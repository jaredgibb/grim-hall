# Mobile controls for GRIM HALL — research + design proposal

Date: 2026-11-21. Audited against `js/main.js` (touch block, lines ~1242–1300),
`index.html` (HUD/CSS), `js/data.js` (tune), `js/game.js` (input consumption).

## TL;DR — the six changes that matter

1. **Draw the controls.** The touch stick is invisible, so there is no affordance and
   no way for a new player to discover it. Render a floating stick base + knob.
2. **Split the hands.** One finger currently does steering, walking, firing and
   pausing. Move = left thumb, look = right thumb, fire = dedicated right-side button.
3. **Kill the hold-to-pause gesture.** An 800 ms hold on the stick pauses the game
   mid-fight. Pause needs its own button.
4. **Put real buttons in the thumb zone.** The HUD sits across the bottom of the view,
   but the only touch-reachable actions are the GUN cell and a 53x25 px sound button.
5. **Make portrait actually playable.** At a 500x800 viewport the canvas is 500x313 —
   39% of the screen — with nothing in the bars but a hidden stick.
6. **Use `pointer` events + `dvh` + safe-area insets.** Mouse-first handlers plus
   `100vh` are the two classic mobile-input bugs.

---

## 1. What the game does today

Current touch model (single contact, anchored wherever the finger lands):

| gesture | effect | code |
|---|---|---|
| drag | `turn = clamp(dx/34)`, `fwd/back = clamp(±dy/34)` | main.js 1261–1274 |
| tap (< 320 ms, no drag) | one shot (`fire = fireEdge = 1`, released after 120 ms) | main.js 1279–1283 |
| hold (>= 800 ms, no drag) | pause overlay | main.js 1256–1258 |
| tap the HUD GUN cell | cycle weapon | main.js 1291–1298 |

Verified headlessly with synthetic pointer events: `node test/touch-harness.js`
writes a probe page (`.debug-touch.html`) and headless Chrome reads `#touchprobe`.
The current suite is `npm run test:touch`, which runs 71 assertions against that page. Early runs of the probe reported
`tap: shots=1`, `drag up-right: turn=1.00 fwd=1.00`, `hold 900ms: state=pause`,
`drag-then-hold: state=play`, `release: turn=0 fwd=0`. The mechanics work; the
scheme is the problem.

### Measured layout at real phone viewports

Measured headlessly with the harness's geometry probe (HUD forced visible; the
one-off `.debug-geo.js` probe it came from has been removed):

| viewport | canvas | letterbox | HUD | HUD cell | SOUND button | minimap |
|---|---|---|---|---|---|---|
| 844x390 (landscape phone) | 624x390 @ x=110 | 110 px each side | 624x78 @ y=312 (covers bottom 20% of the view) | 75x75 | 53x25 | 172x172 @ (664,8) |
| 500x800 (portrait phone) | 500x313 @ y=244 | 244 px top + 181 px bottom | 500x63 @ y=738 | 60x60 | 53x25 | 172x172 @ (320,8) |
| 1024x624 (desktop) | 998x624 | 13 px | 998x125 | 119x122 | 53x25 | 172x172 |

Consequences:

- The only touch-accessible actions are the GUN cell (75x75 — fine) and the sound
  button (53x25 — under every recommended minimum).
- In landscape the **side bars are empty**, which is exactly where thumbs live —
  free real estate for the stick and the fire button.
- In portrait the game is 39% of the screen and the minimap sits in the top-right,
  the least reachable corner for a one-handed player.
---

## 2. What the research says

### Grip and reach
- Hoober's observational studies (1,333 users): **49% one-handed, 36% cradled,
  15% two-handed**; counting cradled users who tap with a thumb, **~75% of all
  touches are thumb touches**. The thumb's arc — not the whole screen — is the
  design canvas.
- The comfortable right-thumb arc in portrait is the **bottom centre**; the far
  top corners require a grip change, and every grip change is an error moment.
- Shooters pull players into **two-handed grip with a thumb in each bottom corner**
  in landscape. A layout must assume both one-handed and two-handed play.
- A **fixed joystick in a fixed corner misfires** in a pocket grip; a *floating*
  stick anchored where the thumb first lands is the standard fix.

### Target sizes (the numbers to design against)

| source | minimum |
|---|---|
| Apple HIG | 44 x 44 pt |
| Google Material | 48 x 48 dp |
| WCAG 2.2 (AA) | 24 x 24 CSS px |
| WCAG 2.1 (AAA) | 44 x 44 CSS px |

Plus spacing between targets, and nothing that demands pixel precision — a finger
covers the thing it is pressing, and there is no hover state to preview with.

### Does touch even pay off?
Microsoft's touch-adaptation work across 200+ streamed titles: **20% of Xbox Cloud
Gaming players use touch exclusively**, and titles with touch controls are played
**~2x as much** on average, with equal-or-higher satisfaction. Their guidance:
- **Start from a template and stay minimal.** Left side = movement, right side =
  primary/secondary actions.
- For shooters, **gyroscope aiming or a right-thumb touchpad** beats a thumb stick
  for precision; if the sensor is missing, **provide a non-sensor fallback**.
- Check reachability on the **smallest device you support**, not the dev machine.
- **Adapt the UI hints to the input type** (Gears 5 shows different prompts for
  gamepad vs touch).

### Why mouse-first input code breaks on a phone
1. **No hover.** Every action needs a visible, tappable form.
2. **Arity.** Move + fire is two simultaneous contacts; a single-position model
   collapses them into one.
3. **Termination.** A finger can vanish without a `pointerup` (notification shade,
   system gesture) — handle `pointercancel`.
4. **Synthetic mouse events.** Browsers still emit phantom clicks after touch, so
   listening to both paths double-fires. Grim Hall already guards this with a
   400 ms `lastTouch` window (main.js 1214) — a workaround rather than a fix.
   Pointer Events unify mouse/touch/pen behind one `pointerId` stream, which
   removes the bug class entirely.

### Fairness compensation for touch aiming
Touch cannot deliver the precision a shooter design assumes. Mobile shooters almost
universally compensate: aim assist, wider hit windows, or **auto-fire** (tap-and-hold
fires continuously). Grim Hall's pistol and shotgun are `auto: false`
(data.js 14–16), so a held touch trigger does nothing after the first shot — a
mobile-only dead end.

### Gyro / haptics — current API reality (checked against MDN)
- `DeviceOrientationEvent.requestPermission()` is **not Baseline**: required on
  iOS Safari, needs **transient activation** (a real click/tap) and a **secure
  context (HTTPS)** — so gyro aim cannot be automatic, and `file://` or
  `http://localhost` testing will not exercise it. Guard with
  `if (typeof DeviceOrientationEvent.requestPermission === 'function')`.
- `navigator.vibrate()` is **not Baseline** (Chrome/Android only) and needs sticky
  user activation. Treat haptics as a bonus, never a requirement.
- `env(safe-area-inset-*)` **is Baseline** (since Jan 2020) but only works with
  `<meta name="viewport" ... viewport-fit=cover>`, which the page currently lacks.
- `dvh`/`svh`/`lvh` are Baseline (2022) and fix the collapsing-toolbar bug that
  `100vh` has on mobile browsers.
- `touch-action: manipulation` disables double-tap-to-zoom, removing the browser's
  click delay on HUD buttons; `touch-action: none` (already on the canvas) is what
  makes `preventDefault()` on `touchmove` work without scroll jank.

---

## 3. Proposed scheme: two-thumb, visible, minimal

### Landscape (the primary mode for a 16:10 game)

```
        ┌───────────────────────────────┐   110 px black bar
        │        game canvas            │   ← stick lives here
   ◉────┤                              ├────▣  FIRE (72 px, bottom-right)
   stick│      HUD: HP · face · ammo    │
        │        GUN  MAP  PAUSE        │
        └───────────────────────────────┘
   left thumb                    right thumb
```

### Portrait
Same idea, controls in the bottom bar under the canvas, HUD shrunk to two rows,
plus a "rotate for a bigger view" hint.

### Gesture → action map

| input | action | replaces |
|---|---|---|
| left thumb drag (floating anchor) | 8-way move **including strafe** | WASD |
| left thumb pushed past ~85% of radius | sprint | Shift |
| right thumb drag (horizontal) | turn / look | mouse, arrows |
| right thumb tap on FIRE pad | fire | click, space |
| hold FIRE with the machinegun | continuous fire | hold click |
| GUN button (HUD, bottom cluster) | cycle weapon | 1 / 2 / 3 |
| MAP button (HUD) | minimap | M |
| PAUSE button (HUD) | pause | ESC, hold-to-pause |
| right thumb tap anywhere else | fire too (fallback) | — |

Things deliberately **not** gestures: hold-to-pause, double-tap, pinch, swipe.
Rare actions get rare, explicit buttons.

### Tuning numbers to start from

```js
const TOUCH = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const STICK_R  = Math.max(30, Math.min(60, 0.12 * Math.min(innerWidth, innerHeight)));
const DEAD     = STICK_R * 0.28;      // ~12 px on a phone: a tap is not a step
const STEER    = 34;                  // px of drag for full turn rate (unchanged)
const SPRINT_AT = 0.85;               // fraction of stick deflection = sprint
```

`game.js` already consumes `fwd/back/left/right` (main loop line 350–352) and
`turn` (line 348), and nothing on touch sets `left`/`right` today — so strafing
is free to add. `sprint` is read at line 357.

### Fairness tweaks worth testing (opt-in, off by default in scores)
- **Auto-fire on touch**: a held FIRE pad re-edges `fireEdge` every `rate` seconds
  for the pistol/shotgun.
- **Aim assist**: nudge heading up to ~4° toward the nearest enemy inside LOS,
  or raise `hitChanceBase` by 0.05 for coarse-pointer input. Both must be
  toggleable — the Gyro/aim-assist literature is consistent that forced
  assistance is worse for some players than none.
- **Optional gyro aim**: request permission on the first tap of a "GYRO" button;
  if the sensor is unavailable, silently fall back to thumb turning.

---

## 4. Implementation plan

### Stage 1 — unblock the existing controls (small, low risk)

`index.html`
```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
```
```css
/* dvh tracks the live viewport as the mobile toolbar collapses; vh does not */
html,body{height:100dvh}
#wrap canvas{width:min(100vw,calc(100dvh*1.6));height:min(100vw/1.6,100dvh);touch-action:none}
#hud{bottom:env(safe-area-inset-bottom);touch-action:manipulation}
#hud button{min-height:44px;min-width:44px}
```

`js/main.js`
- `gunCell` / `sndBtn`: `mousedown` → `pointerdown` (kills the synthetic-click
  delay and the `lastTouch` dedup hack).
- Title/pause overlay copy: when `TOUCH`, show "TAP TO ENTER" and the touch
  gesture list instead of the keyboard list (main.js 1116–1119 already has a
  touch line; make it conditional).
- Add `PAUSE` and `MAP` cells to the HUD, visible only when `TOUCH`.

### Stage 2 — the floating stick and the fire pad

```js
const TOUCH = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const STICK_R = Math.max(30, Math.min(60, 0.12 * Math.min(innerWidth, innerHeight)));
const DEAD = STICK_R * 0.28;
const base = document.createElement('div');
base.className = 'stick'; base.style.display = 'none'; document.body.appendChild(base);
const stick = { id: -1, ox: 0, oy: 0 };

cv().addEventListener('pointerdown', e => {
  if (e.pointerType === 'mouse') return;               // desktop keeps the mouse path
  if (e.clientX > innerWidth * 0.45) return;           // left side only = movement
  stick.id = e.pointerId; stick.ox = e.clientX; stick.oy = e.clientY;
  base.style.left = (e.clientX - STICK_R) + 'px';
  base.style.top  = (e.clientY - STICK_R) + 'px';
  base.style.display = 'block';
  try { cv().setPointerCapture(e.pointerId); } catch (err) {}   // drag off-canvas still steers
}, { passive: false });

cv().addEventListener('pointermove', e => {
  if (e.pointerId !== stick.id || G.state !== 'play') return;
  const dx = e.clientX - stick.ox, dy = e.clientY - stick.oy, d = Math.hypot(dx, dy);
  if (d <= DEAD) { Input.fwd = Input.back = Input.left = Input.right = 0; return; }
  const k = Math.min(1, d / STICK_R);                  // analog magnitude, not a binary
  Input.fwd   = Math.max(0, -dy / d) * k;
  Input.back  = Math.max(0,  dy / d) * k;
  Input.left  = Math.max(0, -dx / d) * k;
  Input.right = Math.max(0,  dx / d) * k;
  Input.sprint = k > 0.85 ? 1 : 0;
}, { passive: false });

const releaseStick = e => {
  if (e.pointerId !== stick.id) return;
  stick.id = -1; base.style.display = 'none';
  Input.fwd = Input.back = Input.left = Input.right = Input.sprint = 0;
};
cv().addEventListener('pointerup', releaseStick);
cv().addEventListener('pointercancel', releaseStick);   // the finger can vanish
```

Right side stays "drag to turn", plus a 72 px `#firePad` anchored bottom-right
inside the letterbox bar (`touch-action: none`, ≥44 px target):
```js
firePad.addEventListener('pointerdown', e => { e.preventDefault(); Input.fire = 1; Input.fireEdge = 1; });
firePad.addEventListener('pointerup',  () => { Input.fire = 0; });
```

### Stage 3 — feel
- Auto-fire assist for non-auto guns while FIRE is held.
- Optional aim assist / gyro aim, both toggleable.
- Optional `navigator.vibrate([15])` on taking damage, feature-detected.
- Auto-downscale quality on coarse-pointer devices (skip bloom/scanlines) —
  mobile GPUs are the reason most browser FPSes stutter, not the input.

### Stage 4 — how to test it
Headless Chrome can't emit real touch, so the harness drives the real handlers with
synthetic `PointerEvent`s and asserts the result. That is now `test/touch-harness.js`:

```
npm run test:touch
# or read the probe output directly:
node test/touch-harness.js && google-chrome --headless=new --dump-dom --window-size=1272,498 --virtual-time-budget=30000 \
  "file://$PWD/.debug-touch.html?touch=1&auto=1" | sed -n 's/.*touchprobe[^>]*>//p'
```
Assertions to add: tap fires exactly once, left drag strafes, sprint trips at 85%
deflection, a second simultaneous contact fires while the first steers,
`pointercancel` stops movement, and HUD buttons report ≥44 px.

Manual protocol (the parts no harness can catch):
1. **One-thumb run** — play with a coffee cup in the other hand.
2. **Silent novice** — hand the phone to someone with no instructions; where they
   hesitate is where the UI fails.
3. **Smallest device pass** — a layout that fits a 6.7" flagship can be a
   stretch-fest on a compact phone.
4. **Interruption test** — notification shade, incoming call, toolbar collapse.


---

## 5. What shipped (2026-11-21)

The scheme is in `js/main.js` (touch block, ~line 1360 onward) and `index.html`
(`#touchUI`, `#sysbar`, `body.touch` rules). Everything below was validated by
`node .debug-touch.js` driving headless Chrome with synthetic `PointerEvent`s:
**51 assertions, all passing.**

### Gesture map

| input | action | notes |
|---|---|---|
| left thumb drag (floating anchor) | analog 8-way move incl. strafe | the anchor follows the thumb past the radius, so reversing is a flick, not a trek |
| left thumb pushed >= 85% of radius | sprint | stick turns red |
| right thumb horizontal drag | turn | anchor slides past `STEER` so a long sweep keeps turning |
| right thumb tap (no drag) | one shot | the tap is *queued* if the action is still cooling |
| hold FIRE pad | continuous fire | `autoFire` re-edges the semi-auto guns |
| tap in the move half | nothing | repositioning a thumb is not a trigger pull |
| `pointercancel` | release everything | fingers vanish under notification shades |
| tab hidden | auto-pause | a phone session is interrupted constantly |
| `SWAP SIDES` | mirrored layout | left-handed: move right, fire left |
| `ONE-THUMB` | drag = walk + face the drag, tap = fire | one-handed play |
| `GYRO` | device tilt turns the camera | opt-in; iOS needs a real tap for permission |
| `LOOK LOW/MED/HIGH` | turn-rate sensitivity | cycles, persisted |

### Numbers in the code

```js
R     = Math.max(30, Math.min(64, 0.13 * Math.min(innerWidth, innerHeight))); // 64 px on 844x390
DEAD  = R * 0.25;                                   // a resting thumb is not a step
STEER = Math.max(22, R * 0.7) * SENS[sens];         // low 1.4, med 1.0, high 0.7
SPRINT_AT = 0.85;                                   // fraction of stick deflection
TAP_MS = 320;                                       // a tap that never dragged = trigger pull
FIRE_W = 66;                                        // fire pad, >= the 44 px minimum
```

Sticks live in the letterbox bars above the HUD
(`floor = min(innerHeight - safe, hudTop) - 12`), and the rarely-used MAP/PAUSE
switches sit in the top-left `#sysbar` so they are never in the combat thumb path.

### Three feel bugs the harness caught

1. **A tap during the cooldown was swallowed.** The old tap set `fire = 1` for
   120 ms; on a 0.9 s shotgun the whole window fell inside the cooldown and the
   shot vanished. Now the tap is held until the action is clear and released the
   instant the shot registers (`tapUntil` / `padDown`).
2. **One-thumb steering overshot.** Steering on `dragAngle - heading` never
   closes, because the anchor slides with the thumb, so the camera spun past the
   target. The drag now captures a *world direction* at touch-down and the
   per-frame `TouchUI.update()` turns toward it until the angle is closed
   (measured: heading 2.01 vs target 2.01).
3. **Move-half taps fired.** Only the look half (and the FIRE pad) is a trigger.

### Running the suite

```bash
npm run test:touch                                     # harness + headless Chrome
```

Or by hand:

```bash
node test/touch-harness.js                             # writes .debug-touch.html
agent-browser open "file://$PWD/.debug-touch.html?touch=1&auto=1"
agent-browser wait 25000
agent-browser get text '#touchprobe'                   # TOTAL 51/51 | PASS ...
```

Plain Chrome works too:

```bash
google-chrome --headless=new --dump-dom --window-size=1272,498 --virtual-time-budget=30000 \
  "file://$PWD/.debug-touch.html?touch=1&auto=1" | sed -n 's/.*touchprobe[^>]*>//p'
```

---

## 6. Research notes that shaped the design

- **Thumb arc, not screen.** Hoober's observational study (1,333 users): 49%
  one-handed, 36% cradled, 15% two-handed; ~75% of all touches are thumb touches.
  Controls go where the thumb already is, not where the UI wants to be.
- **Floating beats fixed.** A fixed corner stick misfires under a pocket grip;
  anchoring the base where the thumb first lands is the standard fix - and the
  base then drifts with the thumb, so a flick reverses direction instantly.
- **Target size.** WCAG 2.2 SC 2.5.8 (AA) requires 24x24 CSS px; WCAG 2.1 AAA,
  Apple HIG (44 pt) and Material (48 dp) all point at ~44 px. Every touch control
  in Grim Hall is >= 44 px, and the harness asserts it.
- **Minimal templates.** Microsoft's touch-adaptation work across 200+ streamed
  titles: 20% of Xbox Cloud players use touch exclusively, and titles with touch
  controls are played ~2x as often. Their guidance - left side moves, right side
  acts, no exotic gestures - is exactly the shipped map.
- **Tilt is good for movement, bad for aiming.** Teather, Roth & MacKenzie (2017),
  *Tilt-touch synergy: Input control for "dual-analog" style mobile games*
  (Entertainment Computing 21:33-43) compared touch/touch, tilt/touch,
  touch/tilt and tilt/tilt in a dual-analog shooter: tilt-based **movement** was
  comparable to touch, but tilt-based **orientation** significantly impaired
  navigation. So gyro aim ships as an opt-in assist and the thumb stick stays the
  primary look control.
- **Fairness compensation is normal; forced assist is not.** Auto-fire, aim
  assist and wider hit windows are near-universal in mobile shooters. All three
  are opt-in toggles here, because the literature is consistent that forced
  assistance is worse for some players than none.
- **API reality.** `env(safe-area-inset-*)` and `dvh` are Baseline;
  `DeviceOrientationEvent.requestPermission()` is not (iOS, needs transient
  activation and HTTPS); `navigator.vibrate()` is Chrome/Android only. Haptics
  and gyro are bonuses with a thumb fallback, never requirements.

## 7. Next things worth trying

1. **Portrait mode.** The view is a fixed 16:10 box, so a portrait phone wastes
   about half the screen. The first-run tip now says "ROTATE FOR A BIGGER VIEW";
   a stacked portrait HUD would be the next step.
2. **Small-device audit.** Run the harness at 360x640 and 320x480 and assert no
   control sits closer to the edge than the safe-area inset.
3. **Turn smoothing.** `turn` is step-wise from drag distance; a 2-3 frame ramp
   would feel less jerky on low-framerate devices.
4. **Onboarding telemetry.** Time-to-first-shot on a fresh install: if it is more
   than a couple of seconds, the legend tip is not doing its job.
5. **Real-device pass.** The harness proves the mechanics, not the feel. One-handed
   play, a silent novice, and an interruption test (notification shade, call,
   toolbar collapse).

