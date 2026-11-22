require('./js/secrets.js');
const GH = require('./js/data.js');
const name = process.argv[2] || 'THE FURNACE';
const l = GH.levels.find(x => x.name === name);
const mark = new Map();
for (const v of l.vaults) for (const [x, y] of v.cells) mark.set(y * l.map[0].length + x, v.id);
for (let y = 0; y < l.map.length; y++) {
  let row = '';
  for (let x = 0; x < l.map[0].length; x++) {
    const k = y * l.map[0].length + x;
    row += mark.has(k) ? String(mark.get(k)) : l.map[y][x];
  }
  console.log(row);
}
for (const v of l.vaults) console.log('vault', v.id, 'panel', v.ex, v.ey, 'dir', v.dx, v.dy, v.w + 'x' + v.d);
