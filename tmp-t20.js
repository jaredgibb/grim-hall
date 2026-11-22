const GH = require('./js/data.js');
const Game = require('./js/game.js');
const { G } = Game;
const fresh = (level = 0, seed = 1234) => { G.seed = seed; Game.buildWorld(level); G.state = 'play'; return G; };
fresh(0, 9);
const lvl = GH.levels[0], W = Game.width(), H = Game.height(), MAP = Game.grid();
const seen = Array.from({ length: H }, () => new Array(W).fill(false));
const q = [[Math.floor(G.player.x), Math.floor(G.player.y)]];
seen[q[0][1]][q[0][0]] = true;
while (q.length) {
  const [x, y] = q.shift();
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= W || ny >= H || seen[ny][nx]) continue;
    if ('#T~W'.includes(MAP[ny][nx])) continue;
    seen[ny][nx] = true; q.push([nx, ny]);
  }
}
console.log('vaults', lvl.vaults.length, 'map rows', H, 'cols', W);
lvl.vaults.forEach((v, i) => {
  const leaks = v.cells.filter(([x, y]) => seen[y][x]);
  if (leaks.length) console.log('vault', i + 1, 'id', v.id, 'leaks', leaks.map(c => c.join(',')).join(' '), 'panels', JSON.stringify(v.panels), 'kind', v.kind);
});
console.log(MAP.join('\n'));
