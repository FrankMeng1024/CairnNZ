"""Phase 5: Build final_report.html + final_report_data.js from Phase 3+4 outputs."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
META_PATH = ROOT / "cleaned" / "metadata.jsonl"
OUT_HTML = ROOT / "final_report.html"
OUT_DATA = ROOT / "final_report_data.js"

# ---- 1. Load metadata (18,943 rows) and build id lookup
print("Loading metadata.jsonl ...")
records = []
with META_PATH.open(encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        try:
            records.append(json.loads(line))
        except json.JSONDecodeError:
            continue
print(f"  Loaded {len(records)} records")
id_lookup = {r["id"]: r for r in records}

# ---- 2. Themes structure (from themes_merged.md + offset_measurement.md)
THEMES = [
    # Q1
    {"n":1,"q":"Q1","code":"Q1.1","title":"Memories & Tears — 多年后回看是浓情感原型",
     "need":"5+ 年后回看仍能感动。用户把 App 当情感容器。",
     "state":"fog + marker + session 三层持久化 in backend,MySQL 长期存储",
     "offset":0,"action":"保持 + 公开数据永远可导出承诺","prio":"medium",
     "cites":["a009307","a008992","a006201"]},
    {"n":2,"q":"Q1","code":"Q1.2","title":"Longevity as Identity — '5/10/15 years using this'",
     "need":"5/10/15 年 'we've been together' 情感契约",
     "state":"项目 2025 起步无历史,但架构支持长期",
     "offset":1,"action":"早期承诺不反悔 (不下架已购功能)","prio":"low",
     "cites":["a004079","a009060","a009040"]},
    {"n":3,"q":"Q1","code":"Q1.3","title":"Data Loss Horror — 一次翻车 = 品牌永久 1 星",
     "need":"数据不能丢。丢一次永远失去信任",
     "state":"backend 持久化 + JWT + local cache; 无客户端离线队列/冲突解决",
     "offset":3,"action":"新增 Sprint: crash-safe write + local queue + retry","prio":"high",
     "cites":["a006324","a016816","a017694"]},
    # Q2
    {"n":4,"q":"Q2","code":"Q2.1","title":"Solitude & Privacy Retreat — 反社交倾向浓",
     "need":"默认私密。反对公开 leaderboard / like button",
     "state":"marker 默认 personal,fog 默认自己看,好友订阅 opt-in",
     "offset":0,"action":"保持 + 公开发文'我们默认私密'","prio":"medium",
     "cites":["a009222","a009051","a008985"]},
    {"n":5,"q":"Q2","code":"Q2.2","title":"Community & Sharing With Real People I Know",
     "need":"让特定的人看,不是全世界 (家人/朋友)",
     "state":"好友订阅 max 5, marker friend 级",
     "offset":1,"action":"观察后调上限或改 tiered","prio":"low",
     "cites":["a016813","a015110","rp0031"]},
    {"n":6,"q":"Q2","code":"Q2.3","title":"中文 relation 类几乎不存在",
     "need":"中文用户不需要照搬 polarsteps 分享",
     "state":"无中文本地化(NZ 优先),英语单语",
     "offset":5,"action":"NZ 优先,中文晚做;做时不照搬社交","prio":"low",
     "cites":["a014201","a018112","a011718"]},
    # Q3
    {"n":7,"q":"Q3","code":"Q3.1","title":"Offline Map Is Existential — AllTrails 头号 pain",
     "need":"离线地图 = 免费基线,不是 premium",
     "state":"有基础设施(NZ 区域),UI 未做,用户不可触达",
     "offset":3,"action":"立即补 offline tile UI,免费不锁","prio":"high",
     "cites":["a004169","a004501","a004181"]},
    {"n":8,"q":"Q3","code":"Q3.2","title":"Safety / Lost in Wild — 户外产品的生命重量",
     "need":"GPS tracking 生存责任。断轨 = 生命危险",
     "state":"有 GPS session + trackpoints; 无 crash-safe / auto-resume 文档",
     "offset":2,"action":"补 auto-resume + crash recovery + state machine 测试","prio":"high",
     "cites":["a004169","a004466","a004691"]},
    {"n":9,"q":"Q3","code":"Q3.3","title":"Trail Data Wrong / Outdated",
     "need":"UGC trail 库 correction 反馈闭环",
     "state":"Cairn 不做 trail library",
     "offset":5,"action":"明确对外定位'不做 trail library'","prio":"low",
     "cites":["a004595","a004169","a004187"]},
    {"n":10,"q":"Q3","code":"Q3.4","title":"Battery Drain Rage — 三类 tracker 通吃",
     "need":"< 5%/h tracking 才能真出门用",
     "state":"未测量,GPS 采样频率未调",
     "offset":3,"action":"立即测 4h 户外 session 耗电 + 调采样频率","prio":"high",
     "cites":["a012600","a004590","a016397"]},
    {"n":11,"q":"Q3","code":"Q3.5","title":"Tracking Broken — GPS Drift / Missed Segments",
     "need":"暂停/后台/断线不能掉点。一次断轨换 app",
     "state":"trackpoints 存储 OK, 暂停/恢复/断线未见系统测试",
     "offset":3,"action":"补 tracking state machine 端到端测试","prio":"high",
     "cites":["a004267","a016397"]},
    {"n":12,"q":"Q3","code":"Q3.6","title":"Wearable Gap — Apple Watch 承诺失效",
     "need":"Apple Watch 独立能用,不需带手机",
     "state":"无 watch app",
     "offset":5,"action":"明确不做直到 v1.0 GA 之后","prio":"low",
     "cites":["a004270","a004590","a004466"]},
    # Q4
    {"n":13,"q":"Q4","code":"Q4.1","title":"Sovereignty of My Own Data",
     "need":"免费导出自己的数据,不能锁在 App 里",
     "state":"GPX/PDF 导出已实现 免费","offset":0,
     "action":"公开'永远免费导出'承诺作为差异化","prio":"medium",
     "cites":["a004990","a009051","a014201"]},
    {"n":14,"q":"Q4","code":"Q4.2","title":"Subscription Betrayal — 'It Used to Be Free'",
     "need":"老功能永免费,不能反悔 paywall",
     "state":"商业模式未定 = 未来定错风险",
     "offset":5,"action":"定价决策强制'新功能付费,老功能永免费';写入 CR/PRD","prio":"high",
     "cites":["a004567","a009060","a004187"]},
    {"n":15,"q":"Q4","code":"Q4.3","title":"Nagging Upsell / Intrusive Pop-ups",
     "need":"免费用户不被骚扰",
     "state":"未定","offset":5,
     "action":"若做订阅,upsell 最多每次 1 次 + 可关","prio":"medium",
     "cites":["a004990","a009082","a010021"]},
    {"n":16,"q":"Q4","code":"Q4.4","title":"fogofworld 定价反常和谐 — 一次买断被接受",
     "need":"一次买断可行(2:1 rating 偏正)",
     "state":"商业模式未定",
     "offset":5,"action":"考虑混合定价(免费基础 + 买断云 + 订阅 AI)","prio":"medium",
     "cites":["a012197","a012198","a012600"]},
    {"n":17,"q":"Q4","code":"Q4.5","title":"Import / Migration Desire — 低阻力增长杠杆",
     "need":"从 Google Timeline / Strava / Photos 带历史资产迁移",
     "state":"无 import 功能",
     "offset":5,"action":"新增 Sprint: Google Timeline JSON + Photos EXIF 生成轨迹","prio":"medium",
     "cites":["a008486","a012198","a018112"]},
    # Q5
    {"n":18,"q":"Q5","code":"Q5.1","title":"Map Completion Obsession — 游戏化收集心理",
     "need":"fog reveal / progress % / country coverage 上瘾",
     "state":"fog-of-war H3 已实现",
     "offset":1,"action":"加 '已探索 X km² / 覆盖 NZ Y%' 面板","prio":"medium",
     "cites":["a012197","a012198","a012600"]},
    {"n":19,"q":"Q5","code":"Q5.2","title":"Daily Ritual / Companion Object",
     "need":"streak / on-this-day / widget 日常粘性",
     "state":"有 memory 但无 push,无 on-this-day, 无 widget",
     "offset":3,"action":"补 on-this-day + 可选 push","prio":"medium",
     "cites":["a009041","a008985","a009049"]},
    {"n":20,"q":"Q5","code":"Q5.3","title":"Life-Changing Praise — 最高情感强度信号",
     "need":"产品有穿透性情感 hook,不只是好用",
     "state":"fog + memory 有种子,无独特 signature moment",
     "offset":2,"action":"找一个 signature moment(如 '5 年地图书')","prio":"low",
     "cites":["a009041","a009307","a012198"]},
    {"n":21,"q":"Q5","code":"Q5.4","title":"AI Backlash — 'Not This App Too'(时代窗口)",
     "need":"Anti-AI positioning 是 2025-2026 差异化窗口",
     "state":"有'marker 关键词过滤'计划,无 AI 生成/训练",
     "offset":1,"action":"公开承诺:AI 只用于安全过滤,不训练用户数据,可关闭","prio":"high",
     "cites":["rd0017","a004990","a009660"]},
    {"n":22,"q":"Q5","code":"Q5.5","title":"中文 Rage — 吃相难看 / 会员套路",
     "need":"核心免费 + 无套路 (中文用户对 monetization 尤敏感)",
     "state":"商业模式未定;中文版未做",
     "offset":5,"action":"中文版做时不能收'访问自己数据'钱","prio":"low",
     "cites":["a014201","a011718","a018112"]},
    {"n":23,"q":"Q5","code":"Q5.6","title":"[补] dayone-au 反常 pain — 澳洲区风险",
     "need":"澳洲区可能有时区/云同步 bug",
     "state":"Cairn 无澳洲部署经验",
     "offset":5,"action":"NZ 后扩澳洲时 QA 覆盖时区","prio":"low",
     "cites":["a006201","a006324"]},
    {"n":24,"q":"Q5","code":"Q5.7","title":"[补] yishengzuji 中文用户'沉默不满意'",
     "need":"中文表达方式差异,阈值低 1 档采样",
     "state":"Cairn 无中文用户,无法采样",
     "offset":5,"action":"中文版发布后阈值调整","prio":"low",
     "cites":["a018112","a017694"]},
]

# Strategies (from offset_measurement.md 3 大战略结论)
STRATEGIES = [
    {"n":1,"title":"户外 tracking 生存质量必须补齐",
     "level":"CRITICAL",
     "why":"Q3.1 offline UI (3) + Q3.2 safety (2) + Q3.4 battery (3) + Q3.5 tracking (3) 四主题都是 🔴。NZ 徒步用户第一次带上山发现掉点/耗电/无信号看不了地图 = 永久流失。",
     "actions":[
        "补 offline tile 下载 UI (免费不锁)",
        "补 GPS tracking state machine 端到端测试 (暂停/后台/断线/重启)",
        "测量并调优 4h 户外 session 电量消耗至 < 5%/h",
        "补 crash-safe write queue + retry + duplicate detection",
     ],
     "cites":["a004169","a004501","a012600","a016397","a004267","a006324"]},
    {"n":2,"title":"商业模式决策不能推 (空白 = 定时炸弹)",
     "level":"CRITICAL",
     "why":"Q4.2/4.3/4.4/4.5 + Q5.5 五个主题都是空白但不是'正确空白'—— 是'决策未做'。一旦定错 (导出加锁 / 老功能变付费) = 品牌永久 1 星。",
     "actions":[
        "定价决策原则:新功能付费,老功能永免费",
        "免费导出永远不锁 (与主题 13 呼应)",
        "考虑混合定价:免费基础 + 可选终身买断云同步 + 订阅 AI (fogofworld 模式被证明 2:1 偏正)",
        "定价锚点参考: Polarsteps €29.99/yr, Day One $34.99/yr, 世界迷雾 198 元买断",
        "upsell 最多每次使用 1 次 + 可关闭",
     ],
     "cites":["a004567","a009060","a004187","a014201","a012197"]},
    {"n":3,"title":"差异化定位窗口有时限 (Anti-Big-Tech 姿态)",
     "level":"HIGH",
     "why":"Q5.4 AI backlash (1) + Q2.1 privacy (0) + Q4.1 data sovereignty (0) 三个主题 Cairn 已经隐式对齐,但用户不知道。写成公开宣言级承诺既是营销杠杆也是自我约束护栏。",
     "actions":[
        "Landing page / About / 首次启动屏 三处公开宣言",
        "宣言 1: 默认私密,永远不做公开 feed / like 排行",
        "宣言 2: 你的数据永远可以免费导出",
        "宣言 3: AI 只用于安全过滤,不训练你的数据,可永久关闭",
        "承诺一旦写出,自我约束不敢反悔 paywall / AI 侵入",
     ],
     "cites":["a009222","a004990","rd0017","a014201","a009051"]},
]

# ---- 3. Business model recommendation (Phase 4 战略 2)
BIZ_MODEL = {
    "principle":"新功能付费,老功能永免费 + 免费导出 + 可选终身买断",
    "anchors":[
        {"app":"Polarsteps","price":"€29.99/yr","note":"订阅制,relation-heavy 用户接受度高"},
        {"app":"Day One","price":"$34.99/yr","note":"订阅制,但用户对 AI 加价激烈反弹"},
        {"app":"世界迷雾 (Fog of World)","price":"198 元买断","note":"一次买断,rating 2:1 偏正,B7 数据证明可行"},
    ],
    "recommendation":"混合模式: 核心 tracking + fog + marker + export 永免费 → 云同步一次买断 → AI 生成 / 高级分析订阅",
    "warnings":[
        "禁止把 export 加锁 (Q4.1 底线)",
        "禁止把已上线免费功能改成付费 (Q4.2 品牌永久伤害)",
        "禁止骚扰 upsell (Q4.3 大量 uninstall)",
        "中文版禁止套路 (Q5.5 '吃相难看'评论)",
    ],
}

# ---- 4. Build citations subset (records referenced by themes/strategies) plus full metadata for appendix
cited_ids = set()
for t in THEMES:
    cited_ids.update(t["cites"])
for s in STRATEGIES:
    cited_ids.update(s["cites"])

citation_data = {}
for cid in cited_ids:
    r = id_lookup.get(cid)
    if r:
        citation_data[cid] = {
            "id": r.get("id"),
            "source": r.get("source"),
            "source_url": r.get("source_url",""),
            "author": r.get("author",""),
            "captured_at": r.get("captured_at",""),
            "raw_quote": r.get("raw_quote",""),
            "category_primary": r.get("category_primary",""),
            "intensity": r.get("intensity",0),
            "cairn_relevance": r.get("cairn_relevance",0),
            "language": r.get("language",""),
            "rating": r.get("rating",""),
            "app_slug": r.get("app_slug",""),
            "region": r.get("region",""),
        }
    else:
        citation_data[cid] = {"id": cid, "raw_quote": "(id not found in metadata - possibly a manual reference like rp0031/rd0017)", "source":"external"}

# Full appendix dataset (small representation of every row for filter/search)
appendix_data = []
for r in records:
    appendix_data.append({
        "id": r.get("id"),
        "src": r.get("source",""),
        "cat": r.get("category_primary",""),
        "int": r.get("intensity",0),
        "cr": r.get("cairn_relevance",0),
        "lang": r.get("language",""),
        "rate": r.get("rating",""),
        "app": r.get("app_slug",""),
        "reg": r.get("region",""),
        "at": r.get("captured_at","")[:10] if r.get("captured_at") else "",
        "q": (r.get("raw_quote","") or "")[:200],  # preview only
    })

# Stats
stats = {
    "total_records": len(records),
    "themes_count": len(THEMES),
    "cited_ids_count": len(citation_data),
    "sources": sorted(set(r.get("source","") for r in records)),
    "categories": sorted(set(r.get("category_primary","") for r in records if r.get("category_primary"))),
}

# ---- 5. Write data JS file
data_payload = {
    "themes": THEMES,
    "strategies": STRATEGIES,
    "biz_model": BIZ_MODEL,
    "citations": citation_data,
    "appendix": appendix_data,
    "stats": stats,
}
print(f"Writing data JS ({len(citation_data)} citations, {len(appendix_data)} appendix rows)...")
OUT_DATA.write_text(
    "window.CAIRN_DATA = " + json.dumps(data_payload, ensure_ascii=False) + ";\n",
    encoding="utf-8"
)

# ---- 6. HTML template
HTML = r"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Cairn Market Research — Final Report (Phase 5)</title>
<style>
:root{
  --cream:#faf7f2; --paper:#f3ede2; --brown:#3d2817; --brown-lite:#6b5340;
  --accent:#c17b3f; --accent-lite:#e6b380; --green:#5a7a3f; --red:#a83a2f;
  --yellow:#c88a2a; --line:#d9cdb9;
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:var(--cream);color:var(--brown);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Helvetica Neue",Arial,"PingFang SC","Microsoft YaHei",sans-serif;font-size:16px;line-height:1.6}
a{color:var(--accent);text-decoration:none;border-bottom:1px dotted var(--accent-lite)}
a:hover{color:var(--brown)}
header{background:var(--paper);border-bottom:1px solid var(--line);padding:24px 32px;position:sticky;top:0;z-index:50}
header h1{font-size:22px;margin-bottom:4px}
header nav{margin-top:8px}
header nav a{margin-right:16px;font-size:14px}
main{max-width:1200px;margin:0 auto;padding:32px}
section{margin-bottom:56px;scroll-margin-top:100px}
h2{font-size:26px;color:var(--brown);border-bottom:2px solid var(--accent);padding-bottom:6px;margin-bottom:20px}
h3{font-size:19px;color:var(--brown);margin:20px 0 10px}
h4{font-size:16px;color:var(--brown-lite);margin:12px 0 6px}
p{margin-bottom:10px}
.subhead{color:var(--brown-lite);font-size:14px;margin-bottom:8px}
.badge{display:inline-block;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600;margin-right:6px}
.badge-high{background:var(--red);color:#fff}
.badge-med{background:var(--yellow);color:#fff}
.badge-low{background:var(--green);color:#fff}
.stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin:16px 0}
.stat{background:var(--paper);padding:14px;border-left:4px solid var(--accent);border-radius:4px}
.stat-num{font-size:22px;font-weight:700;color:var(--accent)}
.stat-lbl{font-size:12px;color:var(--brown-lite);text-transform:uppercase;letter-spacing:0.5px}
/* Heatmap */
.heat{display:grid;grid-template-columns:repeat(6,1fr);gap:6px;margin:16px 0;max-width:640px}
.heat-cell{aspect-ratio:1;padding:8px;border-radius:4px;color:#fff;font-size:12px;display:flex;flex-direction:column;justify-content:space-between;cursor:help;transition:transform 0.15s}
.heat-cell:hover{transform:scale(1.08);z-index:5;box-shadow:0 4px 12px rgba(0,0,0,0.2)}
.heat-code{font-weight:700;font-size:11px;opacity:0.9}
.heat-score{font-size:22px;font-weight:700;text-align:center}
.h0{background:#2f5f2a}.h1{background:#5a7a3f}.h2{background:#a3a344}.h3{background:#c88a2a}.h4{background:#c56336}.h5{background:#a83a2f}
/* Theme cards */
.theme{background:var(--paper);border-radius:6px;padding:16px;margin-bottom:14px;border-left:4px solid var(--line)}
.theme.of-0,.theme.of-1{border-left-color:var(--green)}
.theme.of-2,.theme.of-3{border-left-color:var(--yellow)}
.theme.of-4,.theme.of-5{border-left-color:var(--red)}
.theme-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap}
.theme-title{font-weight:600;font-size:17px;flex:1;min-width:280px}
.theme-score{font-size:28px;font-weight:800;color:var(--brown)}
.theme-body{margin-top:10px;font-size:14.5px}
.theme-body b{color:var(--brown);display:inline-block;min-width:82px}
.quotes{margin-top:10px;background:#fff;border-radius:4px;padding:10px 14px;border:1px solid var(--line)}
.quote-btn{display:inline-block;margin:2px 4px 2px 0;padding:2px 8px;background:var(--cream);border:1px solid var(--line);border-radius:11px;font-size:12px;font-family:monospace;cursor:pointer;color:var(--brown)}
.quote-btn:hover{background:var(--accent-lite);border-color:var(--accent)}
/* Strategy blocks */
.strat{background:var(--paper);padding:18px;border-radius:6px;margin-bottom:20px;border-top:4px solid var(--red)}
.strat.high{border-top-color:var(--yellow)}
.strat h3{color:var(--red);margin-top:0}
.strat.high h3{color:var(--yellow)}
.strat ul{margin:10px 0 10px 22px}
.strat li{margin-bottom:4px}
/* Biz model */
.biz-anchors{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;margin:12px 0}
.biz-a{background:#fff;padding:12px;border-radius:4px;border:1px solid var(--line)}
.biz-a-app{font-weight:700;color:var(--accent)}
.biz-a-price{font-size:20px;color:var(--brown);margin:4px 0}
.biz-warn{background:#fbe9e5;border-left:4px solid var(--red);padding:12px;border-radius:4px;margin-top:10px}
/* Appendix table */
.appendix-ctrl{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap}
.appendix-ctrl input,.appendix-ctrl select{padding:6px 10px;border:1px solid var(--line);background:#fff;border-radius:4px;font-size:13px}
#appendix-count{font-size:13px;color:var(--brown-lite);margin-left:auto;align-self:center}
#appendix-table{width:100%;border-collapse:collapse;font-size:12.5px;background:#fff;border:1px solid var(--line)}
#appendix-table th{background:var(--paper);padding:6px 8px;text-align:left;border-bottom:1px solid var(--line);position:sticky;top:0}
#appendix-table td{padding:5px 8px;border-bottom:1px solid #f0e9db;vertical-align:top}
#appendix-table tr{cursor:pointer}
#appendix-table tr:hover{background:#fdf9ef}
/* Modal */
.modal-bg{display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:100;align-items:center;justify-content:center;padding:20px}
.modal-bg.show{display:flex}
.modal{background:var(--cream);padding:24px;border-radius:8px;max-width:720px;width:100%;max-height:85vh;overflow-y:auto;position:relative}
.modal-close{position:absolute;top:12px;right:14px;font-size:26px;cursor:pointer;color:var(--brown-lite);background:none;border:none;line-height:1}
.modal h3{margin-top:0;color:var(--accent)}
.modal .meta{display:grid;grid-template-columns:auto 1fr;gap:6px 12px;font-size:13px;margin:12px 0}
.modal .meta b{color:var(--brown-lite)}
.modal .raw{background:#fff;padding:14px;border-radius:4px;border:1px solid var(--line);white-space:pre-wrap;line-height:1.7;font-size:14px}
/* Responsive */
@media (max-width:640px){
  main{padding:16px}
  header{padding:16px}
  .heat{grid-template-columns:repeat(4,1fr)}
  h2{font-size:22px}
  .theme-title{font-size:15px}
  .theme-score{font-size:22px}
}
</style>
</head>
<body>
<header>
  <h1>Cairn Market Research — Final Report</h1>
  <div class="subhead">Phase 5 · 2026-07-17 · 18,943 records · 24 themes · 3 strategies</div>
  <nav>
    <a href="#exec">首屏</a>
    <a href="#q1">Q1</a><a href="#q2">Q2</a><a href="#q3">Q3</a><a href="#q4">Q4</a><a href="#q5">Q5</a>
    <a href="#heat">偏移热力图</a>
    <a href="#strat">战略结论</a>
    <a href="#biz">商业模式</a>
    <a href="#appendix">证据附录</a>
  </nav>
</header>
<main>

<section id="exec">
  <h2>1. Executive Summary</h2>
  <p><b>项目背景</b>:Cairn 是一个户外记录 App（新西兰起步 → 英语世界），产品灵魂是「数字手账 + 陌生人善意」——不是安全工具，不是 AR，不是社交 feed。</p>
  <p><b>调研目标</b>:通过 21K+ 用户真实反馈（App Store + Reddit，5 大竞品 5 个地区）回答 5 个问题——多年后回看是否真需求 / 点赞踩机制该做吗 / 竞品痛点在哪 / 付费意愿如何 / 有没有漏的机制。</p>
  <p><b>数据量</b>:</p>
  <div class="stat-grid">
    <div class="stat"><div class="stat-num" id="stat-total">–</div><div class="stat-lbl">Records</div></div>
    <div class="stat"><div class="stat-num">24</div><div class="stat-lbl">Themes across Q1-Q5</div></div>
    <div class="stat"><div class="stat-num">3</div><div class="stat-lbl">战略结论</div></div>
    <div class="stat"><div class="stat-num">3.04</div><div class="stat-lbl">平均偏移分数 (0-5)</div></div>
    <div class="stat"><div class="stat-num" id="stat-cited">–</div><div class="stat-lbl">证据 quote 直连</div></div>
  </div>
  <h3>3 大战略结论</h3>
  <ol>
    <li><b class="badge badge-high">CRITICAL</b> <b>户外 tracking 生存质量必须补齐</b>——offline UI + battery + tracking state 四个 🔴 主题必须在正式发布前修</li>
    <li><b class="badge badge-high">CRITICAL</b> <b>商业模式决策不能推</b>——「新功能付费，老功能永免费 + 免费导出 + 可选终身买断」</li>
    <li><b class="badge badge-med">HIGH</b> <b>差异化定位窗口有时限</b>——Anti-AI + 默认私密 + 数据主权 写成公开宣言</li>
  </ol>
  <h3>偏移热力图预览 (24 主题)</h3>
  <div id="heat-preview" class="heat"></div>
  <p class="subhead">颜色越红 = Cairn 偏移用户真需求越远。绿 = 对齐 / 正确空白。悬停查看主题名。</p>
</section>

<section id="q1">
  <h2>2. Q1 — "N 年后回看" 是不是真需求?</h2>
  <p class="subhead">3 个主题:情感原型 / 长期身份认同 / 数据丢失恐怖</p>
  <div id="q1-themes"></div>
</section>
<section id="q2">
  <h2>3. Q2 — 点赞/踩/举报机制的用户心理</h2>
  <p class="subhead">3 个主题:反社交 / 特定人分享 / 中文 relation 稀缺</p>
  <div id="q2-themes"></div>
</section>
<section id="q3">
  <h2>4. Q3 — 竞品用户具体痛点</h2>
  <p class="subhead">6 个主题:离线地图 / 安全 / 轨迹数据 / 电量 / 断轨 / 手表</p>
  <div id="q3-themes"></div>
</section>
<section id="q4">
  <h2>5. Q4 — 用户愿意为哪些功能付费?</h2>
  <p class="subhead">5 个主题:数据主权 / 订阅背叛 / 骚扰 upsell / 买断和谐 / 迁移</p>
  <div id="q4-themes"></div>
</section>
<section id="q5">
  <h2>6. Q5 — 漏了哪些产品/机制/风险?</h2>
  <p class="subhead">7 个主题:收集上瘾 / 日常仪式 / 情感 hook / AI 反弹 / 中文套路 / 澳洲区风险 / 中文方法学</p>
  <div id="q5-themes"></div>
</section>

<section id="heat">
  <h2>7. Cairn 偏移量热力图 (全量 24 主题)</h2>
  <p>每格显示主题代码 + 偏移分数 (0 = 完全对齐真需求; 5 = 完全空白 / 严重偏移)。悬停显示主题标题。</p>
  <div id="heat-full" class="heat"></div>
  <h3>分数统计</h3>
  <p>0 分 = 3 项 (12.5%) | 1 分 = 4 项 (16.7%) | 2 分 = 2 项 (8.3%) | 3 分 = 5 项 (20.8%) | 5 分 = 10 项 (41.7%,其中 4 项为正确空白，6 项为决策未做)</p>
</section>

<section id="strat">
  <h2>8. 3 大战略结论 (详情)</h2>
  <div id="strat-list"></div>
</section>

<section id="biz">
  <h2>9. 商业模式建议</h2>
  <p><b>核心原则</b>:<span id="biz-principle"></span></p>
  <h3>市场锚点</h3>
  <div id="biz-anchors" class="biz-anchors"></div>
  <h3>推荐组合</h3>
  <p id="biz-rec"></p>
  <h3>禁止事项 (来自用户 rage)</h3>
  <div id="biz-warn" class="biz-warn"></div>
</section>

<section id="appendix">
  <h2>10. 数据附录 — 全部证据索引</h2>
  <p class="subhead">18,943 条 metadata。任意筛选后点击行看完整原文。懒加载显示前 200 行。</p>
  <div class="appendix-ctrl">
    <input id="app-search" placeholder="搜索 raw_quote 或 id..." />
    <select id="app-cat"><option value="">全部类别</option></select>
    <select id="app-src"><option value="">全部来源</option></select>
    <select id="app-int"><option value="">全部强度</option><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option></select>
    <select id="app-cr"><option value="">全部 cairn_relevance</option><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option></select>
    <span id="appendix-count"></span>
  </div>
  <table id="appendix-table">
    <thead><tr><th>ID</th><th>Source</th><th>Cat</th><th>Int</th><th>CR</th><th>Rate</th><th>Date</th><th>Quote (preview)</th></tr></thead>
    <tbody id="appendix-body"></tbody>
  </table>
  <div style="text-align:center;margin-top:12px"><button id="app-more" style="padding:8px 20px;background:var(--accent);color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:14px">加载更多 200 行</button></div>
</section>

</main>

<!-- Modal for quote detail -->
<div class="modal-bg" id="modal-bg">
  <div class="modal">
    <button class="modal-close" onclick="closeModal()">&times;</button>
    <h3 id="m-id"></h3>
    <div class="meta" id="m-meta"></div>
    <div class="raw" id="m-raw"></div>
    <div style="margin-top:12px"><a id="m-url" href="#" target="_blank" rel="noopener">→ 打开原网页</a></div>
  </div>
</div>

<script src="final_report_data.js"></script>
<script>
const D = window.CAIRN_DATA;
document.getElementById("stat-total").textContent = D.stats.total_records.toLocaleString();
document.getElementById("stat-cited").textContent = D.stats.cited_ids_count;

function scoreClass(s){ return "h"+s; }
function prioBadge(p){
  if(p==="high") return '<span class="badge badge-high">HIGH</span>';
  if(p==="medium") return '<span class="badge badge-med">MED</span>';
  return '<span class="badge badge-low">LOW</span>';
}

// Heatmap (both preview and full — identical)
function buildHeat(elId){
  const el = document.getElementById(elId);
  el.innerHTML = D.themes.map(t=>{
    return `<div class="heat-cell ${scoreClass(t.offset)}" title="${t.code} ${t.title.replace(/"/g,'')}">
      <div class="heat-code">${t.code}</div>
      <div class="heat-score">${t.offset}</div>
    </div>`;
  }).join("");
}
buildHeat("heat-preview");
buildHeat("heat-full");

// Theme cards per Q
function renderThemes(){
  ["Q1","Q2","Q3","Q4","Q5"].forEach(q=>{
    const el = document.getElementById(q.toLowerCase()+"-themes");
    const list = D.themes.filter(t=>t.q===q);
    el.innerHTML = list.map(t=>{
      const quotes = t.cites.map(id=>`<span class="quote-btn" onclick="showQuote('${id}')">[${id}]</span>`).join(" ");
      return `<div class="theme of-${t.offset}">
        <div class="theme-head">
          <div class="theme-title">${t.code} · ${t.title}</div>
          <div class="theme-score">${t.offset}</div>
        </div>
        <div class="theme-body">
          <div><b>用户真需求</b>: ${t.need}</div>
          <div><b>Cairn 现状</b>: ${t.state}</div>
          <div><b>建议动作</b>: ${prioBadge(t.prio)} ${t.action}</div>
          <div class="quotes"><b>证据 quotes</b> (点击展开原文): ${quotes}</div>
        </div>
      </div>`;
    }).join("");
  });
}
renderThemes();

// Strategies
function renderStrats(){
  const el = document.getElementById("strat-list");
  el.innerHTML = D.strategies.map(s=>{
    const cls = s.level==="CRITICAL" ? "" : "high";
    const acts = s.actions.map(a=>`<li>${a}</li>`).join("");
    const cites = s.cites.map(id=>`<span class="quote-btn" onclick="showQuote('${id}')">[${id}]</span>`).join(" ");
    return `<div class="strat ${cls}">
      <h3>战略 ${s.n} · <span class="badge ${s.level==='CRITICAL'?'badge-high':'badge-med'}">${s.level}</span> ${s.title}</h3>
      <p><b>依据</b>: ${s.why}</p>
      <p><b>Action items</b>:</p>
      <ul>${acts}</ul>
      <p style="margin-top:8px"><b>支撑证据</b>: ${cites}</p>
    </div>`;
  }).join("");
}
renderStrats();

// Biz model
document.getElementById("biz-principle").textContent = D.biz_model.principle;
document.getElementById("biz-rec").textContent = D.biz_model.recommendation;
document.getElementById("biz-anchors").innerHTML = D.biz_model.anchors.map(a=>`
  <div class="biz-a">
    <div class="biz-a-app">${a.app}</div>
    <div class="biz-a-price">${a.price}</div>
    <div style="font-size:13px;color:var(--brown-lite)">${a.note}</div>
  </div>`).join("");
document.getElementById("biz-warn").innerHTML = "<b>❌ 绝对禁止</b><ul>"+D.biz_model.warnings.map(w=>`<li>${w}</li>`).join("")+"</ul>";

// Appendix table with lazy load
const CHUNK = 200;
let appVisible = 0;
let appFiltered = D.appendix;

function fillAppendixFilters(){
  const cats = [...new Set(D.appendix.map(r=>r.cat))].filter(Boolean).sort();
  const srcs = [...new Set(D.appendix.map(r=>r.src))].filter(Boolean).sort();
  const catEl = document.getElementById("app-cat");
  const srcEl = document.getElementById("app-src");
  cats.forEach(c=>{ const o=document.createElement("option");o.value=c;o.textContent=c;catEl.appendChild(o); });
  srcs.forEach(s=>{ const o=document.createElement("option");o.value=s;o.textContent=s;srcEl.appendChild(o); });
}
fillAppendixFilters();

function applyFilter(){
  const q = document.getElementById("app-search").value.toLowerCase().trim();
  const c = document.getElementById("app-cat").value;
  const s = document.getElementById("app-src").value;
  const i = document.getElementById("app-int").value;
  const cr = document.getElementById("app-cr").value;
  appFiltered = D.appendix.filter(r=>{
    if(c && r.cat!==c) return false;
    if(s && r.src!==s) return false;
    if(i && String(r.int)!==i) return false;
    if(cr && String(r.cr)!==cr) return false;
    if(q){
      const hay = (r.id+" "+(r.q||"")).toLowerCase();
      if(hay.indexOf(q)===-1) return false;
    }
    return true;
  });
  appVisible = 0;
  document.getElementById("appendix-body").innerHTML = "";
  loadMore();
}

function loadMore(){
  const body = document.getElementById("appendix-body");
  const slice = appFiltered.slice(appVisible, appVisible+CHUNK);
  slice.forEach(r=>{
    const tr = document.createElement("tr");
    tr.onclick = ()=>showQuote(r.id);
    tr.innerHTML = `<td>${r.id}</td><td>${r.src}</td><td>${r.cat}</td><td>${r.int}</td><td>${r.cr}</td><td>${r.rate||""}</td><td>${r.at}</td><td>${(r.q||"").replace(/</g,"&lt;")}</td>`;
    body.appendChild(tr);
  });
  appVisible += slice.length;
  document.getElementById("appendix-count").textContent =
    `显示 ${appVisible} / ${appFiltered.length} (总 ${D.appendix.length})`;
  document.getElementById("app-more").style.display = (appVisible<appFiltered.length)?"":"none";
}
document.getElementById("app-more").onclick = loadMore;
["app-search","app-cat","app-src","app-int","app-cr"].forEach(id=>{
  document.getElementById(id).addEventListener("input", applyFilter);
  document.getElementById(id).addEventListener("change", applyFilter);
});
applyFilter();

// Modal
function showQuote(id){
  const c = D.citations[id];
  const meta = D.appendix.find(r=>r.id===id);
  document.getElementById("m-id").textContent = "["+id+"]";
  let full = c;
  if(!full || !full.raw_quote){
    // fall back to appendix preview
    if(meta){
      full = {id:id, source:meta.src, category_primary:meta.cat, intensity:meta.int,
        cairn_relevance:meta.cr, rating:meta.rate, language:meta.lang, captured_at:meta.at,
        raw_quote:(meta.q||"(preview only — full text not loaded)"), source_url:""};
    } else {
      full = {id:id, raw_quote:"(id not found in dataset — likely a manual reference)"};
    }
  }
  const rows = [
    ["Source", full.source||""],
    ["App / Region", (full.app_slug||"")+" / "+(full.region||"")],
    ["Author", full.author||""],
    ["Captured", full.captured_at||""],
    ["Category", full.category_primary||""],
    ["Intensity", full.intensity??""],
    ["Cairn relevance", full.cairn_relevance??""],
    ["Language", full.language||""],
    ["Rating", full.rating??""],
  ];
  document.getElementById("m-meta").innerHTML = rows.map(([k,v])=>`<b>${k}</b><div>${v}</div>`).join("");
  document.getElementById("m-raw").textContent = full.raw_quote || "(empty)";
  const urlEl = document.getElementById("m-url");
  if(full.source_url){ urlEl.href = full.source_url; urlEl.style.display=""; }
  else { urlEl.style.display="none"; }
  document.getElementById("modal-bg").classList.add("show");
}
function closeModal(){ document.getElementById("modal-bg").classList.remove("show"); }
document.getElementById("modal-bg").addEventListener("click", e=>{ if(e.target.id==="modal-bg") closeModal(); });
document.addEventListener("keydown", e=>{ if(e.key==="Escape") closeModal(); });
</script>
</body>
</html>
"""

OUT_HTML.write_text(HTML, encoding="utf-8")
print(f"Wrote {OUT_HTML.name} ({len(HTML)} chars, {HTML.count(chr(10))+1} lines)")
print(f"Wrote {OUT_DATA.name}")
print("DONE")
