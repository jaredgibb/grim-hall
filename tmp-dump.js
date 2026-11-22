require('./js/secrets.js');
const GH = require('./js/data.js');
const Game = require('./js/game.js');
const G = Game.G;
const name = process.argv[2] || 'THE FURNACE';
const idx = GH.levels.findIndex(l => l.name === name);
const lvl = GH.levels[idx];
G.seed = 9; Game.buildWorld(idx);
const MAP = Game.grid(), W = Game.width(), H = Game.height();
for (const v of lvl.vaults) {
  const xs = v.cells.map(c => c[0]), ys = v.cells.map(c => c[1]);
  console.log('vault ' + v.id + ' panel ' + v.ex + ',' + v.ey + ' dir ' + v.dx + ',' + v.dy + ' lining=' + (v.lining ? v.lining.length : 'MISSING'));
  for (let y = Math.min(...ys) - 2; y <= Math.max(...ys) + 2; y++) { let s = ''; for (let x = Math.min(...xs) - 2; x <= Math.max(...xs) + 2; x++) s += MAP[y][x]; console.log('  y' + y, s); }
}
