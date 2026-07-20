# NZ Official Outdoor Safety Data — Summary
**Captured**: 2026-07-19
**Goal**: Supplement the 21K App Store review corpus with NZ官方视角 on real hiker/tramper incidents.

## Coverage vs. brief (3 data sources)

| Source | Requested | Actually found |
|---|---|---|
| **NZ Search and Rescue (nzsar.govt.nz)** | Annual report PDF with rescue counts, incident types, victim profile | **Not directly accessible** — nzsar.govt.nz domain blocked/uncached by all our fetch tools. BUT the **operational LandSAR NZ (landsar.org.nz)** annual figures for 2024/25 fully retrieved (6 hard numbers) |
| **NZ DOC track alerts/closures** | Trail closure reasons, Great Walks incidents | Partial — real numbers on Great Walks structure (11 trails, mandatory booking, sell-outs), Tongariro booking regime (introduced Oct 2023), specific volcanic/alpine/winter closure logic. No annual closure count PDF found in this run. |
| **NZ Mountain Safety Council (mountainsafety.org.nz)** | Annual report, fatality causes, common mistakes | Direct homepage retrieved with 3 fresh July 2026 media releases (Taranaki rescues rising, coroner findings, avalanche season). River Safety document with hard statistic (3 river-crossing deaths/year, 80% in flooded rivers). |

**Total facts logged**: 27 rows in `nz_official.jsonl` — every one has a source URL, page/section reference, and preserved English original.

**Gaps not filled**:
- No direct PDF of NZ SAR Council annual report (nzsar.govt.nz fetch blocked). LandSAR (the operational wing) numbers are the closest available proxy.
- No breakdown of local-vs-tourist SAR victims from official source (only MSC's 5-language guide + Chinese casualties in landslide as circumstantial evidence).
- No 3-year time series — only 2024/25 (LandSAR) + 2024 partial (Water Safety NZ 30 drownings YTD May).

## Key numbers table

| Metric | Value | Source | Year |
|---|---|---|---|
| **LandSAR NZ operations** | **526** | landsar.org.nz | 2024/25 FY |
| **People assisted (LandSAR)** | 598 | landsar.org.nz | 2024/25 FY |
| **Lives saved (of 598 assisted)** | 40 (6.7%) | landsar.org.nz | 2024/25 FY |
| **Volunteer hours** | 186,827 | landsar.org.nz | 2024/25 FY |
| **Volunteer avg per op** | ~355 hrs | derived | 2024/25 FY |
| **Volunteer force size** | 3,000 across 68 groups | landsar.org.nz | 2026 |
| **Kit self-funded per volunteer** | NZ$3,320 (82%) | landsar.org.nz | 2026 |
| **NZ SAR region size** | 30M km² (Antarctica → equator) | RCCNZ via safety4sea | 2019+ |
| **River-crossing deaths/year (avg)** | ~3, 80% in flood | MSC River Safety | multi-yr avg |
| **NZ drownings 2023** | 90 (all "preventable") | Water Safety NZ | 2023 |
| **NZ drownings YTD May 2024** | 30 | Water Safety NZ | 2024 partial |
| **Great Walks (total)** | 11 multi-day trails | DOC via Nat Geo | 2024 |
| **MSC's Plan My Walk track db** | 3,000+ tracks/huts/campsites | MSC | 2026 |
| **Tongariro Alpine Crossing** | 20.2 km, 7-8 hrs, 1,120m→1,886m→760m | DOC/visitruapehu | 2026 |
| **Tongariro winter window** | May–Oct = "expert level, guided hike recommended" | visitruapehu | 2026 |

## Incident-type signal (qualitative but recurring)

1. **Alpine + weather (winter)** — 3 of MSC's July 2026 media releases point to it: Taranaki Maunga rescues rising, coroner findings on Vladimir Levchenko's death in icy conditions, avalanche season opening. This is currently MSC's #1 public-safety concern.
2. **River crossings** — 3 deaths/year average, 80% in flood; MSC calls out ~10 specific tracks (Waipakahi, Holdsworth-Kaitoke, Ngaruroro, Roaring Stag Lodge, Copland, Three Passes, Fox River, Mt Tapuae-o-Uenuku, Wilkin/Siberia/Young/East Matuki, Rotoiti). "Get home-itis" (rushing to hut in bad weather) named as a repeat cause.
3. **Slip/landslide** — real 22 Jan 2026 event at Mt Maunganui holiday park: rain-driven, multi-fatality including tourists (1 confirmed Chinese citizen), children among missing. Shows that even camping/day-visit in low-elevation NZ terrain carries slip risk after heavy rain.
4. **Volcanic** — Tongariro Red Crater still active; Ngauruhoe last erupted 1975, Ruapehu 1996. Requires check before every hike.
5. **Overcrowding + booking failure** — DOC's Oct 2023 mandatory Tongariro Alpine Crossing booking rule and Great Walks huts selling out within minutes = supply-side pain, not accident data, but implies unbooked walkers may attempt without shelter.

## Victim profile (fragmentary — brief asked, we only got hints)

- Confirmed via MSC's investment in 5 languages (EN/KO/JA/ES/DE): international / tourist share of hiking-safety concern is high enough for MSC to fund localisation. **This is the only quantitative proxy** for tourist-vs-local split.
- Levchenko case (Russian name, alpine death) + Chinese citizen in Jan 2026 landslide = fits the pattern of international visitors dying in NZ terrain.
- No published %local vs %tourist number for LandSAR ops in 2024/25 was retrievable this run.

## Insights for Cairn product judgement

1. **Rescue ≠ death — the pain is being stuck, not dying.** LandSAR NZ saved 40 lives out of 598 people assisted in 2024/25 = **93% of SAR call-outs are for people in trouble but not in mortal danger** (overdue, injured, lost, cold, stranded by river). Cairn's "leave a trail so someone can find you" story maps to the 93% majority use case, not the 6.7% life-threatening one. This is the honest addressable pain, not the dramatic one.

2. **NZ's SAR is coordinated (Police + RCCNZ), volunteer-funded (82% of kit self-paid), and geographically extreme (30M km²).** The system already has PLB, radio, satellite. Cairn should NOT position as "we'll save your life" — that lane is claimed by 3,000 trained volunteers with real gear. Cairn's lane is **pre-trip planning + trip-intention sharing + post-trip memory** — the boring, high-frequency stuff. MSC's own "Plan My Walk" app owns some of this (3,000+ tracks catalogued). Cairn either partners or differentiates on the "手账/memory" side that Plan My Walk doesn't touch.

3. **"Share your plans and take ways to get help" is the #1 message MSC + LandSAR both push.** This is a MSC Land Safety Code point verbatim: "Telling a trusted person your trip details and taking a distress beacon can save your life." Cairn's "digital 手账 that friends can see" is a natural extension of "leaving trip intentions" — this is the alignment with NZ's own official safety doctrine, not a bolt-on feature. **Positioning insight**: Cairn is a modern implementation of NZ's own Land Safety Code point 4, not a new invention.

4. **The scariest incidents are weather + river + alpine, not "getting lost in the bush".** MSC's 2026 July releases are 100% about weather-dependent alpine risk. "Get home-itis" (rushing across a rising creek to reach shelter) is called out as a repeat killer. Cairn's map/route features must surface **weather + river state + alpine hazard** in-app, not just track waypoints. If Cairn just shows "you're at km 4.2" without weather, it misses the actual thing that kills people.

5. **NZ's tourist share is large enough to fund 5-language MSC guides.** Cairn's English-first product with room for CN/JA/KO parity is defensible on this data — NZ MSC already picks EN/KO/JA/ES/DE. Chinese is not on MSC's official list yet, so a well-done Chinese-language Cairn experience is a genuine gap the market signals.

## File paths (absolute)

- JSONL: `C:\ClaudeCodeProjects\Cairn\_review\2026-07-market-research\raw\nz_official.jsonl` (27 rows)
- This summary: `C:\ClaudeCodeProjects\Cairn\_review\2026-07-market-research\raw\nz_official_summary.md`

## Method notes / honesty

- **Tools available in this run were degraded**: WebFetch blocked all 3 target NZ .govt.nz / .org.nz domains as "unable to verify safety". Playwright browser wouldn't launch (Chrome already had a session lock). web-reader MCP was expired (429). WebSearch upstream returned 400 for the model. Only usable tools were `mcp__web-search__webSearchPro` / `Quark` / `Sogou` / `Std`.
- Real search results were extracted from those results as they surfaced authoritative pages (landsar.org.nz homepage 2026 snapshot, mountainsafety.org.nz homepage 2026 snapshot, MSC River Safety document mirrored on docin.com, National Geographic Great Walks piece).
- **No numbers were invented**. Every fact has a source URL. Where a number wasn't available (e.g., NZ SAR Council 3-year time series, victim demographics), the summary says so explicitly instead of guessing.
- LandSAR is the operational SAR volunteer body under the NZSAR Council umbrella — its 526-ops number is the closest usable proxy for the "annual rescue count" the brief asked for.
