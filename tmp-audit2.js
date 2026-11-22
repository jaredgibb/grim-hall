// Audit every carved vault: can its panel actually slide, is the chamber reachable
// once it does, does it hold loot, and is anything sitting in the travel lane?
require('./js/secrets.js');
const GH = require('./js/data.js');
const DIRS = [[1,0],[-1,0],[0,1],[0,-1]];
const SOLID = c => '#T~'.includes(c);
let problems = 0;
for (const lvl of GH.levels) {
  const MAP = lvl.map, H = MAP.length, W = MAP[0].length;
  const at = (x,y) => (x<0||y<0||y>=H||x>=W) ? '#' : MAP[y][x];
  const rows = [];
  for (const v of lvl.vaults) {
    // 1. every panel must have two clear squares of travel
    for (const [px,py,dx,dy] of v.panels) {
      const a = at(px+dx, py+dy), b = at(px+dx*2, py+dy*2);
      if (SOLID(a) || SOLID(b) || a === 'D' || b === 'D') { rows.push('panel '+px+','+py+' cannot slide ('+a+','+b+')'); }
      // door adjacency (bible 4.51)
      for (let sy=-1; sy<=1; sy++) for (let sx=-1; sx<=1; sx++)
        if (at(px+sx, py+sy) === 'D') rows.push('panel '+px+','+py+' sits against a door');
    }
    // 2. flood fill from the spawn with the panels still shut, then with them moved
    const reach = (moved) => {
      const g = MAP.map(r => r.split(''));
      for (const [px,py,dx,dy] of v.panels) {
        if (moved) { g[py][px] = '.'; g[py+dy*2][px+dx*2] = 'W'; }
      }
      const solid = c => '#T~W'.includes(c);
      let start = null;
      for (let y=0;y<H&&!start;y++) for (let x=0;x<W;x++) if (g[y][x]==='P') { start=[x,y]; break; }
      const seen = new Set(); const q=[start]; seen.add(start[1]*W+start[0]);
      while (q.length) { const [x,y]=q.pop();
        for (const [dx,dy] of DIRS) { const nx=x+dx, ny=y+dy;
          if (nx<0||ny<0||nx>=W||ny>=H) continue;
          if (solid(g[ny][nx])) continue;
          const k=ny*W+nx; if (seen.has(k)) continue; seen.add(k); q.push([nx,ny]); } }
      return v.cells.filter(([x,y]) => !seen.has(y*W+x));
      };
    const stillSealed = reach(false).length === v.cells.length;
    const afterOpen = reach(true);
    if (!stillSealed) rows.push('vault '+v.id+' is not sealed before the panel moves');
    if (afterOpen.length) rows.push('vault '+v.id+' still unreachable after the panel slides ('+afterOpen.length+' cells)');
    if (!v.loot.length) rows.push('vault '+v.id+' ('+v.kind+' '+v.w+'x'+v.d+') is empty - no payoff');
  }
  const chestsOut = [...MAP.join('')].filter(c => c==='x'||c==='C').length;
  if (rows.length) { problems++; console.log('--- '+lvl.name); rows.forEach(r=>console.log('   '+r)); }
  console.log(lvl.name.padEnd(18), 'vaults', lvl.vaults.length, 'panels', lvl.vaults.reduce((a,v)=>a+v.panels.length,0),
    'kinds', lvl.vaults.map(v=>v.kind+' '+v.w+'x'+v.d).join(', '));
}
console.log('levels with problems:', problems);
