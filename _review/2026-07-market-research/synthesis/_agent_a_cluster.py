#!/usr/bin/env python3
"""Deep-dive: pull representative quotes per emotional pattern + sub-cluster."""
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

BASE = Path("C:/ClaudeCodeProjects/Cairn/_review/2026-07-market-research")
META = BASE / "cleaned" / "metadata.jsonl"

records = []
with META.open(encoding="utf-8") as f:
    for line in f:
        try:
            r = json.loads(line)
        except Exception:
            continue
        if r.get("cairn_relevance", 0) >= 4 and r.get("intensity", 0) >= 4:
            records.append(r)

by_id = {r["id"]: r for r in records}

# Refined semantic patterns per emotional cluster
CLUSTERS = {
    # 1. Rage: subscription bait-switch (extreme)
    "subscription_betrayal": {
        "pat": r"(paywall|held (?:ransom|hostage)|used to be free|was free|took away|took our|hijack|hostage|extort|bait[- ]?and[- ]?switch|now (?:need|require|have to) (?:pay|subscri)|features (?:behind|locked)|removed feature|remove.*paywall|used.*free.*now|forced.*subscri|greedy|money grab|cash grab)",
        "min_len": 100,
    },
    # 2. Deep memory / crying
    "memories_tears": {
        "pat": r"(cried|tears|weep|10 year|20 year|since (?:20\d\d|high school|childhood)|opened.*journal|late (?:mother|father|husband|wife|dad|mom)|passed away|died|last time.*saw|only.*remain|memento|treasure)",
        "min_len": 50,
    },
    # 3. Data loss trauma
    "data_loss_horror": {
        "pat": r"(lost (?:all|my|every)|deleted (?:all|my)|wiped|disappeared|gone (?:forever|missing)|corrupt|sync (?:destroyed|deleted|overwrote|erased)|years of (?:entries|data|memories|trips)|can[' ]?t recover|no backup)",
        "min_len": 100,
    },
    # 4. Physical safety fear
    "safety_lost_in_wild": {
        "pat": r"(lost in|got lost|middle of nowhere|dead battery|no (?:signal|service|reception)|dark|storm|freezing|dangerous|almost died|rescue|emergency)",
        "min_len": 80,
    },
    # 5. Ownership sovereignty
    "my_data_ownership": {
        "pat": r"(my (?:data|routes|trips|memories|journal|entries)|export|takeout|leave.*app|lock[- ]?in|import|migrate|portability)",
        "min_len": 100,
    },
    # 6. Trail data quality outrage
    "trail_bad_data": {
        "pat": r"(wrong (?:trail|path|direction|route)|outdated|closed|no longer|doesn[' ]?t exist|inaccurate|misleading|led me|got me lost|takes you)",
        "min_len": 100,
    },
    # 7. Life-changing praise (deep)
    "life_changing_love": {
        "pat": r"(life[- ]?(?:changing|saver|saving)|changed my life|godsend|couldn[' ]?t live without|every (?:day|single day)|every (?:trip|hike|walk)|obsessed|addicted|companion)",
        "min_len": 80,
    },
    # 8. Community / social connection
    "community_belonging": {
        "pat": r"(community|share (?:with|my)|friends (?:who|use|see)|family use|inspire|inspired|showed my|show off|share.*trip|share.*hike|group|club)",
        "min_len": 100,
    },
    # 9. Anti-social / privacy retreat
    "solo_private": {
        "pat": r"(private|just for me|myself|no one else|only me|solo|alone|introvert|not social|hate social|no share)",
        "min_len": 80,
    },
    # 10. Time / years using (longevity)
    "long_time_user": {
        "pat": r"(\b(?:5|6|7|8|9|10|11|12|13|14|15|20)\s*(?:years?|yrs)|since 20(?:0[0-9]|1[0-9])|for (?:over |more than )?a decade|for years)",
        "min_len": 50,
    },
    # 11. Chinese emotional
    "zh_deep_emotion": {
        "pat": r"(感动|难忘|治愈|温暖|珍贵|眼泪|哭|回忆|陪伴|见证|多年)",
        "min_len": 30,
    },
    "zh_rage_price": {
        "pat": r"(垃圾|烂|气死|恶心|吃相|难用|坑|骗|退款|投诉|涨价|会员|割韭菜|付费墙)",
        "min_len": 30,
    },
    # 12. Battery drain fury
    "battery_drain": {
        "pat": r"(battery (?:drain|dead|killed?|dies|hog)|drain.*battery|kills? (?:my|the) (?:phone|battery)|phone dies|dead phone)",
        "min_len": 80,
    },
    # 13. Nagging / interruption
    "nagging_upsell": {
        "pat": r"(pop[- ]?up|nag|constantly ask|every time.*ask|remind|annoying (?:pop|notif|ad)|keeps? (?:asking|prompting)|shoved|throw.*ads|intrusive)",
        "min_len": 80,
    },
    # 14. Auto-detect / tracking bugs
    "tracking_broken": {
        "pat": r"(tracking (?:broken|not work|failed|stopped|off)|GPS (?:off|wrong|inaccurate|drift|jump)|distance (?:wrong|off|inaccurate)|didn[' ]?t (?:track|record)|lost my (?:track|route|recording))",
        "min_len": 80,
    },
    # 15. Fog of world specific — completion / obsession
    "map_completion_obsession": {
        "pat": r"(fog|reveal|explore|uncover|cover|complet(?:ion|ed|ist)|100%|percent|unlock area|clear the map|paint.*map|fill.*map|blank)",
        "min_len": 80,
    },
    # 16. Journaling ritual
    "daily_journal_ritual": {
        "pat": r"(every (?:day|morning|night)|daily|habit|ritual|routine|streak|first thing|before bed|reflect|mindful)",
        "min_len": 100,
    },
    # 17. Import / migration desire
    "import_migration": {
        "pat": r"(import (?:from|my)|migrate|switch (?:from|to)|come from|used to use|left (?:strava|alltrails|polarsteps|dayone))",
        "min_len": 60,
    },
    # 18. AI / features skepticism
    "ai_backlash": {
        "pat": r"\bAI\b|artificial intelli|ChatGPT|GPT|LLM|prompt|generated (?:by|content)",
        "min_len": 60,
    },
    # 19. Third party apple watch / wearables
    "wearable_gap": {
        "pat": r"(apple watch|wear ?os|garmin|fitbit|wearable|watch (?:app|complication|face))",
        "min_len": 60,
    },
    # 20. Offline / no signal core need
    "offline_map_need": {
        "pat": r"(offline (?:map|route|trail|access|use)|no (?:cell|signal|service|wifi)|download.*(?:trail|map|route)|available offline|works? offline)",
        "min_len": 80,
    },
}

# Match and categorize
theme_records = defaultdict(list)
for r in records:
    q = r.get("raw_quote", "")
    if len(q) < 20:
        continue
    for tname, cfg in CLUSTERS.items():
        if len(q) < cfg["min_len"]:
            continue
        if re.search(cfg["pat"], q, re.IGNORECASE):
            theme_records[tname].append(r)

# Summarize each theme
themes_out = {}
for tname, recs in theme_records.items():
    if not recs:
        continue
    # Sort by intensity desc + length desc (rant power)
    recs_sorted = sorted(recs, key=lambda r: (-r.get("intensity", 0), -len(r.get("raw_quote", ""))))
    src_dist = Counter(r["source"] for r in recs)
    cat_dist = Counter(r.get("category_primary", "?") for r in recs)
    avg_intensity = sum(r.get("intensity", 0) for r in recs) / len(recs)
    themes_out[tname] = {
        "count": len(recs),
        "src_dist": dict(src_dist.most_common(10)),
        "cat_dist": dict(cat_dist),
        "avg_intensity": round(avg_intensity, 2),
        "top_quotes": [
            {"id": r["id"], "src": r["source"], "intensity": r["intensity"],
             "cat": r.get("category_primary"),
             "quote": r["raw_quote"][:800]}
            for r in recs_sorted[:5]
        ],
    }

# Save
out = BASE / "synthesis" / "_agent_a_themes.json"
out.write_text(json.dumps(themes_out, indent=2, ensure_ascii=False), encoding="utf-8")
print(f"Themes: {len(themes_out)}")
for t, d in sorted(themes_out.items(), key=lambda x: -x[1]["count"]):
    print(f"  {t}: {d['count']} avg_i={d['avg_intensity']}")

# Also: how many records covered by at least one theme
covered = set()
for recs in theme_records.values():
    for r in recs:
        covered.add(r["id"])
print(f"\nCoverage: {len(covered)}/{len(records)} = {len(covered)*100//len(records)}%")
