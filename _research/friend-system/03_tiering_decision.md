# Friend Tiering vs Flat: Decision Report for Cairn

**Date**: 2026-06-27
**Author**: PM + Privacy UX research
**Scope**: Should Cairn (hiking memory app, 5-friend cap, Death Stranding-inspired) use friend tiering, flat, or a hybrid model?
**Verdict (TL;DR)**: **Flat with per-post opt-out**. Tiering is structurally wrong for n=5.

---

## §1 — Eight apps, one-line tiering model

| App | Model | Adoption signal |
|-----|-------|----------------|
| **WeChat (微信)** | Manual `标签/分组` + per-post `部分可见 / 不给谁看` | Tags are power-user feature, low usage. Per-post `部分可见` is the dominant pattern. |
| **Snapchat** | Auto `Best Friends` (algorithmic, top 8) + Friends + Public Story | Auto-tier is invisible to user — no decision cost. Custom `Private Story` is opt-in, low usage. |
| **Instagram** | `Close Friends` (manual list, single tier) + Followers + Public | Single-tier (green ring) is the only widely-used tiering feature in mainstream Western social. |
| **Facebook** | `Friends Lists` (Close Friends / Acquaintances / Family / custom) | Classic UX failure. Single-digit percent of users ever opened the Lists UI after launch. |
| **Find My / Life360** | Per-person location share + family Circle (Life360) | Life360's "Circle" is family-only and pre-formed offline — no in-app classification work. |
| **iMessage** | Group threads (created ad-hoc) vs 1:1 — **no tiering** | Tiering achieved via group composition, not by labeling. |
| **Discord / Slack** | Channels within a community — not friend tiering | Outside scope: this is community structure, not personal relationships. |
| **Google+ (defunct)** | `Circles` — drag-and-drop tiering as the core metaphor | Famous failure. Cited as one reason G+ failed: too much classification labor. |

---

## §2 — "Provided but nobody used it": failure cases

**Failure case 1 — Facebook Friends Lists (the canonical reference).** Launched 2007, evolved with auto-generated Smart Lists (Close Friends, Acquaintances, Family, work, school) ~2011. Despite being available to every user, Lists were ignored: most users never opened the Lists UI, never categorized anyone, and shared everything to "Public" or "Friends" by default. Root cause: a one-time classification action that delivers no immediate user value; the only payoff is at *future* post time, but by then users have already chosen the default and moved on. Facebook eventually buried Lists in submenus.

**Failure case 2 — Google+ Circles.** Made tiering the headline feature of the entire product (2011-2019). The drag-into-circle interaction was praised in launch reviews but in practice users either dumped everyone into one circle or stopped posting because deciding "which circle gets this?" was too much friction. Decision fatigue at post time killed engagement. G+ shutdown 2019.

**Failure case 3 — WeChat 标签 (Tags) for personal users.** Despite massive WeChat usage, manual friend tagging is mostly used by salespeople and KOLs to segment customers (see the marketing how-to article in research dump). Ordinary users overwhelmingly default to `公开` (public) or use the lighter-weight per-post `不给谁看` exclusion list — which is *not* a tier, just a deny-list for one post. The classification step (creating a 标签, assigning friends) is what gets skipped.

**Failure case 4 — Snapchat Custom/Private Story.** Snapchat lets you build a manual private story audience, but the feature has low everyday usage. The widely-used "tiering" on Snapchat is the automatic `Best Friends` indicator, which users do not configure — the algorithm picks the top 8 based on send frequency. Manual private stories carry the same Facebook-Lists tax.

**Common pattern**: every tiering feature that requires manual *upfront* classification (before posting) has near-zero adoption. Per-post exclusion / per-post audience picker has higher use because the cost is paid at the moment of perceived value.

---

## §3 — When tiering actually works

Three conditions, all required:

1. **Tier is computed, not declared.** Snapchat Best Friends works because the user does nothing. Instagram Close Friends works as a *single* manual list (one decision: "is this person in or not?") — not a hierarchy.
2. **The tier maps to a pre-existing offline group.** Life360 Circle = "my family" — a relationship that already exists IRL, the app just mirrors it. No taxonomy work.
3. **The friend count is large enough that segmentation pays off.** Tiering 200 followers into "close / acquaintance / public" produces noticeably different audiences. Tiering 5 friends produces the same audience as no tiering.

Instagram Close Friends is the cleanest "successful tier" — and even it is binary (in/out), single-level, and only used by users with 100+ followers who genuinely have a privacy gap to manage. Below ~30 followers, Close Friends usage drops sharply.

---

## §4 — Cairn-specific analysis (5 friends + DS inspiration + hiking)

**The math kills it.** At n=5, tier boundaries cannot exist without being trivial:
- 1 tier of 5 = flat (no tier)
- 2 tiers of 5 = either (4+1), (3+2), or (2+3) — every split is either obvious to the user offline ("my partner vs others") or arbitrary. Both cases mean the user already knows the split without UI.
- 3 tiers of 5 = (1+1+3), (2+1+2)... — meaningless. The "Acquaintances" tier in a 5-person social graph is a UX joke.

**Self-selection already does the tiering.** A user who only allows 5 slots will spend real effort choosing those 5. The 5 are by construction the *innermost* tier. The whole population of contacts beyond those 5 is implicitly the "everyone else" tier — and they are simply not in Cairn. So Cairn ships a 1-tier system whether or not it builds tiering UI.

**Death Stranding's design law.** DS has *zero* friend graph and *zero* tiering — every player is anonymous, every shared structure is asynchronous and public-by-default to whoever crosses your strand. The emotional weight comes from the asymmetry (a stranger helped me) not from segmentation. Adding tier UI to Cairn dilutes the strand metaphor: it imports Facebook's "manage your audience" anxiety into a product whose soul is the opposite of that.

**Decision-point math.** With 5 friends × 3 content types (route / mark / activity), a flat default = 0 per-post decisions (it just goes to all 5). Adding a 2-tier system = up to 15 per-post decisions ("does this tier see it?"). Adding 3 tiers = decision space explodes. Even if 90% of posts default through, the cognitive *presence* of a tier picker on every share screen is friction.

**Hiking-specific signal.** Strava shows the precedent: it offers "Followers / Only You / Everyone" and Privacy Zones (geographic redaction) — *not* friend tiers. Hiking content is overwhelmingly low-sensitivity (a finished trail, a peak photo), with the sensitivity concentrated in 1-2 dimensions (home location, real-time position). Tier-by-person does not address those dimensions; geo-redaction and per-post toggles do.

**Three options for Cairn:**

| Option | UX cost | Privacy benefit | Fit with DS soul |
|--------|---------|-----------------|------------------|
| **A — Full tiering** (Close / Regular / Distant) | Very high — classification step at add-friend time + decision at every post | Negligible at n=5 (tiers are obvious offline) | Wrong: imports impression-management anxiety |
| **B — Flat + per-post opt-out** (everything visible to all 5; one tap to exclude specific friend(s) on a single post) | Low — only paid when the user actively needs it | Real — handles the rare "don't show this one to mom" case | Strong: defaults reinforce the strand metaphor (all friends share by default) |
| **C — Pure flat** (no exclusion at all) | Zero | None — user has no escape valve | Strong-but-rigid: 1 awkward post = friend deletion |

---

## §5 — Recommendation

**RECOMMENDED — Option B: Flat + per-post opt-out.**
- Friend system has no tiers, no labels, no groups. All 5 friends see all content by default.
- Compose screen has a single optional `Visible to` row showing 5 avatars, all selected. Tap an avatar to toggle off for *this post only*. Defaults restore on the next post.
- No persistent "lists" to manage. The opt-out is ephemeral and per-post.
- Matches DS soul (default = share), matches Dunbar-5 intimacy (the 5 are already the inner tier), and gives users an emergency exit without a taxonomy.

**BACKUP — Option C: Pure flat.**
- Choose this if Sprint 0 user testing shows users have zero anxiety about the "weird post" case.
- Strongest soul fit. Lowest engineering and UX cost. Highest risk if even one user gets burned and deletes a friend instead of hiding one post.

**NOT RECOMMENDED — Option A: Full tiering.**
- Every empirical reference point (Facebook Lists, Google+ Circles, WeChat tags, Snapchat custom story) says manual upfront classification at small friend counts is dead weight.
- At n=5 the tiers are mathematically trivial.
- The decision-fatigue tax on every share screen is permanent; the privacy upside is zero (users would self-select the same 5 either way).
- Worst of all: it makes Cairn feel like Facebook, which is the exact opposite of the Death Stranding emotional contract.

**Rule of thumb for any future scale-up**: only consider tiering when the friend count exceeds ~30 (the threshold where Instagram Close Friends starts being used) AND the tier can be inferred algorithmically (Snapchat Best Friends model), not declared by the user.
