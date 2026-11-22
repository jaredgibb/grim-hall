const GH = require('./js/data.js');
require('./js/secrets.js');
for (const level of GH.levels) {
  const H = level.map.length, W = level.map[0].length;
  const solid = c => c === '#' || c === 'T' || c === '~' || c === 'W';
  for (const v of level.vaults) {
    const inV = new Set(v.cells.map(([x, y]) => y * W + x));
    for (const [x, y] of v.cells) {
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx = x + dx, ny = y + dy;
        if (inV.has(ny * W + nx)) continue;
        const c = (nx >= 0 && ny >= 0 && ny < H && nx < W) ? level.map[ny][nx] : '#';
        if (!solid(c)) console.log('LEAK', level.name, 'vault', v.id, 'cell', x + ',' + y, '->', nx + ',' + ny, 'tile', c, 'panels', JSON.stringify(v.panels));
      }
    }
  }
}
console.log('done');
