"""
Booster: pull additional r/tramping records using NZ-specific + broader queries.

Strategy: fetch by title queries relevant to NZ tramping culture, plus fetch
recent posts without keyword filter (small subreddit — every text post is signal).
Appends to existing tramping.jsonl and then triggers re-merge.
"""
import requests, json, time, sys, io
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

ROOT = Path(r"C:/ClaudeCodeProjects/Cairn/_review/2026-07-market-research")
PER = ROOT / "raw" / "_reddit_per_sub" / "tramping.jsonl"

HEADERS = {'User-Agent':'Mozilla/5.0 outdoor-research'}

# Broad NZ tramping culture queries — small sub means each keyword yields fewer results
QUERIES = [
    "tramp", "hut", "river", "track", "route", "great walk",
    "Milford", "Routeburn", "Tongariro", "Kepler", "Rees", "Dusky",
    "Whanganui", "Abel Tasman", "Heaphy", "Rakiura", "Pouakai",
    "gear", "boots", "pack", "raincoat", "food", "cooker",
    "weather", "avalanche", "windy", "flood", "rain", "cold",
    "hypo", "safety", "SAR", "PLB", "beacon", "InReach",
    "beginner", "solo", "first", "overnight", "multi-day",
    "topo50", "topo", "map", "nav", "compass",
    "hazard", "river crossing", "swollen", "flooded",
    "hut booking", "backcountry",
    "trip report", "car park", "shuttle", "transport",
]

def load_existing():
    if not PER.exists():
        return [], set()
    with PER.open('r', encoding='utf-8') as f:
        recs = [json.loads(l) for l in f if l.strip()]
    seen = {r.get('reddit_post_id') for r in recs if r.get('reddit_post_id')}
    return recs, seen

def polite(url, params, tag):
    for i in range(4):
        try:
            r = requests.get(url, params=params, headers=HEADERS, timeout=30)
            if r.status_code == 200:
                return r.json().get('data') or []
            if r.status_code in (429, 422):
                wait = [5,15,30,60][i]
                print(f"  [backoff {wait}s] {tag} ({r.status_code})", flush=True)
                time.sleep(wait); continue
            print(f"  [warn] {tag} status={r.status_code}"); return []
        except Exception as e:
            print(f"  [err] {tag} {e}"); time.sleep(5)
    return []

def normalize(post):
    body = post.get('selftext') or ''
    title = post.get('title') or ''
    combined = f"{title}\n\n{body}".strip()
    if len(combined) < 100: return None
    tl = combined.lower()
    if any(a in tl for a in ["alltrails","strava","day one","dayone","fog of world","polarsteps","一生足迹","gaia gps"]):
        return None
    return {
        "src": "reddit_r_tramping", "subreddit": "tramping",
        "post_title": title, "author": post.get('author') or 'unknown',
        "captured": "2026-07-19", "raw_quote": combined,
        "upvotes": post.get('score') or 0,
        "post_url": f"https://old.reddit.com/r/tramping/comments/{post.get('id','')}/",
        "type": "post", "reddit_post_id": post.get('id'),
        "created_utc": post.get('created_utc'),
    }

def main():
    records, seen = load_existing()
    print(f"starting from {len(records)} existing", flush=True)

    # Query-based expansion
    for q in QUERIES:
        posts = polite("https://arctic-shift.photon-reddit.com/api/posts/search",
                       {"subreddit":"tramping","title":q,"limit":100}, tag=f"tramping q={q!r}")
        added = 0
        for p in posts:
            pid = p.get('id')
            if not pid or pid in seen: continue
            rec = normalize(p)
            if not rec: continue
            records.append(rec); seen.add(pid); added += 1
        print(f"  q={q!r} raw={len(posts)} added={added} total={len(records)}", flush=True)
        # Save each round
        with PER.open('w', encoding='utf-8') as f:
            for r in records:
                f.write(json.dumps(r, ensure_ascii=False) + '\n')
        time.sleep(2.5)
        if len(records) >= 400:
            print(f"  cap 400 reached, stop", flush=True); break

    # Comments fetch for top 20 by score to reach even higher record count
    top_posts = sorted([r for r in records if r['type']=='post'],
                       key=lambda x: -x['upvotes'])[:25]
    print(f"  fetching comments for top {len(top_posts)}", flush=True)
    for r in top_posts:
        pid = r.get('reddit_post_id')
        if not pid: continue
        comments = polite("https://arctic-shift.photon-reddit.com/api/comments/search",
                          {"subreddit":"tramping","link_id":pid,"limit":10},
                          tag=f"comments {pid}")
        added = 0
        for c in comments:
            body = c.get('body') or ''
            if len(body) < 100: continue
            tl = body.lower()
            if any(a in tl for a in ["alltrails","strava","day one","dayone","fog of world","polarsteps","一生足迹","gaia gps"]):
                continue
            crec = {
                "src":"reddit_r_tramping","subreddit":"tramping",
                "post_title": r['post_title'], "author": c.get('author') or 'unknown',
                "captured":"2026-07-19","raw_quote":body,
                "upvotes": c.get('score') or 0,
                "post_url": r['post_url'], "type":"comment",
                "created_utc": c.get('created_utc'),
            }
            records.append(crec); added += 1
        if added:
            print(f"    +{added} comments from {r['post_title'][:50]!r}", flush=True)
            with PER.open('w', encoding='utf-8') as f:
                for r2 in records:
                    f.write(json.dumps(r2, ensure_ascii=False) + '\n')
        time.sleep(2.5)

    print(f"\nDONE. tramping total: {len(records)}", flush=True)

if __name__ == "__main__":
    main()
