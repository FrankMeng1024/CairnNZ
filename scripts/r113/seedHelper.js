// R113 seedHelper — populate test account with baseline data so
// H/F/V/D cases have something to render.
// Called ONCE at runner start via yiiling backend REST API + SSH aliyun for anything
// the API doesn't expose.

const { execSync } = require('child_process');
const API = 'https://api.yiiling.cn';
const SSH_HOST = 'root@122.51.174.118';
const DB_CMD = "docker exec ainews-db mysql -uroot -pMzm920313@950824 cairn -Nse";

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 86400e3).toISOString().slice(0, 19).replace('T', ' ');
}

// Seed N hikes via direct MySQL insert (backend API for start+save is chatty
// and requires GPS point batches; direct SQL is faster for fixture-style bulk).
async function seedHikesViaMysql(userId, count) {
  console.log(`[seed] inserting ${count} hikes for user ${userId}...`);
  // Write SQL to local tmp file, scp to aliyun, source it. Avoids shell escaping.
  const rows = [];
  for (let i = 0; i < count; i++) {
    // First 5 hikes within last 24h so Home Recent pill renders.
    // Remaining spread over days for volume (H16 wants 250 count).
    let startTime;
    if (i < 5) {
      const hoursAgo = [1, 3, 6, 12, 20][i];
      startTime = new Date(Date.now() - hoursAgo * 3600e3).toISOString().slice(0, 19).replace('T', ' ');
    } else {
      startTime = isoDaysAgo(i - 4);
    }
    const endTime = new Date(new Date(startTime).getTime() + 30 * 60e3)
      .toISOString().slice(0, 19).replace('T', ' ');
    const distance = 500 + (i % 10) * 300;
    const duration = 30 * 60;
    const type = i % 3 === 0 ? 'running' : 'hiking';
    const name = `Seed hike ${i + 1}`;
    rows.push(`(${userId}, '${type}', '${startTime}', '${endTime}', '${endTime}', ${distance}, ${duration}, '${name}')`);
  }
  const sql = `INSERT INTO sessions (user_id, type, start_time, end_time, finalized_at, distance_m, duration_s, name) VALUES\n${rows.join(',\n')};\n`;
  const localSql = `C:/tmp/r113-seed-hikes-${userId}.sql`;
  const fs2 = require('fs');
  fs2.mkdirSync('C:/tmp', { recursive: true });
  fs2.writeFileSync(localSql, sql);
  try {
    execSync(`scp -o StrictHostKeyChecking=no "${localSql}" ${SSH_HOST}:/tmp/r113-seed.sql`, { stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000 });
    execSync(`ssh -o StrictHostKeyChecking=no ${SSH_HOST} "docker cp /tmp/r113-seed.sql ainews-db:/tmp/r113-seed.sql && docker exec ainews-db sh -c 'mysql -uroot -pMzm920313@950824 cairn < /tmp/r113-seed.sql'"`, { stdio: ['pipe', 'pipe', 'pipe'], timeout: 60000 });
    console.log(`[seed] hikes done`);
  } catch (e) {
    console.warn('[seed] hikes err:', e.message.slice(0, 200));
  }
}

async function seedMarks(user, count) {
  const jwt = user.jwt;
  console.log(`[seed] inserting ${count} marks via API...`);
  const centerLat = -36.8485, centerLng = 174.7633;
  for (let i = 0; i < count; i++) {
    try {
      const res = await fetch(`${API}/api/markers`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${jwt}`,
          'Content-Type': 'application/json',
          'Origin': 'http://localhost:8082',
        },
        body: JSON.stringify({
          type: 'landmark',
          text: `Seed mark ${i + 1}`,
          lat: centerLat + (i * 0.001),
          lng: centerLng + (i * 0.001),
          permission: 'personal',
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        console.warn(`[seed] mark ${i} status ${res.status}: ${body.slice(0, 100)}`);
      }
    } catch (e) {
      console.warn(`[seed] mark ${i} err`, e.message.slice(0, 80));
    }
  }
  console.log(`[seed] marks done`);
}

async function seedFriends(user, count) {
  // Create N+1 shell users then friend them
  console.log(`[seed] creating ${count} friend users...`);
  const { createTestUser } = require('./authHelper');
  const friends = [];
  for (let i = 0; i < count; i++) {
    const f = await createTestUser({ email: `r113-friend-${Date.now()}-${i}@yiiling.cn` });
    friends.push(f);
  }
  // Send friend requests from main user
  for (const f of friends) {
    try {
      await fetch(`${API}/api/friends/add`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${user.jwt}`,
          'Content-Type': 'application/json',
          'Origin': 'http://localhost:8082',
        },
        body: JSON.stringify({ email: f.email }),
      });
    } catch (e) { console.warn('[seed] friend req err', e.message.slice(0, 80)); }
  }
  console.log(`[seed] friends done`);
  return friends;
}

async function seedAll(user) {
  await seedHikesViaMysql(user.user.id, 250);
  await seedMarks(user, 5);
  await seedFriends(user, 3);
}

module.exports = { seedAll, seedHikesViaMysql, seedMarks, seedFriends };

if (require.main === module) {
  (async () => {
    const { createTestUser } = require('./authHelper');
    const u = await createTestUser();
    await seedAll(u);
    console.log('SEED DONE. email:', u.email);
  })();
}
