[STARTED T+0] Phase 1 S1 Data Quality Audit — 2026-07-17

# Phase 1 S1 Data Quality Audit

## 1. r/dayoneapp (raw/01_reddit/dayoneapp.md)

**Numbers**
- Posts: **22 / 25** target (88%)
- Comments: **0 / ~500** target (0%) — all 22 posts marked `comments unavailable` explicitly
- Total records: 22

**Sample signal check (all 22 titles read)**
- Cairn-relevant themes: AI-in-journal concerns (5), subscription/pricing pain (4), export/lock-in (2), streaks/memory (3), UI complaints (3), feature requests (5) → **22/22 relevant** to journaling+memory competitive space
- Signal-to-noise: ~100% — subreddit is topically pure

**Completeness**
- Structured YAML front matter (id, source_url, captured_at, author, score, raw_body) — present on all 22
- `author: unknown` on every post — mirror strip (documented in source note, not fabrication)
- `raw_body` full text — avg looks ≥300 chars, max post (AI security rant) is ~4000 chars — **complete**
- Comments column completely empty across the file

**Fabrication check** — no; author is honestly labelled `unknown` with reason documented at line 3.

**打分: 🟡 部分完成**

**理由**: Post bodies are high-quality and complete (88% of target, all relevant). But `comments: 0` = the "sentiment reactions" layer is missing entirely. Post bodies alone give us OP intent, not community consensus. For Phase 2 pain-point clustering, comments are the multiplier.

**建议动作**:
- Accept 22 posts as final for post-body signal
-补跑 comments 只针对高价值 post: 用 Playwright 打开 `https://old.reddit.com/r/dayoneapp/comments/<id>/` (需先从 safereddit HTML 找到真实 post id 或直接 old.reddit search "title") 抓 top-10 comments each — 目标 22 * 10 = 220 comments
- Alternative: use webSearch with `site:reddit.com/r/dayoneapp "<exact post title>"` to find canonical thread, then Playwright to comments

---

## 2. r/PolarSteps (raw/01_reddit/polarsteps.md)

**Numbers**
- Posts: **23 / 25** target (92%)
- Comments: **0** — regex confirms 0 comment blocks, 0 `>` quotes, 0 `### Comments` non-empty sections
- Total records: 23

**Sample signal check (all 23 titles read)**
- Product announcements from Polarsteps official: 8 (tagged `[OFFICIAL RESPONSE]`)
- Feature requests (private trips, geotags, chronological sort, best-friends, snap-to-river, transport): 9
- Bug reports (step edit opens wrong one, wrong countries, photo commenting UX): 3
- Community celebration/promotion (AT hikers, statistics): 3
- Relevance: **23/23** on-topic for travel journaling / trip logging competitive space

**Completeness**
- Same YAML schema — well-formed
- `is_official: true` correctly flagged on 8 announcement posts — good corpus hygiene (won't pollute user-pain signal)
- Body avg 741 chars, min 75, max 2669 — **complete, no truncation**
- Comments empty

**Fabrication check** — no; source note (lines 3-7) transparently documents mirror limitation.

**打分: 🟡 部分完成**

**理由**: Post bodies excellent (92%, well-structured, official-vs-user distinguished). Comments missing = same gap as dayoneapp. User feature-request posts have body but no upvote-comments signal (which is where "me too" pain quantification lives).

**建议动作**:
- Accept 23 posts as final for post-body signal
- 补跑 top-15 user posts (skip 8 official) top-10 comments each → target ~150 comments via Playwright on `old.reddit.com`
- 排除 official announcements (already tagged), 只抓 user post 评论

---

## 3. Trustpilot polarsteps (raw/03_trustpilot/polarsteps.md)

**Numbers**
- Reviews: **29 / 300+** target (**~9.7%**) — actual n=29 (not the "30 + 3" reported; 15 from page=1, 14 from page=3, 0 from other pages)
- Rating distribution: **5★=25, 4★=1, 3★=1, 1★=1, null=1** — **86% five-star bias**

**Sample signal check**
- Read reviews 01-06: all short praise (photobook, family sharing, ease of use) — 5-6 relevant items each is repeating same 2 themes (photobook quality, sharing convenience)
- Signal is thin: same signal repeated, low variance
- Missing entirely: negative/churn reviews (only 1 x 1★ in 29), which is where Cairn's opportunity lies

**Completeness**
- Schema (id, source_url, captured_at, author, rating, review_date, sentiment, is_company_reply, title, raw_quote) — all fields present
- `author: [not_extracted]` on every entry — Trustpilot renders author via JS
- `raw_quote` complete, avg ~40-100 chars — reviews genuinely short (Trustpilot review culture), NOT truncation

**Fabrication check** — no; ratings + dates + content look consistent, sentiment tags match rating (5★=POSITIVE, 1★=NEGATIVE, 3★=NEUTRAL).

**打分: 🔴 半成品**

**理由**: 29 reviews out of 300 target = **10%**. And with 86% 5-star skew (which reflects Trustpilot's known selection bias but is exaggerated by only pulling p1+p3), we have essentially zero negative signal. Trustpilot's whole value in this research was to sanity-check "actual paying customer complaints" — that signal density is currently 1 review (1× 1★). Cannot proceed to Phase 2 pain-clustering on 1 negative review.

**建议动作** (重跑):
- Use **Playwright MCP** (not webReader) — Trustpilot IS crawlable with headless Chromium; the "webReader can't paginate" report likely means the reader tool but not real Playwright
- Alternative: Trustpilot public JSON `https://www.trustpilot.com/api/consumersitereviews/reviews/list/companies?businessUnitId=...&stars=1&page=1..10` → filter by 1-3 star to specifically extract negative signal
- Target: minimum **100 reviews** with **at least 30 combined 1★+2★+3★**
- If Playwright also fails: fallback to reading Trustpilot RSS `/review/polarsteps.com/rss` (30 latest) + Google Cache

---

## 4. iTunes RSS jsonl (raw/02_appstore/*.jsonl)

**Aggregate (19 files scanned; note: alltrails_gb_mostRecent.jsonl exists in fs listing not shown in earlier ls output — included in scan)**

Total records: **10,085** (well above 4770 Spike-2 estimate — coverage 211%)

| App | region×sort files | total | rating spread |
|---|---|---|---|
| alltrails | us×2 + gb_mostRecent | 2459 | mixed (mostHelpful 5★=340/800 = 43%, has healthy 1-4★ spread) |
| dayone | us/gb/au/nz × 2 | 4552 | 5★~66%, wide spread — negative signal present |
| polarsteps | us/gb/au/nz × 2 | 3074 | 5★~80%, thinner negative but present |

**Per-file details** (already logged above):
- All 19 files have valid JSONL, `id/rating/title/content/author/updated/version/app_slug/app_id/region/sort/page` schema — **100% field completeness**
- avg content length varies 122–867 chars — **not truncated**; short_content(<20 chars) is 0–109 per file (short one-word "Great!" type reviews are real Apple reviews, not extraction failure — expected long-tail)
- Ratings: **7302 × 5★, 987 × 4★, 592 × 3★, 379 × 2★, 825 × 1★** overall → **1204 records with ≤2★ negative signal** (12% of corpus)

**Signal check (3 samples from polarsteps_us_mostHelpful):**
- Record 1: 5★, 1050+ chars, 3 concrete feature-requests (gallery view, collaboration, digital passport) — high signal
- Record 2: 5★, 1200+ chars, complaint about step-routing + photobook layout limits — high signal
- Record 3: 5★, 900+ chars, "carrying journal" pain + offline usage + video length limit — high signal
- All 3 have long-form nuanced content, not "great app!" filler → Apple mostHelpful skews long

**Fabrication check** — no; timestamps span 2023-09 → 2025-02, ids are Apple review IDs (11-12 digit), versions match known Polarsteps versions (6.9.12, 8.2.14).

**打分: 🟢 真完成**

**理由**: 
- 10,085 records >>> 4770 target (**211%**)
- Full field schema, no truncation
- 12% negative records = **1,204 actionable pain-point reviews** (this alone dwarfs Reddit + Trustpilot combined)
- 4 regions × 3 apps × 2 sort orders covers de-duplication needs
- Ready for Phase 2 sampling/clustering as-is

---

## 最终 S1 判定

**🟡 S1 部分完成 — 先补 Trustpilot (🔴) + Reddit comments (🟡) 再进 S2**

**Rationale**:
- iTunes RSS alone (10K records, 1.2K negatives) IS sufficient minimum for Phase 2 to start
- BUT Reddit + Trustpilot were designed as **cross-source triangulation** — if we drop them we lose the "community discussion" + "purchased-customer complaint" dimensions
- Trustpilot at 29/300 (10% + 86% 5★ bias) is genuinely unusable for negative-signal clustering — MUST fix before S2
- Reddit comments missing is real signal loss (community amplification) but posts alone are workable — SHOULD fix, not MUST

## 具体补跑清单

**Priority 1 (MUST — block S2):**
1. **Trustpilot polarsteps** — retarget 100+ reviews with **≥30 combined 1-3★**
   - Tool: Playwright MCP (headless Chromium, real browser, handles JS pagination)
   - URL pattern: `https://www.trustpilot.com/review/polarsteps.com?stars=1&page=N` + `stars=2` + `stars=3`
   - Save format: append to same file with `---` separators
2. **Trustpilot dayoneapp.com** — 100+ reviews, same negative-skewed filtering (this source is currently MISSING entirely — no `raw/03_trustpilot/dayoneapp.md`)

**Priority 2 (SHOULD — 4h effort, quality boost):**
3. **Reddit r/dayoneapp comments** — 22 posts × top-10 comments = 220 comments
   - Tool: Playwright open `https://old.reddit.com/r/dayoneapp/` search by exact title → click post → capture top-10
4. **Reddit r/PolarSteps comments** — 15 user posts (skip 8 official) × top-10 = 150 comments
   - Same tool + method

**Priority 3 (OPTIONAL — S2 can proceed without):**
5. Add r/journaling and r/hiking cross-mentions (broader competitive context)

**Estimated补跑 time**: P1 = 3h, P2 = 4h. Combined = 1 day of Sprint capacity.

---

## Audit metadata
- Files inspected: 22 (19 jsonl + 2 reddit md + 1 trustpilot md)
- Sampling: 3–5 records read per source
- Tool count used: within 15 budget
- Duration: within 20min budget
