// Boot smoke test for the browser side of the game. It catches the classic
// "game won't load" failure: a module reaching for a name that the namespace
// never defines (or being loaded before data.js declares it).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

test('index.html loads data.js before everything that attaches to it', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const order = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
  const data = order.indexOf('js/data.js');
  assert.ok(data >= 0, 'index.html never loads js/data.js');
  for (const mod of ['js/art.js', 'js/audio.js', 'js/game.js', 'js/main.js']) {
    assert.ok(order.indexOf(mod) > data, `${mod} must load after js/data.js`);
  }
});

test('art, audio and game all attach themselves to the GH namespace', () => {
  const GH = require('../js/data.js');
  require('../js/art.js');
  require('../js/audio.js');
  require('../js/game.js');
  assert.ok(GH.art && typeof GH.art.build === 'function', 'GH.art missing');
  assert.ok(GH.sound && GH.music, 'GH.sound / GH.music missing');
  assert.ok(GH.game && typeof GH.game.update === 'function', 'GH.game missing');
  assert.ok(typeof GH.game.grid === 'function', 'GH.game.grid missing (renderer needs it)');
});

test('every uniform the renderer writes on a figure is declared on its material', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js/main.js'), 'utf8');
  const mk = src.slice(src.indexOf('function mkBillboard'), src.indexOf('function lightDirAt'));
  const declared = new Set([...mk.matchAll(/(\w+): \{ value: /g)].map(m => m[1]));
  assert.ok(declared.size > 0, 'the figure material declares no uniforms');
  const sync = src.slice(src.indexOf('function syncEntities'), src.indexOf('// items'));
  const written = new Set([...sync.matchAll(/(?:\bu\.|spr\.material\.uniforms\.)(\w+)\.value/g)].map(m => m[1]));
  assert.ok(written.size > 0, 'syncEntities writes no figure uniforms');
  for (const name of written)
    assert.ok(declared.has(name), `the renderer writes uniform ${name}, which the figure material never declares`);
});

test('main.js boots with only THREE + GH in scope', () => {
  const GH = require('../js/data.js');
  require('../js/art.js');
  require('../js/audio.js');
  require('../js/game.js');
  const src = fs.readFileSync(path.join(ROOT, 'js/main.js'), 'utf8');
  const sandbox = {
    GH,
    THREE: {},
    window: { addEventListener: () => {} },
    performance: { now: () => 0 },
    location: { search: '' },
    setInterval: () => 0,
  };
  vm.runInNewContext(src, sandbox, { filename: 'js/main.js' });
  assert.ok(sandbox.window.Main && typeof sandbox.window.Main.init === 'function',
    'main.js failed to define the renderer module');
  assert.ok(sandbox.window.Input, 'main.js did not expose the input object');
  assert.ok(GH.input === sandbox.window.Input, 'game.js must read the same input object the renderer writes');
});
