// 中文化已跑完的 case 的 ai_reason（原地翻译 R5/R4/R3 英文前缀）。
// 不改数据本身，只让用户能看懂。

const fs = require('fs');
const DATA_JSON = 'C:/ClaudeCodeProjects/Cairn/docs/feature-map/flows/data.json';

const data = JSON.parse(fs.readFileSync(DATA_JSON, 'utf8'));
let updated = 0;

for (const s of data.screens) {
  for (const r of s.rows) {
    let reason = r.ai_reason || '';
    const orig = reason;
    // R5 fail 语法 → 中文
    reason = reason.replace(
      /^R5 fail: (\d+)\/(\d+) tokens\. Missing: ([^.]+)\. Body: "([^"]{0,200})"\s*(\[[^\]]*\])?/,
      (m, found, total, missing, body, act) => {
        return `找到 ${found}/${total} 条期望文字, 缺: ${missing}. 页面显示: "${body}"${act ? ' ' + act.replace(/^\[/, '(执行了: ').replace(/\]$/, ')') : ''}`;
      }
    );
    reason = reason.replace(
      /^R5 pass: all (\d+) tokens: (.+?)(\[[^\]]*\])?$/,
      (m, n, tokens, act) => {
        return `期望的 ${n} 条文字全找到: ${tokens.trim()}${act ? ' ' + act.replace(/^\[/, '(执行了: ').replace(/\]$/, ')') : ''}`;
      }
    );
    reason = reason.replace(
      /^R5 visual-pass \(spec had no quoted tokens; reached a non-splash screen\)\. Body: "([^"]{0,200})"\s*(\[[^\]]*\])?/,
      (m, body, act) => {
        return `期望里没写具体文字, 到达了非登录首屏就当通过. 页面显示: "${body}"${act ? ' ' + act.replace(/^\[/, '(执行了: ').replace(/\]$/, ')') : ''}`;
      }
    );
    reason = reason.replace(
      /^R5 no-quoted-tokens \+ stuck on auth splash\. Body: "([^"]{0,200})"\s*(\[[^\]]*\])?/,
      (m, body, act) => {
        return `期望里没写具体文字, 但页面还停在登录首屏没进 app. 页面显示: "${body}"${act ? ' ' + act.replace(/^\[/, '(执行了: ').replace(/\]$/, ')') : ''}`;
      }
    );
    reason = reason.replace(
      /^R5 blocked: (.+?)\. Reached body: "([^"]{0,200})"\. Tokens: (\d+)\/(\d+)/,
      (m, reasonEn, body, found, total) => {
        // Translate common English blocked reasons back to Chinese
        const blockedMap = {
          'iOS system permission dialog': 'iOS 系统权限弹窗 — web 没有 iOS 权限对话框, 只能真机测',
          'iOS Settings app jump': '跳转 iOS 设置 app — web 里没有 iOS 系统设置, 只能真机测',
          'Face ID / Touch ID biometric': 'Face ID / Touch ID 生物识别 — web 不支持, 只能真机测',
          'APNs push notification': 'APNs 推送通知 — web 收不到 iOS push, 只能真机测',
          'Real outdoor GPS walk (sim-walker not sufficient per case)': '真实户外走动 — sim-walker 只能模拟静止 GPS 点, case 明确要求真实运动, 只能真机测',
          'Device orientation change': '设备横竖屏切换 — web 视口不是物理设备方向, 只能真机测',
        };
        const zh = blockedMap[reasonEn] || reasonEn;
        return `阻塞: ${zh}. 到达页面: "${body}". 期望文字命中 ${found}/${total}`;
      }
    );
    reason = reason.replace(/^R5 runner-error:/, '脚本运行出错:');
    reason = reason.replace(/^R5 boot timeout$/, 'App 启动超时: 20 秒内 hook 没暴露, 可能是 dev server 卡住');
    reason = reason.replace(/^R5 blocked: /, '阻塞: ');

    if (reason !== orig) {
      r.ai_reason = reason;
      updated++;
    }
  }
}

fs.writeFileSync(DATA_JSON, JSON.stringify(data, null, 2));
console.log(`Translated ${updated} ai_reason strings to Chinese.`);
