# Learned project conventions

Discovered from this codebase; dated so they can be pruned when stale.

- Assists must never read the input channel they write: the raw stick turn lives in
  `stickTurn`, set only by the look stick, FIRE-pad slide, one-thumb steering and the
  arrow keys through `setTurn()`; `Input.turn` is the blended output the assist writes.
  Reading `Input.turn` back makes the assist feed on its own output and the player spins.
  (2026-11-21)
- Touch harness: call `stageTarget()` in `test/touch-harness.js` before any assertion
  that depends on enemy or spawn position. The level is procedural, so position-dependent
  assertions are flaky run to run; stage the player in an open cell beside a living enemy.
  (2026-11-21)
- Assist tests must prove *settling*, not just turning: soak-sample `Input.turn` for ~2 s
  and assert the peak stays inside the assist's own clamp (0.4), plus that the heading ends
  aligned with a target in range. A single "it turned" check passes even when the assist
  is spinning. (2026-11-21)