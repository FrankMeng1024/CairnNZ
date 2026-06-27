#!/usr/bin/env node
/* Patch /app/src/index.js to add cron registration. Idempotent. */
const fs = require('fs');
const path = '/app/src/index.js';
let src = fs.readFileSync(path, 'utf8');

// 1. Add requires if not present
if (!src.includes("require('node-cron')")) {
  src = src.replace(
    /const pool = require\('\.\/config\/db'\);/,
    "const pool = require('./config/db');\nconst cron = require('node-cron');\nconst { run: cleanHiddenOrphans } = require('./cron/cleanHiddenItemsOrphans');"
  );
}

// 2. Add schedule call inside start() right after the app.listen() block, if not present
if (!src.includes('cleanHiddenItemsOrphans')) {
  console.error('cleanHiddenItemsOrphans not referenced — require step failed');
  process.exit(1);
}
if (!src.includes("cron.schedule(")) {
  // Find the app.listen call and insert after its closing });
  const block = `

  if (process.env.DISABLE_CRON === '1') {
    console.log('cron disabled via DISABLE_CRON=1');
  } else {
    cron.schedule('0 3 * * 0', () => {
      cleanHiddenOrphans({ verbose: true }).catch((err) => {
        console.error('[cron/scheduler] cleanHiddenItemsOrphans failed:', err.message);
      });
    }, { timezone: 'UTC' });
    console.log('cron registered: cleanHiddenItemsOrphans (0 3 * * 0 UTC)');
  }
`;
  // Match the app.listen invocation through its closing });
  const re = /(app\.listen\(PORT,[\s\S]*?\}\);)/;
  if (!re.test(src)) {
    console.error('could not find app.listen block');
    process.exit(1);
  }
  src = src.replace(re, '$1' + block);
}

fs.writeFileSync(path, src);
console.log('OK index.js patched');
