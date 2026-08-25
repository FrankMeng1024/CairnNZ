# CairnNZ Visual DNA Changelog

This log records approved or review-pending **system-level** visual decisions. It is not an asset-generation log, screenshot index, or record of every polish pass.

## Change protocol

- Do not change Locked Core DNA because one generated screen looks different.
- A core change requires cross-screen or repeated evidence, a clear reason, and explicit human approval.
- Record the previous assumption, new decision, evidence, affected areas, and status.
- If evidence is incomplete, mark the entry **PROVISIONAL**.
- Asset- or screen-specific adjustments that do not change system rules belong in the relevant Gate record, not here.

---

## 2026-08-24 — Gate 0 extraction

**Status:** APPROVED — Gate 0 locked
**Decision:** establish `CAIRNNZ_VISUAL_DNA.md` as the primary source of truth and make future work derive screens from DNA rather than reverse-engineering the latest screenshot.

**Why:** repeated Home iterations showed that asset continuity and local technical refinement can preserve an emotionally incorrect design direction. The system needed durable reasoning, explicit failure lessons, and a separation between immutable DNA and adaptable expression.

**Evidence:** Gate 1/2 boards, Sunny V1/V2/V3 comparisons, Living Valley prototype, final NZ-world Sunny refinements, current Auth, Memory, Friends, migration records, and runtime QA.

**Affected areas:** all future visual Gates.

---

## 2026-08-24 — Sunny world direction changed

**Status:** APPROVED
**Previous assumption:** the alpine lake/basin geography should remain the canonical Home identity and be improved incrementally.

**Decision:** preserve the successful CairnNZ visual DNA, but release the alpine-basin composition as a Home mandate. The Living New Zealand world may use mountain, water, green land, trees/native vegetation, sunlight, and a human-scale trail in a more open environment.

**Why:** V1→V2→V3 improved camera, trail, terrain detail, and materials without changing the austere emotional category. Geographic plausibility and refinement did not produce enough desire to go outside.

**System consequence:** DNA locks experiential qualities—presence, life, forward exploration, NZ specificity, and desirability—not the rejected ridge/lake silhouette.

---

## 2026-08-24 — Barren high-country rejected as the primary Home expression

**Status:** APPROVED
**Decision:** treeless or sparse NZ high-country remains a valid instance, but must not define the primary Home if it perceives as dry, dead, austere, or emotionally remote at phone size.

**Why:** repeated tawny tussock, exposed soil/rock, and tiny vegetation were technically credible but collapsed into barren texture at 390×844.

**System consequence:** ecological life must survive through large and medium recognizable forms. “Authentic terrain” is insufficient if the Home fails desirability.

---

## 2026-08-24 — Water returned as a life and depth element

**Status:** APPROVED
**Previous assumption:** reducing or removing water would help prevent blue dominance.

**Decision:** water is allowed and encouraged when it adds freshness, ecological transition, reflected light, depth, and a desirable destination.

**Why:** removing water reduced life and openness without solving the underlying color problem.

**System consequence:** control color ownership—sky, water, and distance may be cool while land, vegetation, stone, soil, and shadow remain locally natural—instead of deleting water.

---

## 2026-08-24 — Trees and medium-scale vegetation became essential life signals

**Status:** APPROVED
**Previous assumption:** trees threatened openness and should remain extremely sparse.

**Decision:** healthy tree/native-bush forms may frame scenic environments and provide life, human scale, depth, and NZ ecological identity, provided they do not form a dark wall or close the destination.

**Why:** tiny branches, fern, moss, and low tussock disappeared at phone scale. The environment was technically vegetated but perceptually barren.

**System consequence:** optimize biological hierarchy for 390×844. Use recognizable large/medium forms before microtexture.

---

## 2026-08-24 — Human-height presence locked

**Status:** APPROVED
**Decision:** where a scenic screen represents being outdoors, use a human-height, forward-facing relationship with terrain opening away from the user.

**Why:** elevated overlook and downward-looking compositions produced postcard observation rather than physical entry. The later prototypes improved walkability only after camera presence and the widening corridor changed materially.

**System consequence:** “I am here” is a core test. Maps and utility screens express presence through geography and traces rather than literal scenic camera rules.

---

## 2026-08-24 — Premium no longer means muted

**Status:** APPROVED
**Previous assumption:** restraint, muted earth colors, sparse ecology, and subdued light would create premium calm.

**Decision:** premium comes from composition, believable light, ecological coherence, depth, materials, typography, and control—not from removing vitality.

**Why:** anti-cyan, anti-lush, muted, olive, mineral, and sparse constraints combined into a dry Living Valley result. Individually reasonable constraints produced a collectively lifeless image.

**System consequence:** life, desire, weather recognition, and physical presence cannot be traded for premium styling.

---

## 2026-08-24 — Motion defined as “quietly alive”

**Status:** universal Motion DNA approved; Sunny hierarchy provisional; production implementation open
**Decision:** environmental motion begins immediately but remains low-amplitude, asynchronous, and secondary to the static world. For the approved Sunny concept only, the provisional short-term perceptual hierarchy is water > cloud > vegetation. Other weather/time hierarchies remain open until their relevant Gates.

**Why:** users spend little time on Home, so life must register within 1–2 seconds; delayed or nearly invisible motion has no product value. Strong camera/parallax or obvious loops make the screen feel animated, game-like, or like wallpaper.

**System consequence:** static canonical background + small isolated layers is the preferred architecture. Camera movement and strong parallax are prohibited by default. Static wins if motion reduces quality or costs too much power.

---

## 2026-08-24 — Weather must remain inviting

**Status:** APPROVED
**Decision:** weather changes the character of exploration without removing the desire to explore.

**Why:** darker Cloudy/Rainy treatments, black Night imagery, and flat Snow may communicate conditions correctly while emotionally discouraging the user.

**System consequence:** each condition must use its truthful attractive qualities—diffuse softness, wet ecological richness, reflective clarity, layered mystery—while preserving same-world geography.

---

## 2026-08-24 — Current Sunny is proof, not a universal template

**Status:** APPROVED
**Decision:** Refinement 3 is the first successful approved proof of the Visual DNA, not the DNA itself and not a composition template for every screen.

**Why:** tying the system to one screenshot would repeat the mistake of preserving a composition after its product fit changes.

**System consequence:** other screens inherit presence, life, realism, atmosphere, material integration, and emotional principles without copying the exact lake, mountains, tree, trail, or crop. Once Gate A1 approves Sunny as the production canonical Home geography, Home weather/time variants must preserve that same physical world.

**References:**

- `app/assets/home/prototypes/final-nz-world-sunny/refinement-3/sunny-refinement-3-native.png`
- `app/assets/home/prototypes/final-nz-world-sunny/refinement-3/sunny-refinement-3-delivery.jpg`
- `docs/qa/visual-north-star/sunny-world-reauthor/refinement-3/static-home-390x844.png`
- `docs/qa/visual-north-star/sunny-world-reauthor/refinement-3/micro-motion-preview.html`

---

## Open system decisions

The following are intentionally not changelog decisions yet:

- Final functional icon family
- Exact Night material values
- Production motion architecture and performance budget
- Weather-specific motion
- Final Memory derivation
- Final Friends derivation
- Exact cross-screen transition language
- Final typography scale
- Final material tokens
- Brand-grade cairn form

Resolve these through the roadmap Gates and record them here only after explicit system-level approval.

---

## 2026-08-25 — Gate 0 human approval

**Status:** APPROVED — GATE 0 LOCKED

Human review approved the Gate 0 visual direction with three clarifications: functional usability and accessibility are hard constraints outside the Home visual-success ranking; navigation existence and structure remain product-behavior decisions; and water > cloud > vegetation is provisional for Sunny only. These clarifications remove ambiguity without changing the core visual direction. Gate A1 remains not started, and all listed open topics remain open.
