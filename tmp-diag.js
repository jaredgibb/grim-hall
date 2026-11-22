require('./js/secrets.js');
const GH = require('./js/data.js');
for (const lvl of GH.levels) {
  const v = lvl.vaults || [];
  const g = lvl.map;
  let guards=0, loot=0, twins=0;
  for (const x of v) { guards+=x.guards.length; loot+=x.loot.length; }
  console.log(`${lvl.name.padEnd(16)} ${g[0].length}x${g.length} vaults=${v.length} d=[${v.map(x=>x.d).join(',')}] guards=${guards} loot=${loot} elev=${lvl.elevator?lvl.elevator.x+','+lvl.elevator.y+'>'+lvl.elevator.to:'-'} hint=${v.filter(x=>x.hint).length}`);
}
