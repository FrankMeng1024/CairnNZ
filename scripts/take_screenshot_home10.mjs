import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.setViewportSize({ width: 393, height: 852 });

// Step 1: Navigate
console.log('Navigating to http://localhost:8082 ...');
await page.goto('http://localhost:8082');
await page.waitForTimeout(3000);

// Step 4: Click Sign In
console.log('Looking for Sign In button...');
const snapshot = await page.content();
const allText = await page.evaluate(() => document.body.innerText);
console.log('Page text (first 500):', allText.substring(0, 500));

// Try clicking Sign In
try {
  await page.getByText('Sign In', { exact: false }).first().click();
  console.log('Clicked Sign In via getByText');
} catch (e) {
  console.log('getByText failed:', e.message);
  // Try role button
  try {
    await page.getByRole('button', { name: /sign in/i }).click();
    console.log('Clicked via role button');
  } catch (e2) {
    console.log('role button failed:', e2.message);
  }
}
await page.waitForTimeout(1000);

// Snapshot after click
const text2 = await page.evaluate(() => document.body.innerText);
console.log('After Sign In click (first 300):', text2.substring(0, 300));

// Type email
console.log('Filling email...');
try {
  await page.getByPlaceholder(/email/i).fill('frank@test.com');
} catch (e) {
  try {
    await page.locator('input[type="email"]').fill('frank@test.com');
  } catch (e2) {
    console.log('Email fill failed:', e2.message);
  }
}

// Type password
console.log('Filling password...');
try {
  await page.getByPlaceholder(/password/i).fill('password123');
} catch (e) {
  try {
    await page.locator('input[type="password"]').fill('password123');
  } catch (e2) {
    console.log('Password fill failed:', e2.message);
  }
}

// Click submit
console.log('Clicking submit...');
try {
  await page.getByRole('button', { name: /sign in/i }).click();
} catch (e) {
  try {
    await page.locator('button[type="submit"]').click();
  } catch (e2) {
    console.log('Submit click failed:', e2.message);
  }
}

// Wait 5 seconds
console.log('Waiting 5 seconds for login...');
await page.waitForTimeout(5000);

const text3 = await page.evaluate(() => document.body.innerText);
console.log('After login wait (first 500):', text3.substring(0, 500));

// Take screenshot
console.log('Taking screenshot...');
await page.screenshot({ path: 'docs/qa/sprint41-evidence/home-10.png', fullPage: false });
console.log('Screenshot saved to docs/qa/sprint41-evidence/home-10.png');

await browser.close();
