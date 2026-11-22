require('./js/secrets.js');
const GH = require('./js/data.js');
const L = GH.levels[Number(process.argv[2] || 0)];
console.log('rows', L.map.length, 'cols', L.map[0].length);
for (const v of L.vaults) {
  const xs = v.cells.map(c => c[0]), ys = v.cells.map(c => c[1]);
  console.log('vault ' + v.id, v.kind, v.w + 'x' + v.d, 'panel', v.ex, v.ey, 'dir', v.dx, v.dy,
    'box x', Math.min(...xs), Math.max(...xs), 'y', Math.min(...ys), Math.max(...ys),
    'panels', JSON.stringify(v.panels), 'hint', v.hint, 'guards', v.guards.length, 'loot', v.loot.length);
}
console.log(L.map.join('\n'));
