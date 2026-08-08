#!/bin/bash
# R114/O22 STORY-73006 H2: minimally patch server production User.js + auth.js
# to add PATCH /api/auth/onboarding endpoint.
#
# Design: this script is idempotent. Running it twice makes no additional
# changes. Every edit is anchored to a stable marker so re-runs are safe.

set -euo pipefail
cd /opt/githubRepos/Cairn/Cairn

USER_JS=backend/src/models/User.js
AUTH_JS=backend/src/routes/auth.js

# ── User.js: extend toPublic with onboardingDoneAt ────────────────────────
if ! grep -q "onboardingDoneAt" "$USER_JS"; then
  sed -i 's|hasPassword: !!user.password_hash,|hasPassword: !!user.password_hash,\n    onboardingDoneAt: user.onboarding_done_at ? new Date(user.onboarding_done_at).toISOString() : null,|' "$USER_JS"
  echo "✓ User.js: toPublic extended with onboardingDoneAt"
else
  echo "  User.js: onboardingDoneAt already present, skip"
fi

# ── User.js: add setOnboardingDone function before module.exports ──────
if ! grep -q "async function setOnboardingDone" "$USER_JS"; then
  # Find the line number of "module.exports = {" and insert function above
  MODEXPORTS_LINE=$(grep -n "^module.exports = {" "$USER_JS" | head -1 | cut -d: -f1)
  if [ -z "$MODEXPORTS_LINE" ]; then
    echo "❌ Could not locate module.exports in User.js"; exit 1
  fi
  # Insert lines just before module.exports
  sed -i "${MODEXPORTS_LINE}i\\
// R114/O22 STORY-73006 (H2): mark onboarding done on server so it follows\\
// the user account across devices and reinstalls.\\
async function setOnboardingDone(userId, at) {\\
  await pool.execute(\\
    'UPDATE users SET onboarding_done_at = ? WHERE id = ?',\\
    [at, userId]\\
  );\\
}\\
" "$USER_JS"
  echo "✓ User.js: setOnboardingDone function added"
else
  echo "  User.js: setOnboardingDone already present, skip"
fi

# ── User.js: export setOnboardingDone ─────────────────────────────────
if ! grep -q "setOnboardingDone," "$USER_JS"; then
  sed -i 's|hashPassword, comparePassword, toPublic,|hashPassword, comparePassword, toPublic,\n  setOnboardingDone,|' "$USER_JS"
  echo "✓ User.js: setOnboardingDone exported"
else
  echo "  User.js: setOnboardingDone already exported, skip"
fi

# ── auth.js: add PATCH /onboarding route before module.exports ─────────
if ! grep -q "router.patch('/onboarding'" "$AUTH_JS"; then
  MODEXPORTS_LINE=$(grep -n "^module.exports = router" "$AUTH_JS" | head -1 | cut -d: -f1)
  if [ -z "$MODEXPORTS_LINE" ]; then
    echo "❌ Could not locate module.exports in auth.js"; exit 1
  fi
  sed -i "${MODEXPORTS_LINE}i\\
// R114/O22 STORY-73006 (H2): mark intro-flow onboarding complete.\\
// Idempotent: setting done=true when already done is a no-op.\\
router.patch('/onboarding', authenticate, async (req, res) => {\\
  try {\\
    const user = await User.findById(req.user.userId);\\
    if (!user) return res.status(404).json({ error: 'Account not found.' });\\
    const done = req.body && req.body.done === true;\\
    if (!done) return res.status(400).json({ error: 'Missing or false done flag.' });\\
    if (!user.onboarding_done_at) {\\
      await User.setOnboardingDone(user.id, new Date());\\
    }\\
    const updated = await User.findById(user.id);\\
    return res.json({ user: User.toPublic(updated) });\\
  } catch (err) {\\
    console.error('[onboarding patch]', err);\\
    return res.status(500).json({ error: 'Server error. Please try again.' });\\
  }\\
});\\
\\
" "$AUTH_JS"
  echo "✓ auth.js: PATCH /onboarding route added"
else
  echo "  auth.js: /onboarding already present, skip"
fi

echo
echo "== Patched files ready. Rebuild + restart backend now =="
