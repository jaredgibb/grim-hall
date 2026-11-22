const GH = require('./js/data.js');
require('./js/secrets.js');
for (const level of GH.levels) {
  const H = level.map.length, W = level.map[0].length;
  const inVault = new Set();
  for (const v of level.vaults) for (const [x, y] of v.cells) inVault.add(x + ',' + y);
  let chests = 0, chestsIn = 0, crowns = 0, crownsIn = 0, guards = 0, guardsIn = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = level.map[y][x], inside = inVault.has(x + ',' + y);
    if (c === 'k') { chests++; if (inside) chestsIn++; }
    if (c === 'A') { crowns++; if (inside) crownsIn++; }
    if (c === 'g') { guards++; if (inside) guardsIn++; }
  }
  console.log(level.name.padEnd(14),
    'vaults=' + level.vaults.length,
    'secretW=' + level.pushwalls.filter(p => p.secret).length,
    'chain=' + level.pushwalls.filter(p => p.secret && p.chain).length,
    'twins=' + level.vaults.filter(v => v.twin).length,
    'hints=' + level.vaults.filter(v => v.hint).length,
    'elev=' + (level.elevator ? level.elevator.x + ',' + level.elevator.y + '->' + level.elevator.level : 'NONE'),
    'chests ' + chestsIn + '/' + chests,
    'crowns ' + crownsIn + '/' + crowns,
    'guards ' + guardsIn + '/' + guards,
    'size ' + W + 'x' + H);
}
