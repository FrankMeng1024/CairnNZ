import json
from collections import Counter, defaultdict

path = "C:/ClaudeCodeProjects/Cairn/_review/2026-07-market-research/cleaned/metadata.jsonl"
records = []
with open(path, 'r', encoding='utf-8') as f:
    for line in f:
        try:
            records.append(json.loads(line))
        except:
            pass

print(f"total records: {len(records)}")

# Basic distributions
sources = Counter(r.get('source', 'unknown') for r in records)
app_slugs = Counter(r.get('app_slug', 'unknown') for r in records)
regions = Counter(r.get('region', 'unknown') for r in records)
categories = Counter(r.get('category_primary', 'unknown') for r in records)
langs = Counter(r.get('language', 'unknown') for r in records)
intensities = Counter(r.get('intensity', 0) for r in records)
relevances = Counter(r.get('cairn_relevance', 0) for r in records)

print("\n=== APP SLUGS ===")
for k, v in app_slugs.most_common(30):
    print(f"  {k}: {v}")

print("\n=== REGIONS ===")
for k, v in regions.most_common(20):
    print(f"  {k}: {v}")

print("\n=== CATEGORIES ===")
for k, v in categories.most_common():
    print(f"  {k}: {v}")

print("\n=== LANGUAGES ===")
for k, v in langs.most_common():
    print(f"  {k}: {v}")

print("\n=== INTENSITY ===")
for k, v in sorted(intensities.items()):
    print(f"  {k}: {v}")

print("\n=== CAIRN_RELEVANCE ===")
for k, v in sorted(relevances.items()):
    print(f"  {k}: {v}")

# Category x App
print("\n=== CATEGORY x APP_SLUG (top pairs) ===")
cat_app = Counter()
for r in records:
    cat_app[(r.get('category_primary'), r.get('app_slug'))] += 1
for k, v in cat_app.most_common(50):
    print(f"  {k[0]:15s} x {k[1]:15s} = {v}")

# Category x App x Region
print("\n=== CATEGORY x APP x REGION (top 40) ===")
tri = Counter()
for r in records:
    tri[(r.get('category_primary'), r.get('app_slug'), r.get('region'))] += 1
for k, v in tri.most_common(40):
    print(f"  {k[0]:12s} x {k[1]:12s} x {k[2]:6s} = {v}")

# intensity=5 by app
print("\n=== INTENSITY=5 by APP_SLUG ===")
i5 = Counter()
for r in records:
    if r.get('intensity') == 5:
        i5[r.get('app_slug')] += 1
for k, v in i5.most_common():
    print(f"  {k}: {v}")

# intensity=5 by category
print("\n=== INTENSITY=5 by CATEGORY ===")
i5c = Counter()
for r in records:
    if r.get('intensity') == 5:
        i5c[r.get('category_primary')] += 1
for k, v in i5c.most_common():
    print(f"  {k}: {v}")

# relevance=5 by category
print("\n=== RELEVANCE=5 by CATEGORY ===")
r5c = Counter()
for r in records:
    if r.get('cairn_relevance') == 5:
        r5c[r.get('category_primary')] += 1
for k, v in r5c.most_common():
    print(f"  {k}: {v}")

# relevance=5 by app
print("\n=== RELEVANCE=5 by APP ===")
r5a = Counter()
for r in records:
    if r.get('cairn_relevance') == 5:
        r5a[r.get('app_slug')] += 1
for k, v in r5a.most_common():
    print(f"  {k}: {v}")

# time distribution by year
print("\n=== TIME (year) BY CATEGORY ===")
year_cat = defaultdict(Counter)
for r in records:
    ca = r.get('captured_at', '')
    if ca:
        yr = ca[:4]
        year_cat[yr][r.get('category_primary')] += 1
for yr in sorted(year_cat.keys()):
    print(f"  {yr}: {dict(year_cat[yr].most_common(5))}")

# Chinese lang distribution
print("\n=== ZH LANGUAGE by APP ===")
zh_app = Counter()
for r in records:
    if r.get('language') == 'zh':
        zh_app[r.get('app_slug')] += 1
for k, v in zh_app.most_common():
    print(f"  {k}: {v}")

# ZH by category
print("\n=== ZH LANGUAGE by CATEGORY ===")
zh_cat = Counter()
for r in records:
    if r.get('language') == 'zh':
        zh_cat[r.get('category_primary')] += 1
for k, v in zh_cat.most_common():
    print(f"  {k}: {v}")

# pricing signal
print("\n=== category=pricing by app ===")
pr_app = Counter()
for r in records:
    if r.get('category_primary') == 'pricing':
        pr_app[r.get('app_slug')] += 1
for k, v in pr_app.most_common():
    print(f"  {k}: {v}")

# pain signal
print("\n=== category=pain by app ===")
pn_app = Counter()
for r in records:
    if r.get('category_primary') == 'pain':
        pn_app[r.get('app_slug')] += 1
for k, v in pn_app.most_common():
    print(f"  {k}: {v}")

# emotion signal
print("\n=== category=emotion by app ===")
em_app = Counter()
for r in records:
    if r.get('category_primary') == 'emotion':
        em_app[r.get('app_slug')] += 1
for k, v in em_app.most_common():
    print(f"  {k}: {v}")

# relation signal
print("\n=== category=relation by app ===")
re_app = Counter()
for r in records:
    if r.get('category_primary') == 'relation':
        re_app[r.get('app_slug')] += 1
for k, v in re_app.most_common():
    print(f"  {k}: {v}")

# region breakdown for alltrails
print("\n=== ALLTRAILS by REGION ===")
at_reg = Counter()
for r in records:
    if r.get('app_slug') == 'alltrails':
        at_reg[r.get('region')] += 1
for k, v in at_reg.most_common():
    print(f"  {k}: {v}")

# Pain x App x Region
print("\n=== PAIN x APP x REGION (top 30) ===")
pn_tri = Counter()
for r in records:
    if r.get('category_primary') == 'pain':
        pn_tri[(r.get('app_slug'), r.get('region'))] += 1
for k, v in pn_tri.most_common(30):
    print(f"  {k[0]:12s} x {k[1]:6s} = {v}")

# Recent surge — 2025/2026
print("\n=== 2025 records by app x category ===")
recent = Counter()
for r in records:
    ca = r.get('captured_at', '')
    if ca.startswith('2025') or ca.startswith('2026'):
        recent[(r.get('app_slug'), r.get('category_primary'))] += 1
for k, v in recent.most_common(30):
    print(f"  {k[0]:12s} x {k[1]:12s} = {v}")

# rating vs category for pricing
print("\n=== category=pricing rating distribution by app ===")
pr_rating = defaultdict(Counter)
for r in records:
    if r.get('category_primary') == 'pricing':
        pr_rating[r.get('app_slug')][r.get('rating', 'na')] += 1
for k, v in pr_rating.items():
    print(f"  {k}: {dict(v)}")
