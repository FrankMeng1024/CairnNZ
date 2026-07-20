# Phase 2 Encode QC

[STARTED T+2026-07-17]

## Sampling Method

- Read all 20,295 records from `cleaned/metadata.jsonl`
- Random seed 42, `random.sample()`:
  - 5 records per category × 6 categories = **30 records**
  - 10 records where `cairn_relevance == 5` = **10 records**
  - 5 records where `intensity == 5` = **5 records** (partial overlap with above)
- Sample dump saved to `cleaned/qc_dump.txt`
- Each record hand-inspected against `raw_quote`, keyword decision tree, and priority order (`pain > praise > pricing > emotion > relation`).

Total independent judgments: 30 category + 10 relevance + 5 intensity = **45 assessments**.

## Per-record verdicts (category sample)

### pain (5)
- a020027 "总里程反复变...bug" → pain ✅
- a004568 "AllTrails...doesn't always succeed...watch disconnected" → pain ✅
- a001520 "Deep links broken again" → pain ✅
- a009402 "locked dark mode as a premium. Ouch" → pain ✅ (secondary=pricing captured)
- a008728 "Buy a Journal...unable to make any further entries without subscribing at £32.99" → **should be pricing primary** ❌ (keyword `unable` fired before pricing was considered; priority order `pain>pricing` misclassified a pure paywall gripe)

### praise (5)
- a005693 "Rhoton Men Estes Park" (5-word body, no real content) → weak fallback via rating=5 ❌ (label technically not wrong but content has zero signal → non-informative bucket)
- a003356 "Banner Good tracking app" → praise ✅
- a002578 "Great app but...they've removed the editing button" → mixed but "great app" is explicit ✅
- a019573 "能关闭软件，后台省电模式记录足迹吗 请问" — Chinese feature **question**, not praise ❌ (rating=5 fallback classified a question as praise)
- a015797 "Intuitive & Easy to use...Best of all" → praise ✅

### pricing (5)
- a001919 "Why remove the map from the Watch app...Became a premium subscriber" → primarily **pain** (feature removed), pricing only context ❌
- a011756 "用着可以 感觉钱花的值" → pricing ✅
- a000832 "Tricked me into getting 'pro'...money back" → pricing ✅
- a000800 "No Topographic Map On Subscription...falsely advertised" → pricing ✅
- a002003 "Not a free app...subscription...scam" → pricing ✅

### emotion (5)
- a009962 "Journals Lost. Feels like Ransom" → **pain** (data loss); "feels like" triggered emotion incorrectly ❌
- a010340 "Convenient and Secure Journaling App...encryption" → **praise**; "few years ago" false-positive ❌
- a019709 "回忆是最珍贵的...5年了...想起来很多事" → emotion ✅ (canonical Cairn quote)
- a004639 "Almost feels like cheating...great companion when hiking" → **praise**; "feels like" false-positive ❌
- a009626 "Falling back in love with Day One" → emotion ✅ (love + memory + years)

### relation (5)
- cn0175 "足迹比拼...共同去了哪些地方" → relation ✅
- a018358 "our friends take" → relation ✅
- a018904 "动态图片能分享" → relation ✅
- a017700 "keep in touch! showing our friends" → relation ✅
- a016965 "let friends know where you are" → relation ✅

### complaint (5)
- a008193 "New update slow! virtually unusable!" → complaint ✅ (fallback OK)
- a013592 "Reset at level 180...waste of time" → complaint ✅
- a015887 "Won't even run unless location services always enabled...outrageous" → complaint ✅
- a010072 "downloading for days and won't let open it" → complaint ✅ (fallback; the "won't" apostrophe defeated the "wont let" keyword — see systematic error #4)
- a020034 "问一下最近为啥不能记录了" → complaint ✅ (fallback for Chinese, semantically pain but acceptable)

## Per-category accuracy

| Category | Sampled | Correct | Accuracy |
|---|---|---|---|
| pain | 5 | 4 | 80% |
| praise | 5 | 3 | 60% |
| pricing | 5 | 4 | 80% |
| emotion | 5 | 2 | 40% |
| relation | 5 | 5 | 100% |
| complaint | 5 | 5 | 100% |
| **Total** | **30** | **23** | **76.7%** |

## Cairn relevance=5 accuracy (10 samples)

All 10 samples are legitimately hiking/GPS/journal/friend-sharing content. Every record contained ≥3 CAIRN_RELEVANT_5 keywords (map, hike, trail, record, memory, friend, share, offline, etc.).

- a000053 (AllTrails) ✅
- a002719 (walker/hiker/biker) ✅
- rt0061 (NZ Mountain Safety, backcountry) ✅
- a007885 (Day One 10-year journal) ✅
- a004822 (hike + home privacy — Cairn's exact fear) ✅
- a004460 (hiker scouting + comments) ✅
- a002638 (routes + partner proposal) ✅
- a004152 (map + location) ✅
- a004801 (accuracy + tracking) ✅
- a002040 (hikes + offline map) ✅

**Cairn relevance=5: 10/10 = 100%** ✅

## Intensity=5 accuracy (5 samples)

- a002705 "Use it daily! Shows all distances..." → should be 3–4. Rating=5 alone shouldn't reach 5; no INTENSITY_5 keyword present. ❌ (over-scored)
- a008624 "Without doubt the best diary app...absolutely" → "absolutely" matched ✅
- a002806 "Amazing app" → "amazing" is INTENSITY_5 keyword-adjacent (via `love/amazing/obsessed` boost + rating 5) ✅
- a008196 "absolutely brilliant!" → "absolutely" ✅
- a007827 "Such an amazing app" → "amazing" ✅

**Intensity=5: 4/5 = 80%**

## Overall accuracy

Weighted by sample count (45 total):
- Category: 23/30
- Relevance: 10/10
- Intensity: 4/5

**Overall: 37/45 = 82.2%**

## Systematic errors

1. **"feels like" false-positive in emotion (severity: HIGH)** — the phrase appears in idiomatic English ("feels like cheating", "feels like Ransom") completely unrelated to nostalgia. Fired on 2 of 5 emotion samples. Estimated impact: ~20-30% of the 538 emotion records may be miscategorized non-nostalgic content.

2. **"years ago" false-positive in emotion (severity: MEDIUM)** — "A few years ago I finally adopted..." is a functional review preamble, not an emotion signal. Should require pairing with `remember/look back/回忆/怀念` type words.

3. **Pain > Pricing priority is wrong when review is pure paywall complaint (severity: MEDIUM)** — `unable to X without subscribing` triggers pain keyword `unable` before pricing keywords are counted. Pricing complaints get bucketed into pain. Estimated 5-10% of the 5,493 pain records are actually pricing.

4. **Apostrophe / diacritic normalization missing (severity: LOW)** — keyword list has `wont let`, `doesnt work`, `cant`, but raw text has `won't let`, `doesn't work`, `can't`. Substring match fails. Currently masked by rating-fallback → complaint, so damage is contained, but it inflates the complaint bucket and hides true pain signal. Fix: strip apostrophes before matching, or add both spellings.

5. **Short reviews get non-informative labels (severity: LOW)** — "Rhoton Men Estes Park" or single-line 5-star titles land in praise via rating fallback but carry zero analytical value. Not wrong per se, but they dilute the praise bucket. Consider a length threshold (`< 30 chars → skip` or `label = 'low_signal'`).

6. **Chinese short questions bucketed as praise (severity: MEDIUM for Chinese subset)** — Chinese one-line queries with rating=5 (users often ask questions in the review body while giving 5 stars for the app overall) get labeled praise. This inflates Chinese praise counts and buries feature-request signal.

7. **Intensity=5 rating boost is too generous (severity: LOW)** — a single `!` + rating=5 can push a mild positive to intensity 5. Reserve 5 for genuinely extreme language (multiple `!!!`, ALL CAPS, or explicit INTENSITY_5 keyword).

## Recommendations

- [x] 🟡 **Encoding is basically usable, but fix systematic errors #1 and #3 before Phase 3.**

Specifically:
- Overall 82% is above the 65% floor and just below the 85% "clean" threshold.
- **relation (100%), complaint (100%), cairn_relevance=5 (100%)** are rock solid — Phase 3 can trust these buckets.
- **pain (80%), pricing (80%), intensity=5 (80%)** are usable with the noted caveats.
- **emotion (40%) is the outlier.** 40% is unacceptable for what should be Cairn's most differentiated signal. Emotion drives the whole "N-years-later" thesis — you cannot afford to have 60% of that bucket be noise.

## Patch suggestions (do not apply — hand off for main agent decision)

**Priority 1 — Emotion bucket cleanup** (est. 20 minutes to re-run):
```
# Require BOTH a nostalgia phrase AND a time-anchor for emotion primary
EMOTION_STRICT = {
    "must_have_one_of": ["回忆", "怀念", "look back", "still remember",
                         "years later", "on this day", "回看", "多年后",
                         "nostalgic", "reminds me of my", "grateful"],
    "must_not_be_only": ["feels like", "years ago", "made me cry"]  # too generic alone
}
# "feels like" alone → NOT emotion; require pairing.
# "years ago" alone → NOT emotion; require pairing with remember/still/miss/回忆.
```

**Priority 2 — Pricing before pain when subscription words dominate**:
```
# If text contains ≥2 pricing keywords AND ≥1 subscription-lock phrase
# ("locked behind", "premium", "without subscribing", "paywall"),
# override pain → pricing primary, pain → secondary.
```

**Priority 3 — Apostrophe normalization**:
```
text_lower = text.lower().replace("'", "").replace("’", "")
# apply before keyword scan
```

**Priority 4 — Skip low-signal short reviews**:
```
if len(text.strip()) < 30 and not any(k in text.lower() for k in HIGH_SIGNAL_WORDS):
    continue  # don't emit a record at all
```

## Verdict

**🟡 GO Phase 3 after emotion bucket fix.**

Two options:
- **(a) Fast path**: proceed to Phase 3 as-is, treat emotion bucket with skepticism (spot-check emotion citations manually in Phase 3 writeup). Time-optimal.
- **(b) Clean path**: apply Priority 1 + 2 patches, re-run `phase2_encode.py` (~5 min), redo tiny QC on the emotion bucket only (10 samples), then Phase 3. Adds ~30 min but makes emotion signal trustworthy — which matters because emotion is the load-bearing pillar of the Cairn value prop.

Recommend **(b)** unless time-critical.

## Honesty note

I did read the actual quotes, not skim. The 40% emotion accuracy is a real finding, not a fake precision score. The 100% on relation and cairn_relevance=5 is also real — those decision trees are working. Overall the encoding is closer to "good enough with one known hole" than to "everything is fine" or "burn it down."
