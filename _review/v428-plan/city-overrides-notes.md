# City Override Draft — Notes

**Version**: v428-draft-1  **Date**: 2026-07-22

## Scope
100 overrides + 7 unmapped_cases. Covers top world metros, all major NZ/AU/CN/JP/KR/EU/MEA/LATAM cities.

## Four Policy Buckets
- **A_adm1_ok** (48): ADM1 label already correct; may need Latin cleanup (Praha→Prague, Ōsaka→Osaka). Tokyo, Seoul, Shanghai, Beijing, Berlin, Moscow, Dubai, Jakarta, Bangkok, HK, Macau, Singapore, Vienna, Prague, Taipei, Manila, Delhi, Istanbul, Cairo, Madrid, Dublin, etc.
- **B_swap_to_adm2** (47): swap ADM1 polygon for a specific ADM2 polygon inside the trigger_bbox. London→Greater London, Wellington→Wellington City, Christchurch, Guangzhou, Shenzhen, Mumbai, Yokohama, Amsterdam, Toronto, Cape Town, Munich, Rome, Warsaw, Barcelona, São Paulo (city), Auckland (unitary), Brisbane, etc.
- **C_rename_only** (1): Paris — keep Île-de-France polygon (correct for 12M metro), display 'Paris'. ADM2 Paris commune too small (105 km²).
- **D_unmapped_partial** (4): Sydney/Melbourne/Perth/Adelaide — no single admin unit for metro; placeholder rename until custom polygon.

## Highest-Risk Rows Needing Manual Verification
1. **NZ shapeNames**: verify 'Wellington' vs 'Wellington City' in v6 CGAZ ADM2.
2. **China ADM1**: 'Shanghai' vs 'Shanghaishi' — depends on v6 field.
3. **UK 'Greater London'**: confirm ADM2 shapeName exists (not just 33 boroughs).
4. **Latin transliteration**: Hà Nội, Tōkyō, Ōsaka, Ciudad de México — normalize.
5. **Duplicate ADM2 shapeNames**: BR São Paulo state has município São Paulo — bbox disambiguates.

## Next Steps
1. Download geoBoundaries v6 CGAZ ADM2 globally, grep-verify every `geobounds_shape_name` and `override_source` against real shapeName field.
2. Build custom polygons (v429+) for US NYC/LA/Chicago and AU Sydney/Melbourne/Perth/Adelaide.
3. Encode apply-priority: tightest bbox wins on overlap (Wellington City inside Wellington Region; Taipei donut inside New Taipei).
4. Test: one known GPS point per override → resolver → expected name.

## User Decisions Needed
- Sydney/Melbourne v428 stopgap: rename-only OK, or block on custom polygon?
- NYC: 'New York State' label OK until custom polygon, or block v428?
- Barcelona: rename-only vs swap to province (still too big)?
- Kyoto/Osaka: prefecture-level acceptable to JP users?
