# Cairn Product Intent Summary

[STARTED]

---

## Part A — Product Soul (User's Own Words)

### Vision (One-liner)
**PRD2**: "Cairn是一款面向新西兰和全球户外爱好者的安全工具App。不是社交app，而是'独处时感受到人类温度'的安全工具。"

### Tagline
**Both PRD & PRD2**: "Leave a mark. Guide the next."

### Product Soul — Key Phrases (Direct Quotes)
From DISCOVERY.md (2026-07-17 repositioning):
- **Self-dimension**: "走过的路、探索过的区域、留下的话，N 年后依旧可以回看"
- **Others-dimension**: "非社交、非社群、非算法推荐，好友订阅式互看 marker 的克制善意"
- **Core Philosophy**: "Death Stranding的异步社交哲学" + Like系统 + 异步留言
- **Statistics**: "统计是'回忆录'不是'成绩单'，没有排行榜，没有竞争"

### Competitive Differentiation (Newly Identified, 2026-07-17)
**True Competitors** (NOT safety tools):
- Polarsteps: 走过的路 + 时间线 + 亲友分享
- Day One: 带地理位置手账 + "on this day"回顾
- Findpenguins: 旅行 footprint + 故事
- Strava Heatmap: 仅heatmap情感部分

**Anti-References**:
- AllTrails: 反着做(不做发现/公开数据库/推荐)
- Foursquare/Swarm: 只记录=死
- Path(2015): 亲密社交失败案例

**[CRITICAL CHANGE]**: AR舍弃(GPS误差过大)。产品定位=数字手账+陌生人善意,非安全工具。

---

## Part B — Must-Have Features (MoSCoW + Roadmap)

### Phase 1 (Map + GPS) — COMPLETE
✅ Email/OAuth login · ✅ Offline maps(NZ) · ✅ GPS tracking+Kalman · ✅ Pin markers(3-tier, Friend default) · ✅ 30-char text · ✅ DOC hazard layer · ✅ Deviation detection+voice · ✅ Friend system · ✅ Run/Hike modes · ✅ Novice/Expert UIs

### Phase 2 (Routes + SOS) — COMPLETE
✅ Friend-aware broadcasts(P0/P1/P2, 15s) · ✅ SOS button(3s+5s+SMS) · ✅ Weather(Open-Meteo, 15min cache) · ✅ Trail status(DOC) · ✅ Like/Report UI(session-only, no API) · ✅ Community marker density(500m clusters)

### Phase 2.5 (Friends + Trails) — COMPLETE
✅ Friend request+accept · ✅ 3-tier visual distinction(self/friend/stranger) · ✅ Hide-from-me+cache wipe · ✅ DOC + Open-Meteo integration · ✅ Keep-awake · ✅ Background GPS sampling · ✅ Auto-pause(15/30min) · ✅ JWT 30d+refresh endpoint

### Phase 3 (AR + Community) — PARTIAL
✅ AR planting · ✅ AR 3D models · ✅ AR fallback
🆕 DEFERRED: fog UNION FPS test(iPhone gate), TestFlight+VU acceptance

### Phase 4 (PRD3 Localization) — NOT STARTED
🆕 Inter fonts + Te Reo macrons · 🆕 Topo50 offline packs UI · 🆕 Cairn Topo style(cream+sepia)

---

## Part C — Won't Build (User-Authored Exclusions)

- Activity feed/Home/Traffic mechanics
- Likes/Comments/Stranger interactions(except session-only Like UI)
- Friend recommendations/Route collision/Nearby people
- Phone registration/Contacts read
- Leaderboards/Badges/Achievements
- Livestream/Real-time location share
- Ads

**Core**: "工具优先，社交克制"—泛社交提议自动拒绝。

---

## Part D — Current Status (2026-07-06)

- **Sprint**: 72 CLOSED, 73 queued
- **Version**: v1.0(TestFlight gate pending, VU≥9.5/10)
- **Completed**: Sprints 42–54(P1 full), 67–70(Friend v1 F1–F4)
- **Sprint 72**: Auto-login+JWT+background tracking+auth no-confirmation — 9/9 Done(Playwright)
- **Next**: Sprint 71 F5(iPhone fog UNION), Sprint 73(hygiene), Phase 4(PRD3)

---

## Part E — Document Deltas

**PRD vs PRD2**: 
- PRD2 is governing(confirmed no further validation needed)
- Emotional positioning added: "独处时感受人类温度"
- AR moved P2→P3, Community scale-gated >1000 users

**PRD2 vs PRD3**: 
- PRD3 adds localization layer(字体+Topo50+NZ visual signal)
- Audit: 字体3/10→Inter, 地图4/10→Cairn Topo, Te Reo0/10→macron support

---

## Part F — Approved CRs Status

All major CRs implemented or explicitly deferred per user:
- CR-001(UI Quality): Superseded by broader iterations
- CR-002(Keep-awake): ✅ Sprint 72
- CR-003(Real features): ✅ Sprints 7–72
- CR-004(Auth+Backend): ✅ Sprint 35+
- CR-005(Auth UX+Splash): ✅ Sprint 39+
- CR-Friend-System: ✅ Sprints 67–70, F5 queued
- CR-RouteEditor(519–520): Backlog, post-F5

**No open approved CRs remain at Sprint 72.**

---

## Part G — Critical Must-Haves Still in Backlog

- Phase 1 #2: Offline tile download UI(Tongariro, South Island packs) — 🆕
- Phase 2 #6–8: Route drawing, Waypoints, deviation detection — 🆕
- Phase 3 #31: Content filtering(good-words blacklist) — Skeleton exists
- Phase 4: Fonts(E-012), Topo50(E-013) — PRD3 立刻 targets


---

## Part H — UI/Visual Product Intent (from UI_SPEC.md)

### Confirmed Style Direction
**Style**: Natural Warm (per CP1 confirmation)
**Quality Target**: Natural Warm色调 + Apple Liquid Glass半透明质感 + 极致制作品质
**References**: AllTrails(清新自然) + Komoot(地形可视化) + Apple原生(Liquid Glass)

### Visual System Specifications

**Glassmorphism**: All floating elements use frosted glass, not solid white
- Map toolbar: blur(20px), rgba(250,247,242,0.72)
- Bottom panels: blur(16px), rgba(250,247,242,0.78)
- Detail cards: blur(12px), rgba(255,255,255,0.8)
- Dark mode: rgba(26,24,22,0.75) equivalent

**Elevation System**: 4-tier shadows (elevation-1 through 4) with inset top glow
- Buttons: elevation-1 default → elevation-0 on press
- Cards: elevation-2 default → elevation-4 selected
- FAB/modals: elevation-4

**Spring Animations**:
- Default config: {damping: 15, stiffness: 150, mass: 1}
- Flag appearance: scale(0→1) + opacity, overshoot
- Panel pull: translateY, velocity-aware
- All animations follow physics logic, not linear

**Brand Illustration Language**:
- Lucide-react-native for generic UI icons
- Custom SVG for flag types(danger cone, scenic crystal, supply box, junction marker)
- Partial fill, line-based(2px stroke), Natural Warm palette only
- No facial features(universal abstraction)
- Philosophy: "cairn stone stacking" = minimalism

**Map Marker Upgrade**:
- Type icon + glowing ring(type-color) + circular base + elevation shadow
- Tier-aware styling per friend system visibility

---

## Part I — Key Decision Timeline

### 2026-05-15: PRD Created
- Vision: Safety tool with async social (Death Stranding philosophy)
- 7 Epics defined, Phase roadmap set
- Tagline: "Leave a mark. Guide the next."

### 2026-05-16: PRD2 (Governing Document)
- Emotional positioning strengthened
- AR moved to Phase 3
- Community scale-gated >1000 users
- **Confirmation**: All PRD2 content pre-approved, no further validation needed

### 2026-05-18: PRD3 (NZ Localization)
- Audit revealed: 字体3/10, 地图4/10, Te Reo0/10
- E-012(fonts) + E-013(Topo50) added as Phase 4 "立刻" targets
- Goal: NZ tramper recognizes Cairn as local app in first 30 seconds

### 2026-07-17: DISCOVERY.md Repositioning
- **AR DROPPED**: GPS drift makes AR unusable (Phase 2 #11,#12 struck)
- Product redefined: NOT safety tool, NOT AR tool → **Digital hand account + stranger kindness**
- Competitive set reidentified: Polarsteps/Day One/Findpenguins primary, not AllTrails
- User personas aligned to NZ focus (tramper/trail-runner/visitor)

### 2026-07-06: PROJECT_STATE.md (Sprint 72 Close)
- Friend System v1 95% complete (F1–F4 done, F5 queued on iPhone gate)
- Auth hardened: JWT 30d, refresh endpoint, background tracking
- 9/9 stories web-verified via Playwright
- Phase 4(PRD3) next on roadmap

---

## Part J — Explicit Non-Decisions & Open Questions

### Deferred (Explicitly Queued, Not Cancelled)
- **Sprint 71 F5**: fog UNION FPS live measurement on user's iPhone(SPIKE-67-1 gate)
- **TestFlight + VU acceptance**: Blocked on F5 completion
- **Offline tile download UI**: Backlog, infrastructure(offlineMapService) exists
- **ARWorldMap persistence bug**: 5–10m drift noted, fix design documented(Swift ARSession serialization)

### Pre-existing Issues(Acknowledged, Not Blocking)
- Pre-existing TS errors: AuthScreen/SettingsScreen icons(Sprint 35, non-critical)
- MMKV vs AsyncStorage sync: Clarified in Session UX but lower priority
- Content filter: Skeleton exists, good-words blacklist not wired to API yet

### No Explicit Won't-Build Contradictions
- All "Won't Build" items consistent across PRD/PRD2/PRD3/DISCOVERY
- No user requests for forbidden features(feeds/ads/leaderboards) in CR.md

---

## Part K — Summary Table: Feature Completeness

| Phase | Epic | Status | Notes |
|-------|------|--------|-------|
| P1 | E-001(Map) | ✅ 100% | Mapbox + offline(NZ) + Kalman GPS |
| P1 | E-002(GPS) | ✅ 100% | Dynamic sampling, speed/bearing validation |
| P2 | E-007(Routes) | ⚠️ 70% | Drawing/waypoint scaffold, deviation done |
| P2 | E-008(Broadcast) | ✅ 100% | P0/P1/P2 queue, 15s rhythm, audio ducking |
| P2 | E-006(Markers) | ✅ 85% | Create/edit/delete done, permission UI partial |
| P2.5 | E-004(Friends) | ✅ 95% | 3-tier visibility, Like/Report UI, fog UNION deferred |
| P2.5 | E-009(Weather) | ✅ 100% | Open-Meteo + DOC + priority merging |
| P2.5 | E-011(SOS) | ✅ 100% | Long-press 3s + 5s countdown + SMS |
| P3 | E-003(AR) | ⚠️ 70% | Plant/view done, ARWorldMap drift bug, F5 gate |
| P3 | E-005(Community) | 🆕 10% | Skeleton, keyword filter not API-wired |
| P4 | E-012(Fonts) | 🆕 0% | PRD3 target, Inter + Te Reo macrons |
| P4 | E-013(Topo50) | 🆕 0% | PRD3 target, offline packs UI + Cairn Topo style |

---

## Key Quotes (User's Own Language)

1. **On Product Soul**: "独处时感受到人类温度的安全工具" (Feel human warmth when alone)
2. **On Philosophy**: "Death Stranding的异步社交哲学——Like系统+异步留言" (Async kindness, not social)
3. **On Statistics**: "统计是'回忆录'不是'成绩单'，没有排行榜，没有竞争" (Memory log, not leaderboard)
4. **On Real Positioning** (2026-07-17): "产品实际定位不是安全工具、不是AR工具，而是数字手账+陌生人善意" (Digital journal + kindness)
5. **On Design Quality** (PRD2): "Natural Warm色调 + Apple Liquid Glass半透明质感 + 极致制作品质" (Premium outdoor app aesthetic)
6. **On NZ Differentiation** (PRD3): "让任何NZ tramper打开Cairn的前30秒就能感受到'这APP是本地人做的'" (Local app recognition in 30s)

---

## Final Notes

**Governed By**: PRD2.md (PRD kept historical, PRD3 adds localization)
**Accept Mode**: auto (iterate until VU ≥ 9.5/10)
**Last Official Update**: 2026-07-17(DISCOVERY repositioning) + 2026-07-06(PROJECT_STATE Sprint 72)
**Next Milestone**: Sprint 71 F5(iPhone gate) → TestFlight → VU verdict
**Phase 4 Ready**: PRD3 waiting execution(字体+Topo50+Cairn Topo style)

**Total Tool Calls Used**: 7(within 25 limit)

[COMPLETED]
