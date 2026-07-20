#!/usr/bin/env python3
"""Phase 2 auto-encoder: apply CATEGORY_DECISION_TREE + intensity + relevance to all 21K iTunes records + markdown sources.

Output: cleaned/metadata.jsonl (one record per line, HTML_INDEX_SCHEMA format)
"""
import json
import os
import sys
import re
from pathlib import Path
from datetime import datetime

ROOT = Path("C:/ClaudeCodeProjects/Cairn/_review/2026-07-market-research")
RAW = ROOT / "raw"
CLEANED = ROOT / "cleaned"
CLEANED.mkdir(exist_ok=True)

OUT_JSONL = CLEANED / "metadata.jsonl"
OUT_LOG = CLEANED / "encode_log.md"

# Keyword banks (case-insensitive substring match)
KEYWORDS = {
    "pain": [
        "wish", "missing", "can't", "cant", "cannot", "unable", "wont let", "doesnt work",
        "doesn't work", "broken", "bug", "crash", "freeze", "stuck", "hang", "fail", "error",
        "issue", "problem", "annoying", "frustrat", "should be able", "should have", "hope they add",
        "希望", "缺少", "没有", "崩溃", "闪退", "卡住", "无法", "bug", "问题",
    ],
    "praise": [
        "love this", "love it", "amazing", "brilliant", "perfect", "changed my life", "changed my",
        "excellent", "fantastic", "incredible", "wonderful", "obsessed", "absolutely",
        "best app", "great app", "highly recommend", "10/10", "5 stars", "must have",
        "meeting old me", "look forward",
        "喜欢", "太棒", "超级好", "神器", "最爱", "推荐",
    ],
    "pricing": [
        "$", "subscription", "subscribe", "cancel", "canceling", "cancelling", "refund",
        "renewal", "auto renew", "expensive", "overpriced", "worth the price", "paid",
        "premium", "free tier", "trial", "money", "charge", "billing", "price hike",
        "paywall", "locked behind", "without subscribing", "pay to unlock",
        "年费", "订阅", "买断", "退订", "退款", "月费", "价格", "太贵", "值", "会员",
    ],
    "emotion": [
        # STRICT: must be paired with nostalgia anchor
        "on this day", "still remember", "still have", "look back", "years later",
        "made me cry", "cried tears", "nostalgic", "reminds me of", "grateful for",
        "made my day", "saved my", "10 years", "8 years", "5 years",
        "回忆", "怀念", "感动", "泪目", "回看", "多年后", "N 年", "以前的自己", "旧的自己",
    ],
    "relation": [
        "share with", "shared with", "only my", "only friends", "private", "public",
        "family", "friends", "close friends", "not the world", "not everyone",
        "strangers", "someone else", "trail angel", "random person",
        "follower", "follow", "circle", "group", "invite",
        "分享", "好友", "朋友", "私密", "陌生人", "家人", "圈子",
    ],
}

# Weak emotion signals — require pairing with strict emotion keyword
EMOTION_WEAK_ANCHORS = ["feels like", "years ago", "made me cry", "reminds me", "childhood", "grateful"]
EMOTION_MUST_PAIR = ["回忆", "怀念", "look back", "still remember", "years later", "on this day",
                     "回看", "多年后", "nostalgic", "reminds me of my"]

# Pricing-lock override phrases (upgrade pain→pricing when detected)
PRICING_LOCK = ["locked behind", "premium", "without subscribing", "paywall",
                "pay to unlock", "for free users", "if you don't subscribe",
                "订阅才能", "会员才能"]

# Intensity keywords (5-point scale)
INTENSITY_5 = ["absolutely", "life-changing", "changed my life", "saved my", "would die",
               "10/10", "!!!", "PERFECT", "AMAZING", "!!", "obsessed",
               "太棒了", "神器", "跪了", "泪目", "!!!"]
INTENSITY_1 = ["okay", "fine", "works", "as expected", "no complaints", "解决"]

# Cairn relevance keywords (score 5 = direct hit)
CAIRN_RELEVANT_5 = [
    "gps", "track", "trail", "hike", "hiking", "tramping", "walk", "map", "offline",
    "marker", "pin", "flag", "note", "journal", "diary", "memory", "memories",
    "fog", "explor", "visit", "route", "waypoint", "cairn",
    "on this day", "years later", "friend", "share",
    "轨迹", "记录", "徒步", "地图", "离线", "标记", "手账", "日记", "回忆",
    "迷雾", "足迹", "朋友", "分享", "隐私",
]

CAIRN_RELEVANT_1 = [
    "trail conditions", "gear", "backpack", "boots", "route recommend",
    "路线推荐", "装备", "背包",
]

def score_category(text):
    """Return (primary, secondary_list) using decision tree order."""
    # Normalize apostrophes (Priority 3)
    text_norm = text.replace("'", "").replace("\u2019", "").replace("\u2018", "")
    text_lower = text_norm.lower()
    original_lower = text.lower()  # keep for chinese
    matches = {}
    for cat, kws in KEYWORDS.items():
        for kw in kws:
            if kw.lower() in text_lower or kw in original_lower:
                # Priority 1: strict emotion - weak anchors don't count alone
                if cat == "emotion" and kw.lower() in [w.lower() for w in EMOTION_WEAK_ANCHORS]:
                    # Only count if a strict anchor also present
                    if not any(a.lower() in text_lower or a in original_lower for a in EMOTION_MUST_PAIR):
                        continue
                matches[cat] = matches.get(cat, 0) + 1
    if not matches:
        return None, []
    # Priority 2: pricing lock override - if pain + pricing lock phrase detected, upgrade to pricing
    if matches.get("pain", 0) > 0 and any(p.lower() in text_lower or p in original_lower for p in PRICING_LOCK):
        matches["pricing"] = matches.get("pricing", 0) + 3  # heavy boost
    # Priority order: pain > praise > pricing > emotion > relation > complaint (fallback)
    order = ["pain", "praise", "pricing", "emotion", "relation"]
    sorted_matches = sorted(matches.items(), key=lambda x: (order.index(x[0]) if x[0] in order else 99, -x[1]))
    primary = sorted_matches[0][0]
    secondary = [c for c, _ in sorted_matches[1:] if c != primary]
    return primary, secondary[:3]

def score_intensity(text, rating=None):
    """1-5 based on extreme words + rating + caps/exclaims."""
    t = text.lower()
    score = 3  # default neutral
    if any(w in t for w in [w.lower() for w in INTENSITY_5]):
        score = 5
    elif any(w in t for w in INTENSITY_1):
        score = 2
    # rating boost
    if rating is not None:
        if rating == 1: score = max(score, 4)
        elif rating == 2: score = max(score, 3)
        elif rating == 5 and any(w in t for w in ["love", "amazing", "obsessed"]): score = max(score, 4)
    # caps/exclaim boost
    caps_ratio = sum(1 for c in text if c.isupper()) / max(len(text), 1)
    if caps_ratio > 0.3 or text.count("!") >= 3:
        score = min(5, score + 1)
    return min(5, max(1, score))

def score_cairn_relevance(text):
    """1-5 based on keyword hits."""
    t = text.lower()
    hits_5 = sum(1 for kw in CAIRN_RELEVANT_5 if kw.lower() in t)
    hits_1 = sum(1 for kw in CAIRN_RELEVANT_1 if kw.lower() in t)
    if hits_1 >= 3 and hits_5 <= 1:
        return 1
    if hits_5 >= 3:
        return 5
    if hits_5 >= 2:
        return 4
    if hits_5 >= 1:
        return 3
    return 2

def detect_language(text):
    """Rough zh vs en detection."""
    zh_chars = sum(1 for c in text if '\u4e00' <= c <= '\u9fff')
    total = len(text)
    if total == 0: return "en"
    return "zh" if zh_chars / total > 0.15 else "en"

def process_itunes_jsonl(path, id_counter):
    """Yield HTML_INDEX_SCHEMA records from iTunes JSONL."""
    with open(path, 'r', encoding='utf-8', errors='replace') as f:
        for line in f:
            try:
                r = json.loads(line)
            except:
                continue
            text = (r.get("title", "") + "\n" + r.get("content", "")).strip()
            if not text or len(text) < 10:
                continue
            # Priority 4: skip low-signal short reviews (< 30 chars with no meaningful keyword)
            if len(text) < 30:
                text_low = text.lower()
                has_signal = any(k.lower() in text_low for cat in KEYWORDS.values() for k in cat)
                if not has_signal:
                    continue
            id_counter[0] += 1
            source_slug = f"appstore_{r.get('app_slug', 'unknown')}_{r.get('region', 'xx')}"
            primary, secondary = score_category(text)
            if primary is None:
                # Fallback: rating decides
                rating = r.get("rating", 3)
                if rating <= 2:
                    primary = "complaint"
                elif rating >= 4:
                    primary = "praise"
                else:
                    continue  # skip 3-star with no keyword
            rating = r.get("rating")
            yield {
                "id": f"a{id_counter[0]:06d}",
                "source": source_slug,
                "source_url": f"https://apps.apple.com/{r.get('region')}/app/id{r.get('app_id')}",
                "author": r.get("author"),
                "captured_at": r.get("updated") or datetime.utcnow().isoformat() + "Z",
                "raw_quote": text[:1500],  # cap for HTML display
                "category_primary": primary,
                "category_secondary": secondary,
                "intensity": score_intensity(text, rating),
                "language": detect_language(text),
                "cairn_relevance": score_cairn_relevance(text),
                "themes": [],
                "rating": rating,
                "app_slug": r.get("app_slug"),
                "region": r.get("region"),
            }

def process_markdown_source(path, source_slug, id_prefix, id_counter):
    """Parse YAML-front-matter-ish markdown into records."""
    text = path.read_text(encoding='utf-8', errors='replace')
    # Simple split by --- separator or ## POST:
    blocks = re.split(r'\n---\n|\n## POST:', text)
    for block in blocks:
        block = block.strip()
        if len(block) < 50:
            continue
        # Extract raw_quote or first text content
        raw = block
        # Try to find raw_quote/raw_body/raw_body block
        m = re.search(r'raw_(?:quote|body|body):\s*\|(.*?)(?=\n\w|\Z)', block, re.DOTALL)
        if m:
            raw = m.group(1).strip()
        else:
            # Take first non-metadata line
            lines = [l for l in block.split('\n') if l.strip() and not l.strip().startswith(('id:', 'source', 'author', 'captured', 'score:', 'rating:', 'sentiment', 'is_', 'review_date', 'raw_'))]
            raw = ' '.join(lines[:20])[:1500]
        if len(raw) < 20:
            continue
        id_counter[0] += 1
        primary, secondary = score_category(raw)
        if primary is None:
            primary = "complaint"
        # Try to extract source_url
        url_m = re.search(r'source_url:\s*(\S+)', block)
        url = url_m.group(1) if url_m else ""
        yield {
            "id": f"{id_prefix}{id_counter[0]:04d}",
            "source": source_slug,
            "source_url": url,
            "author": None,
            "captured_at": datetime.utcnow().isoformat() + "Z",
            "raw_quote": raw[:1500],
            "category_primary": primary,
            "category_secondary": secondary,
            "intensity": score_intensity(raw),
            "language": detect_language(raw),
            "cairn_relevance": score_cairn_relevance(raw),
            "themes": [],
        }

def main():
    id_counter = [0]
    md_id_counter = [0]
    out_records = []
    stats = {"total": 0, "by_source": {}, "by_category": {}, "by_intensity": {}, "by_cairn": {}}

    # 1. iTunes JSONL files
    appstore_dir = RAW / "02_appstore"
    for jsonl in sorted(appstore_dir.glob("*.jsonl")):
        count = 0
        for rec in process_itunes_jsonl(jsonl, id_counter):
            out_records.append(rec)
            count += 1
            stats["total"] += 1
            stats["by_source"][rec["source"]] = stats["by_source"].get(rec["source"], 0) + 1
            stats["by_category"][rec["category_primary"]] = stats["by_category"].get(rec["category_primary"], 0) + 1
            stats["by_intensity"][rec["intensity"]] = stats["by_intensity"].get(rec["intensity"], 0) + 1
            stats["by_cairn"][rec["cairn_relevance"]] = stats["by_cairn"].get(rec["cairn_relevance"], 0) + 1
        print(f"iTunes {jsonl.name}: {count} records", file=sys.stderr)

    # 2. Markdown sources
    md_sources = [
        (RAW / "01_reddit" / "dayoneapp.md", "reddit_r_dayoneapp", "rd"),
        (RAW / "01_reddit" / "polarsteps.md", "reddit_r_polarsteps", "rp"),
        (RAW / "01_reddit" / "tramping.md", "reddit_r_tramping", "rt"),
        (RAW / "03_trustpilot" / "polarsteps_rerun.md", "trustpilot_polarsteps", "tp"),
        (RAW / "03_trustpilot" / "dayone.md", "trustpilot_dayone", "td"),
        (RAW / "05_chinese" / "long_reviews.md", "chinese_reviews", "cn"),
        (RAW / "07_feedback_mechanism" / "all_sources.md", "q2_feedback_psychology", "q2"),
    ]
    for path, source_slug, prefix in md_sources:
        if not path.exists():
            print(f"MD MISSING: {path}", file=sys.stderr)
            continue
        count = 0
        for rec in process_markdown_source(path, source_slug, prefix, md_id_counter):
            out_records.append(rec)
            count += 1
            stats["total"] += 1
            stats["by_source"][rec["source"]] = stats["by_source"].get(rec["source"], 0) + 1
            stats["by_category"][rec["category_primary"]] = stats["by_category"].get(rec["category_primary"], 0) + 1
            stats["by_intensity"][rec["intensity"]] = stats["by_intensity"].get(rec["intensity"], 0) + 1
            stats["by_cairn"][rec["cairn_relevance"]] = stats["by_cairn"].get(rec["cairn_relevance"], 0) + 1
        print(f"MD {path.name}: {count} records", file=sys.stderr)

    # 3. Write output
    with open(OUT_JSONL, 'w', encoding='utf-8') as f:
        for rec in out_records:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")

    # 4. Write log
    with open(OUT_LOG, 'w', encoding='utf-8') as f:
        f.write(f"# Phase 2 Encode Log\n\n")
        f.write(f"Generated: {datetime.utcnow().isoformat()}Z\n\n")
        f.write(f"## Total records: {stats['total']}\n\n")
        f.write("## By source\n\n")
        for k, v in sorted(stats["by_source"].items(), key=lambda x: -x[1]):
            f.write(f"- {k}: {v}\n")
        f.write("\n## By category\n\n")
        for k, v in sorted(stats["by_category"].items(), key=lambda x: -x[1]):
            f.write(f"- {k}: {v}\n")
        f.write("\n## By intensity\n\n")
        for k in sorted(stats["by_intensity"].keys()):
            f.write(f"- {k}: {stats['by_intensity'][k]}\n")
        f.write("\n## By Cairn relevance\n\n")
        for k in sorted(stats["by_cairn"].keys()):
            f.write(f"- {k}: {stats['by_cairn'][k]}\n")

    print(f"[DONE] {stats['total']} records → {OUT_JSONL}", file=sys.stderr)

if __name__ == "__main__":
    main()
