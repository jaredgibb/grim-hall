// Unit tests for the progress module: it takes its storage object, so it runs
// in plain node with no browser.
const test = require('node:test');
const assert = require('node:assert');
const Progress = require('../js/progress.js');
const LEVELS = require('../js/data.js').levels;

// three normal floors, no secret - enough to walk the unlock ladder
const SHORT = [{ name: 'one' }, { name: 'two' }, { name: 'three' }];
const SECRET_LAST = [{ name: 'one' }, { name: 'two' }, { name: 'secret', secret: true }];

const mem = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) };
};
const win = (score, time, accuracy = 0, secrets = 0, rank = 'SURVIVOR') => ({ score, time, accuracy, secrets, rank });

test('a fresh player has only the first floor', () => {
  assert.deepStrictEqual(Progress.load(mem(), SHORT), { unlocked: 0, best: {} });
  assert.deepStrictEqual(Progress.load(mem({ 'gh.progress': '' }), SHORT), { unlocked: 0, best: {} });
});

test('a corrupt or hand-edited save falls back to a clean one', () => {
  const junk = mem({ 'gh.progress': 'definitely not json' });
  assert.deepStrictEqual(Progress.load(junk, SHORT), { unlocked: 0, best: {} });

  const odd = mem({ 'gh.progress': JSON.stringify({ unlocked: 'nine', best: { 1: null, x: { score: 5 }, 99: { score: 1 } } }) });
  const p = Progress.load(odd, SHORT);
  assert.strictEqual(p.unlocked, 0);
  assert.deepStrictEqual(p.best, {});
});

test('private-mode storage never takes the title screen down', () => {
  const blocked = { getItem: () => { throw new Error('localStorage is blocked'); },
                    setItem: () => { throw new Error('localStorage is blocked'); } };
  assert.deepStrictEqual(Progress.load(blocked, SHORT), { unlocked: 0, best: {} });
  Progress.save(blocked, { unlocked: 1, best: {} });   // must not throw
});

test('clearing a floor unlocks the next one', () => {
  let p = Progress.load(mem(), SHORT);
  p = Progress.recordWin(p, 0, win(500, 60), SHORT);
  assert.strictEqual(p.unlocked, 1);
  p = Progress.recordWin(p, 1, win(700, 55), SHORT);
  assert.strictEqual(p.unlocked, 2);
  assert.deepStrictEqual(p.best[1], { score: 700, time: 55, accuracy: 0, secrets: 0, rank: 'SURVIVOR' });
});

test('clearing the last normal floor does not wrap the ladder to zero', () => {
  const lastNormal = Progress.highestNormal(LEVELS);
  assert.strictEqual(lastNormal, LEVELS.length - 2, 'the real ladder ends one floor before the secret');
  let p = { unlocked: lastNormal - 1, best: {} };
  p = Progress.recordWin(p, lastNormal, win(1000, 100, 40, 1, 'HALLMASTER'), LEVELS);
  assert.strictEqual(p.unlocked, lastNormal, 'a wrap must read as the top of the ladder, not the bottom');
  assert.ok(p.best[lastNormal], 'the win is still recorded');
});

test('the secret floor records a score but unlocks nothing', () => {
  let p = { unlocked: 1, best: {} };
  p = Progress.recordWin(p, 2, win(2000, 80, 60, 4, 'HALLMASTER'), SECRET_LAST);
  assert.strictEqual(p.unlocked, 1);
  assert.strictEqual(p.best[2].score, 2000);
});

test('the better run wins, and a tie goes to the faster one', () => {
  let p = { unlocked: 0, best: {} };
  p = Progress.recordWin(p, 0, win(800, 120, 30, 0, 'SURVIVOR'), SHORT);
  p = Progress.recordWin(p, 0, win(500, 40, 20, 0, 'SURVIVOR'), SHORT);
  assert.strictEqual(p.best[0].score, 800, 'a lower score never overwrites a higher one');
  p = Progress.recordWin(p, 0, win(800, 90, 30, 0, 'SLAYER'), SHORT);
  assert.strictEqual(p.best[0].time, 90, 'equal scores, faster time wins');
  p = Progress.recordWin(p, 0, win(800, 120, 30, 0, 'SLAYER'), SHORT);
  assert.strictEqual(p.best[0].time, 90, 'a slower repeat changes nothing');
});

test('recording the same win twice is a no-op', () => {
  let p = { unlocked: 0, best: {} };
  p = Progress.recordWin(p, 0, win(900, 75, 45, 2, 'SLAYER'), SHORT);
  const before = JSON.parse(JSON.stringify(p));
  const again = Progress.recordWin(p, 0, win(900, 75, 45, 2, 'SLAYER'), SHORT);
  assert.deepStrictEqual(again, before);
});

test('save and load roundtrip', () => {
  const store = mem();
  let p = Progress.load(store, SHORT);
  p = Progress.recordWin(p, 1, win(1200, 90, 55, 1, 'HALLMASTER'), SHORT);
  Progress.save(store, p);
  assert.deepStrictEqual(Progress.load(store, SHORT), p);
});

test('the rotation skips the secret floor', () => {
  assert.strictEqual(Progress.nextNormal(SECRET_LAST, 1), 0, 'after the last normal floor the ladder wraps');
  assert.strictEqual(Progress.nextNormal(LEVELS, 16), 0, 'GRIM HALL -> floor 1, never the gilded one');
  assert.strictEqual(Progress.nextNormal(LEVELS, 17), 0, 'riding out of the secret floor returns to floor 1');
});
