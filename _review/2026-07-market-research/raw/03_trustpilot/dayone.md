# Trustpilot Day One Reviews — 完整报告

[STARTED T+2026-07-17T14:08Z]

## 关键发现

**Trustpilot 上 Day One journal app (dayoneapp.com) 页面存在,但数据极度稀薄:**
- Total reviews: **11 条**
- TrustScore: 2.2 / 5 ("Poor")
- 5-star: 1 (9%)
- 4-star: 0 (0%)
- 3-star: 0 (0%)
- 2-star: 2 (18%)
- 1-star: 8 (73%)
- 12 个月内新增: 8 条
- Claimed profile since April 2017

**更严重的问题:11 条中只有 4 条是 Day One journal app 的**。其余 7 条德语评论是关于**同名不同 app** — "Arda" 相关的服装品牌 (windbreaker/T-shirt/cap/Socken),被错误归到 dayoneapp.com profile 下 (Trustpilot 用户混淆域名)。这些评论提到 "Arda"、"Sale"、"Windbreaker"、"Klamotten" (衣服),完全不是 journal app。

**Fallback 尝试:**
1. bloomconsulting.com → 404 (母公司域名错)
2. automattic.com → 18 条 (Automattic 是 WordPress/Tumblr/Day One 综合母公司,评论主要针对 WordPress 政治性内容,不适合 Day One 单独分析)
3. day-1.com → 550 条 4.7 星 (完全无关的荷兰养车公司)

**结论**: Trustpilot 不是 Day One journal app 的有效数据源。真实 Day One 用户反馈应主要用 App Store (Audit 已确认 4 区 2K+ 条完整数据) + Reddit r/DayOneApp。

---

## 真正的 Day One journal app 评论 (n=4)

---
id: trustpilot_dayone_01
source_url: https://www.trustpilot.com/review/dayoneapp.com?languages=all
captured_at: 2026-07-17T14:10:00Z
author: L Savage (GB, 14 reviews)
rating: 1
review_date: 2026-05-11
sentiment: NEGATIVE
is_company_reply: false
verified: false
raw_quote: |
  Title: Terrible glitchy app that's not user friendly.

  I wanted a journal that I could share with my partner. All the reviews say it's a number 1 app for journalists and other users and that sharing was easy to do and secure.
  The only way I could trial this app was subscribing to a paid version and having a 30 day free period before paying, despite it saying that there was a basic app that could be used for free. This free version wasn't available for my partner on most platforms or devices. The price for the Silver version was advertised variously as £49 or £29 depending on where you looked on the app/web. Trying to share an entry with my partner was a long and protracted experience with ambiguous advice and poor icon signage. Encryption was necessary but could only be accessed through the sync button, not that obviously. Despite having 250mb download the website/app took a long time to load and sometimes didn't load correctly. Cancelling my subscription wasn't easy, neither was deleting the app. Wasted 2 days of my life.
themes:
  - shared_journals_broken (伙伴共享难用)
  - pricing_opacity (£49 vs £29 定价混乱)
  - subscription_trap (30天试用强制订阅)
  - encryption_hidden_ui (加密藏在 sync 按钮里)
  - cancel_difficult (退订/删除难)
  - performance_slow (250mb 下载后仍加载慢)
---

---
id: trustpilot_dayone_02
source_url: https://www.trustpilot.com/review/dayoneapp.com?languages=all
captured_at: 2026-07-17T14:10:00Z
author: Jörn Boie-Wegener (GB, 4 reviews)
rating: 2
review_date: 2025-05-27
sentiment: NEGATIVE
is_company_reply: false
verified: false
raw_quote: |
  Title: Mangelnde Transparenz Day one Premium
  (Lack of transparency, Day One Premium)

  Nach intensiver Recherche habe ich mich für day one als elektronisches Tagebuch entschieden. Ausschlaggebend für die kostenpflichtige Premium Version (€38 p.a) war dabei, dass Tagebücher geteilt und gemeinsam bearbeitet werden können und die day one App auf allen Geräten genutzt werden kann. Leider fehlte dabei die Information, dass die Mitnutzer ebenfalls eine kostenpflichtigen Version der App benötigen, um ihrerseits alle Geräte nutzen zu können. Diese Transparenz hätte ich mir vorher gewünscht. Eine gut gemachte App verliert dadurch erheblich. Schade.

  [Translation]: After intensive research I chose Day One as electronic diary. The reason for paying Premium (€38/yr) was that journals can be shared/co-edited and app works across all devices. Unfortunately the info was missing that co-users also need a PAID version to use all their devices. This transparency would have been welcome upfront. A well-made app loses significantly through this. Pity.
themes:
  - shared_journals_dark_pattern (共享要求双方付费,售前未披露)
  - pricing_transparency (欧洲 €38/yr Premium)
  - well_designed_but (承认设计好,但商业模式伤好感)
---

---
id: trustpilot_dayone_03
source_url: https://www.trustpilot.com/review/dayoneapp.com?languages=all
captured_at: 2026-07-17T14:10:00Z
author: Urchin (IN, 1 review)
rating: 5
review_date: 2025-05-04
sentiment: POSITIVE
is_company_reply: false
verified: false
raw_quote: |
  Title: Much much better
  Much much better, responsible price
themes:
  - price_reasonable_india (印度市场认为价格合理,可能是本地定价)
  - too_brief_to_analyze (仅一句话,信息量极低)
---

---
id: trustpilot_dayone_04
source_url: https://www.trustpilot.com/review/dayoneapp.com?languages=all
captured_at: 2026-07-17T14:10:00Z
author: Schneider Steffi (AT, 10 reviews)
rating: 1
review_date: 2024-11-06
sentiment: NEGATIVE
is_company_reply: false
verified: false
raw_quote: |
  Title: Trotz Kündigung wird einfach wieder ein…
  (Despite cancellation an ABO is charged again)

  Trotz Kündigung wird einfach wieder ein ABO über die Kreditkarte abgebucht. Day One ist in keiner Weise erreichbar, weder per Email noch per Telefon. Unseriös und null Kundenservice.

  [Translation]: Despite cancellation, another subscription was charged to my credit card. Day One is not reachable at all, neither by email nor phone. Unprofessional and zero customer service.
themes:
  - subscription_charged_after_cancel (退订后仍扣款)
  - support_unreachable (邮件/电话都联系不上)
  - trust_broken (Unseriös = untrustworthy)
---

## 主题聚合 (n=4 有效评论)

| 主题 | 频次 | 涉及评论 |
|------|------|---------|
| 共享功能问题 (定价不透明/难用) | 2 | 01, 02 |
| 订阅陷阱/退订难 | 2 | 01, 04 |
| 定价混乱 (跨平台/跨货币不一致) | 1 | 01 |
| 客服联系不到 | 1 | 04 |
| 加密 UI 藏得深 | 1 | 01 |
| 性能慢 | 1 | 01 |
| 满意 (仅"合理价格") | 1 | 03 |

## 有效 vs 无效数据

| 类别 | 数量 |
|------|------|
| 真正 Day One journal app 评论 | 4 |
| 错误归类 (Arda 服装品牌) | 7 |
| **有效总数** | **4** |

## 建议给主 agent

1. **不要把 Trustpilot 数据当独立数据源** — n=4 太小,统计意义为零
2. **可以作为定性辅证**:2 条独立负评都提到 shared journals + 订阅相关,与 App Store 数据 (Audit 4 区 2K+ 条) 形成主题共振
3. **反偏见价值**:即使只有 4 条,3/4 是负评,支持"Day One 商业化伤害老用户"这一 hypothesis
4. **不要重复尝试**:no page=1 page=2 分页 (只有 1 页 11 条),no stars filter 分别拉 (10 条一页全在了)

[COMPLETE T+2026-07-17T14:15:00Z, 4 valid records (out of 11 raw), stars 分布: 1★x2, 2★x1, 5★x1]
