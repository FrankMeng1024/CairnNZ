// One-shot scan: find Alert.alert(...) calls that don't include a buttons array.
// Skips strings/comments naively but good enough for a source-tree audit.
const fs = require('fs');
const path = require('path');

const results = [];

function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    const s = fs.statSync(p);
    if (s.isDirectory()) walk(p);
    else if (f.endsWith('.tsx') || f.endsWith('.ts')) check(p);
  }
}

function check(p) {
  const c = fs.readFileSync(p, 'utf8');
  let i = 0;
  while (true) {
    const m = c.indexOf('Alert.alert(', i);
    if (m < 0) break;
    let depth = 1;
    let j = m + 'Alert.alert('.length;
    let inS = false, inD = false, inT = false, inLC = false, inBC = false;
    let hasArr = false;
    while (j < c.length && depth > 0) {
      const ch = c[j];
      const pv = j > 0 ? c[j-1] : '';
      if (inLC) { if (ch === '\n') inLC = false; j++; continue; }
      if (inBC) { if (pv === '*' && ch === '/') inBC = false; j++; continue; }
      if (inS)  { if (ch === "'"  && pv !== '\\') inS = false; j++; continue; }
      if (inD)  { if (ch === '"'  && pv !== '\\') inD = false; j++; continue; }
      if (inT)  { if (ch === '`'  && pv !== '\\') inT = false; j++; continue; }
      if (ch === '/' && c[j+1] === '/') { inLC = true; j += 2; continue; }
      if (ch === '/' && c[j+1] === '*') { inBC = true; j += 2; continue; }
      if (ch === "'") { inS = true; j++; continue; }
      if (ch === '"') { inD = true; j++; continue; }
      if (ch === '`') { inT = true; j++; continue; }
      if (ch === '(' || ch === '{') depth++;
      else if (ch === '[') { if (depth === 1) hasArr = true; depth++; }
      else if (ch === ')' || ch === '}' || ch === ']') depth--;
      j++;
    }
    if (!hasArr) {
      const line = c.substring(0, m).split('\n').length;
      results.push(p + ':' + line);
    }
    i = j;
  }
}

walk('app/src');
results.forEach(x => console.log(x));
console.log('TOTAL missing:', results.length);
