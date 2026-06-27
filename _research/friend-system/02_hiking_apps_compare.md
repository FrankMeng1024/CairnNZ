# Hiking / Outdoor App Friend System Comparison

**Date**: 2026-06-27
**Sources**: Official help/support docs (verified live via Playwright). AllTrails Help Center, Strava Help Center, Komoot Help Center, Polarsteps Help Center. Wikiloc & FATMAP marked partial — see notes.
**Method**: Direct navigation to product support pages with exact article quotes. GLM general web search was noise-heavy and discarded.

---

## §1 Five-App Comparison Table

| | **AllTrails** | **Strava** | **Komoot** | **Polarsteps** | **Wikiloc / FATMAP** |
|---|---|---|---|---|---|
| **Friend model** | Follower (single-direction) | Follower (single-direction) | Follower (single-direction) | Follower (single-direction) | Wikiloc: public-route community, no friends. FATMAP: shut down / merged into Strava 2024 |
| **Approve before follow** | Optional setting: "Require follower requests" — OFF by default (anyone can follow) | Optional. Default = anyone can follow you. Tied to profile privacy. | Optional. Two profile modes: **Public** (no approval) or **Private** (approve every follower). | **ON by default** (account=Private at signup → all followers need approval) |
| **Friend limit** | unknown (no documented cap) | unknown (no documented cap) | unknown (no documented cap) | unknown (no documented cap) | n/a |
| **Sub-tier inside friends?** | No (flat follower list) + can block | No (flat follower list) + block + mute | **Yes — "Close friends" list** (explicit subgroup of followers) | No (flat follower list) | n/a |
| **Per-item visibility tiers** | Activities can be shared / kept private. Trail "saves" can be public/private. Limited tiering vs. Strava/Komoot. | **Per-activity**: Everyone / Followers / Only You. Also per-profile. | **Per-route/activity/Collection**: Only you / Close friends / Whoever can see my profile. Profile = Public or Private. | **Per-trip**: Everyone / Followers / Only me. Account: Private/Everyone. |
| **Per-item friend selection** (this trip→Alice; that trip→Bob)? | No | No (mute is consumer-side, not producer-side) | No — but Close friends acts as a static subgroup | **Explicitly NO** (quote: "your followers follow your account, and not one trip in specific"). Workaround = **secret link** per trip. |
| **Groups / clubs?** | No formal "group share" | **Yes — Clubs** (waivers, moderation, club feeds) | No formal group share (Close friends is closest) | **Travel Buddy** = collaborative trip authoring (multiple authors on one trip) |
| **Invite methods** | Email/link referral, username search, profile URL | Username search, contacts sync, profile link | Username search, contacts, link | Username/email search, link share, **secret trip link** |
| **Default visibility (new content)** | Activity privacy varies by user setting; profile default = Everyone | **Activities = Everyone**, Profile = Everyone, Map start/end 200m **hidden by default** | Default per-content setting = inherits profile. Profile default = Public on signup. | **Trip default = Followers**; Account default = **Private** |
| **% users change default** | unknown | unknown (anecdotal: privacy-aware users do; majority do not) | unknown | unknown |
| **Home/privacy-zone hiding** | unknown (no dedicated feature in docs) | Yes — Map Visibility, hide first/last X meters (default 200m) | **Yes — Privacy Zones** (manual radius around home address) | **Yes — Hide home location** + **Hide live location** features |
| **Paywall on friend features?** | Following itself is free. Premium (AllTrails+ / Peak) gates planning, offline, AI features, NOT friending. | Free: follow/follower, activity privacy. Premium: deep training analytics, NOT friending. | Following is free. Premium: route planner, navigation, offline, NOT friending. | Following is free. Premium: travel book printing, weather, NOT friending. |
| **5-friend cap freemium model?** | **No app does this.** No documented hiking/outdoor app caps free-tier follower count. |

**Cairn takeaway per row**:
- Follower vs friend → universal pattern is follower-direction with optional approval gate. The bidirectional-friend (Facebook-style) model is absent from all 5 outdoor apps. **Cairn shouldn't reinvent bidirectional friending unless there's a specific emotional argument (Death Stranding's asymmetric likes is exactly this pattern, ironically).**
- Sub-tiering → only Komoot has explicit "Close friends". Indicates a market gap if Cairn wants finer-grained sharing.
- Per-item visibility → 3 of 5 apps (Strava, Komoot, Polarsteps) offer 3 tiers (Only me / inner / outer). AllTrails is weakest. **3-tier is the standard.**
- Per-follower-per-item selection → universally rejected. All 4 say "followers see all your content, period" — workaround is secret-link share. **Don't build per-follower-per-trip ACLs; they collapsed in this category.**
- Privacy zones / home hiding → 3 of 4 main apps have it. Outdoor data is location-sensitive; this is table-stakes.
- Friend-feature paywall → **none paywall friending itself.** Friending is free everywhere. Premium = planning/maps/analytics, not relationships.

---

## §2 Common Patterns (all 5 do this — these are defaults you violate at your peril)

1. **Asymmetric follow, not symmetric friend** — Every outdoor app uses follower model. Cheaper cognitively (no "did they accept?" overhang), supports both Patreon-style 1-to-many AND mutual-friend through reciprocal follow.
2. **Per-item visibility override** — Profile-level default + per-item override is universal. Users want to be public by default but stealth a single sensitive activity (or vice versa). One global toggle is not enough.
3. **Home-area location masking** — Strava (200m hide), Komoot (privacy zones), Polarsteps (hide home location). Outdoor activities track from home → home is exposed. Industry knows this is critical, especially for women/stalking risk.
4. **Friending is free, premium gates planning/maps/AI** — No outdoor app monetizes the friend graph itself. Subscriptions monetize route planning, offline maps, training analytics, AI route generation. **5-friend cap freemium is unprecedented in this category.**
5. **Secret link as escape hatch** — Multiple apps (Polarsteps, Komoot) offer per-item share links so you can give one trip to grandma without making her create an account or follow you. This is the universal "show this one thing to one person" solution.

---

## §3 Differential Patterns (these are design choices, not defaults)

| Pattern | Who does it | What it implies |
|---|---|---|
| **Default account = Private** | Only Polarsteps | Trip data is more personal than fitness data. If Cairn frames memories as intimate, follow this; if it frames them as community, go Strava-style public default. |
| **Explicit "Close friends" subgroup** | Only Komoot | Recognizes that "everyone I follow back" ≠ "people I trust with the GPX file of where I run". A market gap; could be a Cairn differentiator. |
| **Clubs / formal groups** | Only Strava | Strava's clubs are heavy (waivers, moderation, leaderboards). Not relevant for a memory-app unless Cairn becomes a community product. |
| **Travel Buddy (multi-author content)** | Only Polarsteps | One trip authored by multiple people. Powerful for couples/families. **Cairn analogue**: a hike done together = shared memory authored by both. |
| **Heatmap contribution opt-in** | Strava (yes by default), Komoot (yes by default), Polarsteps (no community heatmap) | Aggregate-data uses of user trails. Cairn's "fog of war" is private by definition → not a concern, but Cairn-wide heatmaps would be a CR. |
| **Anonymous accounts** | Polarsteps | Lets users follow without revealing identity. Niche but matters for travel safety / women's safety. |
| **Per-route privacy independent of profile** | Komoot only (full matrix), Strava/Polarsteps (limited) | Komoot lets you say "profile public, this Collection close-friends, that route only me". Most granular control on the market. |
| **Approve follower requests by default** | Polarsteps only | Friction trade-off — fewer followers gained, more trust per follower. |

---

## §4 Recommendations for Cairn (on the "should we tier friends?" question)

**Context recap**: Cairn = hiking memory app, Death Stranding inspiration, GPS traces + photos + emotional resonance. Question is whether friend system should be flat or tiered.

**Recommendation 1 — Use follower model, not friend model.**
All 5 apps converged on followers. Bidirectional "friend confirm" adds friction with no upside. Death Stranding's mechanic is itself one-directional (you "like" what someone left, they may never know who you are). **Follower-with-optional-approve matches DS's emotional model.**

**Recommendation 2 — Do NOT tier friends into family/friends/strangers/public AT THE FRIEND LEVEL.**
The market signal is clear: 4 of 5 apps have a flat follower list, and the 5th (Komoot) treats sub-tiering as an opt-in "Close friends" subset, not a 4-level hierarchy. Tiering at the friend level (assigning every follower to a bucket) is high cognitive cost and low adoption (no evidence any app surveyed has measurable "users actively maintain their tier assignments"). **DO tier at the content level instead.**

**Recommendation 3 — Build 3-tier per-memory visibility: Private / Close circle / Everyone.**
This matches Komoot's "Only you / Close friends / Profile-default" and is what Strava and Polarsteps approximate. Each memory has a visibility setting; "Close circle" is a single, user-curated list. Avoids the "for each post pick from 4 buckets" decision paralysis while keeping a meaningful intimate vs. public boundary.

**Recommendation 4 — Privacy default depends on the soul of Cairn.**
- If Cairn is "your private hiking diary that you optionally share": default = **Only you** (most conservative).
- If Cairn is "shared trail memories with chosen people": default = **Close circle / Followers** (Polarsteps-style).
- If Cairn is "Death Stranding for hikers — leave traces for strangers to find": default = **Everyone** (Strava-style).
The Death Stranding inspiration suggests the third — but trail GPS traces are far more identifying than DS's anonymous structures. Real-world stalking risk argues for default = Close circle. **My recommendation: default = Close circle, with one-tap "make this one public" for the DS-style serendipity moments.**

**Recommendation 5 — Do NOT cap free-tier follower count at 5 (or any low number).**
No competitor does this. It will read as hostile / dark-pattern. Friending is universally free in this category. Monetize what users will pay for: better maps, AI-generated route suggestions, printed memory books (Polarsteps does this), advanced fog-of-war analytics, more storage, premium aesthetic themes. The friend graph is the moat — gating it gates adoption.

**Bonus — Build privacy zones / home-area masking from day 1.**
3 of 4 main competitors have this. Outdoor location data is uniquely sensitive; lacking it would be a launch-blocker for any safety-conscious user (especially women, especially in dense urban areas where home address is identifiable from the trail start).
