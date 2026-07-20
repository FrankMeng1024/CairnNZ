#!/usr/bin/env python3
"""Phase 3 Agent A - Emotional Intensity Clustering."""
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

BASE = Path("C:/ClaudeCodeProjects/Cairn/_review/2026-07-market-research")
META = BASE / "cleaned" / "metadata.jsonl"

# Load high-signal records: cairn_relevance>=4 AND intensity>=4
records = []
with META.open(encoding="utf-8") as f:
    for line in f:
        try:
            r = json.loads(line)
        except Exception:
            continue
        if r.get("cairn_relevance", 0) >= 4 and r.get("intensity", 0) >= 4:
            records.append(r)

print(f"High-signal records: {len(records)}")

# Language mix + source
by_lang = Counter(r.get("language", "?") for r in records)
by_src = Counter(r.get("source", "?") for r in records)
by_cat = Counter(r.get("category_primary", "?") for r in records)

print("Languages:", by_lang.most_common(10))
print("Top sources:", by_src.most_common(15))
print("Categories:", by_cat.most_common())

# Extract emotional signal keywords in raw_quote
# Strong emotion markers (multi-lang)
STRONG = {
    # English rage
    "en_rage": r"\b(hate|angry|furious|fuming|infuriating|ridiculous|garbage|trash|useless|worthless|scam|rip[- ]?off|awful|terrible|horrible|disaster|nightmare|frustrat|piss|bulls|pathetic|disgust)",
    # English deep love
    "en_love": r"\b(love this|absolutely love|obsessed|life[- ]saver|life[- ]changing|godsend|magical|magic|priceless|treasure|cherish|cried|tears|weep|memori)",
    # English pricing rage
    "en_price_rage": r"\b(overpriced|price hike|too expensive|greedy|money grab|cash grab|paywall|subscription|extort|hostage|held ransom|refund)",
    # Emotion state
    "en_lost_scared": r"\b(lost|stranded|scared|panic|dead battery|drained|no signal|middle of nowhere|dark|storm)",
    # Chinese
    "zh_love": r"(感动|难忘|治愈|温暖|珍贵|眼泪|哭|回忆|陪伴|见证)",
    "zh_rage": r"(垃圾|烂|气死|恶心|吃相|难用|坑|骗|退款|投诉|恶臭|傻)",
    "zh_price": r"(涨价|会员|开通|订阅|贵|不值|割韭菜|付费墙)",
    # Data loss (extreme emotion trigger)
    "data_loss": r"\b(lost my|deleted|gone|disappeared|wiped|erased|corrupted|synced away)|数据(丢|没了|清空|消失)",
    # Ownership sovereignty
    "own_data": r"\b(my data|my routes|my memories|export|takeout|leave|lock[- ]?in)|我的(数据|轨迹|记录)",
}

pattern_counts = defaultdict(list)
for r in records:
    q = r.get("raw_quote", "")
    for name, pat in STRONG.items():
        if re.search(pat, q, re.IGNORECASE):
            pattern_counts[name].append(r["id"])

print("\nPattern hits:")
for name, ids in sorted(pattern_counts.items(), key=lambda x: -len(x[1])):
    print(f"  {name}: {len(ids)}")

# Length analysis - rant detection
long_rants = [r for r in records if len(r.get("raw_quote", "")) > 500]
print(f"\nLong rants (>500 chars): {len(long_rants)}")
super_rants = [r for r in records if len(r.get("raw_quote", "")) > 1500]
print(f"Super rants (>1500 chars): {len(super_rants)}")

# Save intermediate stats
out = BASE / "synthesis" / "_agent_a_stats.json"
out.write_text(json.dumps({
    "total_high_signal": len(records),
    "by_lang": dict(by_lang),
    "by_src": dict(by_src.most_common(30)),
    "by_cat": dict(by_cat),
    "pattern_counts": {k: len(v) for k, v in pattern_counts.items()},
    "long_rants": len(long_rants),
    "super_rants": len(super_rants),
    "pattern_sample_ids": {k: v[:20] for k, v in pattern_counts.items()},
}, indent=2, ensure_ascii=False), encoding="utf-8")
print(f"\nStats saved to {out}")
