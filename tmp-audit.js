const GH = require('./js/data.js');
const Game = require('./js/game.js');
const { G } = Game;
for (let i = 0; i < GH.levels.length; i++) {
  G.seed = 9; Game.buildWorld(i); G.state = 'play';
  const lvl = GH.levels[i], W = Game.width(), H = Game.height(), MAP = Game.grid();
  const wcount = MAP.join('').split('W').length;
  const nodir = G.doors.filter(d => d.push && !(d.dx || d.dy)).map(d => d.cx + ',' + d.cy);
  console.log(lvl.name.padEnd(16), 'W=' + wcount, 'secrets=' + G.secrets.total, 'noDir=' + nodir.join(' '));
}
