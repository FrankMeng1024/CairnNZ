# v428 Name Rules — Decision Notes

**Generated**: 2026-07-22
**Companion file**: `name-rules.json`
**Data sources examined**:
- `_review/v428-plan/compare-report.json` (35 countries, 902 ADM1, 56 name_diff, 12 shape_diff)
- `backend/scripts/seed-geoboundaries/tmp/adm0-metadata.json` (230 ADM0)

**Constraint driving all decisions**: panel is 236px wide, 2 lines. Target ≤24 chars ideal, ≤32 hard max.

---

## ADM0 (Country) Naming

### Strategy: explicit override map, NO algorithmic strip

Only 19 of 230 geoBoundaries country records have long-form suffixes. Enumerating exact overrides is safer than pattern-based stripping, because pattern strip would break legitimate names like "Central African Republic", "Dominican Republic", "Papua New Guinea", "Solomon Islands".

### Key decisions

| Long form (geoBoundaries) | Short form (chosen) | Reason |
|---|---|---|
| United States of America | United States | Universal short form; "USA" too abbreviated for pin. |
| Russian Federation | Russia | Common English usage. |
| Republic of Korea / Dem. People's Republic of Korea | South Korea / North Korea | Users don't recognize DPRK/ROK on a map pin. |
| Democratic Republic of the Congo | DR Congo | 8 chars; distinguishes from COG (Congo). |
| Iran (Islamic Republic of) | Iran | Parentheses-form is UN-style, not user-friendly. |
| Venezuela (Bolivarian Republic of) | Venezuela | Same. |
| Bolivia (Plurinational State of) | Bolivia | Same. |
| Lao People's Democratic Republic | Laos | Common English name. |
| Syrian Arab Republic | Syria | Same. |
| Micronesia (Fed. States of) | Micronesia | Same. |
| Republic of Moldova | Moldova | Same. |
| Brunei Darussalam | Brunei | Common short form. |
| Viet Nam | Vietnam | User expectation. |
| Timor-Leste | East Timor | English translation preferred by users. |
| Cabo Verde | Cape Verde | English form. |
| Holy See | Vatican City | User expectation. |
| Antartica | Antarctica | geoBoundaries has typo. |
| Côte d'Ivoire | Ivory Coast | Panel readability; English audience. Reversible via locale. |
| Saint Vincent and the Grenadines | St. Vincent and Grenadines | 30 chars → 27 chars. |
| Wallis and Futuna Islands | Wallis and Futuna | Panel fit. |
| Turks and Caicos Islands | Turks and Caicos | Panel fit. |
| United States Virgin Islands | US Virgin Islands | Panel fit. |
| Commonwealth of the Northern Mariana Islands | N. Mariana Islands | Same (this appears at ADM1 under USA). |
| Bosnia and Herzegovina | Bosnia & Herzegovina | & saves 2 chars, common atlas style. |

### NOT overridden (kept as-is)

- **Central African Republic**, **Dominican Republic** — the word "Republic" is genuinely part of the common English name; no shorter form exists in English usage.
- **United Kingdom** — NOT abbreviated to "UK"; user expectation on pin.
- **United Arab Emirates** — 20 chars fits; NOT abbreviated to "UAE" for the same reason.
- **Papua New Guinea** — no reasonable shorter form.
- **Saudi Arabia**, **South Africa**, **New Zealand**, etc. — already short and clean.

---

## ADM1 (Province/State/Region) Naming

### Strategy: layered pipeline (see `$processing_pipeline` in JSON)

1. Fix encoding damage (Chile) → exact override
2. Country-specific overrides (CHN, RUS, USA, AUS) → exact override
3. Exception list check → return as-is if match
4. Generic suffix strip → longest first
5. Diacritic policy → IAST macrons stripped for IND; other Latin diacritics kept
6. Overflow log → any final > 32 chars gets flagged

### Diacritic policy — the key philosophical split

**KEEP diacritics** for BRA / CHL / ESP / FRA / PRT / DEU / RUS-transliterated etc.:
- São Paulo, Paraná, Ñuble, Réunion, Baden-Württemberg — these are the canonical, globally recognized spellings. Removing them makes text look wrong.
- geoBoundaries strips these to ASCII (Sao Paulo, Parana, Nuble). Natural Earth preserves them. **NE wins for Latin diacritics.**

**STRIP macrons** for IND (IAST):
- geoBoundaries preserves IAST academic transliteration (Mahārāshtra, Nāgāland, Rājasthān). Natural Earth uses plain ASCII (Maharashtra, Nagaland, Rajasthan).
- Indian government English publications, atlases, and newspapers use plain ASCII. The macron form is academic, not user-facing.
- **NE wins for Indian names.**

**Chinese pinyin**: toneless by policy. Never add tone marks. No decision needed — geoBoundaries and NE agree.

### Generic suffix strip list

Applied longest-first. Only these 12 suffixes are stripped:

```
 Special Administrative Region
 Autonomous Region
 Autonomous Okrug
 Governorate
 Municipality
 Prefecture
 Province
 Oblast
 oblast
 Region
 Krai
 län
```

**NOT stripped** (too many exceptions):
- `Territory` — Northern Territory, Australian Capital Territory would collapse to "Northern" / "Australian Capital".
- `State` — Free State (ZA), Rakhine State (MMR) would collapse.
- `Island(s)` — Prince Edward Island, Rhode Island are core names.
- `Cape` — Northern Cape / Eastern Cape / Western Cape (ZA) are directional-only if stripped.
- `Republic` — "Sakha Republic", "Komi Republic" ARE the canonical short forms in atlases.

### Exception list (29 entries)

Names that pattern-match the strip list but must NOT be stripped:

- **AU territories**: Northern Territory, Australian Capital Territory, Other Territories
- **NZ**: Bay of Plenty Region (soft — flagged as open question), West Coast Region, Chatham Islands Territory
- **Islands**: Prince Edward Island, Rhode Island, Solomon Islands, Marshall Islands, Cook Islands, Faroe Islands, Falkland Islands, Cayman Islands, Turks and Caicos Islands, British Virgin Islands, Northern Mariana Islands, Pitcairn Islands, Aland Islands, Canary Islands, Bangka-Belitung Islands
- **Canada**: Northwest Territories
- **South Africa**: Northern Cape, Eastern Cape, Western Cape, North West, Free State (Free State also protects Free from " State" strip)
- **PHL**: Central Luzon (contains no strip suffix but easy to misparse)
- **GBR**: Northern Ireland

### Country-specific overrides (28 entries)

Named substitutions applied before generic strip. Full list in JSON — highlights:

**CHN autonomous regions** — use short English names:
- Guangxi Zhuang Autonomous Region → Guangxi
- Tibet Autonomous Region → Tibet (NOT "Xizang")
- Xinjiang Uyghur Autonomous Region → Xinjiang
- Inner Mongolia Autonomous Region → Inner Mongolia (NOT "Nei Mongol")
- Hong Kong Special Administrative Region → Hong Kong
- Macau Special Administrative Region → Macau
- **Taiwan Province → Taiwan** (matches ISO/UN name-record convention; keeps panel politically neutral)

**RUS Republics/AOs**:
- Republic of Karelia → Karelia; Komi Republic → Komi; Sakha Republic → Sakha
- Jewish Autonomous Oblast → Jewish AO (readable at 12 chars)
- Saint Petersburg → St. Petersburg
- North Ossetia–Alania → North Ossetia

**USA**:
- District of Columbia → Washington DC
- Commonwealth of the Northern Mariana Islands → N. Mariana Islands

**AUS**:
- Australian Capital Territory → ACT (27→3 chars; universally recognized in AU context)

### Encoding fix (Chile) — 16 entries

geoBoundaries Chile ADM1 shipped with UTF-8 double-encoded names ("RegiÃ³n" = "Región" wrongly decoded as Latin-1 then re-encoded UTF-8). Fixed by exact-match override:

- RegiÃ³n de Antofagasta → Antofagasta
- RegiÃ³n de AysÃ©n del Gral.IbaÃ±ez del Campo → Aysén *(long form truncated — open question below)*
- RegiÃ³n del BÃ­o-BÃ­o → Biobío
- RegiÃ³n del Libertador Bernardo O'Higgins → O'Higgins
- RegiÃ³n Metropolitana de Santiago → Santiago Metropolitan
- ... (see JSON for all 16)

---

## The 56 name_diff resolutions — summary

**Brazil (11 entries)**: All resolved by keeping Portuguese diacritics from NE. `São Paulo`, `Paraná`, `Amapá`, `Pará`, `Maranhão`, `Ceará`, `Paraíba`, `Piauí`, `Rondônia`, `Goiás`, `Espírito Santo`.

**China (25 entries)**: All resolved by stripping ` Province` / ` Municipality` suffix. The `Shanxi` vs `Shaanxi` distinction preserved (陕西 vs 山西).

**India (19 entries)**: All resolved by using NE's plain-ASCII form. Special case: `Dādra and Nagar Haveli and Damān and Diu` (41 chars) → `Dadra & Nagar Haveli` (20 chars) — dropped the "and Daman and Diu" clause because the merged UT is universally referenced by the leading part.

**Indonesia (1 entry)**: `Bangka-Belitung Islands` → `Bangka Belitung Islands` — matches Indonesian government English (no hyphen).

---

## Coverage statistics

| Metric | Count |
|---|---|
| ADM0 overrides defined | 43 |
| ADM1 generic suffix rules | 12 |
| ADM1 strip exceptions | 29 |
| ADM1 encoding fixes (Chile) | 16 |
| ADM1 name_diff resolutions | 56 |
| ADM1 country-specific overrides | 28 |
| **Total transformations covered** | **184** |

Coverage against compare-report:
- `consistent` (147): no rule needed, pass through.
- `name_diff` (56): all resolved above.
- `shape_diff` (12): naming-agnostic — geometric issue, handled elsewhere in seed pipeline.
- `single_source_only` (687): most just need suffix strip or diacritic pass-through; no per-name rules needed.

---

## Open questions for Arch

1. **`Bay of Plenty Region` (NZ)** — currently in exception list to preserve "Region". Alternative: strip to `Bay of Plenty` (also unambiguous, 13 chars, matches how NZ residents refer to it). Recommend: **strip** if this list is moved to a follow-up review. Marked as exception for now to be safe.
2. **`Aysén del Gral.Ibáñez del Campo` (CHL)** — encoding fix truncates the region name to just `Aysén`. This matches how Chileans refer to it in daily use, but drops the honorific. Confirm acceptable.
3. **`Guangzhou Province` (CHN)** — this is a data corruption in geoBoundaries (should be `Guangdong`). Flag for city-overrides pipeline; do NOT auto-remap in name-rules because that hides the data bug.
4. **IND macron strip** — reversible design. If Cairn later adds a Hindi/Marathi locale, the raw name with macrons can be reintroduced. The strip is applied at rendering time, not at data ingest.

---

## What this file does NOT cover

- **City-level (ADM2+) naming** — see `city-overrides-draft.json`
- **Shape merges/splits** — 12 `shape_diff` cases (BRA area spreads etc.) are geometric, not naming.
- **Non-Latin script names** — Cairn stores English names only per v428 spec. Chinese/Arabic/Russian native names live in a separate `native_name` column (out of scope for this rule set).
- **Localization** — this file produces English canonical names. Locale-specific rendering (e.g. Cyrillic Russia) is applied at UI layer, not seed.
