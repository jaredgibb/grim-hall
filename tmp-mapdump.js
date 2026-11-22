require('./js/secrets.js');
const GH = require('./js/data.js');
const Game = require('./js/game.js');
const l = GH.levels[0];
console.log(l.map.join('\n'));
for (const v of l.vaults)
  console.log(`vault ${v.id} panel ${v.ex},${v.ey} dir ${v.dx},${v.dy} ${v.w}x${v.d} ${v.kind} guards=${v.guards.map(g => g.ch).join('')} loot=${v.loot.map(x => x.ch).join('')}`);
console.log('elevator', JSON.stringify(l.elevator));
Game.buildWorld(0);
const MAP = Game.grid(), W = Game.width(), H = Game.height();
const seen = Array.from({ length: H }, () => new Array(W).fill(false));
const q = [[Math.floor(Game.G.player.x), Math.floor(Game.G.player.y)]];
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
for (const v of l.vaults) for (const [x, y] of v.cells)
  if (seen[y][x]) console.log('LEAK vault', v.id, x, y, MAP[y][x]);
