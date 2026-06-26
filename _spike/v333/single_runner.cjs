const { chromium } = require('C:/Users/I585134/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright');
const fs = require('fs');

const bbox = JSON.parse(fs.readFileSync('demo_bbox.json', 'utf8'));
const pngs = {
  'A_corridor': fs.readFileSync('demo_A_corridor.png'),
  'B_blob': fs.readFileSync('demo_B_blob.png'),
  'C_combo': fs.readFileSync('demo_C_combo.png'),
};

const html = (label, png) => `<!doctype html>
<html><head>
<script src="https://api.mapbox.com/mapbox-gl-js/v3.7.0/mapbox-gl.js"></script>
<link href="https://api.mapbox.com/mapbox-gl-js/v3.7.0/mapbox-gl.css" rel="stylesheet" />
<style>
  body{margin:0;font-family:-apple-system,sans-serif;background:#1a1a1a;color:#eee;}
  #h{padding:10px;background:#222;font-size:16px;}
  #map{position:fixed;top:50px;bottom:0;left:0;right:0;}
</style>
</head><body>
<div id="h"><b>Cairn v333:</b> ${label}</div>
<div id="map"></div>
<script>
mapboxgl.accessToken='pk.eyJ1IjoiNzRqdHgiLCJhIjoiY21wOWQ3d3g0MG9zYTMzcHhraDQ2N3hiYyJ9.ICN7x0SsiUafGaN09Boy8w';
const vp=${JSON.stringify(bbox)};
const map=new mapboxgl.Map({container:'map',style:'mapbox://styles/mapbox/outdoors-v12',center:vp.center,zoom:13});
window.map=map;
map.on('load',()=>{
  map.addSource('fog',{type:'image',url:'./${png}',coordinates:vp.corners});
  map.addLayer({id:'fog',type:'raster',source:'fog',paint:{'raster-opacity':1,'raster-fade-duration':0}});
});
</script>
</body></html>`;

(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:/Users/I585134/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe',
    headless: true,
  });
  const ctx = await browser.newContext({ viewport: { width: 900, height: 1200 } });

  for (const [name, png] of Object.entries(pngs)) {
    const htmlPath = `single_${name}.html`;
    fs.writeFileSync(htmlPath, html(name.replace('_', ' '), `demo_${name}.png`));
    await ctx.route(`**/demo_${name}.png`, r => r.fulfill({ status: 200, contentType: 'image/png', body: png }));
    const page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error') console.error(name, m.text()); });
    await page.goto(`file:///C:/ClaudeCodeProjects/Cairn/_spike/v333/${htmlPath}`);
    await page.waitForFunction(() => window.map && window.map.isStyleLoaded && window.map.isStyleLoaded(), { timeout: 30000 });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `demo_single_${name}.png`, fullPage: false });
    console.log('saved demo_single_' + name + '.png');
    await page.close();
  }
  await browser.close();
})();
