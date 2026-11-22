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
- Pushwall tests must clear the panel's travel lane before shoving: vault guards and props
  wander into the two squares a panel needs to slide (`freeForWall` in js/game.js), so filter
  `G.enemies` out of the lane and mark `G.items` taken along it (as the "deep chamber shove"
  and "hatch stays sealed" tests in test/game.test.js do) or the assertion fails on a jam
  rather than on the mechanic. The jam itself has its own test, so never rely on one to
  prove a panel can slide. (2026-11-22)
- Grim Hall deploys automatically: any push to `main` triggers `.github/workflows/deploy.yml`
  (`wrangler pages deploy . --project-name grim-hall`). To confirm a build is live, check
  `wrangler pages deployment list --project-name grim-hall` (the Source column must equal
  `git rev-parse HEAD`) or md5-compare the served `js/*.js` against the local files —
  `https://grim-hall.pages.dev`. (2026-11-22)