const GH = require('./js/data.js');
const Game = require('./js/game.js');
const { G } = Game;
const DT = 1/60;
function sim(ticks, input={}){ for(let i=0;i<ticks;i++){ if(G.state!=='play')break; GH.input=Object.assign({fwd:0,back:0,left:0,right:0,turn:0,fire:0,fireEdge:0,wantW:-1,sprint:0},input); Game.update(DT);} }
function fresh(level=0,seed=1234){ G.seed=seed; Game.buildWorld(level); G.state='play'; return G; }

// ---- test 19 debug ----
const idx = GH.levels.findIndex(l => (l.vaults||[]).some(v=>v.d>=5));
fresh(idx,71);
const vault = GH.levels[idx].vaults.find(v=>v.d>=5);
const panel = G.doors.find(d=>d.push && d.cx===vault.ex && d.cy===vault.ey);
const [dx,dy]=[vault.dx,vault.dy];
console.log('level',idx,'vault',vault.id,vault.kind,'w',vault.w,'d',vault.d,'panel',vault.ex,vault.ey,'dir',dx,dy,'chain',vault.chain);
const MAP=Game.grid();
console.log('cells around panel along axis:');
for(let a=-1;a<=7;a++){const x=vault.ex+dx*a,y=vault.ey+dy*a;console.log(' a='+a,x,y,MAP[y][x]);}
G.player.x=vault.ex-dx+0.5;G.player.y=vault.ey-dy+0.5;G.player.a=Math.atan2(dy,dx);
sim(40,{fwd:1});
console.log('after shove1 panel at',panel.cx,panel.cy,'want',vault.ex+dx*2,vault.ey+dy*2);
sim(60,{fwd:1});
console.log('after shove2 panel at',panel.cx,panel.cy,'want',vault.ex+dx*4,vault.ey+dy*4);
sim(30);
G.player.x=panel.cx+dx+0.5;G.player.y=panel.cy+dy+0.5;G.player.a=Math.atan2(-dy,-dx);
console.log('push-back cell a=',(panel.cx-vault.ex)*dx+(panel.cy-vault.ey)*dy);
console.log('freeForWall check cells:', MAP[panel.cy-dy][panel.cx-dx], MAP[panel.cy-2*dy][panel.cx-2*dx]);
console.log('tryPushwall back ->', Game.tryPushwall(panel,-dx,-dy));
console.log('enemies near:', G.enemies.filter(e=>Math.floor(e.x)===14&&Math.floor(e.y)>=3&&Math.floor(e.y)<=7).map(e=>[e.x,e.y,e.dead,e.corpse,e.hp]));
console.log('items near:', G.items.filter(it=>!it.taken&&Math.floor(it.x)===14&&Math.floor(it.y)>=3&&Math.floor(it.y)<=8).map(it=>[it.x,it.y,it.key]));
console.log('panel state', panel.cx, panel.cy, panel.push, panel.open, panel.jamCd, panel.dx, panel.dy);
console.log('doorAt cells:', Game.doorAt[5*Game.width()+14], Game.doorAt[6*Game.width()+14]);
console.log('grid', MAP[3][14],MAP[4][14],MAP[5][14],MAP[6][14],MAP[7][14],MAP[8][14]);

console.log('MAP rows:'); for(let y=vault.ey-2;y<=vault.ey+8;y++) console.log(y, MAP[y]);
