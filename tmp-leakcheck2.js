const GH = require('./js/data.js');
const Game = require('./js/game.js');
const G = Game.G;
G.seed = 9;
Game.buildWorld(0);
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
console.log(MAP.join('\n'));
for (const v of (lvl.vaults || [])) {
  const leak = v.cells.filter(([x, y]) => seen[y][x]);
  console.log(`vault ${v.id} panel ${v.ex},${v.ey} dir ${v.dx},${v.dy} ${v.w}x${v.d} cells=${v.cells.length} lining=${(v.lining||[]).length} leaks=${leak.map(c => c.join(',')).join(' ')}`);
}
let unreach = 0;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
  if (!seen[y][x] && !'#T~W'.includes(MAP[y][x])) { unreach++; console.log('unreachable floor', x, y, MAP[y][x]); }
console.log('unreachable floor cells:', unreach);
