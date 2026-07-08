/**
 * v412: deterministicCid — 客户端点 (lat, lng, ts) → 稳定 36 字符 sha1 前缀。
 *
 * 抽出为公共模块, 保证 memory.js 和 sessions.js (含新 /save 端点) 用同一份实现,
 * 避免两处 cid 计算算法漂移 → memory_points 表 client_id 唯一约束失效 →
 * 同一位置多次上传产生重复行。
 *
 * 精度: lat/lng 保留 7 位小数 (~11cm 精度), ts 是毫秒整数。
 * 关键: 服务端算, 客户端不算, 保证跨端一致 (客户端浮点精度可能不一样)。
 */
const crypto = require('crypto');

function deterministicCid(userId, ts, lat, lng) {
  return crypto
    .createHash('sha1')
    .update(`${userId}|${ts}|${lat.toFixed(7)}|${lng.toFixed(7)}`)
    .digest('hex')
    .slice(0, 36);
}

module.exports = { deterministicCid };
