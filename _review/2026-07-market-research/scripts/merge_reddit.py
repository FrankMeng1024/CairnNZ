"""Merge all per-sub jsonl into the final reddit_outdoor.jsonl and print stats."""
import json, sys, io
from pathlib import Path
from collections import Counter

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

ROOT = Path(r"C:/ClaudeCodeProjects/Cairn/_review/2026-07-market-research")
PER_SUB_DIR = ROOT / "raw" / "_reddit_per_sub"
OUT = ROOT / "raw" / "reddit_outdoor.jsonl"

SUBS = ["hiking", "backpacking", "CampingandHiking", "newzealand", "tramping"]

# Keywords across which we compute frequency in raw_quote
PAIN_KEYWORDS = [
    "lost", "rescue", "stranded", "SAR", "search and rescue", "injured", "near miss",
    "hypothermia", "weather", "storm", "signal", "offline", "no service",
    "trail conditions", "trail closed", "closure", "river crossing", "bad map",
    "navigation", "off trail", "off-trail", "wrong way", "solo", "first time",
    "help", "advice", "beginner", "mistake", "scared", "close call", "emergency",
    "PLB", "beacon", "InReach", "battery died", "phone died", "no cell", "GPS failed",
    "route finding", "cairn", "washed out", "swept away", "cold", "wet", "night",
    "bear", "cougar", "snake", "moose", "encounter", "wildlife",
    "blister", "twisted ankle", "sprained", "fell", "fall", "slipped", "broke",
    "planning", "gear failure", "boots", "shoes", "layers", "food ran out",
    "hut", "trail", "track", "hike", "tramp", "pack", "map", "gps",
]

all_records = []
per_sub_counts = {}

for sub in SUBS:
    p = PER_SUB_DIR / f"{sub}.jsonl"
    if not p.exists():
        per_sub_counts[sub] = 0
        continue
    with p.open('r', encoding='utf-8') as f:
        recs = [json.loads(l) for l in f if l.strip()]
    for i, r in enumerate(recs, 1):
        r['id'] = f"rd_{sub}_{i:04d}"
    all_records.extend(recs)
    per_sub_counts[sub] = len(recs)

# Write final merged
with OUT.open('w', encoding='utf-8') as f:
    for r in all_records:
        f.write(json.dumps(r, ensure_ascii=False) + '\n')

print("=" * 60, flush=True)
print(f"FINAL TOTAL: {len(all_records)}", flush=True)
print(f"Output: {OUT}", flush=True)
print(f"\nPer-subreddit counts:", flush=True)
for sub, c in per_sub_counts.items():
    print(f"  r/{sub}: {c}", flush=True)

print(f"\nTop 20 keyword frequencies:", flush=True)
counter = Counter()
for r in all_records:
    tl = r['raw_quote'].lower()
    for kw in PAIN_KEYWORDS:
        if kw in tl:
            counter[kw] += 1
for kw, cnt in counter.most_common(20):
    print(f"  {kw}: {cnt}", flush=True)

# Post vs comment breakdown
n_post = sum(1 for r in all_records if r.get('type') == 'post')
n_comment = sum(1 for r in all_records if r.get('type') == 'comment')
print(f"\nPost/Comment breakdown: posts={n_post} comments={n_comment}", flush=True)

# Sample of top-upvoted posts by subreddit (a sanity check)
print(f"\nTop 3 highest-upvoted posts by subreddit:", flush=True)
for sub in SUBS:
    subrecs = [r for r in all_records if r['subreddit'] == sub and r['type'] == 'post']
    top = sorted(subrecs, key=lambda x: -x['upvotes'])[:3]
    print(f"  r/{sub}:", flush=True)
    for r in top:
        print(f"    {r['upvotes']:>6} | {r['post_title'][:80]}", flush=True)
