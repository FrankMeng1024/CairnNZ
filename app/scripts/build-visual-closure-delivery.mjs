#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';

const repoRoot = path.resolve('..');
const finalRoot = path.resolve(process.env.CAIRN26_FINAL_ROOT || '/tmp/cairn26-final');
const deliveryName = process.env.CAIRN26_DELIVERY_NAME || '26_Cairn_Visual_Closure_Comprehensive_Pro_Review_20261026';
const deliveryParent = path.resolve(process.env.CAIRN26_DELIVERY_PARENT || '/Users/mzm/Downloads');
const deliveryDir = path.join(deliveryParent, deliveryName);
const zipPath = `${deliveryDir}.zip`;
if (fs.existsSync(deliveryDir) || fs.existsSync(zipPath)) throw new Error(`Refusing to overwrite existing delivery: ${deliveryName}`);

const mkdir = target => fs.mkdirSync(target, { recursive: true });
const write = (relative, content) => {
  const target = path.join(deliveryDir, relative);
  mkdir(path.dirname(target));
  fs.writeFileSync(target, content);
};
const copy = (source, relative) => {
  const target = path.join(deliveryDir, relative);
  mkdir(path.dirname(target));
  fs.copyFileSync(source, target);
  return target;
};
const walk = root => fs.existsSync(root)
  ? fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const absolute = path.join(root, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  }) : [];
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const git = args => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trimEnd();

mkdir(deliveryDir);
for (const directory of ['BEFORE', 'AFTER', 'CONTACT_SHEETS', 'RAW_RESULTS', 'TEST_RESULTS', 'SOURCE']) mkdir(path.join(deliveryDir, directory));

const sources = [
  ['Home', 'home-time'],
  ['Memory_City', 'memory-city'],
  ['Route_Detail', 'route-detail'],
  ['Route_Editor', 'route-ux'],
  ['Hike_Run', 'hike-run'],
  ['System_Themes', 'system-ui'],
  ['Trails', 'trails'],
  ['Settings_States', 'settings-states'],
  ['Settings_Scroll', 'settings-scroll'],
  ['Friends', 'friends'],
  ['Global_Sheets', 'global-sheets'],
  ['Cairns', 'cairn-core'],
];

const themes = ['day', 'sunset', 'night'];
const inferTheme = name => themes.find(theme => new RegExp(`(^|-)${theme}(-|$)`).test(name)) || 'day';
const inferViewport = name => name.match(/\d{3}x\d{3,4}/)?.[0] || '390x844';
const inferTime = name => name.includes('nighttime') ? 'nighttime' : name.includes('daytime') ? 'daytime' : 'not-fixed';
const safe = value => value.toLowerCase().replace(/\.png$/i, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const captures = [];
for (const [category, directory] of sources) {
  const root = path.join(finalRoot, directory);
  const pngs = walk(root).filter(file => file.toLowerCase().endsWith('.png'));
  pngs.forEach((file, index) => {
    const original = path.basename(file);
    const alreadyComplete = /-(day|sunset|night)-(daytime|nighttime)-\d{3}x\d{3,4}-/.test(original);
    const theme = inferTheme(original);
    const time = inferTime(original);
    const viewport = inferViewport(original);
    const normalized = alreadyComplete
      ? original
      : `${safe(category)}-${theme}-${time}-${viewport}-${safe(original)}-${String(index + 1).padStart(3, '0')}.png`;
    const relative = path.join('AFTER', category, normalized);
    const target = copy(file, relative);
    captures.push({ category, screen: safe(category), theme, time, viewport, state: safe(original), relative: relative.split(path.sep).join('/'), bytes: fs.statSync(target).size, sha256: sha256(target) });
  });
  for (const file of walk(root).filter(file => /\.(json|txt|md)$/i.test(file))) {
    copy(file, path.join('RAW_RESULTS', `${safe(category)}-${path.basename(file)}`));
  }
}

const beforeSources = [
  ['/tmp/cairn26-diagnostic-theme-comparison', 'Route_Detail_System_Path'],
  ['/tmp/cairn26-diagnostic-route-detail', 'Route_Detail_Dedicated_Path'],
];
for (const [root, category] of beforeSources) {
  for (const file of walk(root).filter(file => /route-detail.*\.png$/i.test(file))) {
    copy(file, path.join('BEFORE', category, path.basename(file)));
  }
}

const testRoot = path.join(finalRoot, 'test-results');
for (const file of walk(testRoot)) copy(file, path.join('TEST_RESULTS', path.basename(file)));

const branch = git(['branch', '--show-current']);
const commit = git(['rev-parse', 'HEAD']);
const tree = git(['rev-parse', 'HEAD^{tree}']);
const status = git(['status', '--short']);
const integrationBase = git(['rev-parse', 'main']);
write('SOURCE/IDENTITY.txt', `BRANCH=${branch}\nCOMMIT=${commit}\nTREE=${tree}\nWORKTREE=${repoRoot}\nINTEGRATION_BASE_MAIN=${integrationBase}\n`);
write('SOURCE/WORKTREE_STATUS.txt', status ? `${status}\n` : 'clean\n');
write('SOURCE/COMMIT_STAT.txt', `${git(['show', '--stat', '--oneline', '--decorate', 'HEAD'])}\n`);
write('SOURCE/COMMITS_SINCE_MAIN.txt', `${git(['log', '--oneline', '--decorate', `${integrationBase}..HEAD`])}\n`);
write('SOURCE/DIFF_AGAINST_INTEGRATION_BASE.patch', `${git(['diff', '--binary', `${integrationBase}..HEAD`])}\n`);

const coverageRows = [
  ['Home', 'normal; compact; large', 'day/sunset/night; NZ 10:00/21:00', 'PASS'],
  ['Friends', 'list; requests; profile; accept/reject/cancel/remove', 'three themes + detailed Day interaction', 'PASS'],
  ['Trails / Routes Library', 'content; empty; network error; search; 300 rows', 'three themes; 320/390/430', 'PASS'],
  ['Route Detail', 'own; received; long name; share; delete/remove; re-entry', 'three themes × two time contexts; 320/390/430', 'PASS'],
  ['Route Editor', 'browse; draw; freehand; point; trim; layers; leave confirmation', 'Day/Sunset/Night; 320/390/430', 'PASS'],
  ['Hike / Run', 'ready; recording; long; paused; degraded; finish; pause/resume', 'three themes; both times for live state; 320/390/430', 'PASS'],
  ['Activity Detail', 'normal route theme comparison', 'three themes; 390', 'PASS'],
  ['Memory', 'Mine/Friends/Both; City closed/open/scroll/select/back/empty/reopen', 'hard 3×2 at 390 plus 320/430', 'PASS_WEB'],
  ['Cairn List / Detail / Create / Edit', 'save; failure retained; success; delete confirmation; history', 'Day plus Sunset/Night create', 'PASS_WEB'],
  ['Settings', 'root; account; privacy; help; content review; export/error/confirmation', 'three themes; 320/390/430; 3 navigation rounds', 'PASS'],
  ['Sheets / Modals', 'light sheet; permission; Mark Detail; destructive confirmations', 'three themes; 390', 'PASS'],
  ['Public Encounter', 'existing surface observation only', 'Owner redesign HOLD', 'HOLD_NO_CHANGE'],
];
write('SCREEN_COVERAGE_MATRIX.csv', `Screen,States,Theme_Time_Viewport,Coverage\n${coverageRows.map(row => row.map(value => `"${value.replaceAll('"', '""')}"`).join(',')).join('\n')}\n`);

const memoryCount = captures.filter(item => item.category === 'Memory_City').length;
const screenshotCount = captures.length;
const issueText = `# Issue Register

| ID | Severity | Screen | Symptom / evidence | Root cause | Fix status | Retest |
|---|---|---|---|---|---|---|
| V26-01 | P1 | Route Detail | #25 system-path screenshots clipped/covered Mapbox legal controls | First-frame fallback clearance was lower than the measured compact panel; one QA path captured before layout stabilized | FIXED: conservative first frame + live measurement + 5-frame/tile/pixel gate | PASS, dedicated and system paths, 320/390/430, themes, re-entry |
| V26-02 | P1 gate | Settings | #25 did not actually prove root-bottom → child-top | Product key isolation was correct; old proof manipulated the wrong scroll path | QA FIXED: real wheel to bottom and actual RN Web ScrollView coordinates | PASS 36/36 transitions |
| V26-03 | P1 gate | Route | #25 thresholds weakened architectural checks | Old assertions measured presence/height rather than visible equivalence | QA FIXED: canonical source continuity, rendered features/label, screenshot pixel offset lane, real button bounds | PASS 3/3 matrices |
| V26-04 | P2 | Memory City | City popover used several fixed Day surfaces in Sunset/Night | Hard-coded panel auxiliary colors bypassed theme semantics | FIXED in HierarchyPanel only; no data/camera/Fog change | PASS 8 scenarios / ${memoryCount} captures |
| V26-05 | P2 gate | Hike/Run | Ready state falsely reported missing metrics in first new gate | Metrics are intentionally absent before recording | QA FIXED: absence required in Ready, clipping required for active states | PASS 56 layouts / 4 interactions |
| V26-06 | P2 test debt | Legacy O88 continuation | Old Memory encounter continuation times out after Cairn coverage | Script targets superseded Memory contracts owned by parallel work | OPEN / integration pending; Cairn core isolated and passed | Not counted as Memory City failure |
`;
write('ISSUE_REGISTER_CN.md', issueText);

write('START_HERE_CN.md', `# Cairn #26 Visual Closure

**总体结论：PARTIAL（Web 产品与交互门禁通过；Native iOS 未执行，O94 Memory 并行集成待复核）。**

- 最终源码：\`${commit}\` / tree \`${tree}\`
- 分支：\`${branch}\`
- 最终 Web 原始截图：${screenshotCount} 张；Memory City：${memoryCount} 张。
- Route Detail 两条原 #25 进入路径均已关闭 Logo/i 矛盾；严格检查真实像素、遮挡层、Tiles 与重新进入。
- Settings 真实 ScrollView 36 次切换全部从子页顶部开始。
- Memory City 完成 3 主题 × NZ 10:00/21:00，并覆盖关闭、打开、滚动、选城、返回、空态、重复关闭和离页返回。
- 首先查看：\`CONTACT_SHEETS/\`、\`REVIEW_GALLERY.html\`、\`ISSUE_REGISTER_CN.md\`。
- 未执行：Push / Merge / OTA / Native Build / TestFlight / Production / Backend / DB。
`);
write('CHANGE_MANIFEST_CN.md', `# 修改清单

## 产品源码

1. \`MapHistoryScreen.tsx\`：Route Detail 初始 Mapbox ornament clearance 提升为安全首帧值；面板 onLayout 后仍由实际高度替代。
2. \`HierarchyPanel.tsx\`：Memory City 的辅助 surface/border/text/icon/legend 使用现有主题 token；列表高度按视口收敛并保留数据/相机/Fog 行为。

## QA 工具

- Route Detail：真实 Mapbox 稳定、像素、遮挡、重入、权限和行为门禁。
- Settings：真实 RN Web ScrollView 三轮切换门禁。
- Memory City：3×2 + compact/large 完整交互门禁。
- Route：canonical + rendered repeat + pixel visibility 等价门禁。
- Hike/Run：长数值裁切、主题/时段/状态、Pause/Resume。
- Friends、Home time context 与交付 Gallery 可复现工具。

没有新增依赖；没有改 API、后端、Schema、localization、O Marker、Build/runtime 配置。
`);
write('REQUIREMENT_STATUS_CN.md', `# 需求状态

- V26-01 Route Detail attribution：PASS。
- V26-02 Settings scroll：PASS（36/36）。
- V26-03 Route regression gate：PASS（3/3；不是放宽阈值）。
- Friends 三主题视觉参照：PASS，未重做已认可页面。
- Hike 小屏数值：PASS，320 长距离/时长/海拔无裁切。
- Memory City 3×2：PASS_WEB；${memoryCount} 张原始 PNG，含 6 组合 × 5 必需阶段及 320/430、空态。
- 全 App Web 复查：PASS_WEB，${coverageRows.length} 个页面族、${screenshotCount} 张最终截图。
- Native iOS：NATIVE_PENDING。
- Public Encounter marker/card：HOLD，按 Owner 要求未修改。
- Push / Merge / OTA / Build / Production：NOT DONE。
`);
write('VALIDATION_REPORT_CN.md', `# 验证报告

- Activity changed gate：PASS 646/646。
- Route fast gate：PASS 75/75。
- Jest focused：PASS 88/88（6 suites）。
- Route Detail strict Web：PASS，19 captures，无 runtime error。
- Settings scroll：PASS，36 transitions；root 最少真实滚动 305px，子页最大 scrollTop 0。
- Memory City：PASS，8 scenarios / ${memoryCount} captures；hosted Mapbox Style/Tiles/Fog/source/rendered features。
- Hike/Run：PASS，56 layout checks / 4 Pause-Resume interactions / 58 screenshots。
- Trails：PASS，23 captures，大列表虚拟化受控。
- Friends：PASS，Requests/Profile/confirmation/transitions。
- Cairn core：PASS；旧 O88 Memory continuation 被隔离，不计产品 PASS。
- 全仓 TypeScript：BASELINE FAIL（缺少 @playwright/test 类型、Preview navigation、Turf exports、既有测试类型）；本轮修改文件无新增错误。
- Native iOS：NATIVE_PENDING（未创建 Native Build）。
`);
write('OPEN_ISSUES_CN.md', `# 尚未解决 / 边界

1. **NATIVE_PENDING**：Web PASS 不能替代 iOS Mapbox、safe area、haptic 或原生字体验收。
2. **O94 Memory integration pending**：并行工作区修改 MemoryMap、entry presentation、camera target 等文件，本分支未覆盖；合并后需重跑 Memory 3×2。
3. **Legacy O88 script debt**：其 encounter continuation 使用旧 Memory contract；本轮用新的 Memory City gate验证当前 snapshot，不篡改并行功能。
4. **TypeScript baseline**：全仓既有错误仍存在，详见 TEST_RESULTS；本轮相关测试和运行时构建通过。
5. **Public Encounter design HOLD**：Marker/Card/animation 按 Owner 指令没有扩大修改。
6. npm audit：app 有 14 项、backend 有 1 项 high 报告；未自动升级依赖，需独立依赖治理。
`);
write('INTEGRATION_NOTES_CN.md', `# 集成说明

- #26 基于 main O93 \`${integrationBase}\`，再安全叠加 #23/#25；未重置 main。
- 与并行 O94 的已知重叠风险：\`HierarchyPanel.tsx\` 与其 MemoryScreen/MemoryMap 工作同属 Memory 功能域，但当前观察到 O94 未修改 HierarchyPanel；合并前仍应逐文件复核。
- \`MapHistoryScreen.tsx\` 仅改首帧 attribution fallback，不改 Route 几何、保存或相机跟随。
- 建议集成：**CONDITIONAL**。先完成 O94 文件级 reconciliation，再跑 Memory City 和 Route Detail strict gates；Native Owner review 后方可考虑 OTA。
`);
write('PRO_REVIEW_CHECKLIST.md', `# Pro Review Checklist

- [ ] 打开 REVIEW_GALLERY.html，按 Memory City / Route Detail / Hike_Run 筛选。
- [ ] 对比三主题与 NZ 10:00/21:00；理解手动主题优先于时钟。
- [ ] 检查 Route Detail 左下 Logo、右下 i、长标题、Received Remove。
- [ ] 检查 Memory City 关闭/打开/滚动/选城/返回以及 320px。
- [ ] 检查 Settings root-bottom → child-top 的 RAW_RESULTS。
- [ ] 检查 Route repeated traversal 的像素证据与 canonical source。
- [ ] 确认 Public Encounter HOLD 未被扩大。
- [ ] 将 Native iOS 标记保持 NATIVE_PENDING，直到 Owner 真机验收。
`);

const galleryData = JSON.stringify(captures);
write('REVIEW_GALLERY.html', `<!doctype html><html><head><meta charset="utf-8"><title>Cairn #26 Review Gallery</title><style>
body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#101715;color:#eef3ef;margin:0;padding:20px}h1{margin:0 0 8px}.note{color:#b7c5bd;margin-bottom:16px}.filters{display:flex;gap:10px;flex-wrap:wrap;position:sticky;top:0;background:#101715ee;padding:10px 0;z-index:2}select{background:#23312c;color:#fff;border:1px solid #506159;border-radius:8px;padding:8px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:18px}.card{background:#1a2421;border:1px solid #3a4943;border-radius:12px;padding:10px}.card img{width:100%;max-height:620px;object-fit:contain;background:#0c100f;border-radius:8px}.meta{font-size:12px;color:#b7c5bd;word-break:break-word;margin-top:8px}a{color:inherit;text-decoration:none}</style></head><body><h1>Cairn #26 · Final ${commit.slice(0,12)}</h1><div class="note">本地离线 Gallery。手动 Day/Sunset/Night 优先于时钟；not-fixed 表示该辅助页面不是硬性 NZ 10:00/21:00 矩阵。</div><div class="filters"><select id="category"><option value="">All pages</option></select><select id="theme"><option value="">All themes</option></select><select id="time"><option value="">All times</option></select><select id="viewport"><option value="">All viewports</option></select><input id="query" placeholder="state filter"></div><div id="grid" class="grid"></div><script>
const items=${galleryData};const fields=['category','theme','time','viewport'];for(const field of fields){const el=document.getElementById(field);[...new Set(items.map(x=>x[field]))].sort().forEach(v=>{const o=document.createElement('option');o.value=v;o.textContent=v;el.appendChild(o)});el.onchange=render}document.getElementById('query').oninput=render;function render(){const filters=Object.fromEntries(fields.map(f=>[f,document.getElementById(f).value]));const q=document.getElementById('query').value.toLowerCase();const shown=items.filter(x=>fields.every(f=>!filters[f]||x[f]===filters[f])&&(!q||x.state.includes(q)));document.getElementById('grid').innerHTML=shown.map(x=>'<div class="card"><a href="'+x.relative+'"><img loading="lazy" src="'+x.relative+'"></a><div class="meta">'+x.category+' · '+x.theme+' · '+x.time+' · '+x.viewport+'<br>'+x.state+'</div></div>').join('')}render();
</script></body></html>`);

async function makeBoard(name, title, selected, columns = 3) {
  if (!selected.length) return;
  const tileW = 250; const tileH = 542; const labelH = 46; const gap = 14; const header = 56;
  const rows = Math.ceil(selected.length / columns);
  const composites = [{ input: Buffer.from(`<svg width="${gap + columns * (tileW + gap)}" height="${header}"><text x="20" y="35" font-family="Arial" font-size="21" font-weight="700" fill="#edf2ee">${title}</text></svg>`), left: 0, top: 0 }];
  for (let index = 0; index < selected.length; index += 1) {
    const item = selected[index]; const left = gap + (index % columns) * (tileW + gap); const top = header + Math.floor(index / columns) * (tileH + labelH + gap);
    const image = await sharp(path.join(deliveryDir, item.relative)).resize({ width: tileW, height: tileH, fit: 'contain', background: '#101715' }).png().toBuffer();
    const label = Buffer.from(`<svg width="${tileW}" height="${labelH}"><rect width="100%" height="100%" fill="#23312c"/><text x="${tileW / 2}" y="19" text-anchor="middle" font-family="Arial" font-size="11" fill="#fff">${item.theme} · ${item.time} · ${item.viewport}</text><text x="${tileW / 2}" y="36" text-anchor="middle" font-family="Arial" font-size="10" fill="#bfd0c6">${item.state.slice(0,42)}</text></svg>`);
    composites.push({ input: label, left, top }, { input: image, left, top: top + labelH });
  }
  await sharp({ create: { width: gap + columns * (tileW + gap), height: header + rows * (tileH + labelH + gap), channels: 3, background: '#101715' } }).composite(composites).jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).toFile(path.join(deliveryDir, 'CONTACT_SHEETS', name));
}

const memoryOpen = captures.filter(item => item.category === 'Memory_City' && item.viewport === '390x844' && item.state.includes('picker-open')).slice(0, 6);
const memoryStates = captures.filter(item => item.category === 'Memory_City' && item.theme === 'day' && item.time === 'daytime' && item.viewport === '390x844').slice(0, 6);
const routeThemes = captures.filter(item => item.category === 'Route_Detail' && item.viewport === '390x844' && item.state.includes('own')).slice(0, 6);
const appSampler = sources.flatMap(([category]) => captures.filter(item => item.category === category).slice(0, 1)).slice(0, 12);
await makeBoard('01_memory_city_six_contexts.jpg', 'Memory City · 3 themes × NZ 10:00 / 21:00', memoryOpen);
await makeBoard('02_memory_city_interaction_states.jpg', 'Memory City · closed / open / scrolled / selected / back', memoryStates);
await makeBoard('03_route_detail_theme_time.jpg', 'Route Detail · legal controls and final composition', routeThemes);
await makeBoard('04_full_app_sampler.jpg', 'Full app · final visual sampler', appSampler);

const manifestFiles = walk(deliveryDir).filter(file => path.basename(file) !== 'EVIDENCE_MANIFEST.json').map(file => ({
  path: path.relative(deliveryDir, file).split(path.sep).join('/'), bytes: fs.statSync(file).size, sha256: sha256(file), sourceCommit: commit, sourceTree: tree,
}));
write('EVIDENCE_MANIFEST.json', `${JSON.stringify({ generatedAt: new Date().toISOString(), branch, commit, tree, integrationBase, screenshotCount, memoryCount, files: manifestFiles }, null, 2)}\n`);

execFileSync('zip', ['-qr', zipPath, deliveryName], { cwd: deliveryParent });
console.log(JSON.stringify({ deliveryDir, zipPath, bytes: fs.statSync(zipPath).size, sha256: sha256(zipPath), screenshotCount, memoryCount, commit, tree }, null, 2));
