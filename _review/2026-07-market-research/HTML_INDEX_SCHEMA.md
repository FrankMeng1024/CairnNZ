# HTML Index Schema

**用途**: Phase 2 打标时按此 JSON schema 写 metadata,Phase 5 HTML 直接读,不用回头改 6000 条。

## Schema 定义

每条 cleaned data 是一个 JSON object,存 `cleaned/metadata.jsonl`(每行一条):

```json
{
  "id": "d001",
  "source": "reddit_r_dayoneapp",
  "source_url": "https://safereddit.com/r/dayoneapp/comments/xxx/title/",
  "author": "u/anonymous_hiker",
  "captured_at": "2026-07-18T14:30:00Z",
  "raw_quote": "I opened my Day One from 2019 and cried",
  "category_primary": "emotion",
  "category_secondary": ["praise"],
  "intensity": 4,
  "language": "en",
  "cairn_relevance": 5,
  "themes": []
}
```

## 字段规范

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 是 | 全局唯一,前缀 = 源缩写(d=reddit_dayoneapp, p=r_polarsteps, t=trustpilot, a=appstore, z=zhihu, y=youtube, etc.),后跟递增数字 |
| `source` | string | 是 | 数据源分类,枚举: `reddit_r_dayoneapp` / `reddit_r_polarsteps` / `reddit_r_tramping` / `reddit_r_hiking` / `reddit_r_ultralight` / `reddit_r_ukwalking` / `reddit_r_canadianhiking` / `reddit_r_deathstranding` / `reddit_r_youtube` / `trustpilot_polarsteps` / `appstore_polarsteps_us` / `appstore_polarsteps_nz` / `appstore_polarsteps_gb` / `appstore_polarsteps_au` / `appstore_dayone_*` / `appstore_alltrails_*` / `appstore_fogofworld_*` / `appstore_yishengzuji_cn` / `appstore_linggan_cn` / `zhihu` / `36kr` / `sspai` / `ifanr` / `xhs_metadata` / `youtube_dislike_reports` / `psychology_paper` / `fb_nz_tramping` / `fb_te_araroa` / `xhs_full` / `bushwalk` / `bpl` / `ukhw` |
| `source_url` | string | 是 | 原文完整 URL,Phase 5 HTML 点击可回溯 |
| `author` | string \| null | 否 | 用户名(匿名场合为 null) |
| `captured_at` | ISO 8601 | 是 | 抓取时间(UTC) |
| `raw_quote` | string | 是 | 原文引用(不改,不总结) |
| `category_primary` | enum | 是 | 主标签,6 选 1: `pain` / `praise` / `complaint` / `emotion` / `relation` / `pricing` |
| `category_secondary` | array | 否 | 副标签,可 0-3 个,同 6 类枚举 |
| `intensity` | int 1-5 | 是 | 情感强度(基于原文修辞/重复/大写/表情) |
| `language` | ISO 639-1 | 是 | `en` / `zh` |
| `cairn_relevance` | int 1-5 | 是 | 和 Cairn 主题相关度(GPS/记录/marker/好友/N年后回看/陌生人 like) |
| `themes` | array of string | 否 | **Phase 3 填**,不在 Phase 2 填 |

## 6 类别枚举

- `pain` — 痛点(功能缺失/bug/体验差)
- `praise` — 真爱("这个功能改变了我")
- `complaint` — 抱怨(定价/隐私/AI 侵入/流失原因,和 pain 区别:pain 是具体功能问题,complaint 是产品/公司层面不满)
- `emotion` — 情感(N 年后回看/善意时刻/回忆)
- `relation` — 关系(好友分享/私密/公开态度)
- `pricing` — 付费意愿(愿付多少/为什么付/为什么退订)

## Phase 5 HTML 索引使用

```javascript
// Phase 5 HTML 直接读取
const data = await fetch('cleaned/metadata.jsonl')
  .then(r => r.text())
  .then(t => t.split('\n').filter(Boolean).map(JSON.parse));

// Filter 示例
const painPoints = data.filter(d => d.category_primary === 'pain');
const highIntensity = data.filter(d => d.intensity >= 4);
const cairnRelevant = data.filter(d => d.cairn_relevance >= 4);

// 点击回溯: window.open(d.source_url)
```

## 主 agent 铁律

- Phase 2 subagent 必须**严格按此 schema 输出**,不许自创字段
- Phase 3 只能新增 `themes` 数组内容,不许改其他字段
- Phase 5 只读不改
