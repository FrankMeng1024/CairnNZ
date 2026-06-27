# Death Stranding Strand System — Research for Cairn Friend System

**Date**: 2026-06-27
**Author**: PM / UX research subagent
**Purpose**: Extract DS strand-system patterns that can inform Cairn's friend/sharing UX. Cairn's inspiration is DS — user requested this analysis explicitly.

---

## §1 DS Strand System — Mechanism Cross-Check

Based on Kojima Productions design interviews, GameSpot Social Strand explainer, and Chinese player walkthroughs (sources at bottom).

| Question | DS Answer | What it means |
|---|---|---|
| **Do players need to add each other as friends to see content?** | **No.** DS has no "friend list" gate for visibility. All players in the same online region/session pool see each other's persistent structures by default. There is a `strand contract` (Kojima's term) but it is metaphorical — not a permission gate. | DS is opt-out, not opt-in. The world is shared by default. |
| **How are structures matched between players?** | Server-side pool — Kojima Productions matches players based on **progress similarity** (story progress, region unlocked) and population density. Quote (CN walkthrough): "会把与你进度相似的设施共享来"。No geographic IRL matching — purely in-game world coordinates + progress. | Cairn's equivalent (real GPS) is even more natural: people who hike the same trail see each other's marks. |
| **Can you see who left a structure?** | **Yes — name shown, no profile, no chat.** Each structure shows a player handle ("Built by SamPorter") but no avatar, no DM, no follow. No way to "visit" them. | This is the heart of "social-without-social" — identity is visible, interaction is not. |
| **Is there a bidirectional "strand contract"?** | Yes, light. Once you've used someone's structure repeatedly OR exchanged enough likes, the system flags a `strand connection`. This unlocks slight in-game perks (their structures are more likely to appear in your world). **No mutual approval step.** Kojima: "就好比我想约那个女孩儿，但不想跟她结婚" — connection without commitment. | Asymmetric, drift-based bonding. No "accept friend request" friction. |
| **Can a player block others / go private?** | DS Director's Cut added a "private room" / offline mode where no other-player structures appear. Per-player block does **not** exist — only global on/off. Players can choose not to upload their own structures by playing offline. | Privacy = global toggle, not per-friend ACL. |
| **What gets shared?** | **All persistent structures by default**: bridges, ladders, ropes, watchtowers, generators, signs/markers, roads, safe houses. Cargo lost on death may be picked up by other players. Personal locker/room contents = private. | Default = public; private = explicit (locker). |
| **Push or pull model?** | **Pull / spatial discovery.** Other players' structures appear in your world only when you physically traverse the location. No feed, no notification, no "10 friends near you" prompt. | Discovery is a side effect of doing the activity, not a separate social action. |
| **Filtering on the receive side?** | Limited. Players can adjust "density" of how many other-player structures appear (helps with map clutter). No "show only signs / hide buildings" type filter. | Density slider exists; type-level filter does not. |
| **Likes mechanic** | One-directional, **only positive**. Auto-like on first use of a structure + manual additional likes. No dislike, no comment, no reply. Likes are quasi-currency for reputation but unlock no transactional rewards — Kojima explicitly designed this as "unconditional love" (无条件的爱). Structures with many likes persist longer; low-like structures decay. | Like = lightweight gratitude beacon, not engagement metric. |
| **Decay / lifecycle** | Structures decay over real-world time + Timefall (in-game weather). High-like structures live longer. Player-built items can be destroyed (BT void-out) and the crater itself slowly heals. | Content has a half-life — popular things stick, abandoned things fade. |

---

## §2 The "Social-Without-Social" Design Philosophy

Kojima's stated design intent (from Game Informer / 篝火 interview, Sept 2019):

> "玩游戏是一种孤独的感觉…你会意识到，'世界上有一个和我很像的人也感到了这种孤独'，这是一种间接的联系。"

The strand system is explicitly **anti-social-network**. Kojima removed every interaction primitive that traditional social networks rely on: no DMs, no comments, no follow/unfollow, no profile pages, no feed, no leaderboards, no dislike. What remains is **a single one-way positive beacon (like) attached to a physical trace left in a shared world**. The player who left the ladder doesn't know who used it, can't be contacted by them, and only sees an abstract count of likes received.

Why does this feel emotional rather than empty? Three reasons surface in player reviews (Douban DS reviews, 2019-2021):

1. **Earned discovery.** You don't get a structure pushed to you; you stumble on it after an hour of solo trekking. The serendipity makes each found ladder feel like a gift from a stranger who walked here before. This is the opposite of a notification — it is a *deposit*.
2. **No social cost.** Because you can't be replied to, judged, or harassed, leaving a structure carries zero anxiety. The asymmetry (you can give but can't be attacked) inverts the typical social-app risk profile. Likes-only feedback is a hard architectural rule, not a moderation policy — abuse vectors don't exist.
3. **Identity present but distant.** Seeing "Built by HikerJoe — 142 likes" is enough humanity to feel less alone; the absence of a profile page is enough to keep them mythical. Kojima found the sweet spot where presence > interaction.

The whole system is engineered for the emotion of **"路途孤独，但我并不孤独"** (the journey is lonely, but I am not alone) — a player Douban review that perfectly distills the design target.

---

## §3 Cairn Borrowing Matrix

| DS pattern | Borrow as-is | Borrow modified | Don't borrow | Rationale |
|---|---|---|---|---|
| No "friend request" gate — shared world by default | | ✅ default-public marks, opt-out private | | Cairn already has the `mark` primitive; making them public-by-default mirrors DS. But IRL location data needs explicit consent that DS didn't need. |
| Likes-only, one-direction, no dislike, no comments | ✅ | | | Hard rule. Zero negative interaction primitives. This single decision blocks 90% of social-app toxicity. |
| Auto-like on first use + manual additional like | | ✅ — auto-"viewed" beacon when someone passes a mark, manual heart on top | | "Use" doesn't map cleanly to hiking; "passing within X m" + "tap to heart" is the analog. |
| Asymmetric strand-contract (no mutual approval) | | ✅ — drift-based "frequent visitor" status, no accept/reject | | Avoids the social anxiety of friend-request rejection; consistent with DS's "no committed relationship" metaphor. |
| Identity shown (name), interaction blocked (no DM/profile) | ✅ | | | This is the load-bearing piece of the philosophy. Name visible, profile page minimal, DM forbidden. |
| Spatial / pull discovery (only see things on your route) | ✅ | | | Cairn already enforces this via GPS; perfect fit. Don't add a feed. |
| Structures decay; high-like content lives longer | | ✅ — marks with 0 hearts after 90 days fade visually (still in owner's archive) | | Prevents map clutter without deleting personal memory. Decay rule is per-viewer (others stop seeing it), never per-owner. |
| Private locker / offline mode (global private toggle) | | ✅ — per-mark private flag + global "don't share any new marks" toggle | | DS only has global; Cairn users explicitly asked for per-route privacy. Need both granularities. |
| Density slider for how many others' marks appear | ✅ | | | Direct steal. Especially valuable on popular trails where 200 marks would clutter the map. |
| Server-pool match by "progress similarity" | | | ❌ | Cairn has no progress dimension. Use raw geographic proximity instead — anyone who walks here sees marks left here. |
| No friend list, no per-friend ACL | | ✅ — partial | | DS doesn't need it because there's no IRL safety axis. Cairn's user explicitly asked for **email-based pairing for trusted-friend layer** on top of the public layer. Solution: keep the DS public-by-default layer AND add a thin "trusted friends" layer for activity-sharing only (not for the marks themselves). |
| No activity sharing (no "Sam delivered 5 packages today" feed) | ✅ | | | Aligns 1:1 with user's stated requirement: "share route/mark, NOT activity." Don't build an activity feed. Ever. |
| Cargo lost on death pickup by others | | | ❌ | No analog. Cairn has no "lost" object class. |
| Strand connection unlocks small perks | | ✅ — frequent co-locators get a subtle "you've crossed paths N times" affordance | | Light touch only. No leaderboards, no badges, no streaks. |

---

## §4 Three Concrete Recommendations for Cairn's Friend System

### Recommendation 1 — Two-layer model: "Open World" (DS-style) + "Trusted Circle" (email-pair)

Cairn should NOT pick between "DS public model" and "traditional friend model" — it should layer them. **Layer 1 (Open World, default ON)**: every public mark a user drops is visible to anyone who walks within ~50 m of it. Pull-only, no notifications, no feed. Heart-only feedback. Builder name visible, no profile page. This is the DS layer. **Layer 2 (Trusted Circle, opt-in)**: user can email-pair with up to ~10 hiking friends. Pairing unlocks: (a) seeing each other's private (non-public) marks, (b) one-way "I'm hiking [trail] this weekend" beacon that the friend can opt to follow. **No activity feed, ever** — that violates the user's stated requirement and the DS philosophy.

### Recommendation 2 — "Heart-only" beacon, hardcoded, never expandable

Implement the like system as a single integer counter on each mark, incremented by tapping a heart icon when within geographic range of the mark. Auto-increment by 1 when a user's GPS passes within 30 m of a mark for the first time (DS's auto-like). Manual heart adds another. **Architecturally forbid**: comments, replies, dislikes, reactions other than heart, any free-text field attached to a heart. This is not a v1 feature flag — it must be a constraint baked into the data model (single integer column, no FK to a comment table that "could be added later"). Once you have a comment table you cannot uninvent moderation cost. Kojima's "unconditional love" is only structurally guaranteed when negativity has no syntax.

### Recommendation 3 — Geographic-pull discovery, never push notifications for social events

When user A drops a mark on the Tongariro Crossing, user B who hikes there 3 weeks later sees it appear on their map *only when B is physically near*. No push notification ever says "Someone heart-ed your mark" or "A friend dropped a mark nearby." The single allowed exception is the user opening Cairn's "Activity" tab voluntarily — there they may see a list of hearts received on their own marks (passive consumption, user-initiated, no badge counter on the app icon). This preserves the DS emotional contract: discovery is a reward for doing the activity, never an interruption to demand more of it. Pull, never push. Hearts are a deposit found later, not a ping.

---

## Sources

- [Kojima 专访：谈谈《死亡搁浅》的立意、概念与哲学 — 篝火营地 (Game Informer 转载)](https://gouhuo.qq.com/content/detail/0_20190917163640_6mbMHIk7V) — primary source for "unconditional love", no-dislike design intent, "约会但不结婚"比喻
- [Kojima 专访 — 百度贴吧转载](https://tieba.baidu.com/p/6258164983) — second mirror of the same interview, with the explicit quote about auto-like vs manual like
- [死亡搁浅多人模式机制介绍 — Ali213 (2019-10)](https://gl.ali213.net/html/2019-10/372865.html) — strand-contract metaphor, auto-like + manual like detail, structure decay
- [死亡搁浅联机机制方法介绍 — 9Game (2023-09)](https://www.9game.cn/siwanggeqian/8813850.html) — confirms "can see traces but not interact directly", no real-time multiplayer
- [Bridge to the future — Douban DS Review (2020-02)](https://www.douban.com/review/12218105/) — primary emotional source: "路途孤独，但我并不孤独", describes the experience of finding others' ladders/shelters/highways
- [被国内玩家玩到"极致"的游戏 — Tencent Cloud (2020-11)](https://cloud.tencent.cn/developer/news/717825) — confirms server-pool matching by "progress similarity"
- [死亡搁浅：优秀的设定与音乐，连接系统与他人的点赞 — Tencent Cloud (2021-03)](https://cloud.tencent.com/developer/news/788973) — third-party analysis of how the like mechanic produces emotional response
- [Death Stranding: How The Social Strand System Works — GameSpot (2019-11)](https://www.gamespot.com/videos/death-stranding-heres-how-the-social-strand-system/2300-6451514/) — English-language overview of strand system mechanics
