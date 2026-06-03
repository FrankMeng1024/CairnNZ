# Sprint 55 Goal — 23-Bug Hotfix from real-device testing

**Sprint:** 55
**Date:** 2026-05-20
**Mode:** Manual acceptance (Mode 1) — user verifies on real iPhone after EAS build

## One-line goal

Ship one EAS production build that fixes 23 real-device bugs, restores real-user auth, persists data on native, and brings AR/Routes/Settings to a finished state.

## Sprint 55 testing policy（用户硬性要求）

**关键约束**：所有改动必须按"能测就真测"原则验证。

### 分类 A — 可在 web/dev 中真实测试（**MUST**，用 Playwright + jest）

- **STORY-00200 (S1) Auth & storage**: fresh load → Auth；bypass 关闭后无法 enter Home；AsyncStorage round-trip
- **STORY-00201 (S2) Crashes**: signout → confirm → 不抛错；Run Complete 有 Back
- **STORY-00205 (S6) Add Friend keyboard**: focus input → page 不被遮挡（viewport resize 模拟键盘）
- **STORY-00206 (S7) Polish**: night-mode toggle → DOM 切换；rows 等高（measure DOM）；Home tools 圆形（assert computed style）；Run Complete 无 Share（assert absent）
- **STORY-00207 (S8) Telemetry**: 模拟 session 结束 → fetch 调用；session_meta 第一条；screen_view 在导航后
- **STORY-00208 (S9) Settings 重组**: assert section 顺序 + Sign Out 在 Account 组红色

### 分类 B — Web 上无法验证，**多个 Arch subagent 反复 review**

下列改动 web 上不可能复现，必须 launch **2-3 个独立 Arch subagent** 分别审 diff，达成一致后才能进 build：

- **STORY-00202 (S3) GPS pipeline**: AppState 切换 + timestamp dedupe（生产 GPS 时间戳行为）
  - 单元测试可覆盖 pure dedupe 函数
  - AppState 切换 + 真实 Location 订阅必须真机
- **STORY-00203 (S4) Hike 重入**: phase 同步（jest 可测）+ chip 布局（视觉，无 Storybook）
- **STORY-00204 (S5) AR 罗盘**: `watchHeadingAsync` 真机硬件，jest 可 mock 但无视觉
- **STORY-00205 (S6) RouteSheet Mapbox**: MapView 必须 native build 才可见
- **STORY-00209 (S10) App icon**: 视觉效果

### 分类 C — 单元测试 / 静态分析（每个 Story 都跑）

- `tsc --noEmit` 全量
- jest unit tests for: `addTrackPoint` dedupe，`bearingTo`，storage round-trip（mock AsyncStorage），phase sync helper
- ESLint 检查 dangling imports

### 流程

每个 Story 实现完成后：

1. 跑分类 A Playwright 验证（如适用）
2. 跑分类 C 单元测试
3. **触及分类 B 的 Story**：launch **2-3 个独立 Arch subagent**，分别提交 diff summary，要求结构化 JSON 评审；**全部 PASS** 才进入 Integration

全部 Story 完成后：
- QA subagent 跑总体 verdict（基于 Playwright 截图）
- UX subagent 视觉/交互 review

最后：一次 EAS build → 用户在 iPhone 上跑 Acceptance Checklist。

## Stories

| ID | Story | Bugs | Test class |
|----|-------|------|------------|
| STORY-00200 | S1 Auth + Storage | auto-bypass, no-login-Home, activity-disappears | A |
| STORY-00201 | S2 Crash fixes | signout闪退, login crash, run-complete-no-back | A |
| STORY-00202 | S3 GPS pipeline | hike GPS 飘, run时间双跳, EAS Build 占位, 双击暂停无插旗 | **B + C** |
| STORY-00203 | S4 Hike re-entry + chip | hike中途back-无法回到tracking, GPS-chip-vs-compass重叠 | **B + C** |
| STORY-00204 | S5 AR directional | AR不显示 | **B** |
| STORY-00205 | S6 Routes map + Add Friend kb | routes-map不展示, add-friend-被键盘遮挡 | A + **B** |
| STORY-00206 | S7 Visual polish | night-mode无效, z-index, share按钮多余, settings行高, home tools, back-blur | A |
| STORY-00207 | S8 Telemetry auto-upload + extended | (新需求 #1) | A |
| STORY-00208 | S9 Logo align + Settings reorganize | (新需求 #2 + #3) | A |
| STORY-00209 | S10 App icon NZ green + 3-stone | (新需求 #4) | **B** |

## Build constraint

**Must complete 23 bugs in ONE EAS build.** No build budget for retry. All fixes pre-build verified.

After build: any polish ships via `eas update --branch production` (free, unlimited).

## Implementation order

S1 → S2 → S3 → S4 → S6 → S5 → S8 → S9 → S7 → **S10（图标，最后）**
→ `jest + tsc --noEmit`
→ Playwright 全量
→ 一次 `eas build`
