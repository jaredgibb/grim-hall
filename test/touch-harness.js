// Headless harness for the touch controls: drives the real pointer handlers with
// synthetic PointerEvents in Chrome and asserts what a thumb would do.
//
//   npm run test:touch
//   node test/touch-harness.js
//   google-chrome --headless=new --dump-dom --window-size=1272,498 --virtual-time-budget=30000 \
//     "file://$PWD/.debug-touch.html?touch=1&auto=1" | sed -n 's/.*touchprobe[^>]*>//p'
const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const probe = `<script>
window.addEventListener('load', () => {
  const out = [];
  const norm = (a) => { a %= 2 * Math.PI; if (a > Math.PI) a -= 2 * Math.PI; if (a < -Math.PI) a += 2 * Math.PI; return a; };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const ok = (name, cond, detail) => out.push((cond ? 'PASS' : 'FAIL') + ' ' + name + (detail ? ' [' + detail + ']' : ''));
  const d = document.createElement('pre');
  d.id = 'touchprobe'; d.style.cssText = 'position:absolute;left:-9999px;top:0';
  document.body.appendChild(d);
  const rect = el => { const r = el.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), Math.round(r.left), Math.round(r.top)]; };
  setTimeout(async () => {
    try {
      const cv = document.querySelector('#wrap canvas');
      const firePad = document.getElementById('firePad');
      const moveEl = document.getElementById('moveStick');
      const I = window.Input, G = GH.game.G;
      const readPrefs = () => { try { return JSON.parse(localStorage.getItem('gh.touch') || '{}'); } catch (e) { return {}; } };
      const pt = (el, type, id, x, y) => el.dispatchEvent(new PointerEvent(type, {
        pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true }));
      const drag = (id, x0, y0, x1, y1) => { pt(cv, 'pointerdown', id, x0, y0); pt(cv, 'pointermove', id, x1, y1); };
      Main.startGame();
      await wait(300);

      // ---- layout: everything a thumb needs is on screen and big enough ----
      ok('touchUI visible', !document.getElementById('touchUI').classList.contains('hidden'));
      ok('fire pad >= 44px target', rect(firePad)[0] >= 44 && rect(firePad)[1] >= 44, rect(firePad).join('x'));
      for (const b of document.querySelectorAll('#hud button, #sysbar button'))
        ok('HUD button ' + b.id + ' >= 44px', rect(b)[0] >= 44 && rect(b)[1] >= 44, rect(b).join('x'));
      const hudTop = document.getElementById('hud').getBoundingClientRect().top;
      ok('move stick sits above the HUD', moveEl.getBoundingClientRect().bottom <= hudTop + 1,
        'stick bottom ' + Math.round(moveEl.getBoundingClientRect().bottom) + ' hud top ' + Math.round(hudTop));
      ok('legend tip present', document.getElementById('tip').textContent.includes('THUMB'));

      // ---- the control surface: reachable, big enough, and never overlapping ----
      const lookEl = document.getElementById('lookStick');
      const sysbar = document.getElementById('sysbar');
      // rect() returns [w, h, left, top]; overlap is the area two boxes share
      const overlap = (a, b) => Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[2], b[2])) *
                               Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[3], b[3]));
      const inside = r => r[2] >= 0 && r[3] >= 0 && r[0] + r[2] <= innerWidth && r[1] + r[3] <= innerHeight;
      const fr = rect(firePad), mr = rect(moveEl), lr = rect(lookEl);
      ok('look stick has a visible resting home', getComputedStyle(lookEl).opacity !== '0',
        'opacity ' + getComputedStyle(lookEl).opacity);
      ok('move, look and FIRE do not overlap', overlap(mr, lr) === 0 && overlap(mr, fr) === 0 && overlap(lr, fr) === 0,
        'move ' + mr.join('x') + ' look ' + lr.join('x') + ' fire ' + fr.join('x'));
      ok('no control hangs off the screen', inside(fr) && inside(mr) && inside(lr),
        'viewport ' + innerWidth + 'x' + innerHeight);
      ok('the sticks are clear of the minimap', overlap(rect(document.getElementById('mini')), mr) === 0 &&
        overlap(rect(document.getElementById('mini')), lr) === 0, 'mini ' + rect(document.getElementById('mini')).join('x'));
      for (const b of sysbar.querySelectorAll('button'))
        ok(b.id + ' is out of the thumb traffic', overlap(rect(b), fr) === 0 && overlap(rect(b), mr) === 0 && overlap(rect(b), lr) === 0,
          b.id + ' ' + rect(b).join('x'));
      const lookHome = [parseFloat(lookEl.style.left), parseFloat(lookEl.style.top)];

      // ---- move stick: dead zone, analog, sprint, drift ----
      drag(1, 150, 300, 150, 292);            // 8 px: inside the dead zone
      ok('dead zone: a resting thumb is not a step', I.fwd === 0 && I.back === 0 && I.left === 0 && I.right === 0);
      pt(cv, 'pointermove', 1, 150, 250);     // 50 px up
      ok('drag up walks forward', I.fwd > 0.5 && I.back === 0, 'fwd=' + I.fwd.toFixed(2));
      pt(cv, 'pointermove', 1, 200, 300);     // 50 px right
      ok('drag right strafes', I.right > 0.5 && I.fwd < 0.02, 'right=' + I.right.toFixed(2));
      pt(cv, 'pointermove', 1, 150, 380);     // 80 px down, past the radius
      ok('full push sprints', I.sprint === 1 && I.back >= 0.99, 'back=' + I.back.toFixed(2) + ' sprint=' + I.sprint);
      pt(cv, 'pointermove', 1, 230, 380);     // keep pushing diagonally past the edge
      ok('thumb drift slides the base with the finger', parseFloat(moveEl.style.left) > 90,
        'stick left=' + moveEl.style.left);
      pt(cv, 'pointerup', 1, 150, 380);
      ok('release stops movement', I.fwd === 0 && I.back === 0 && I.left === 0 && I.right === 0 && I.sprint === 0);

      // ---- analog walk: deflection is the speed, not just walk-or-sprint ----
      const Rstick = rect(moveEl)[0] / 2;
      const MAP = GH.game.grid();
      let spot = null;
      for (let yy = 2; yy < MAP.length - 3 && !spot; yy++)
        for (let xx = 2; xx < MAP[yy].length - 3 && !spot; xx++) {
          if ('#T'.includes(MAP[yy][xx]) || '#T'.includes(MAP[yy][xx + 1]) || '#T'.includes(MAP[yy][xx + 2])) continue;
          if (G.enemies.some(e => !e.dead && Math.abs(e.x - xx) < 3 && Math.abs(e.y - yy) < 3)) continue;
          spot = [xx + 0.5, yy + 0.5];
        }
      // Hold the stick at a given deflection and measure the tiles it actually
      // covers, so the assertion tests the whole chain, not just the input layer.
      const walk = (px) => {
        if (!spot) return -1;
        const p = G.player; p.x = spot[0]; p.y = spot[1]; p.a = 0;
        pt(cv, 'pointerdown', 13, 150, 300);
        pt(cv, 'pointermove', 13, 150, 300 - px);
        for (let i = 0; i < 20; i++) GH.game.update(1 / 60);   // 1/3 s of sim
        pt(cv, 'pointerup', 13, 150, 300 - px);
        return Math.hypot(p.x - spot[0], p.y - spot[1]);
      };
      if (spot) {
        const home = [G.player.x, G.player.y, G.player.a];   // the spawn neighbourhood the later tests need
        const slow = walk(Rstick * 0.45), mid = walk(Rstick * 0.65), fast = walk(Rstick * 0.8);
        G.player.x = home[0]; G.player.y = home[1]; G.player.a = home[2];
        ok('a half-deflected thumb walks slower than a full one', slow > 0.1 && mid > slow + 0.1 && fast > mid + 0.1,
          '45% = ' + slow.toFixed(2) + ' tiles, 65% = ' + mid.toFixed(2) + ' tiles, 80% = ' + fast.toFixed(2) + ' tiles');
        ok('the walk is a gradient, not a walk/sprint cliff', fast / slow < 2.2 && fast / slow > 1.4,
          'ratio ' + (fast / slow).toFixed(2));
      } else {
        ok('no open ground to measure the walk gradient', false, 'no clear spot found');
      }

      // ---- dead-zone hysteresis: hovering at the edge must not stutter ----
      drag(14, 150, 300, 150, 300 - Rstick * 0.35);   // past the dead zone (0.25 R)
      ok('the stick engages past its dead zone', I.fwd > 0, 'fwd=' + I.fwd.toFixed(2));
      pt(cv, 'pointermove', 14, 150, 300 - Rstick * 0.2);  // back inside DEAD, above MOVE_IN
      ok('drifting back inside the dead zone does not stutter the walk', I.fwd > 0, 'fwd=' + I.fwd.toFixed(2));
      pt(cv, 'pointermove', 14, 150, 300 - Rstick * 0.1);  // below the re-entry threshold
      ok('the walk stops when the thumb really leaves the stick', I.fwd === 0 && I.back === 0, 'fwd=' + I.fwd.toFixed(2));
      pt(cv, 'pointerup', 14, 150, 300 - Rstick * 0.1);

      // ---- look stick: turn, saturate, flick back ----
      drag(2, 700, 300, 760, 300);
      ok('drag right turns right', I.turn > 0.9, 'turn=' + I.turn.toFixed(2));
      pt(cv, 'pointermove', 2, 900, 300);     // long sweep past the radius
      ok('a long sweep keeps turning', I.turn > 0.9, 'turn=' + I.turn.toFixed(2));
      pt(cv, 'pointermove', 2, 820, 300);     // flick back past the anchor
      ok('flicking back reverses instantly', I.turn < -0.4, 'turn=' + I.turn.toFixed(2));
      pt(cv, 'pointerup', 2, 820, 300);
      ok('release stops turning', I.turn === 0);
      drag(3, 700, 200, 726, 200);
      ok('a small look drag still turns', Math.abs(I.turn) > 0.4, 'turn=' + I.turn.toFixed(2));
      pt(cv, 'pointerup', 3, 726, 200);

      // ---- fire pad: hold, auto-fire, release ----
      const shots0 = G.stats.shots;
      drag(4, 150, 300, 150, 250);                      // left thumb keeps walking
      pt(firePad, 'pointerdown', 5, 800, 320);
      await wait(700);
      ok('move + fire at the same time', I.fwd > 0.5 && I.fire === 1, 'fwd=' + I.fwd.toFixed(2) + ' fire=' + I.fire);
      ok('auto-fire re-edges the semi-auto pistol', G.stats.shots - shots0 >= 2,
        'pistol rate 0.28s -> ' + (G.stats.shots - shots0) + ' shots in 0.7s');
      pt(firePad, 'pointerup', 5, 800, 320);
      pt(cv, 'pointerup', 4, 150, 250);
      ok('fire pad releases', !I.fire, 'fire=' + I.fire);

      // ---- a tap in the look half is a trigger pull, and only one ----
      const shots1 = G.stats.shots;
      pt(cv, 'pointerdown', 6, 900, 250);
      await wait(60);
      pt(cv, 'pointerup', 6, 900, 250);
      await wait(1200);
      ok('look-half tap fires exactly once', G.stats.shots === shots1 + 1,
        'delta=' + (G.stats.shots - shots1) + ' fireCd=' + G.player.fireCd.toFixed(2));
      // the tap lands while the shotgun is still cooling: the shot is queued,
      // not thrown away, and it is still only one shot
      const shots2 = G.stats.shots;
      pt(cv, 'pointerdown', 17, 900, 250);
      pt(cv, 'pointerup', 17, 900, 250);
      await wait(1400);
      ok('a tap during the cooldown still fires once', G.stats.shots === shots2 + 1,
        'delta=' + (G.stats.shots - shots2));

      // ---- repositioning the move thumb must never be a trigger pull ----
      const shotsM = G.stats.shots;
      pt(cv, 'pointerdown', 16, 200, 300);
      pt(cv, 'pointerup', 16, 200, 300);
      await wait(400);
      ok('a tap on the move half does not fire', G.stats.shots === shotsM, 'delta=' + (G.stats.shots - shotsM));

      // ---- pointercancel: a finger that vanishes must not leave you walking ----
      drag(7, 150, 300, 150, 240);
      ok('held stick walks', I.fwd > 0.5);
      pt(cv, 'pointercancel', 7, 150, 240);
      ok('pointercancel stops movement', I.fwd === 0);

      // ---- HUD buttons ----
      const w0 = G.player.w;
      G.player.owns.sg = true;
      pt(document.getElementById('gunCell'), 'pointerdown', 8, 0, 0);
      await wait(400);
      ok('GUN cell swaps weapon', G.player.w !== w0, 'w=' + G.player.w + ' was ' + w0);
      // ---- the GUN cell has a cool-down: a brushed thumb is one swap, not two ----
      const gun = document.getElementById('gunCell');
      G.player.w = 0; G.player.owns.sg = true; G.player.owns.mg = false;
      pt(gun, 'pointerdown', 9, 0, 0);
      pt(gun, 'pointerdown', 10, 0, 0);
      await wait(300);
      ok('two quick taps on GUN swap once, not twice', G.player.w === 1, 'w=' + G.player.w);
      await wait(300);
      pt(gun, 'pointerdown', 11, 0, 0);
      await wait(300);
      ok('a tap after the cool-down swaps again', G.player.w === 0, 'w=' + G.player.w);
      pt(document.getElementById('pauseBtn'), 'pointerdown', 9, 0, 0);
      ok('PAUSE button pauses', G.state === 'pause', 'state=' + G.state);
      document.getElementById('ov').dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
      ok('overlay tap resumes', G.state === 'play', 'state=' + G.state);

      // ---- the option panel ----
      const toggle = id => {
        const b = document.querySelector('#ovBox button[data-opt=' + id + ']');
        if (!b) return false;
        b.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 10, pointerType: 'touch', bubbles: true, cancelable: true }));
        return true;
      };
      ok('option panel renders on touch', !!document.querySelector('#ovBox button[data-opt=mode]'));
      toggle('autofire');
      ok('AUTO-FIRE toggles off', !I.autoFire, 'autoFire=' + I.autoFire);
      toggle('autofire');
      ok('AUTO-FIRE toggles back on', I.autoFire === true, 'autoFire=' + I.autoFire);
      toggle('haptics');
      ok('HAPTICS off is persisted', readPrefs().haptics === false, 'haptics=' + readPrefs().haptics);
      toggle('haptics');
      ok('option buttons do not also resume the game', G.state === 'play', 'state=' + G.state);

      // ---- aim assist ----
      const nearestVisible = () => {
        let best = null, bd = 90;
        for (const e of G.enemies) {
          if (e.dead) continue;
          const d2 = (e.x - G.player.x) ** 2 + (e.y - G.player.y) ** 2;
          if (d2 < bd && GH.game.hasLOS(G.player.x, G.player.y, e.x, e.y)) { bd = d2; best = e; }
        }
        return best;
      };
      let target = nearestVisible();
      if (target) {
        toggle('aim');
        const ang = Math.atan2(target.y - G.player.y, target.x - G.player.x);
        G.player.a = ang + 0.6;                       // start ~34 deg off target
        await wait(700);
        // measure against the target as it is now: enemies chase, so the bearing
        // captured before the wait is already stale by the time the assist closes in
        const live = nearestVisible();
        let diff = live ? Math.abs(norm(Math.atan2(live.y - G.player.y, live.x - G.player.x) - G.player.a))
                        : Math.abs(norm(G.player.a - ang));
        ok('aim assist turns toward a visible enemy', diff < 0.4, 'off by ' + diff.toFixed(2) + ' rad');
        toggle('aim');
        ok('aim assist is opt-in and off again', I.aim === false, 'aim=' + I.aim);
      } else {
        ok('aim assist had no visible enemy to test against', false, 'none found');
      }

      // ---- look sensitivity: the same drag, two turn rates ----
      toggle('sens');                          // MED -> HIGH
      drag(18, 700, 300, 720, 300);
      const turnHigh = I.turn;
      pt(cv, 'pointerup', 18, 720, 300);
      toggle('sens');                          // HIGH -> LOW
      drag(19, 700, 300, 720, 300);
      const turnLow = I.turn;
      pt(cv, 'pointerup', 19, 720, 300);
      toggle('sens');                          // back to MED
      ok('look sensitivity changes the turn rate', turnHigh > turnLow + 0.2,
        'high=' + turnHigh.toFixed(2) + ' low=' + turnLow.toFixed(2));
      ok('sensitivity cycles back to the default', readPrefs().sens === 'med', 'sens=' + readPrefs().sens);

      // ---- the look stick's response curve ----
      drag(21, 700, 300, 712, 300);
      const curvedTurn = I.turn;
      pt(cv, 'pointerup', 21, 712, 300);
      ok('a light drag on the curved stick turns less than a linear stick would',
        curvedTurn > 0.05 && curvedTurn < 0.2, 'turn=' + curvedTurn.toFixed(3));
      toggle('curve');
      drag(22, 700, 300, 712, 300);
      const linearTurn = I.turn;
      pt(cv, 'pointerup', 22, 712, 300);
      ok('LINEAR LOOK is the fallback for players who want raw stick input',
        linearTurn > curvedTurn + 0.05, 'linear=' + linearTurn.toFixed(3) + ' curved=' + curvedTurn.toFixed(3));
      ok('the curve pref is persisted', readPrefs().curve === 1, 'curve=' + readPrefs().curve);
      toggle('curve');

      // ---- aim assist blends with the stick instead of switching off ----
      if (nearestVisible()) {
        const runAssist = async (aimOn) => {
          if (aimOn) toggle('aim');
          const tgt = nearestVisible();
          if (!tgt) return [0, false];
          const ang = Math.atan2(tgt.y - G.player.y, tgt.x - G.player.x);
          const a0 = ang + 0.6;                 // the target sits 0.6 rad off the heading
          G.player.a = a0;
          drag(24, 700, 300, 710, 300);         // a light stick drag AWAY from the target
          await wait(600);
          const marked = document.getElementById('lookStick').classList.contains('assist');
          pt(cv, 'pointerup', 24, 710, 300);
          const delta = norm(G.player.a - a0);
          if (aimOn) toggle('aim');
          return [delta, marked];
        };
        const stickOnly = await runAssist(false);
        const blended = await runAssist(true);
        ok('aim assist still engages while the look stick is held',
          blended[0] < stickOnly[0] - 0.2,
          'stick alone turned ' + stickOnly[0].toFixed(2) + ' rad away from the target, blended turned ' + blended[0].toFixed(2));
        ok('the assist marks itself while it is pulling', blended[1], 'look stick had no assist ring');
      }

      // ---- one-thumb mode ----
      toggle('mode');
      const a0 = G.player.a;
      I.fwd = 0; I.back = 0; I.left = 0; I.right = 0;
      drag(11, 300, 300, 300, 240);                   // drag up: walk forward
      ok('one-thumb mode enabled', readPrefs().one === true, 'one=' + readPrefs().one);
      ok('one-thumb drags forward', I.fwd > 0.5, 'fwd=' + I.fwd);
      pt(cv, 'pointerup', 11, 300, 240);
      drag(12, 300, 300, 360, 240);                   // up-and-right: face the finger, then walk
      await wait(1400);
      const want = norm(a0 + Math.atan2(360 - 300, -(240 - 300)));
      ok('one-thumb steers toward the drag', Math.abs(norm(G.player.a - want)) < 0.45,
        'a=' + G.player.a.toFixed(2) + ' want=' + want.toFixed(2));
      pt(cv, 'pointerup', 12, 360, 240);
      await wait(400);
      const fire2 = G.stats.shots;
      drag(13, 700, 250, 700, 250);                   // tap with no drag = fire
      pt(cv, 'pointerup', 13, 700, 250);
      await wait(600);
      ok('one-thumb tap-to-fire works', G.stats.shots > fire2, 'shots=' + (G.stats.shots - fire2));
      toggle('mode');
      ok('one-thumb mode disabled', readPrefs().one !== true, 'one=' + readPrefs().one);

      // ---- mirrored layout for left-handed players ----
      toggle('mirror');
      ok('fire pad moves to the left half', rect(firePad)[2] < innerWidth / 2, 'fire left=' + rect(firePad)[2]);
      I.turn = 0; I.fwd = 0;
      drag(14, 200, 300, 260, 300);                   // left half is the look stick now
      ok('left half turns when mirrored', I.turn > 0.4, 'turn=' + I.turn.toFixed(2));
      pt(cv, 'pointerup', 14, 260, 300);
      drag(15, 900, 300, 900, 240);                   // right half walks
      ok('right half moves when mirrored', I.fwd > 0.5, 'fwd=' + I.fwd);
      pt(cv, 'pointerup', 15, 900, 240);
      toggle('mirror');
      ok('mirror is opt-out', readPrefs().mirror !== true, 'mirror=' + readPrefs().mirror);

      // ---- gyro ----
      toggle('gyro');
      ok('gyro opt registers', readPrefs().gyro === true, 'gyro=' + readPrefs().gyro);
      const ga0 = G.player.a;
      for (let i = 0; i < 3; i++) {
        const ev = new Event('deviceorientation');
        ev.alpha = 4 * i;                             // a slow rightward twist of the phone
        window.dispatchEvent(ev);
        await wait(60);
      }
      let gd = Math.abs(G.player.a - ga0);
      while (gd > Math.PI) gd = Math.abs(gd - 2 * Math.PI);
      ok('gyro turns the camera', gd > 0.02, 'delta=' + gd.toFixed(3) + ' rad');
      toggle('gyro');
      ok('gyro opt-out works', readPrefs().gyro !== true, 'gyro=' + readPrefs().gyro);

      // ---- backgrounding the tab ----
      Object.defineProperty(document, 'hidden', { value: true, writable: false, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      await wait(200);
      ok('hidden tab auto-pauses', G.state === 'pause', 'state=' + G.state);
      Object.defineProperty(document, 'hidden', { value: false, writable: false, configurable: true });

      const fails = out.filter(s => s.startsWith('FAIL')).length;
      d.textContent = 'TOTAL ' + (out.length - fails) + '/' + out.length + ' | ' + out.join(' | ');
    } catch (e) {
      d.textContent = 'ERROR: ' + (e && e.message ? e.message : e) + ' | ' + out.join(' | ');
    }
  });
});
</script>`;
fs.writeFileSync('.debug-touch.html', html.replace('</body>', probe + '</body>'));
console.log('wrote .debug-touch.html');
