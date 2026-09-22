#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const geojson = JSON.parse(fs.readFileSync(path.join(HERE, 'ALMOST_DONE_PRIVACY_SAFE.geojson'), 'utf8'));
const matching = JSON.parse(fs.readFileSync(path.join(HERE, 'ALMOST_DONE_MATCHING_DIAGNOSTICS.json'), 'utf8'));
const clone = JSON.parse(fs.readFileSync(path.join(HERE, 'ALMOST_DONE_CLONE_V1_PROVENANCE.json'), 'utf8'));
const features = Object.fromEntries(geojson.features.map(feature => [feature.properties.name, feature]));

function shell({ title, kicker, summary, mode, body, script = '' }) {
  const data = JSON.stringify({
    canonical: features.canonical_o46.geometry.coordinates,
    currentCandidate: features.current_production_dry_run.geometry.coordinates,
    hybrid: features.experimental_conservative_hybrid.geometry.coordinates,
    clone: features.almost_done_clone_v1.geometry.coordinates,
  });
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
:root{--ink:#17231d;--muted:#68736d;--line:#dfe5e1;--paper:#f6f8f6;--card:#fff;--green:#176b45;--green2:#70a786;--amber:#bd7b25;--red:#a94235;--blue:#3d668f}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:14px/1.45 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.page{max-width:1120px;margin:auto;padding:24px}.kicker{font-size:11px;font-weight:800;letter-spacing:.14em;color:var(--green);text-transform:uppercase}.title{margin:5px 0 8px;font-size:clamp(24px,5vw,42px);line-height:1.05}.summary{max-width:780px;color:var(--muted);margin:0 0 18px}.grid{display:grid;grid-template-columns:minmax(0,1fr) 290px;gap:16px}.card{background:var(--card);border:1px solid var(--line);border-radius:18px;box-shadow:0 8px 30px rgba(23,35,29,.06)}.map{position:relative;min-height:620px;overflow:hidden;background:linear-gradient(135deg,#f8faf8,#eef3ef)}svg{display:block;width:100%;height:620px}.panel{padding:18px}.panel h2{font-size:14px;margin:0 0 12px}.metric{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #edf0ee}.metric:last-child{border:0}.metric span{color:var(--muted)}.metric b{font-variant-numeric:tabular-nums}.legend{display:grid;gap:9px;margin-top:14px}.legend label{display:flex;align-items:center;gap:8px;color:var(--muted)}.swatch{width:28px;height:4px;border-radius:3px}.notice{padding:12px;border-radius:12px;background:#f0f5f1;color:#365344;margin-top:14px}.notice.warn{background:#fff5e7;color:#78501c}.controls{position:absolute;left:14px;right:14px;bottom:14px;padding:10px 12px;background:rgba(255,255,255,.94);border:1px solid var(--line);border-radius:14px;display:flex;gap:10px;align-items:center}.controls input{flex:1}.pill{border:1px solid var(--line);background:#fff;border-radius:999px;padding:6px 9px;font-size:11px;font-weight:700}.foot{margin-top:14px;color:var(--muted);font-size:12px}.route{fill:none;stroke-linecap:round;stroke-linejoin:round}.point{stroke:#fff;stroke-width:2}.gridline{stroke:#dfe8e1;stroke-width:1}.label{font-size:12px;font-weight:800;paint-order:stroke;stroke:#fff;stroke-width:4px;stroke-linejoin:round}.raw-disabled{opacity:.55;text-decoration:line-through}@media(max-width:760px){.page{padding:12px}.grid{grid-template-columns:1fr}.map,svg{min-height:510px;height:510px}.panel{padding:15px}.title{font-size:28px}}
</style></head><body><main class="page"><div class="kicker">${kicker}</div><h1 class="title">${title}</h1><p class="summary">${summary}</p><div class="grid"><section class="card map"><svg id="plot" role="img" aria-label="Privacy-translated Activity geometry"></svg>${mode === 'repeat' ? '<div class="controls"><span class="pill" id="clock">00:00</span><input id="scrub" type="range" min="1" value="1"><button class="pill" id="play">Play</button></div>' : ''}</section>${body}</div><p class="foot">All geometry is translated to a fixed review origin. Scale, shape, order, timestamps, turns, and overlap are preserved; the real location is not retained in this file.</p></main><script>const DATA=${data};${baseScript(mode)}${script}</script></body></html>`;
}

function baseScript(mode) {
  return `
const svg=document.getElementById('plot'),NS='http://www.w3.org/2000/svg';
const all=[...DATA.canonical,...DATA.currentCandidate,...DATA.clone];
const xs=all.map(p=>p[0]),ys=all.map(p=>p[1]);let minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);const padX=(maxX-minX)*.16||.001,padY=(maxY-minY)*.16||.001;minX-=padX;maxX+=padX;minY-=padY;maxY+=padY;
const W=900,H=620,project=p=>[38+(p[0]-minX)/(maxX-minX)*(W-76),38+(maxY-p[1])/(maxY-minY)*(H-76)];svg.setAttribute('viewBox','0 0 '+W+' '+H);
function el(tag,attrs={}){const n=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);svg.appendChild(n);return n}
for(let i=1;i<6;i++){el('line',{x1:i*W/6,y1:0,x2:i*W/6,y2:H,class:'gridline'});el('line',{x1:0,y1:i*H/6,x2:W,y2:i*H/6,class:'gridline'})}
const d=pts=>pts.map((p,i)=>{const [x,y]=project(p);return(i?'L':'M')+x.toFixed(1)+' '+y.toFixed(1)}).join(' ');
function route(pts,color,width,dash='',opacity=1,id=''){return el('path',{d:d(pts),stroke:color,'stroke-width':width,'stroke-dasharray':dash,opacity,class:'route',id})}
function marker(p,color,label){const [x,y]=project(p);el('circle',{cx:x,cy:y,r:7,fill:color,class:'point'});const t=el('text',{x:x+10,y:y-10,fill:color,class:'label'});t.textContent=label}
` + (mode === 'current' ? `
route(DATA.canonical,'#17231d',9,'',.16);route(DATA.canonical,'#176b45',5);route(DATA.currentCandidate,'#bd7b25',3,'7 6',.9);marker(DATA.canonical[0],'#176b45','START');marker(DATA.canonical.at(-1),'#a94235','END');marker(DATA.canonical[107],'#3d668f','U-TURN');
` : mode === 'hybrid' ? `
route(DATA.canonical,'#17231d',8,'',.16);route(DATA.clone,'#176b45',5);marker(DATA.clone[0],'#176b45','START');marker(DATA.clone.at(-1),'#a94235','END');const u=DATA.clone.findIndex((_,i)=>i>90&&i<120);marker(DATA.clone[102]||DATA.clone[u],'#3d668f','U-TURN');
` : `
const pts=DATA.clone;document.getElementById('scrub').max=pts.length;document.getElementById('scrub').value=pts.length;let timer=null;function paint(n){svg.querySelectorAll('.temporal').forEach(x=>x.remove());for(let i=1;i<n;i++){const hue=145+(i/(pts.length-1))*85;const a=project(pts[i-1]),b=project(pts[i]);const line=el('line',{x1:a[0],y1:a[1],x2:b[0],y2:b[1],stroke:'hsl('+hue+' 48% 40%)','stroke-width':6,'stroke-linecap':'round',class:'temporal'});svg.insertBefore(line,svg.querySelector('.point'))}document.getElementById('clock').textContent=Math.floor((n/pts.length)*403/60).toString().padStart(2,'0')+':'+Math.floor((n/pts.length)*403%60).toString().padStart(2,'0')}marker(pts[0],'#176b45','START');marker(pts.at(-1),'#a94235','END');marker(pts[102],'#3d668f','U-TURN');paint(pts.length);const scrub=document.getElementById('scrub');scrub.oninput=()=>paint(+scrub.value);document.getElementById('play').onclick=()=>{if(timer){clearInterval(timer);timer=null;return}scrub.value=1;timer=setInterval(()=>{scrub.value=Math.min(pts.length,+scrub.value+2);paint(+scrub.value);if(+scrub.value===pts.length){clearInterval(timer);timer=null}},45)};
`);
}

const original = matching.originalSave.recordedMatch;
const currentHtml = shell({
  title: 'Current production match preview',
  kicker: 'almost done · production dry-run',
  summary: 'The original Save and the repeated dry-run both reached Mapbox, but every chunk fell back. The amber line is the matcher pipeline’s fallback/smoothing candidate; green is the geometry actually saved for Detail.',
  mode: 'current',
  body: `<aside class="card panel"><h2>Result</h2><div class="metric"><span>Input</span><b>${original.pointCount} canonical</b></div><div class="metric"><span>Requests</span><b>${original.requestCount}</b></div><div class="metric"><span>Accepted chunks</span><b>0</b></div><div class="metric"><span>Partial tracepoints</span><b>13 / 160</b></div><div class="metric"><span>Final source</span><b>Canonical</b></div><div class="legend"><label><i class="swatch" style="background:#176b45"></i>Saved final display</label><label><i class="swatch" style="background:#bd7b25"></i>Fallback/smoothing candidate</label><label class="raw-disabled"><i class="swatch" style="background:#68736d"></i>Exact raw coordinates</label></div><div class="notice warn">Raw coordinates are intentionally absent from remote QA telemetry and remained only in the device’s pending payload after HTTP 400. This preview does not invent them.</div></aside>`,
});

const repeatHtml = shell({
  title: 'Repeated traversal preview',
  kicker: 'almost done · chronology inspection',
  summary: 'Color advances with time, and the scrubber reveals the route in order. Three visits to the same internal corridor remain three ordered passes even where their pixels overlap.',
  mode: 'repeat',
  body: `<aside class="card panel"><h2>Topology contract</h2><div class="metric"><span>Repeated corridor passes</span><b>${clone.geometry.repeatedInternalCorridor.passCountAfter}</b></div><div class="metric"><span>Directions</span><b>S · S · N</b></div><div class="metric"><span>U-turn retained</span><b>YES</b></div><div class="metric"><span>Lateral offsets</span><b>NONE</b></div><div class="legend"><label><i class="swatch" style="background:#70a786"></i>Earlier</label><label><i class="swatch" style="background:#3d668f"></i>Later</label></div><div class="notice">Default Detail should stay as one clean stroke. Optional inspection should use time scrub/replay plus arrows and turnaround markers—never displaced coordinates.</div></aside>`,
});

const hybridHtml = shell({
  title: 'Conservative hybrid snap preview',
  kicker: 'almost done clone v1 · review geometry',
  summary: 'No subsection passed sequence, coverage, confidence, endpoint, deviation, and topology gates. Green therefore uses canonical fallback after removing proven stationary-only traversal and applying a maximum 1.5 m collinear presentation refinement.',
  mode: 'hybrid',
  body: `<aside class="card panel"><h2>Clone v1</h2><div class="metric"><span>Matched subsections</span><b>0</b></div><div class="metric"><span>Fallback windows</span><b>${matching.conservativeHybrid.fallbackWindowCount}</b></div><div class="metric"><span>Stationary vertices removed</span><b>${clone.pipeline.stationaryTraversalRemovedRawOrdinals.length}</b></div><div class="metric"><span>Bounded refinements</span><b>${clone.pipeline.boundedSmoothing.changedPointCount}</b></div><div class="metric"><span>Geometry length</span><b>${clone.geometry.displayLengthM.toFixed(1)} m</b></div><div class="legend"><label><i class="swatch" style="background:#176b45"></i>Clone v1 display</label><label><i class="swatch" style="background:#17231d;opacity:.25"></i>Original canonical</label></div><div class="notice warn">Sparse network tracepoints were rejected. Enlarging radii would risk stealing the internal path onto a nearby external road.</div></aside>`,
});

fs.writeFileSync(path.join(HERE, 'ALMOST_DONE_CURRENT_MATCH_PREVIEW.html'), currentHtml);
fs.writeFileSync(path.join(HERE, 'ALMOST_DONE_REPEAT_TRAVERSAL_PREVIEW.html'), repeatHtml);
fs.writeFileSync(path.join(HERE, 'ALMOST_DONE_HYBRID_SNAP_PREVIEW.html'), hybridHtml);
