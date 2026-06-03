process.env.PLAYWRIGHT_CHROMIUM_HEADLESS_SHELL_EXECUTABLE_PATH = 'C:/Users/I585134/AppData/Local/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-win64/chrome-headless-shell.exe';
const { chromium } = require('C:/Users/I585134/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright-core');
const path = require('path');
const fs = require('fs');

const EVIDENCE_DIR = 'C:/ClaudeCodeProjects/Cairn/sandbox/docs/qa/sprint3-evidence';
const URL = 'http://localhost:8766/stage2_visual/index.html';

async function takeScreenshot(page, filepath, attempt) {
  // Pause the animation loop before screenshotting
  try {
    await page.evaluate(function() {
      // Cancel all pending rAF
      var id = window.requestAnimationFrame(function(){});
      for (var i = 0; i <= id + 10; i++) { window.cancelAnimationFrame(i); }
      // Pause sandbox
      if (window.__sandboxState) window.__sandboxState.paused = true;
    });
  } catch(e) { /* ignore */ }

  await page.waitForTimeout(200);

  // Try screenshot with clip to avoid full-page canvas issues
  await page.screenshot({
    path: filepath,
    clip: { x: 0, y: 0, width: 1280, height: 800 },
    timeout: 10000,
  });
}

(async () => {
  const browser = await chromium.launch({
    channel: 'chromium',
    headless: true,
    executablePath: 'C:/Users/I585134/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--headless=new',
    ],
  });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  page.setDefaultTimeout(20000);

  // Collect console messages
  const consoleErrors = [];
  const consoleAll = [];
  page.on('console', msg => {
    consoleAll.push(msg.type() + ': ' + msg.text());
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => consoleErrors.push('PAGE ERROR: ' + err.message));

  console.log('Step 1: Navigate to', URL);
  try {
    await page.goto(URL, { waitUntil: 'load', timeout: 15000 });
    console.log('  Page loaded');
  } catch(e) {
    console.log('  goto timeout (expected for canvas app) — continuing anyway');
    console.log('  Error:', e.message.split('\n')[0]);
  }

  // Wait 3 seconds for async init
  console.log('Step 2: Waiting 3s for async persona init...');
  await page.waitForTimeout(3000);

  // Check if init worked
  const initCheck = await page.evaluate(function() {
    return {
      sandboxExists: typeof window.__sandboxState !== 'undefined',
      walkers: window.__sandboxState ? window.__sandboxState.walkers.length : -1,
      frame: window.__sandboxState ? window.__sandboxState.frame : -1,
    };
  });
  console.log('  Init check:', JSON.stringify(initCheck));

  // Screenshot S3-01
  console.log('Step 3: Taking initial load screenshot...');
  try {
    await takeScreenshot(page, path.join(EVIDENCE_DIR, 'S3-01-initial-load.png'));
    console.log('  Saved S3-01-initial-load.png');
  } catch(e) {
    console.log('  Screenshot S3-01 FAILED:', e.message.split('\n')[0]);
  }

  // Resume simulation and wait 5 more seconds
  console.log('Step 4: Resuming simulation, waiting 5s...');
  await page.evaluate(function() {
    if (window.__sandboxState) window.__sandboxState.paused = false;
    window.requestAnimationFrame(function loop(t) {
      // Let it run
    });
  });
  await page.waitForTimeout(5000);

  // Screenshot S3-02
  console.log('Step 5: Taking running-5sec screenshot...');
  try {
    await takeScreenshot(page, path.join(EVIDENCE_DIR, 'S3-02-running-5sec.png'));
    console.log('  Saved S3-02-running-5sec.png');
  } catch(e) {
    console.log('  Screenshot S3-02 FAILED:', e.message.split('\n')[0]);
  }

  // Read DOM element values
  console.log('Step 6-7: Reading DOM element values...');
  const domValues = await page.evaluate(function() {
    function get(id) {
      var el = document.getElementById(id);
      return el ? el.textContent.trim() : 'NOT FOUND';
    }
    return {
      walkerCount: get('walker-count'),
      markerCount: get('marker-count'),
      frame: get('frame'),
      simDay: get('sim-day'),
      mTotal: get('m-total'),
      mHealthy: get('m-healthy'),
      mBorder: get('m-border'),
      mHb: get('m-hb'),
      mSunk: get('m-sunk'),
      tLikes: get('t-likes'),
      tReports: get('t-reports'),
      tEnc: get('t-enc'),
    };
  });
  console.log('  DOM values:', JSON.stringify(domValues, null, 2));

  // Check __sandboxState keys
  console.log('Step 8: Checking window.__sandboxState...');
  const stateKeys = await page.evaluate(function() {
    return JSON.stringify(Object.keys(window.__sandboxState || {}));
  });
  console.log('  __sandboxState keys:', stateKeys);

  // Get sandbox state summary
  console.log('Step 9: Getting sandbox state summary...');
  const stateSummary = await page.evaluate(function() {
    var s = window.__sandboxState;
    if (!s) return JSON.stringify({ error: 'not found' });
    var markerStatusCounts = {};
    if (window.__sandboxAlgo && s.markers) {
      s.markers.forEach(function(m) {
        var st = window.__sandboxAlgo.markerStatus(m, s.simNow);
        markerStatusCounts[st] = (markerStatusCounts[st] || 0) + 1;
      });
    }
    return JSON.stringify({
      walkers: s.walkers ? s.walkers.length : 0,
      markers: s.markers ? s.markers.length : 0,
      frame: s.frame,
      simNow: s.simNow,
      paused: s.paused,
      totalLikes: s.totalLikes,
      totalReports: s.totalReports,
      totalEncounters: s.totalEncounters,
      markerStatusCounts: markerStatusCounts,
    });
  });
  console.log('  State summary:', stateSummary);

  // Screenshot S3-03
  console.log('Step 10: Taking stats panel screenshot...');
  try {
    await takeScreenshot(page, path.join(EVIDENCE_DIR, 'S3-03-stats-panel.png'));
    console.log('  Saved S3-03-stats-panel.png');
  } catch(e) {
    console.log('  Screenshot S3-03 FAILED:', e.message.split('\n')[0]);
  }

  // Resume simulation so walkers move
  await page.evaluate(function() {
    if (window.__sandboxState) window.__sandboxState.paused = false;
  });
  await page.waitForTimeout(1000);

  // Click on canvas to select a walker
  console.log('Step 11: Clicking canvas to select a walker...');
  const canvasBox = await page.locator('canvas').boundingBox();
  console.log('  Canvas bounds:', JSON.stringify(canvasBox));

  var selected = false;
  if (canvasBox) {
    // Trail positions in canvas-relative coords
    // Canvas x starts at 0 in canvas coords (panel is separate div)
    // Walker trail points: [60,150],[180,130],[320,165],[460,140],[620,175],[780,150],[920,180]
    // These are direct canvas pixel coords
    var trailPoints = [
      [320, 165], [180, 130], [460, 140], [620, 175], [60, 150],
      [430, 310], [580, 280], [70, 280], [200, 480],
    ];
    for (var i = 0; i < trailPoints.length; i++) {
      var px = trailPoints[i][0];
      var py = trailPoints[i][1];
      // Canvas starts after panel (260px), so absolute page x = 260 + canvas_x
      var pageX = canvasBox.x + px;
      var pageY = canvasBox.y + py;
      await page.mouse.click(pageX, pageY);
      await page.waitForTimeout(300);
      var vis = await page.evaluate(function() {
        return document.getElementById('persona-detail').classList.contains('show');
      });
      if (vis) {
        console.log('  Walker selected at canvas pos', px, py, '-> page pos', Math.round(pageX), Math.round(pageY));
        selected = true;
        break;
      }
    }
    if (!selected) {
      console.log('  No walker found at tried positions');
    }
  }

  // Wait 1 second
  await page.waitForTimeout(1000);

  // Screenshot S3-04
  console.log('Step 13: Taking single-view screenshot...');
  try {
    await takeScreenshot(page, path.join(EVIDENCE_DIR, 'S3-04-single-view.png'));
    console.log('  Saved S3-04-single-view.png');
  } catch(e) {
    console.log('  Screenshot S3-04 FAILED:', e.message.split('\n')[0]);
  }

  // Check persona-detail state
  console.log('Step 14: Checking persona-detail visibility...');
  const pdState = await page.evaluate(function() {
    var el = document.getElementById('persona-detail');
    var title = document.getElementById('pd-title');
    var meta = document.getElementById('pd-meta');
    return {
      hasShow: el ? el.classList.contains('show') : false,
      titleText: title ? title.textContent.trim() : '',
      metaText: meta ? meta.textContent.trim().substring(0, 150) : '',
    };
  });
  console.log('  persona-detail state:', JSON.stringify(pdState, null, 2));

  // Click Export JSON
  console.log('Step 15: Clicking Export JSON button...');
  try {
    await page.click('#btn-export');
    console.log('  Export JSON clicked');
  } catch(e) {
    console.log('  Export click failed:', e.message.split('\n')[0]);
  }
  await page.waitForTimeout(300);

  // Click God View
  console.log('Step 16: Clicking God View button...');
  try {
    await page.click('#btn-godview');
    console.log('  God View clicked');
  } catch(e) {
    console.log('  God View click failed:', e.message.split('\n')[0]);
  }
  await page.waitForTimeout(500);

  // Final screenshot
  console.log('Step 17: Taking godview-return screenshot...');
  try {
    await takeScreenshot(page, path.join(EVIDENCE_DIR, 'S3-05-godview-return.png'));
    console.log('  Saved S3-05-godview-return.png');
  } catch(e) {
    console.log('  Screenshot S3-05 FAILED:', e.message.split('\n')[0]);
  }

  // Final state check
  const finalState = await page.evaluate(function() {
    function get(id) {
      var el = document.getElementById(id);
      return el ? el.textContent.trim() : 'NOT FOUND';
    }
    return {
      walkerCount: get('walker-count'),
      markerCount: get('marker-count'),
      frame: get('frame'),
      simDay: get('sim-day'),
      mTotal: get('m-total'),
      mHealthy: get('m-healthy'),
      viewMode: get('view-mode'),
      personaDetailShow: document.getElementById('persona-detail').classList.contains('show'),
    };
  });
  console.log('\n=== Final DOM State ===');
  console.log(JSON.stringify(finalState, null, 2));

  // Console errors
  console.log('\n=== Console Errors ===');
  if (consoleErrors.length === 0) {
    console.log('  NONE — zero console errors');
  } else {
    consoleErrors.forEach(function(e) { console.log('  ERROR:', e); });
  }

  // All console messages (first 20)
  console.log('\n=== All Console Messages (first 20) ===');
  consoleAll.slice(0, 20).forEach(function(m) { console.log(' ', m); });

  // List saved screenshots
  console.log('\n=== Screenshots Saved ===');
  try {
    var files = fs.readdirSync(EVIDENCE_DIR);
    files.forEach(function(f) {
      var stat = fs.statSync(path.join(EVIDENCE_DIR, f));
      console.log(' ', f, '(' + Math.round(stat.size/1024) + ' KB)');
    });
  } catch(e) {
    console.log('  Error listing files:', e.message);
  }

  await browser.close();
  console.log('\nDONE');
})().catch(function(e) {
  console.error('FATAL:', e.message);
  process.exit(1);
});
