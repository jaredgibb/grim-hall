const GH=require('./js/data.js');const Game=require('./js/game.js');const VG=require('./js/secrets.js');
const lvl=GH.levels[0];const MAP=lvl.map;const H=MAP.length,W=MAP[0].length;const at=(x,y)=>(x<0||y<0||y>=H||x>=W)?'!':MAP[y][x];
for(const v of lvl.vaults){const bx=v.ex+v.dx*(v.d+1),by=v.ey+v.dy*(v.d+1);const hx=bx+v.dx,hy=by+v.dy,rx=bx+v.dx*2,ry=by+v.dy*2;console.log('vault '+v.id,v.kind,v.w+'x'+v.d,'panel',v.ex+','+v.vry||v.ex+','+v.ey,'dir',v.dx,v.dy,'farwall',bx+','+by,'='+at(bx,by),'hatch',hx+','+hy,'='+at(hx,hy),'rest',rx+','+ry,'='+at(rx,ry));}
console.log('level0 map:');MAP.forEach(r=>console.log(r));
