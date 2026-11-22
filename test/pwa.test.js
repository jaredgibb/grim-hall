// The offline/install plumbing is mostly files, so the tests check the files:
// a manifest that parses and points at icons that exist, icons that are real
// PNGs, a service worker that at least compiles, and an index.html that
// registers it without breaking the file:// workflow.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const exists = f => fs.existsSync(path.join(ROOT, f));

test('the manifest parses and says what an installer needs', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.strictEqual(m.name, 'GRIM HALL');
  assert.strictEqual(m.short_name, 'GRIM HALL');
  assert.strictEqual(m.display, 'fullscreen');
  assert.strictEqual(m.orientation, 'landscape');
  assert.strictEqual(m.background_color, '#0a0505');
  assert.strictEqual(m.theme_color, '#0a0505');
  assert.ok(m.start_url, 'start_url missing');
  assert.ok(m.scope, 'scope missing');
  assert.ok(Array.isArray(m.icons) && m.icons.length === 2, 'the manifest needs both icons');
  for (const icon of m.icons) {
    assert.ok(icon.sizes, 'icon has no sizes');
    assert.ok(icon.purpose.includes('maskable'), 'icon is not maskable');
    assert.ok(exists(icon.src), 'manifest points at a missing file: ' + icon.src);
  }
});

test('the icons are real PNGs of the size the manifest promises', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  const signature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  for (const icon of m.icons) {
    const buf = fs.readFileSync(path.join(ROOT, icon.src));
    assert.deepStrictEqual([...buf.slice(0, 8)], signature, icon.src + ' is not a PNG');
    const type = buf.toString('ascii', 12, 16);
    assert.strictEqual(type, 'IHDR', icon.src + ' has no IHDR chunk');
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
    assert.strictEqual(icon.sizes, w + 'x' + h, icon.src + ' is ' + w + 'x' + h + ' but claims ' + icon.sizes);
    assert.strictEqual(buf[24], 8, icon.src + ' is not 8-bit');
    assert.strictEqual(buf[25], 6, icon.src + ' is not RGBA');
    // the IDAT stream must actually inflate, or the launcher shows a broken icon
    const idat = [];
    for (let i = 8; i < buf.length;) {
      const len = buf.readUInt32BE(i);
      const t = buf.toString('ascii', i + 4, i + 8);
      if (t === 'IDAT') idat.push(buf.slice(i + 8, i + 8 + len));
      i += 12 + len;
    }
    const raw = require('zlib').inflateSync(Buffer.concat(idat));
    assert.strictEqual(raw.length, w * (1 + w * 4), icon.src + ' scanlines are the wrong length');
  }
});

test('the service worker compiles and precaches files that exist', () => {
  execFileSync(process.execPath, ['--check', path.join(ROOT, 'sw.js')]);
  const sw = read('sw.js');
  assert.ok(/grim-hall-v\d+/.test(sw), 'the cache is not versioned');
  assert.ok(/skipWaiting/.test(sw) && /clients\.claim/.test(sw), 'install/activate handshake missing');
  const urls = [...sw.matchAll(/'\.\/([^']+)'|'\.\/'$/g)].map(m => m[1]).filter(Boolean);
  assert.ok(urls.length >= 10, 'the precache list is suspiciously short');
  for (const u of urls) assert.ok(exists(u), 'precache lists a missing file: ' + u);
});

test('index.html links the manifest and guards the service worker', () => {
  const html = read('index.html');
  assert.ok(/<link rel="manifest" href="manifest\.webmanifest">/.test(html), 'no manifest link');
  assert.ok(/<meta name="theme-color" content="#0a0505">/.test(html), 'no theme-color');
  assert.ok(/apple-touch-icon/.test(html), 'no apple touch icon');
  assert.ok(/location\.protocol !== 'file:'/.test(html), 'the service worker is registered on file:// too');
  assert.ok(/'serviceWorker' in navigator/.test(html), 'no serviceWorker support check');
});

test('the deploy ships the offline files and skips the workshop', () => {
  const ignore = read('.assetsignore');
  for (const ship of ['manifest.webmanifest', 'sw.js', 'icons/'])
    assert.ok(!ignore.split(/\n/).some(line => line.trim() === ship), ignore + ' must not ignore ' + ship);
  assert.ok(ignore.split(/\n/).some(line => line.trim() === 'tools/'), 'tools/ should not be deployed');
});
