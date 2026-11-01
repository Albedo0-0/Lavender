// Pre-deploy check (dev tool, not part of the app). Run from the project folder: node check-deploy.js
// Verifies every service-worker precache entry and every file index.html loads exists with the EXACT
// filename (a directory listing is used, so it is exact even on case-insensitive disks), and that
// everything index.html loads is precached.
const fs = require('fs'), path = require('path');
const dir = process.argv[2] || '.';
const names = new Set(fs.readdirSync(dir));
const sw = fs.readFileSync(path.join(dir, 'service-worker.js'), 'utf8');
const block = n => (sw.match(new RegExp('const ' + n + ' = \\[([\\s\\S]*?)\\];')) || [, ''])[1];
const list = s => (s.match(/'\.\/([^']*)'/g) || []).map(x => x.slice(3, -1));
const required = list(block('APP_SHELL'));
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const loaded = (html.match(/(?:src|href)="([^"#?]+)/g) || []).map(x => x.replace(/^(src|href)="/, '').replace(/^\.\//, '')).filter(u => !/^(https?:|data:)/.test(u));
let bad = 0; const fail = m => { bad++; console.log('FAIL ' + m); };
required.filter(f => f && !names.has(f)).forEach(f => fail('precache entry has no such file (exact name): ' + f));
loaded.filter(f => !names.has(f)).forEach(f => fail('index.html loads a file that does not exist (exact name): ' + f));
loaded.filter(f => !required.includes(f)).forEach(f => fail('index.html loads a file that is not in APP_SHELL: ' + f));
console.log(bad ? bad + ' problem(s). Do not deploy.' : 'OK: ' + required.length + ' precache entries, all present and exact.');
process.exit(bad ? 1 : 0);
