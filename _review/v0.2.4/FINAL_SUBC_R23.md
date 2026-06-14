# FINAL Sub#C — R2.3 Self-Licking Fix Verification

**Reviewer**: Independent sub#C (third pair of eyes; main agent + sub#A + sub#B not trusted)
**Date**: 2026-06-14
**Scope**: Verify R2.3 jest 是否真打破 self-licking — 不再是 jest 自己仿 UnityAROverlay 行为。

---

## File existence

- `app/src/services/originPropagation.ts`: **EXISTS** (1219 bytes, 49 lines). Pure helper exporting `projectOrigin(persisted, live) -> ProjOrigin` and types `PersistedOrigin / LiveOrigin / ProjOrigin`. `lowAccuracy` is preserved when `persisted` is provided; dropped when falling back to `live`.
- `app/src/components/UnityAROverlay.tsx`: **真 import**, line 31 — `import { projectOrigin } from '../services/originPropagation';`. **真调** at line 716 — `const projOrigin = projectOrigin(props.arOrigin, props.userPos);` inside the spawn-build path (comment line 713-715 explicitly notes "反 self-licking").
- `app/__tests__/r23-caller-propagation.test.ts`: **真 import**, line 9 — `import { projectOrigin } from '../src/services/originPropagation';`. Same module specifier resolves to the same file UnityAROverlay imports. 5 test cases all call this `projectOrigin` directly.

Conclusion: prod and jest 都 import 同一个 `src/services/originPropagation.ts`,**没有 jest-private helper**.

## Jest run

- Command: `npx jest __tests__/r23-caller-propagation.test.ts`
- Result: **5 passed, 0 failed, 0 skipped**
- Exit code: 0
- Time: ~1.7s

## Self-reverse verification

- 备份: `cp originPropagation.ts /tmp/origin-bak.ts` ✓
- 改了什么: 在 `projectOrigin` 的 `if (persisted)` 分支删掉 `lowAccuracy: persisted.lowAccuracy` 字段返回,只返回 `{ lat, lng }`。这模拟"helper 回退,丢字段"。
- 跑 jest 结果: **2 failed, 3 passed** (Test 1 `lowAccuracy=true 收紧` 失败 — `toHaveProperty('lowAccuracy', true)` Received `{lat,lng}` 没字段;Test 2 `lowAccuracy=false 走 5m` 同样 fail)
- 为什么不是 5 fail: Test 3 `without lowAccuracy field` 期望 `undefined`,helper 不返回字段也是 `undefined`,所以仍 pass — 这正确;Test 4 `null origin` 不进 `if (persisted)` 分支,不受影响;Test 5 `reverse-verify` 直接构造 buggy origin 不调 helper。这 3 个 pass 是预期的。
- restore: `cp /tmp/origin-bak.ts originPropagation.ts` + diff 0 差异 + 重跑 jest = **5 passed** ✓
- **真打破 self-licking: YES** — 改 prod helper,jest 立刻挂;两者真共享同一函数。

## Verdict

**R2.3 jest 现在是真测吗?** YES,有铁证:
1. UnityAROverlay.tsx:31 `import { projectOrigin } from '../services/originPropagation'` 和 jest line 9 `import { projectOrigin } from '../src/services/originPropagation'` 是**同一文件** (test 在 `app/__tests__/`,组件在 `app/src/components/`,相对路径都解析到 `app/src/services/originPropagation.ts`)。
2. 反向 mutation 实测: 删 `lowAccuracy` 字段 → jest 2 个 fail;还原 → 5 个 pass。如果是 self-licking,改 prod jest 应该照样绿。
3. UnityAROverlay 调用点是真生产路径 (line 716,spawn-build path),不是 dead code。

**sub#A 的 SUSPECT 标签还成立吗?** **不成立** — 标签必须撤销。理由:
- sub#A 当时定 SUSPECT 是因为 jest 自己写了 `projectOrigin` 仿 UnityAROverlay 行为,两者无共享代码 → 改 prod 不影响 jest = 假绿。
- 现在 jest 通过 `import` 真调 prod helper,prod 改了 jest 一定挂 (我已实证)。这是教科书定义的"打破 self-licking"。
- 仍可保留**一条小观察**: 这只覆盖 `projectOrigin` 这一函数,UnityAROverlay 里 `arOrigin → projOrigin → buildSpawnRequest` 链路的**前半段** (从 `props.arOrigin` 怎么来 / `arOrigin` PersistedOrigin 怎么从 storage 读出来带 `lowAccuracy`) 没被 jest 覆盖。但这不是 self-licking,是覆盖率问题,应该叫 PARTIAL_COVERAGE 而非 SUSPECT。

**Recommendation**: CHECKLIST 里 R2.3 的 SUSPECT 改为 VERIFIED,可加注 "extend coverage 到 storage→PersistedOrigin 反序列化" 作为后续可选 tech-debt。
