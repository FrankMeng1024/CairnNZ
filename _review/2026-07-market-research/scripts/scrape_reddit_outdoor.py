"""
Scrape user pain-point posts + comments from outdoor subreddits.

Primary source: arctic-shift.photon-reddit.com (photon-reddit's Arctic Shift archive)
Fallback: api.pullpush.io (Pushshift replacement)

Output: raw/reddit_outdoor.jsonl
"""
import requests
import json
import time
import sys
import io
from pathlib import Path
from collections import Counter

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

ROOT = Path(r"C:/ClaudeCodeProjects/Cairn/_review/2026-07-market-research")
RAW_DIR = ROOT / "raw"
PER_SUB_DIR = RAW_DIR / "_reddit_per_sub"
OUT = RAW_DIR / "reddit_outdoor.jsonl"

HEADERS = {'User-Agent': 'Mozilla/5.0 outdoor-research-project'}

SUBREDDITS = ["hiking", "backpacking", "CampingandHiking", "newzealand", "tramping"]

PAIN_KEYWORDS = [
    "lost", "rescue", "stranded", "SAR", "search and rescue", "injured", "near miss",
    "hypothermia", "weather", "storm", "signal", "no signal", "offline", "no service",
    "trail conditions", "trail closed", "closure", "river crossing", "bad map",
    "navigation", "off trail", "off-trail", "wrong way", "solo", "first time",
    "help", "advice", "beginner", "mistake", "scared", "close call", "emergency",
    "PLB", "beacon", "InReach", "battery died", "phone died", "no cell", "GPS failed",
    "route finding", "cairn", "washed out", "swept away", "cold", "wet", "night",
    "bear", "cougar", "snake", "moose", "encounter", "wildlife",
    "blister", "twisted ankle", "sprained", "fell", "fall", "slipped", "broke",
    "planning", "gear failure", "boots", "shoes", "layers", "food ran out",
]

APP_EXCLUDES = [
    "alltrails", "all trails", "strava", "day one", "dayone", "fog of world",
    "fogofworld", "polarsteps", "一生足迹", "gaia gps", "gaiagps",
]

# Title-based queries. Arctic-shift filters on title match.
QUERIES_GENERAL = [
    "lost", "rescue", "help", "solo", "first", "beginner",
    "scared", "hypothermia", "storm", "close call", "injured",
    "advice", "mistake", "SAR", "emergency", "stranded",
    "night", "weather", "trail", "planning", "gear",
    "blister", "fell", "cold",
]

QUERIES_NZ = [
    "tramping", "track", "hut", "backcountry", "SAR",
    "hypothermia", "river", "Milford", "Routeburn", "Tongariro",
    "Kepler", "great walk", "alpine", "DOC", "rescued",
]

BASE_DELAY = 2.5
ARCTIC = "https://arctic-shift.photon-reddit.com/api/posts/search"
ARCTIC_COMMENTS = "https://arctic-shift.photon-reddit.com/api/comments/search"
PULLPUSH = "https://api.pullpush.io/reddit/submission/search"

def polite_get(url, params, tag=""):
    for attempt in range(4):
        try:
            r = requests.get(url, params=params, headers=HEADERS, timeout=30)
            if r.status_code == 200:
                return r.json().get('data') or []
            if r.status_code in (429, 422):  # rate limit or slow-down
                wait = [5, 15, 30, 60][attempt]
                print(f"  [backoff {wait}s] {tag} ({r.status_code})", flush=True)
                time.sleep(wait)
                continue
            print(f"  [warn] status {r.status_code} for {tag}: {r.text[:80]}", flush=True)
            return []
        except Exception as e:
            print(f"  [warn] {tag} err: {str(e)[:80]}", flush=True)
            time.sleep(8)
    return []

def is_app_post(text):
    tl = text.lower()
    return any(app in tl for app in APP_EXCLUDES)

def normalize_post(sub, post):
    body = post.get('selftext') or ''
    title = post.get('title') or ''
    combined = f"{title}\n\n{body}".strip()
    if len(combined) < 100:
        return None
    if is_app_post(combined):
        return None
    return {
        "src": f"reddit_r_{sub}",
        "subreddit": sub,
        "post_title": title,
        "author": post.get('author') or 'unknown',
        "captured": "2026-07-19",
        "raw_quote": combined,
        "upvotes": post.get('score') or 0,
        "post_url": f"https://old.reddit.com/r/{sub}/comments/{post.get('id','')}/",
        "type": "post",
        "reddit_post_id": post.get('id'),
        "created_utc": post.get('created_utc'),
    }

def normalize_comment(sub, comment, post_title, post_url):
    body = comment.get('body') or ''
    if len(body) < 100:
        return None
    if is_app_post(body):
        return None
    return {
        "src": f"reddit_r_{sub}",
        "subreddit": sub,
        "post_title": post_title,
        "author": comment.get('author') or 'unknown',
        "captured": "2026-07-19",
        "raw_quote": body,
        "upvotes": comment.get('score') or 0,
        "post_url": post_url,
        "type": "comment",
        "created_utc": comment.get('created_utc'),
    }

def has_outdoor_signal_nz(text):
    tl = text.lower()
    return any(w in tl for w in [
        'track', 'trail', 'tramp', 'hike', 'hut', 'walk',
        'backcountry', 'alpine', 'mountain', 'doc ',
        'milford', 'routeburn', 'tongariro', 'kepler',
        'aoraki', 'fiordland', 'wanaka', 'sar', 'rescue',
        'lost', 'hypothermia', 'river', 'crossing',
    ])

def scrape_subreddit(sub, per_sub_file):
    print(f"\n=== r/{sub} ===", flush=True)
    records = []
    seen_reddit_ids = set()

    queries = QUERIES_NZ if sub == "newzealand" else QUERIES_GENERAL

    for q in queries:
        posts = polite_get(ARCTIC, {'subreddit': sub, 'title': q, 'limit': 100}, tag=f"{sub} title={q!r}")
        added = 0
        for p in posts:
            pid = p.get('id')
            if not pid or pid in seen_reddit_ids:
                continue
            rec = normalize_post(sub, p)
            if not rec:
                continue
            if sub == "newzealand" and not has_outdoor_signal_nz(rec['raw_quote']):
                continue
            records.append(rec)
            seen_reddit_ids.add(pid)
            added += 1
        print(f"  q={q!r}: raw={len(posts)} kept={added} total={len(records)}", flush=True)

        # Persist after each query
        with per_sub_file.open('w', encoding='utf-8') as f:
            for r in records:
                f.write(json.dumps(r, ensure_ascii=False) + '\n')

        time.sleep(BASE_DELAY)

    # Comments phase: arctic-shift comments endpoint
    top_posts = sorted([r for r in records if r['type'] == 'post'],
                       key=lambda x: -x['upvotes'])[:15]
    print(f"  fetching comments for top {len(top_posts)} posts...", flush=True)
    for r in top_posts:
        post_reddit_id = r.get('reddit_post_id')
        if not post_reddit_id:
            continue
        # arctic-shift comments filter by link_id
        comments = polite_get(ARCTIC_COMMENTS,
                              {'subreddit': sub, 'link_id': post_reddit_id, 'limit': 10},
                              tag=f"{sub} comments {post_reddit_id}")
        c_added = 0
        for c in comments:
            crec = normalize_comment(sub, c, r['post_title'], r['post_url'])
            if crec:
                records.append(crec)
                c_added += 1
        if c_added:
            print(f"    +{c_added} comments from {r['post_title'][:50]!r}", flush=True)
            with per_sub_file.open('w', encoding='utf-8') as f:
                for r2 in records:
                    f.write(json.dumps(r2, ensure_ascii=False) + '\n')
        time.sleep(BASE_DELAY)

    return records

def merge_and_stats():
    all_records = []
    per_sub_counts = {}
    for sub in SUBREDDITS:
        per_sub_file = PER_SUB_DIR / f"{sub}.jsonl"
        if not per_sub_file.exists():
            per_sub_counts[sub] = 0
            continue
        with per_sub_file.open('r', encoding='utf-8') as f:
            recs = [json.loads(l) for l in f if l.strip()]
        for i, r in enumerate(recs, 1):
            r['id'] = f"rd_{sub}_{i:04d}"
        all_records.extend(recs)
        per_sub_counts[sub] = len(recs)

    with OUT.open('w', encoding='utf-8') as f:
        for r in all_records:
            f.write(json.dumps(r, ensure_ascii=False) + '\n')

    print("\n" + "="*60, flush=True)
    print(f"TOTAL: {len(all_records)} records -> {OUT}", flush=True)
    print("\nPer-subreddit:", flush=True)
    for sub, c in per_sub_counts.items():
        print(f"  r/{sub}: {c}", flush=True)

    print("\nTop 15 pain keywords:", flush=True)
    counter = Counter()
    for r in all_records:
        tl = r['raw_quote'].lower()
        for kw in PAIN_KEYWORDS:
            if kw in tl:
                counter[kw] += 1
    for kw, cnt in counter.most_common(15):
        print(f"  {kw}: {cnt}", flush=True)

def main():
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    PER_SUB_DIR.mkdir(parents=True, exist_ok=True)

    for sub in SUBREDDITS:
        per_sub_file = PER_SUB_DIR / f"{sub}.jsonl"
        if per_sub_file.exists() and per_sub_file.stat().st_size > 0:
            with per_sub_file.open('r', encoding='utf-8') as f:
                cached = sum(1 for l in f if l.strip())
            print(f"\n=== r/{sub} === (cached {cached} records, skip)", flush=True)
        else:
            scrape_subreddit(sub, per_sub_file)

    merge_and_stats()

if __name__ == "__main__":
    main()
