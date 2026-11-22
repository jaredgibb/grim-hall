const V = require('./js/secrets.js');
const GH = require('./js/data.js');
const lvl = GH.levels[0];
console.log('levels', GH.levels.length, 'vaults lvl0', (lvl.vaults || []).length);
const g = V.sealUnreachable(V.pad(lvl.map));
console.log('padded', g.length, g[0].length);
const c = V.candidates(g);
console.log('candidates', c.length);
console.log(g.map(r => r.join('')).join('\n'));
