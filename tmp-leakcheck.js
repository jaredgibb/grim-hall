require('./js/secrets.js');
const GH = require('./js/data.js');
const Game = require('./js/game.js');
const G = Game.G;
for (let i = 0; i < GH.levels.length; i++) {
  G.seed = 9; Game.buildWorld(i); G.state = 'play';
  const lvl = GH.levels[i], W = Game.width(), H = Game.height(), MAP = Game.grid();
  const seen = Array.from({ length: H }, () => new Array(W).fill(false));
  const q = [[Math.floor(G.player.x), Math.floor(G.player.y)]];
  seen[q[0][1]][q[0][0]] = true;
  while (q.length) {
    const [x, y] = q.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || seen[ny][nx]) continue;
      if ('#T~W'.includes(MAP[ny][nx])) continue;
      seen[ny][nx] = true; q.push([nx, ny]);
    }
  }
  for (const v of (lvl.vaults || [])) for (const [x, y] of v.cells)
    if (seen[y][x]) console.log('LEAK', lvl.name, 'vault', v.id, x, y, MAP[y][x]);
  for (const v of (lvl.vaults || []))
    console.log(lvl.name, 'vault', v.id, 'panel', v.ex, v.ey, 'dir', v.dx, v.dy, v.w + 'x' + v.d);
}
