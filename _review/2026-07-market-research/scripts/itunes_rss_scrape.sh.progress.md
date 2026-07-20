[STARTED T+0]
- Task: iTunes RSS batch scrape bash script
- Target: scripts/itunes_rss_scrape.sh
[T+3] Script written, starting dry-run 1/3: Polarsteps us mostRecent p1
[T+7] Rewrote parser to python (no jq on Windows). Running dry-runs.

[T+11] Root-caused 0-reviews bug: Python 3.14 default stdout encoding cp1252 on Windows silently exited before writing rows. Fixed: exported PYTHONIOENCODING=utf-8 + PYTHONUTF8=1 in script.

[DRY-RUN RESULTS]
Test 1: Polarsteps us mostRecent p1  -> 50 records ✓
Test 2: Day One nz mostHelpful p1     -> 50 records ✓
Test 3: 世界迷雾 cn mostRecent p1    -> 50 records ✓

[COMPLETE T+12, dry-run 3/3 pass, ready for production]
