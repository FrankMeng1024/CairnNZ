// R113 auth helper — create test account programmatically via yiiling backend.
// Steps: register → SSH into aliyun MySQL → grab verification code → verify → return JWT.
// Uses a unique email per session so runs don't collide.
//
// This does NOT persist accounts long-term. Cleanup after all rounds done:
//   ssh root@122.51.174.118 "docker exec ainews-db mysql -uroot -p... cairn -e 'DELETE FROM users WHERE email LIKE \"r113-test-%\"'"

const { execSync } = require('child_process');

const API = 'https://api.yiiling.cn';
const SSH_HOST = 'root@122.51.174.118';
const DB_CMD = "docker exec ainews-db mysql -uroot -pMzm920313@950824 cairn -Nse";

async function createTestUser(opts = {}) {
  const stamp = Date.now();
  const email = opts.email || `r113-test-${stamp}@yiiling.cn`;
  const password = opts.password || `R113test!${stamp}`;
  const name = opts.name || `R113 Tester ${stamp}`;
  // 30 years ago — age > 13 ok
  const dateOfBirth = opts.dateOfBirth || new Date(Date.now() - 30 * 365 * 86400e3).toISOString().slice(0, 10);

  // Step 1: register
  const regRes = await fetch(`${API}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost:8082' },
    body: JSON.stringify({ email, password, name, dateOfBirth }),
  });
  if (!regRes.ok) {
    const txt = await regRes.text();
    throw new Error(`register failed ${regRes.status}: ${txt}`);
  }
  const regJson = await regRes.json();
  console.log('[auth] registered:', email);

  // Step 2: pull code from MySQL (production doesn't return dev_code)
  let code;
  if (regJson.dev_code) {
    code = regJson.dev_code;
  } else {
    // SSH → MySQL. Retry a few times for row visibility.
    for (let i = 0; i < 5; i++) {
      try {
        const raw = execSync(
          `ssh -o StrictHostKeyChecking=no ${SSH_HOST} "${DB_CMD} 'SELECT code FROM pending_registrations WHERE email=\\"${email}\\"'"`,
          { encoding: 'utf8', timeout: 20000 }
        ).trim();
        if (raw && /^\d{6}$/.test(raw)) {
          code = raw;
          break;
        }
      } catch (e) {
        // retry
      }
      await new Promise(r => setTimeout(r, 1000));
    }
    if (!code) throw new Error('could not fetch verification code from DB after 5 tries');
  }
  console.log('[auth] got code:', code);

  // Step 3: verify → creates user + returns JWT
  const verRes = await fetch(`${API}/api/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost:8082' },
    body: JSON.stringify({ email, code }),
  });
  if (!verRes.ok) {
    const txt = await verRes.text();
    throw new Error(`verify failed ${verRes.status}: ${txt}`);
  }
  const verJson = await verRes.json();
  console.log('[auth] verified, user id:', verJson.user && verJson.user.id);
  return { email, password, jwt: verJson.token || verJson.jwt, user: verJson.user };
}

module.exports = { createTestUser };

// Standalone test
if (require.main === module) {
  createTestUser()
    .then(u => { console.log('SUCCESS', JSON.stringify(u, null, 2)); process.exit(0); })
    .catch(e => { console.error('FAIL', e.message); process.exit(1); });
}
