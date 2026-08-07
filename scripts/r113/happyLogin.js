// Happy-path integration test: real login flow end-to-end.
// If this fails, we FIX the runner or the app until it passes.
// This is not a triage — this is the baseline that MUST work.

const { chromium, devices } = require('playwright');
const { createTestUser } = require('./authHelper');

const BASE_URL = 'http://localhost:8082/';

(async () => {
  console.log('=== Happy Path #1: Register + Sign In from Auth screen ===');
  const testUser = await createTestUser();
  console.log('[step 0] created backend user id', testUser.user?.id);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ...devices['iPhone 13'],
    viewport: { width: 390, height: 844 },
  });
  // Fresh page: clear storage each nav — user must actually sign in through UI
  await context.addInitScript(() => {
    try { localStorage.clear(); sessionStorage.clear(); } catch {}
  });
  const page = await context.newPage();

  // Step 1: land on Auth
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);
  let state = await page.evaluate(() => ({
    route: window.__cairnStores?.getCurrentRoute?.(),
    body: (document.body.innerText||'').slice(0, 200),
  }));
  console.log('[step 1] after boot:', JSON.stringify(state));

  // Step 2: tap Sign In
  const tapSignIn = await page.getByText(/^Sign In$/i).first().tap({ timeout: 5000 }).then(()=>true).catch(e=>{console.log('tap err',e.message);return false;});
  console.log('[step 2] tap Sign In =', tapSignIn);
  await page.waitForTimeout(2000);
  state = await page.evaluate(() => ({
    route: window.__cairnStores?.getCurrentRoute?.(),
    body: (document.body.innerText||'').slice(0, 300),
  }));
  console.log('[step 2 after]:', JSON.stringify(state));

  // Step 3: fill email
  const inputs = await page.locator('input').count();
  console.log('[step 3] input count:', inputs);
  for (let i = 0; i < inputs; i++) {
    const input = page.locator('input').nth(i);
    const placeholder = await input.getAttribute('placeholder').catch(()=>null);
    const type = await input.getAttribute('type').catch(()=>null);
    console.log(`  input[${i}] placeholder="${placeholder}" type="${type}"`);
  }

  // Try filling first input with email, second with password
  if (inputs >= 2) {
    await page.locator('input').nth(0).fill(testUser.email);
    await page.locator('input').nth(1).fill(testUser.password);
    console.log('[step 3] filled email + password');
    await page.waitForTimeout(500);

    // Step 4: tap Sign In (submit)
    // Multiple Sign In text elements — need the button one, likely at bottom
    const signInBtns = await page.getByText(/^Sign In$/i).count();
    console.log('[step 4] Sign In text count:', signInBtns);
    // Try tapping the last one (likely the submit button)
    await page.getByText(/^Sign In$/i).last().tap({ timeout: 5000 });
    console.log('[step 4] tapped submit Sign In');
    await page.waitForTimeout(4000);

    state = await page.evaluate(() => ({
      route: window.__cairnStores?.getCurrentRoute?.(),
      loggedIn: window.__cairnStores?.useAppStore?.getState?.().isLoggedIn,
      user: window.__cairnStores?.useAppStore?.getState?.().user?.email,
      body: (document.body.innerText||'').slice(0, 200),
    }));
    console.log('[step 4 after]:', JSON.stringify(state, null, 2));
  }

  await page.screenshot({ path: 'C:/ClaudeCodeProjects/Cairn/docs/qa/user-flows-round-1/_happypath_login.png', fullPage: false });
  await browser.close();
  console.log('\nScreenshot saved to docs/qa/user-flows-round-1/_happypath_login.png');
})();
