# Cairn Terminology Guide — NZ vs US English

> Source of truth for user-facing strings. Apply on all new copy + during PR
> review. Existing strings will migrate over time.

## Hard rules

| ❌ US/Generic | ✅ NZ-correct | Why |
|---|---|---|
| trail | **track** | NZ official term (DOC, LINZ); "trail" reads American |
| hike (verb when multi-day) | **tramp** | NZ-specific for backcountry overnight trips |
| hike (day walk) | **walk** OR **hike** | Both OK in NZ |
| cabin / shelter | **hut** | DOC system uses "hut" exclusively |
| Easy / Medium / Hard | DOC 6-level (see below) | NZ users expect this scale |
| canyon | **gully** OR **valley** | "Canyon" is rare in NZ |

## DOC track classification (UI must match)

1. **Short Walk** — wheelchair accessible
2. **Walking Track** — flat, well-formed
3. **Easy Tramping Track** — Great Walks standard
4. **Tramping Track** — backcountry experience needed
5. **Route** — markers only, no formed track
6. **Mountaineering / Expert** — alpine skills required

## Voice / tone

✅ NZ register:
- "Track is closed."
- "River crossings are the most common cause of tramping fatalities."
- "Tell someone your plans before you go."

❌ Avoid (US-style hype):
- "⚠️ EXTREME DANGER!"
- "Unleash your epic adventure!"
- "Achieve your goals today!"

## Te Reo Māori

When adding bilingual content:

- ✅ Place names dual: "Aoraki / Mount Cook"
- ✅ Macrons required: ā ē ī ō ū (Māori, Aoraki, Tāmaki Makaurau)
- ✅ Greetings: "Kia ora", "Nau mai, haere mai", "Ngā mihi"
- ❌ Never use kowhaiwhai/tukutuku/koru patterns without iwi consultation
- ❌ Never machine-translate Te Reo strings
- All Te Reo translations must come from a registered translator
  (Te Taura Whiri i te Reo Māori list)

## Empty-state copy guide

Don't write instruction-manual copy. Invite the user.

| Screen | ❌ Bad | ✅ Good |
|---|---|---|
| Friends empty | "No friends yet. Add friends to share flags" | "Cairn is better with trail companions. Invite friends to share markers and stay connected." |
| Markers empty | "No markers yet" | "Leave your first cairn when you find something worth noting." |
| Routes empty | "No routes yet" | "Plan your next track. Save routes for offline use." |
| Sessions empty | "No sessions yet" | "Your past tracks will appear here." |

## Approved abbreviations

- **PLB** — Personal Locator Beacon
- **DOC** — Department of Conservation
- **LINZ** — Land Information New Zealand
- **MSC** — Mountain Safety Council
- **GPX** — GPS exchange format

## Place names spelling

Always include macrons. Common ones:

- Tāmaki Makaurau / Auckland
- Te Whanganui-a-Tara / Wellington
- Ōtautahi / Christchurch
- Aoraki / Mount Cook
- Tongariro
- Whakaari / White Island
- Pīwakawaka (fantail)
- Kōwhai (yellow flowering plant)
- Pōhutukawa (NZ Christmas tree)
- Māori (people / language)

## Route review checklist (PR review)

Before merging any UI change with new strings:

- [ ] Searched for `trail` (lowercase whole-word) — replaced with `track`
- [ ] Searched for `hiking trail` — replaced with `tramping track` or `walking track`
- [ ] No US-style hype words: "epic", "unleash", "discover" (when used as marketing)
- [ ] If using Te Reo, macrons present and translation reviewed
- [ ] Empty states use invite-tone, not instruction-tone
- [ ] DOC difficulty labels match the official 6-level system
