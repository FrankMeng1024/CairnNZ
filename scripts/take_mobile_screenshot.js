/**
 * Playwright script to take iPhone 14 Pro screenshots of Cairn app
 * Navigates to login, signs in, and captures home screen
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const OUTPUT_DIR = path.join(__dirname, '..', 'docs', 'qa', 'mobile-preview');
const APP_URL = 'http://localhost:8082';

// iPhone 14 Pro dimensions
const VIEWPORT = { width: 393, height: 852 };

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function takeScreenshots() {
  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 3,  // iPhone 14 Pro has 3x pixel density
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
  });
  const page = await context.newPage();

  console.log('Step 1: Navigating to', APP_URL);
  await page.goto(APP_URL, { waitUntil: 'networkidle' });
  await sleep(2000); // Wait for splash animation

  // Take initial screenshot (splash/home)
  const splashPath = path.join(OUTPUT_DIR, 'splash-screen.png');
  await page.screenshot({ path: splashPath, fullPage: false });
  console.log('Screenshot saved:', splashPath);

  // Look for Sign In button
  console.log('Step 4: Looking for Sign In button...');
  const pageContent = await page.content();

  // Take screenshot of current state
  const beforeLoginPath = path.join(OUTPUT_DIR, 'before-login.png');
  await page.screenshot({ path: beforeLoginPath, fullPage: false });
  console.log('Screenshot saved:', beforeLoginPath);

  // Try to find and click Sign In
  let loginClicked = false;

  // Try various selectors for Sign In button
  const signInSelectors = [
    'text=Sign In',
    'text=Sign in',
    'text=LOG IN',
    'text=Login',
    '[data-testid="sign-in"]',
    'button:has-text("Sign In")',
    'button:has-text("Login")',
  ];

  for (const selector of signInSelectors) {
    try {
      const el = await page.$(selector);
      if (el) {
        console.log('Found Sign In with selector:', selector);
        await el.click();
        loginClicked = true;
        break;
      }
    } catch (e) {
      // Try next selector
    }
  }

  if (!loginClicked) {
    console.log('Sign In button not found, checking page structure...');
    // Get visible text to understand page state
    const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 500));
    console.log('Page text:', bodyText);

    // Take screenshot to see what's on screen
    const debugPath = path.join(OUTPUT_DIR, 'debug-state.png');
    await page.screenshot({ path: debugPath, fullPage: false });
    console.log('Debug screenshot saved:', debugPath);
  }

  await sleep(1000); // Wait for login form

  // Take screenshot of login form
  const loginFormPath = path.join(OUTPUT_DIR, 'login-form.png');
  await page.screenshot({ path: loginFormPath, fullPage: false });
  console.log('Screenshot saved:', loginFormPath);

  // Try to fill in credentials
  console.log('Step 6-7: Filling in credentials...');

  // Email field
  const emailSelectors = [
    'input[type="email"]',
    'input[placeholder*="email" i]',
    'input[placeholder*="Email" i]',
    '[data-testid="email-input"]',
  ];

  let emailFilled = false;
  for (const sel of emailSelectors) {
    try {
      const el = await page.$(sel);
      if (el) {
        await el.click();
        await el.fill('test@test.com');
        emailFilled = true;
        console.log('Email filled with selector:', sel);
        break;
      }
    } catch (e) {}
  }

  // Password field
  const passwordSelectors = [
    'input[type="password"]',
    'input[placeholder*="password" i]',
    'input[placeholder*="Password" i]',
    '[data-testid="password-input"]',
  ];

  let passwordFilled = false;
  for (const sel of passwordSelectors) {
    try {
      const el = await page.$(sel);
      if (el) {
        await el.click();
        await el.fill('password123');
        passwordFilled = true;
        console.log('Password filled with selector:', sel);
        break;
      }
    } catch (e) {}
  }

  if (emailFilled && passwordFilled) {
    // Click submit button
    const submitSelectors = [
      'button[type="submit"]',
      'text=Sign In',
      'text=Login',
      'text=LOG IN',
      'button:has-text("Sign In")',
      'button:has-text("Login")',
    ];

    for (const sel of submitSelectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          console.log('Step 8: Clicking submit with selector:', sel);
          await el.click();
          break;
        }
      } catch (e) {}
    }
  } else {
    console.log('Could not fill credentials - emailFilled:', emailFilled, 'passwordFilled:', passwordFilled);

    // Try Create Account as fallback
    console.log('Trying Create Account fallback...');
    const createSelectors = [
      'text=Create Account',
      'text=Sign Up',
      'text=Register',
      'button:has-text("Create Account")',
    ];

    for (const sel of createSelectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          await el.click();
          console.log('Clicked Create Account');
          await sleep(1000);

          // Fill registration form
          const nameField = await page.$('input[placeholder*="name" i]') ||
                            await page.$('input[placeholder*="Name" i]');
          if (nameField) await nameField.fill('Preview');

          const emailField = await page.$('input[type="email"]') ||
                             await page.$('input[placeholder*="email" i]');
          if (emailField) await emailField.fill('preview@test.com');

          const pwField = await page.$('input[type="password"]');
          if (pwField) await pwField.fill('preview123');

          // Submit registration
          const regSubmit = await page.$('button[type="submit"]') ||
                            await page.$('text=Create Account') ||
                            await page.$('text=Register');
          if (regSubmit) await regSubmit.click();

          break;
        }
      } catch (e) {}
    }
  }

  // Wait for home screen
  console.log('Step 9: Waiting 2 seconds for home screen...');
  await sleep(2000);

  // Check for any verification code (dev_code in yellow banner)
  const pageText = await page.evaluate(() => document.body.innerText);
  console.log('Current page text preview:', pageText.substring(0, 300));

  // Take final screenshot
  console.log('Step 10: Taking home screen screenshot...');
  const homeLoggedInPath = path.join(OUTPUT_DIR, 'home-loggedin.png');
  await page.screenshot({ path: homeLoggedInPath, fullPage: false });
  console.log('Final screenshot saved:', homeLoggedInPath);

  // Also take a full-page screenshot for reference
  const homeFullPath = path.join(OUTPUT_DIR, 'home-loggedin-full.png');
  await page.screenshot({ path: homeFullPath, fullPage: true });
  console.log('Full page screenshot saved:', homeFullPath);

  await browser.close();
  console.log('Done! All screenshots saved to:', OUTPUT_DIR);
}

takeScreenshots().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
