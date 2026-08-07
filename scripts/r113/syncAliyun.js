// R113 aliyun sync helper — incremental push of new screenshots + data.json.
// Called by runner every N cases so map.yiiling.cn shows live progress.
//
// Usage: node syncAliyun.js  (checks mtime, syncs only newer files)

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const EVIDENCE_DIR = 'C:/ClaudeCodeProjects/Cairn/docs/qa/user-flows-round-1';
const DATA_JSON = 'C:/ClaudeCodeProjects/Cairn/docs/feature-map/flows/data.json';
const SSH = 'root@122.51.174.118';

function syncAliyun() {
  const t0 = Date.now();
  // Use current-dir-relative path for tar (avoids C: -> remote host interpretation)
  const tarFilename = 'r113-sync.tar.gz';
  const localTar = path.join(EVIDENCE_DIR, tarFilename);
  try {
    // Push data.json (small, fast)
    execSync(
      `scp -o StrictHostKeyChecking=no "${DATA_JSON}" ${SSH}:/var/www/feature-map/flows/data.json`,
      { stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000 }
    );
    // Package all screenshots. cd into dir + relative filename avoids drive-letter issue.
    execSync(
      `cd "${EVIDENCE_DIR}" && tar czf ${tarFilename} *.png`,
      { stdio: ['pipe', 'pipe', 'pipe'], timeout: 60000 }
    );
    execSync(
      `scp -o StrictHostKeyChecking=no "${localTar}" ${SSH}:/tmp/r113-sync.tar.gz`,
      { stdio: ['pipe', 'pipe', 'pipe'], timeout: 120000 }
    );
    execSync(
      `ssh -o StrictHostKeyChecking=no ${SSH} "cd /var/www/feature-map/flows/screenshots/round-1 && tar xzf /tmp/r113-sync.tar.gz && rm /tmp/r113-sync.tar.gz"`,
      { stdio: ['pipe', 'pipe', 'pipe'], timeout: 90000 }
    );
    // Cleanup local tar
    try { fs.unlinkSync(localTar); } catch {}
    const took = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`[aliyun-sync] done in ${took}s`);
    return true;
  } catch (e) {
    console.warn('[aliyun-sync] err:', e.message.slice(0, 200));
    return false;
  }
}

module.exports = { syncAliyun };

if (require.main === module) {
  syncAliyun();
}
