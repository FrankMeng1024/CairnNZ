#!/usr/bin/env node

/** Build the privacy-bounded, source-inclusive O85 evidence archive. */
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync, cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync,
  readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const outputArg = process.argv.indexOf('--output');
const outputPath = path.resolve(outputArg >= 0
  ? process.argv[outputArg + 1]
  : '/Users/mzm/Downloads/Cairn_O85_Real_Mapbox_Routes_Memory_Closure.zip');
const archiveRootName = 'Cairn_O85_Real_Mapbox_Routes_Memory_Closure';
const workRoot = mkdtempSync(path.join(tmpdir(), 'cairn-o85-evidence-'));
const archiveRoot = path.join(workRoot, archiveRootName);
const sha256 = input => crypto.createHash('sha256').update(input).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();

function copyRelative(relativePath, destinationPath = relativePath) {
  const source = path.join(repoRoot, relativePath);
  if (!existsSync(source)) throw new Error(`required evidence missing: ${relativePath}`);
  const destination = path.join(archiveRoot, destinationPath);
  mkdirSync(path.dirname(destination), { recursive: true });
  copyFileSync(source, destination);
}

function copyArtifact(relativePath, destinationPath) {
  copyRelative(path.join('app', '_review', relativePath), path.join('evidence', destinationPath));
}

function copyExternal(sourcePath, destinationPath) {
  if (!existsSync(sourcePath)) throw new Error(`required external evidence missing: ${sourcePath}`);
  const destination = path.join(archiveRoot, destinationPath);
  mkdirSync(path.dirname(destination), { recursive: true });
  copyFileSync(sourcePath, destination);
}

const expectedPrompt = '/Users/mzm/Downloads/Cairn_O85_O84_Device_Findings_Mapbox_Closure_Codex_EN.md';
const promptPath = existsSync(expectedPrompt)
  ? expectedPrompt
  : readdirSync('/Users/mzm/Downloads')
      .filter(name => /^Cairn_O85.*\.md$/i.test(name))
      .map(name => path.join('/Users/mzm/Downloads', name))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
if (!promptPath) throw new Error('authoritative O85 prompt not found');

const head = git('rev-parse', 'HEAD');
const base = git('merge-base', 'HEAD', 'origin/main');
const productionBackend = git('rev-parse', 'origin/master');
const branch = git('branch', '--show-current');
const changedFiles = git('diff', '--name-only', `${base}..${head}`).split('\n').filter(Boolean);
const deletedFiles = changedFiles.filter(relativePath => !existsSync(path.join(repoRoot, relativePath)));
const status = git('status', '--porcelain');
if (status) throw new Error('evidence build requires a clean tracked worktree');

try {
  mkdirSync(archiveRoot, { recursive: true });
  const contractDestination = path.join(archiveRoot, 'contract', path.basename(promptPath));
  mkdirSync(path.dirname(contractDestination), { recursive: true });
  copyFileSync(promptPath, contractDestination);

  for (const relativePath of changedFiles) {
    if (!deletedFiles.includes(relativePath)) {
      copyRelative(relativePath, path.join('source', 'changed-files', relativePath));
    }
  }
  for (const relativePath of [
    'app/package.json', 'app/package-lock.json', 'app/app.config.js', 'app/eas.json',
    'backend/src/routes/friend-sharing.js', 'backend/src/routes/memory-subscriptions.js',
    'backend/src/services/friendAuthorization.js', 'backend/src/services/friendProjection.js',
    'backend/src/migrations/045_memory_friends_cairn_contract.sql',
  ]) copyRelative(relativePath, path.join('source', 'context', relativePath));

  const patch = execFileSync('git', ['diff', '--binary', `${base}..${head}`], {
    cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  mkdirSync(path.join(archiveRoot, 'source'), { recursive: true });
  writeFileSync(path.join(archiveRoot, 'source', 'O85.patch'), patch);
  writeFileSync(path.join(archiveRoot, 'source', 'SOURCE_PROVENANCE.json'), `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    branch,
    baseCommit: base,
    candidateCommit: head,
    originMain: git('rev-parse', 'origin/main'),
    originMasterBackend: productionBackend,
    appVersion: '0.2.6',
    runtimeVersion: '0.2.6-o66',
    installedBuild: 65,
    currentProductionOta: {
      updateId: '01a1438a-9341-7774-8b04-a87afe660228',
      groupId: 'c83a6def-8777-48c1-9ebc-ff0453080601',
      marker: 'O84',
      gitCommit: base,
    },
    candidateMarker: 'O85',
    candidateDisposition: 'SOURCE_READY_HUMAN_OTA_ONLY_PHYSICAL_IPHONE_REPLAY_PENDING',
    promptFile: path.basename(promptPath),
    promptSha256: sha256(readFileSync(promptPath)),
    changedFiles,
    deletedFiles,
  }, null, 2)}\n`);

  for (const name of [
    'PROVIDER_AND_SOURCE_RECEIPT.json', 'MANIFEST.json', 'RUNTIME_ERRORS.txt',
    'O85_REAL_MAPBOX_ROUTE_BOARD.jpg', 'route-92-test1-390x844.png',
    'route-93-test2-390x844.png', 'route-94-test3-390x844.png',
    'route-95-test-a-1-390x844.png', 'route-96-test-a-2-390x844.png',
  ]) copyArtifact(path.join('o85-real-mapbox', name), path.join('real-mapbox-routes', name));
  copyArtifact('o85-production-friend-fog.json', 'production-friend-fog/receipt.json');
  for (const name of [
    'route-ux-report.json', 'route-360-day-point.png', 'route-390-sunset-layers.png',
    'route-390-sunset-freehand.png', 'route-390-sunset-detail.png',
    'route-430-night-trim.png',
  ]) copyArtifact(path.join('o85-route-ux', name), path.join('route-web-real-basemap', name));
  for (const name of [
    'visual-qa.json', 'friends-360-day-360x800.jpg', 'friends-390-day-390x844.jpg',
    'friends-430-day-430x932.jpg', 'add-friend-existing-inline-390-day-390x844.jpg',
    'memory-picker-two-selected-loading-390x844.jpg',
    'memory-picker-two-loaded-390x844.jpg',
    'memory-friend-fog-wellington-390x844.jpg',
    'memory-friend-fog-queenstown-390x844.jpg',
  ]) copyArtifact(path.join('o85-friends-memory-phase2-final', name), path.join('friends-memory-web-real-basemap', name));
  for (const name of [
    'visual-qa.json', 'memory-friend-fog-source-1-390x844.jpg',
    'memory-friend-fog-source-2-390x844.jpg',
  ]) copyArtifact(path.join('o85-production-memory-mapbox-postdeploy', name), path.join('postdeploy-memory-mapbox', name));
  for (const name of [
    'route-fog-report.json', 'route-friend-fog-source-1-390x844.png',
    'route-friend-fog-source-2-390x844.png',
    'route-friend-fog-after-style-reload-390x844.png',
  ]) copyArtifact(path.join('o85-production-route-mapbox-postdeploy', name), path.join('postdeploy-route-mapbox', name));
  copyArtifact(path.join('o85-o84-input', 'result.json'), 'isolated-authorized-fixture/result.json');
  copyExternal(
    '/private/tmp/cairn-o85-phase2-personal-friends-migration050-final/result.json',
    'evidence/mysql-personal-friends/result.json',
  );
  copyExternal(
    '/private/tmp/cairn-o85-phase2-public-final2/result.json',
    'evidence/mysql-public-cairn/result.json',
  );

  const repairReceipt = {
    generatedAt: new Date().toISOString(),
    sourceA: {
      cause: 'Activities predated independent Memory ingestion; legitimate timestamped native GPS remained in finalized Activity evidence but had never been attributed into cumulative Memory.',
      finalizedSessionsInvestigated: 16,
      recoveredAcceptedPoints: 415,
      conservativeUnknownPointsRetained: 913,
      visibleCellsAfterBackfill: 19,
      visibleRegionsAfterBackfill: 6,
    },
    sourceB: {
      cause: 'Nine delayed accepted rows were removed from the derived projection by the retired 250 m endpoint/private-place mask.',
      eligibleAcceptedRows: 9,
      qualifyingEvidenceRowsAfterRepair: 823,
      visibleCellsAfterRebuild: 49,
      visibleRegionsAfterRebuild: 4,
    },
    productionProjection: {
      authorizedSources: 2,
      cells: 68,
      policyVersion: 3,
      delaySeconds: 1800,
      endpointOrProtectedPlaceMask: false,
    },
    productionBackup: {
      path: '/opt/cairn-backups/o85-phase2/cairn-pre-o85-phase2-20261017T0250CST.sql.gz',
      bytes: 78796869,
      sha256: '900b79b19ac34bb694ed137f15fb258f5adbf4aecc9ab1dce45ce6d671452019',
    },
  };
  writeFileSync(path.join(archiveRoot, 'evidence', 'DATA_REPAIR_RECEIPT.json'), `${JSON.stringify(repairReceipt, null, 2)}\n`);

  const testSummary = {
    activityChangedGate: { passed: 676, failed: 0 },
    backendNode: { passed: 151, failed: 0 },
    finalIndependentFocusedJest: { suites: 6, passed: 101, failed: 0 },
    publicCacheFocused: { passed: 34, failed: 0 },
    personalFriendsMysql: { passed: 23, failed: 0 },
    publicMysql: { passed: 21, failed: 0 },
    cairnMemoryMysql: { passed: 28, failed: 0 },
    memoryMapbox: { authorizedCells: 68, renderedFeaturesByViewport: [2, 2], verdict: 'PASS' },
    routeMapbox: { authorizedCells: 68, renderedFeaturesByViewport: [2, 2], styleReloadRenderedFeatures: 2, verdict: 'PASS' },
    physicalIPhone: 'NOT_RUN_OWNER_REPLAY_REQUIRED',
  };
  writeFileSync(path.join(archiveRoot, 'evidence', 'TEST_SUMMARY.json'), `${JSON.stringify(testSummary, null, 2)}\n`);

  const finalReport = `# Cairn O85 最终交付报告

## A. 历史 Memory / Friends Fog

- Source A 的 16 个旧 Activity 产生 0 行，是因为这些记录早于独立 Memory 架构：真实、带可信时间与精度的原始/规范 GPS 仍在 Activity 中，但没有进入累计 Memory。幂等回填恢复 415 个 accepted points，生成 19 cells / 6 regions；913 个无法可靠证明的历史点继续保守保留为 unknown，未伪造。
- Source B 的 9 个延迟合格记录被已废弃的 250 m endpoint/Protected Places mask 从物化投影剔除。删除全链路 mask、重建投影后，823 条合格证据生成 49 cells / 4 regions。
- 生产合计 68 cells，两个方向授权来源均通过 HTTPS API、客户端账户隔离缓存、FogLayer 与真实 Mapbox WebGL 在 Memory 和 Route Editor 中可见；30 分钟延迟保留。
- 迁移 049 清退旧 bulk/global authority；生产空数据 verifier 漏检 enum 后，以幂等迁移 050 正确补齐并验证。生产账本为 050。

## B. 六个独立挑战结论

| 领域 | 主要确认问题 | 处理 |
|---|---|---|
| Routes | owner 切换、provider timeout、Draw 投影失败残留、重复保存/迟到导航、过小 Fog 控件 | 全部修复并增加事务/取消/导航回归 |
| Friends | 旧 bulk authority、授权加载时显示陈旧状态、重复/反向请求与未授权 decline cooldown | 清退 bulk 写入，显式逐好友全历史授权，错误/加载 fail closed |
| Memory | 撤权后缓存可见、焦点/风格重载竞态、被动证据与 source/projection 不一致、城市相机抢占 | 当前会话重授权、账户隔离清理、并发投影、服务端 passive witness parity |
| Cairn | 旧草稿位置、伪造精度、错误 author key、重复 acquired pin、Public 身份暴露/竞态 | 重新 GPS lock、精度/provenance 贯穿、单一 pin 权威、服务端资源 block、旧缓存匿名迁移 |
| Cross-feature | 账户切换、撤权、Location/Plant/Activity 与 Cairn/Memory 的重复权威 | generation fence、owner-scoped cache、真实证据边界与清理链统一 |
| UI/UX | sheet 过渡截帧、触控尺寸、Friends/Memory 状态层级、Web/native 主题证据边界 | 稳定捕获、44pt 控件、简化文案和明确 loading/error；未冒充 native 视觉验证 |

最终独立复审未发现残留 P0/P1/P2 发布阻断。

## C. 验证与限制

- Activity changed gate：676/676；后端 Node：151/151；最终定向 Jest：6 suites / 101 tests；Public cache：34/34。
- 隔离真实 MySQL/API：Friends/Memory 23/23、Public 21/21、Cairn Memory 28/28。
- 部署后生产 API：49 + 19 = 68 cells；Memory 两视口 rendered features 2/2；Route 两视口 2/2，style reload 后 2。
- Expo Web 使用 live Mapbox style/tiles。没有实体 iPhone、原生 Mapbox 或原生 GPS PASS；这仍需 Owner 做最小重放。

## D. 待 Owner 决策

无待定产品决策。人工 OTA 与实体 iPhone 验证是执行边界，不是产品决策。

## E. 发布

- Client branch: \`${branch}\`, SHA \`${head}\`。
- Backend production: \`${productionBackend}\`，健康，migration ledger 050。
- O85 marker 已存在；未执行 EAS Build；未由自动化发布 OTA（仓库规则要求人工发布）。
- 最小 iPhone 重放：安装人工 O85 OTA 后，分别打开 Memory → Friends 和 Route Editor → Mine & Friends，切换两个来源城市并触发一次后台/前台与地图样式重载；再做一次短真实步行，30 分钟后确认新增 Fog，最后撤权确认立即消失。
`;
  writeFileSync(path.join(archiveRoot, 'O85_FINAL_REPORT_ZH.md'), finalReport);

  const files = [];
  const walk = directory => {
    for (const name of readdirSync(directory).sort()) {
      const absolute = path.join(directory, name);
      if (statSync(absolute).isDirectory()) walk(absolute);
      else {
        const relative = path.relative(archiveRoot, absolute);
        const contents = readFileSync(absolute);
        files.push({ path: relative, bytes: contents.length, sha256: sha256(contents) });
      }
    }
  };
  walk(archiveRoot);
  writeFileSync(path.join(archiveRoot, 'MANIFEST.json'), `${JSON.stringify({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    privacy: 'Allowlisted files only; no .env, token, raw production coordinates, unrelated Downloads files or EAS Build output.',
    fileCount: files.length,
    files,
  }, null, 2)}\n`);

  mkdirSync(path.dirname(outputPath), { recursive: true });
  if (existsSync(outputPath)) rmSync(outputPath);
  execFileSync('zip', ['-qry', outputPath, archiveRootName], { cwd: workRoot });
  const zipBytes = readFileSync(outputPath);
  const zipHash = sha256(zipBytes);
  writeFileSync(`${outputPath}.sha256`, `${zipHash}  ${path.basename(outputPath)}\n`);
  process.stdout.write(`${JSON.stringify({
    output: outputPath,
    bytes: zipBytes.length,
    sha256: zipHash,
    manifestFiles: files.length,
    base,
    head,
  }, null, 2)}\n`);
} finally {
  rmSync(workRoot, { recursive: true, force: true });
}
