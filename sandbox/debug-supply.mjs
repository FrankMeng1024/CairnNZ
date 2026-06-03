// 调试: 重现 73赞/22报 supply 失败 case
import { createMarkerV34, addLikeV34, addReportV34, recordView,
  lifeLeftV34, currentHeatV34, reportPenaltyV34, effectiveAge,
  TYPE_PARAMS_V34 } from './algorithm-v34.mjs';

const DAY = 86400 * 1000;
const m = createMarkerV34({ id: 'm', type: 'supply', x:0, y:0, authorId: 'A', tCreate: 1 });

// 模拟 327 天, 期间 343 个 view 均匀分布, 73 个赞均匀, 22 个 report
const days = 327;
for (let i = 0; i < 343; i++) {
  m.viewCount++;
}
// 73 个赞均匀
for (let i = 0; i < 73; i++) {
  const t = (i / 73) * days * DAY + DAY;
  addLikeV34(m, 'L'+i, t);
}
// 22 个 report 均匀, 一半 info_wrong, 一半 dislike
for (let i = 0; i < 22; i++) {
  const t = (i / 22) * days * DAY + DAY;
  const reason = i < 11 ? 'info_wrong' : 'dislike';
  addReportV34(m, 'R'+i, reason, t);
}

const tFinal = days * DAY;
const eff = effectiveAge(m, tFinal);
const heat = currentHeatV34(m, tFinal);
const pen = reportPenaltyV34(m, tFinal, {});
const life = lifeLeftV34(m, tFinal, {});
const params = TYPE_PARAMS_V34.supply;

console.log(`supply 参数:`, params);
console.log(`days=${days}, views=${m.viewCount}, likes=${m.likes.length}, reports=${m.reports.length}`);
console.log(`effectiveAge = ${eff.toFixed(2)} 天`);
console.log(`heat = ${heat.toFixed(2)}`);
console.log(`penalty = ${pen.toFixed(2)}`);
console.log(`baseLifetime + heat×boost - penalty×boost - eff = ${params.baseLifetime} + ${heat.toFixed(2)}×${params.boost} - ${pen.toFixed(2)}×${params.boost} - ${eff.toFixed(2)}`);
console.log(`= ${params.baseLifetime + heat*params.boost - pen*params.boost - eff}`);
console.log(`life = ${life.toFixed(2)} 天`);
