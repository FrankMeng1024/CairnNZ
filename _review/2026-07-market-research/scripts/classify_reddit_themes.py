"""
Reddit 户外痛点主题分类脚本 · 可复现版

数据源：raw/reddit_outdoor.jsonl (4,847 条)
每条含：post_title + raw_quote + subreddit + upvotes

分类方法：对每条帖子的 post_title + raw_quote 合并文本，用**严格短语匹配**
（不是宽松 word），一条帖子只归入最先命中的主题（避免重复计数）。

产出：主题频次分布（用于第三部分 HTML report 数据校对）
"""
import json, re, sys
sys.stdout.reconfigure(encoding='utf-8')

INPUT = 'C:/ClaudeCodeProjects/Cairn/_review/2026-07-market-research/raw/reddit_outdoor.jsonl'

# 严格短语正则：至少 2 词或明确复合词，避免宽泛的单词误匹配
THEMES = [
    ('planning_anxiety', [
        r'\bfirst time (hik|backpack|tramp)',
        r'\bfirst (hik|backpack|tramp)',
        r'\bbeginner\b',
        r'\bam i ready\b',
        r'\bplanning (my|our|a) first\b',
        r'\bnervous about\b',
        r'\bscared to (go|try|start)\b',
        r'\bnever (hiked|backpacked|tramped)\b',
        r'\bnew to (hiking|backpacking|tramping)\b',
        r'\bnewbie\b',
        r'\bneed advice\b',
        r'\bcan (i|we) do\b',
        r'\bfirst attempt\b',
        r'\bwhat should i (bring|pack|know|do)\b',
        r'\bhow do (i|you) (start|begin|prepare)\b',
        r'\btips for (my|our|the) first\b',
    ]),
    ('gear_failure', [
        r'\b(boots?|shoes?|pack|tent|jacket|rain gear|sleeping bag|stove) (broke|failed|ripped|leaked|dead|worn)',
        r'\bblister',
        r'\bgear (failed|broke|died|malfunctioned)',
        r'\bfell apart\b',
        r'\btorn (pack|tent|jacket)\b',
        r'\b(boot|shoe) (blowout|fell apart|ripped)\b',
        r'\bpack straps? (broke|snap)\b',
    ]),
    ('weather_storm', [
        r'\bcaught in (a |the )?(storm|rain|snow|thunderstorm|blizzard|hail)\b',
        r'\bweather (turned|changed|rolled in|got bad)\b',
        r'\bthunderstorm\b',
        r'\bice storm\b',
        r'\bhypothermia\b',
        r'\bfroze (my|our) (butt|ass)\b',
        r'\bfreezing (cold|rain|temperatures)\b',
        r'\bblizzard\b',
        r'\bwhiteout\b',
        r'\bwoke up to (snow|rain|storm|ice)\b',
        r'\b(sudden|unexpected) (storm|rain|snow)\b',
    ]),
    ('solo_fear', [
        r'\bsolo hike\b.*(?:scared|fear|nervous|worried|close call|dangerous|alone)',
        r'\b(hiking|camping|backpacking) alone\b.*(?:scared|fear|worried|nervous)',
        r'\bby myself\b.*(?:scared|fear|worried|nervous|dangerous)',
        r'\bfirst solo\b',
        r'\bscared of solo\b',
        r'\balone in (the )?woods\b',
        r'\bemergency device\b',
        r'\bcarry (a )?(plb|garmin|inreach|beacon)\b',
    ]),
    ('river_crossing', [
        r'\briver crossing\b',
        r'\bcreek crossing\b',
        r'\bford (a|the) (river|creek|stream)\b',
        r'\bflooded (river|creek|stream)\b',
        r'\bwater level (rose|too high|dangerous)\b',
        r'\bstream cross\b',
        r'\bcross(ed|ing) the river\b',
        r'\bwaimakariri\b',
        r'\brees.dart\b',
        r'\bsnowy creek\b',
    ]),
    ('getting_lost', [
        r'\bgot lost\b',
        r'\bwas lost\b',
        r'\blost my way\b',
        r'\bwrong (trail|path|turn|way)\b',
        r'\btook the wrong\b',
        r'\bmissed (the |a )turn\b',
        r'\boff.trail\b',
        r'\bcouldn.?t find (the )?(trail|way|path)\b',
    ]),
    ('rescue_sar', [
        r'\bsearch and rescue\b',
        r'\bsar (team|helicopter|call)\b',
        r'\brescue helicopter\b',
        r'\bplb\b',
        r'\bpersonal locator beacon\b',
        r'\bcalled 911\b',
        r'\bpressed sos\b',
        r'\bactivated (my|the) (beacon|plb|inreach)\b',
        r'\bevacuated\b',
    ]),
    ('injury', [
        r'\btwisted (my |an )?ankle\b',
        r'\bsprained (my )?(ankle|knee|wrist)\b',
        r'\bbroke (my )?(leg|arm|ankle|wrist|knee)\b',
        r'\bfell (down|off|and)\b',
        r'\binjured (my |on the)\b',
        r'\bhurt (my |myself)\b',
        r'\bblister under\b',
        r'\bopen wound\b',
    ]),
    ('signal_offline_battery', [
        r'\bno (signal|cell|reception|service|coverage)\b',
        r'\bdead zone\b',
        r'\boffline map\b',
        r'\bphone (died|dead|battery)\b',
        r'\bbattery (died|drained|dead)\b',
        r'\bno data\b',
        r'\bcell coverage\b',
    ]),
]

def classify(text):
    """一条 post 归入最先命中的主题。返回 theme_name 或 None."""
    for theme, patterns in THEMES:
        for pat in patterns:
            if re.search(pat, text, re.IGNORECASE):
                return theme
    return None

def main():
    records = []
    with open(INPUT, 'r', encoding='utf-8') as f:
        for line in f:
            try:
                records.append(json.loads(line))
            except: pass
    print(f'Total records: {len(records)}')
    print()

    from collections import Counter
    theme_ct = Counter()
    uncategorized = 0
    for r in records:
        text = (r.get('post_title','') + ' ' + r.get('raw_quote','')).lower()
        theme = classify(text)
        if theme:
            theme_ct[theme] += 1
        else:
            uncategorized += 1

    # 打印结果（按频次排序）
    total = len(records)
    print(f'{"Theme":<30s} {"Count":>7s}  {"%":>6s}')
    print('-'*50)
    for theme, ct in theme_ct.most_common():
        print(f'{theme:<30s} {ct:>7d}  {ct/total*100:>5.1f}%')
    print(f'{"(uncategorized)":<30s} {uncategorized:>7d}  {uncategorized/total*100:>5.1f}%')

    # 写 JSON 结果
    out = {
        'total_records': total,
        'themes': dict(theme_ct),
        'uncategorized': uncategorized,
        'method': 'strict phrase regex, first-match-wins, no double counting',
        'source': 'raw/reddit_outdoor.jsonl',
    }
    with open('C:/ClaudeCodeProjects/Cairn/_review/2026-07-market-research/raw/reddit_theme_classification.json', 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print()
    print('Written to raw/reddit_theme_classification.json')

if __name__ == '__main__':
    main()
