# Mobile control ergonomics — research round 2

Date: 2026-11-21. Follows `docs/mobile-controls.md`, which documents the shipped
two-thumb scheme. Baseline at the time of writing: **58/58 assertions pass**
(`npm run test:touch`).

This round asked a narrower question: *given the controls already work, what does
the research say about making them better?* Every finding below is cross-checked
against the actual code, with line numbers, so the claims can be verified.

---

## 1. Sources

| Source | What it establishes |
|---|---|
| Hoober / Clark, via Smashing Magazine, "The Thumb Zone" (2016) | 49% of people hold a phone one-handed; ~75% of all touches are thumb touches; comfortable tap targets ~44 px, swipe areas at least 45 px; the thumb's arc, not the screen, is the design canvas. |
| Teather, Roth & MacKenzie, *Tilt-Touch Synergy: Input control for "dual-analog" style mobile games*, Entertainment Computing 21:33-43 (2017) | Controlled experiment of four dual-analog schemes. "Tilt-based orientation hinders navigation"; "tilt-based movement works well"; touch/touch scored best overall, tilt-movement + touch-aiming a close second. |
| Mark Venturelli, "Everything I Learned About Dual-Stick Shooter Controls", Game Developer (2015) | Years of iterating on dual-stick controls: dead zones exist because analog sticks never read exactly zero, and the right stick is where a shooter's feel is won or lost. |
| Valve, *Steam Input Gamepad Emulation — Best Practices* | When converting a touch surface into a virtual stick, it only works well with high sensitivity, a minimal dead zone and a deliberate response curve — otherwise use a different mapping. |
| Game Accessibility Guidelines (gameaccessibilityguidelines.com) | Motor section: adjust control sensitivity, make touch targets large and well spaced, provide simpler alternatives, remap controls (basic); avoid requiring held buttons, avoid requiring simultaneous actions, keep accuracy-critical targets stationary, ensure analogue/gesture input is *supplementary* not required (intermediate); 0.5 s input cool-down, allow portrait and landscape (advanced). |
| Lee, Oh, Shi & Doh, *Mobile Game Design Guide to Improve Gaming Experience for the Middle-Aged and Older Adult Population*, JMIR Serious Games 9(2):e24449 (2021) | 45 design guidelines from a 40-participant user study. The weakest satisfaction scores for action games were "agility" and "button interaction" — the latter explicitly because participants "were difficult to control buttons simultaneously using both hands". |
| WCAG 2.2 SC 2.5.8 | 24x24 CSS px is the *minimum* target size; Apple HIG (44 pt) and Material (48 dp) are the practical game numbers. |

Not used: a 2024 MDPI evaluation of FPS control schemes (403-blocked, so nothing
from it is cited here).

---

## 2. What the shipped scheme already gets right

Validated against the code and the harness — this is why round 2 is about tuning,
not rebuilding:

- **Pointer Events with one `pointerId` per finger** gives real multi-touch arity
  (move + look + fire at once, asserted in the harness).
- **`pointercancel` releases everything** — the finger-under-a-notification-shade
  case is handled.
- **Floating stick anchored where the thumb lands**, with the base sliding past the
  radius so reversing is a flick. This is the standard answer to pocket-grip
  misfires.
- **Every control is >= 44 px** and the harness asserts it, plus non-overlap and
  on-screen containment.
- **Rare switches are out of the thumb path** (`#sysbar` in the top corner, the
  least reachable arc).
- **Assists are opt-in and persisted** (auto-fire, aim assist, gyro, haptics,
  sensitivity, mirror, one-thumb).
- **Two-thumb *and* one-thumb modes** cover the 49% who play with one hand.

---

## 3. Findings, in priority order

### Finding 1 — the move stick is analog in the input layer, binary in the game layer

This is the highest-value fix, and it is a bug rather than a design opinion.

`js/main.js:1568` computes the analog magnitude:

```js
const k = Math.min(1, d / R);             // analog, not binary
Input.fwd = Math.max(0, -uy) * k;         // ...
```

`js/game.js:353-358` then throws it away:

```js
const len = Math.hypot(mx, my);
if (len > 0) {
  mx /= len; my /= len;                   // <- magnitude normalised to 1
  const spd = TUNE.playerSpeed * (inp.sprint ? 1.55 : 1);
```

A thumb at 30% deflection walks at exactly the same speed as one at 100%. The
only speed granularity the stick delivers is the sprint cliff at 85%
(`main.js:1581`). The harness never caught this because it asserts `fwd > 0.5`,
not the resulting speed.

**Why it matters:** dual-analog schemes — the genre this game is in — use stick
magnitude as the speed gradient. It is also the main accessibility lever: players
with limited dexterity need a slow walk, not walk-or-sprint.

**Fix (two lines; desktop is untouched because keyboard input always yields
len >= 1):**

```js
const spd = TUNE.playerSpeed * Math.min(1, len) * (inp.sprint ? 1.55 : 1);
```

**New assertion:** 50% deflection produces a slower player speed than 100%
deflection.

---

### Finding 2 — dead zones need hysteresis, not a single threshold

Gamepad dead zones exist because an analog stick never reads exactly zero; a
touch dead zone has the same problem in a worse form, because a thumb resting on
glass drifts a few pixels. With one threshold, a thumb hovering at exactly `DEAD`
chatters between "walking" and "not walking", and every crossing re-triggers the
footstep sound.

Currently (`main.js:1552`, `1592`):

```js
if (d <= DEAD) { zeroMove(); ... }        // one threshold, no hysteresis
Input.turn = Math.abs(dx) <= LOOKDEAD ? 0 : ...;
```

**Fix:** exit the dead zone at the full threshold, re-enter only below a smaller
one (standard practice is ~60% of the exit value):

```js
const MOVE_OUT = R * 0.25, MOVE_IN = MOVE_OUT * 0.6;
const LOOK_OUT = Math.max(3, R * 0.08), LOOK_IN = LOOK_OUT * 0.5;
```

Keep a "was active" flag per stick so state only flips when the threshold
matching the *current* state is crossed.


---

### Finding 3 — aiming wants a response curve, not a linear ramp

`main.js:1592` maps drag pixels to turn rate linearly, saturating at `STEER`
(~35 px on a phone). Linear is the wrong shape for a thumb: the precision range
that matters for a hit-chance system (`hitChanceBase 0.85`, dropping 0.04 per
tile) lives in the first third of the deflection, while past that the player just
wants a fast turn. Valve's guidance for touch-as-stick emulation is explicitly
about the curve — high sensitivity, minimal dead zone, deliberate acceleration
curve — and Venturelli's dual-stick write-up reaches the same place from practice.

```js
const mag = Math.min(1, Math.abs(dx) / STEER);
Input.turn = Math.sign(dx) * Math.pow(mag, 1.6);   // fine near centre, fast at the edge
```

Make the exponent a pref (`prefs.curve`) with 1.0 as the linear fallback, per the
rule already in the project: an assist that cannot be turned off is an assist
some players cannot use.

**Use the wasted axis.** `main.js:1593` draws the knob moving vertically, but
vertical deflection does nothing. An affordance that promises a function and
delivers none is a known source of touch confusion. Either constrain the knob to
horizontal, or make it mean something. For this engine (no pitch), the cheapest
meaningful mapping is **vertical push on the look pad = fine-aim mode**, scaling
`STEER` so the same horizontal drag turns less.

---

### Finding 4 — one thumb is being asked to cover three controls

At a 1280-wide viewport the harness reports move stick `132x132x12x366`, look
stick `132x132x1060x366`, FIRE pad `70x70x1202x428`. Scaled to an 844-wide phone
the look stick and the FIRE pad are adjacent in the bottom-right corner — exactly
where the right thumb parks. The FIRE-as-aim work already recognises this: one
thumb cannot be on two controls at once.

Two independent lines of evidence say the same thing:

- Microsoft's touch template guidance is "start minimal": left side moves, right
  side acts.
- The JMIR older-adult study found "button interaction" was the weakest element in
  action games specifically because participants struggled to operate buttons with
  both hands simultaneously.

**Fix — a layout option, not a new default:**

| layout | left thumb | right thumb |
|---|---|---|
| `FULL` (current) | move | look + FIRE |
| `AIM` | move | FIRE pad doubles as the aim stick (already implemented) |
| `SIMPLE` | move | one 90 px pad: hold = fire, slide = turn. No separate look stick |

`SIMPLE` is `FULL` with the look stick removed and the FIRE pad enlarged. It is
the layout to recommend for small phones and one-handed play, and it makes the
fire-as-aim feature *discoverable* rather than incidental — right now sliding the
FIRE pad turns the camera, but nothing on screen tells the player that is
possible. The pad's `aria-label` already says "hold to shoot, slide to turn"; the
visible `<small>hold</small>` should say `hold / slide`.

---

### Finding 5 — aim assist is invisible, and any stick input cancels it

`main.js:1133`:

```js
if (!TOUCH || !Input.aim || G.state !== 'play' || Input.turn) return;
```

`Input.turn` is non-zero whenever the look stick is even 4 px off centre. So a
player who is walking and turning — which is most of the time — gets no assist at
all, with no indication that the feature is on or why it is not acting. Hidden
assistance reads as the game fighting the player, which is the most common
complaint about aim assist.

**Fix:**

1. Engage when `Math.abs(Input.turn) < 0.15` rather than `=== 0`.
2. Blend instead of overwrite, so stick input wins and the assist fills the gaps:
   `Input.turn = Input.turn || assistTurn;`
3. Show a marker when the assist is actively pulling the camera (a dim bracket on
   the minimap, or reuse `#hit`). A player who can see the assist can trust it —
   or turn it off.

---

### Finding 6 — the accessibility gaps the guidelines name explicitly

Against the Game Accessibility Guidelines motor list, Grim Hall is strong on
sensitivity, target size, haptics toggling and simpler alternatives, and weak on
four named items:

| Guideline (level) | Status | Change |
|---|---|---|
| "Ensure that all key actions can be carried out by digital controls... analogue, speech, gesture not required" (intermediate) | **Not met** | Turning currently requires an analog drag. Add a discrete alternative: tap the look pad = 45 deg snap turn, or `TURN L` / `TURN R` buttons in the thumb zone. |
| "Include an option to adjust the game speed" (basic) | **Not met** | A `SLOW` toggle scaling simulation `dt` (0.7x) is a one-line change and the strongest difficulty/accessibility lever in a real-time game. |
| "Include a cool-down period (post acceptance delay) of 0.5 seconds between inputs" (advanced) | **Partly met** | The GUN cell has no debounce; two accidental taps cycle weapons twice. Add a 400 ms debounce. |
| "Allow play in both landscape and portrait" (advanced) | **Not met** | The canvas is a fixed 16:10 box; on a 500x800 phone it is 39% of the screen. A stacked portrait HUD with controls in the lower third is the next step. |

Also relevant: "Ensure interactive elements that require accuracy are stationary".
The FIRE pad is stationary; the sticks float by design, which is correct for
movement but means the *aim* pad should stay fixed — it does.

---

### Finding 7 — tilt is a good movement input and a poor aiming input

The shipped gyro is aim-only. The literature supports the opposite pairing:
Teather et al. found tilt-based movement comparable to touch, while tilt-based
orientation "significantly altered, and in certain cases impaired, participant
navigation" — their design guidance is literally titled "Tilt-based orientation
hinders navigation". Their aim-acceptance caveat applies to games without a
navigation component; Grim Hall has one.

**Fix:** keep `GYRO AIM` opt-in, and add `TILT MOVE` (tilt to walk, thumb to aim)
as an accessibility option — that is the pairing the evidence supports. The iOS
permission reality is already documented: the toggle button is the transient
activation that grants the sensor.

---

### Finding 8 — touch has no hover, so every state change needs a confirmation

The surface is good here (FIRE pad reddens, sprint reddens the stick), but the
missing confirmations are the states that change *inside* the game:

- **Sprint engaging** has no cue beyond the stick colour, which the thumb is
  covering. Thumb occlusion means the confirmation has to be outside the finger's
  footprint: an edge glow on the ring, or the footstep sound changing.
- **Aim assist** engages with no signal at all (Finding 5).
- **Weapon swap** plays a click, but a double-tap on the GUN cell swaps twice with
  no confirmation of which gun is live beyond HUD text.

The underlying principle from Clark's touch work: on a phone the finger *is* the
cursor, and it hides the thing it is touching.

---

## 4. Roadmap

### Tier 1 — tune what exists (small, testable, no new UI)

| # | Change | Evidence | Effort |
|---|---|---|---|
| 1 | Make walking analog: `Math.min(1, len)` speed factor | Finding 1 | 2 lines |
| 2 | Dead-zone hysteresis on both sticks | Finding 2 | ~10 lines |
| 3 | Power curve on the look stick, exponent as a pref | Findings 2, 3 | ~5 lines |
| 4 | Aim assist engages at `|turn| < 0.15`, blends with the stick, and shows a marker | Finding 5 | ~15 lines |
| 5 | 400 ms debounce on the GUN cell | Finding 6 | 3 lines |
| 6 | Make the FIRE pad's dual role visible (`hold / slide`) | Finding 4 | 1 line + CSS |

### Tier 2 — new control options

- `SIMPLE` layout: one aim+trigger pad, no separate look stick (Finding 4).
- Discrete turning: look-pad tap = 45 deg snap, or `TURN L/R` buttons (Finding 6).
- `SLOW` game-speed toggle (Finding 6). Note: scaling `dt` also scales cooldowns,
  so it changes combat balance, not just reaction demand — worth its own pref
  rather than being folded into difficulty.
- Portrait layout: canvas top, HUD and controls stacked in the lower third.
- `TILT MOVE` accessibility mode (Finding 7).
- Meaningful use of the look stick's vertical axis, or remove the implied affordance.

### Tier 3 — measure, then decide

- **Turn smoothing:** a 2-3 frame ramp on `turn`. Only worth doing once the curve
  and hysteresis are in, and it must be measured against perceived latency —
  smoothing trades responsiveness for stability, and on a touch device latency is
  already the limiting factor.
- **Haptics beyond damage:** a short buzz on trigger pull and on sprint engage.
  `navigator.vibrate` is Chrome/Android only, so it stays a bonus.
- **Auto quality downscale** on coarse-pointer devices, as the first doc proposed:
  the stutter on phones is rendering, not input, and input feel is impossible to
  evaluate through a 12 fps frame rate.

---

## 5. How to know if it worked

The game already records `shots` and `hits` (`statLine()`), so accuracy by control
mode is a free measurement. Add a small `TouchUI.stats` object and log:

- **time to first shot** after the overlay closes — the discoverability number. If
  it is more than a couple of seconds, the legend tip is failing.
- **mis-taps**: fire events with no enemy inside LOS at the moment of the pull.
- **turn reversals per second** — high values mean the dead zone is chattering.
- **accuracy by layout** (`FULL` vs `SIMPLE` vs one-thumb) and by assist
  (auto-fire on/off, aim assist on/off). The older-adult study's finding that
  two-handed button control was the failure point is a hypothesis this data can
  test directly.

Harness assertions worth adding alongside Tier 1:

```
partial deflection walks slower than full deflection
a thumb parked at the dead-zone edge does not alternate step/no-step
the look curve turns less at 25% deflection than a linear mapping would
aim assist still engages while the move stick is held
a double tap on GUN swaps once, not twice
SIMPLE layout: sliding FIRE turns, holding FIRE fires, no look stick exists
```



