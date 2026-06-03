# Sandbox Auto-Verdict — v3.3 Algorithm

**Date**: 2026-05-31
**Mode**: Project Skill `--auto`
**Verdict**: ✅ **ACCEPTED**
**Evidence**: this folder (`sprint3-evidence/`)

---

## TL;DR

The Cairn marker feedback algorithm was iterated from **v3.2 → v3.3** under a
deterministic, reproducible Node simulator (no Playwright dependency to avoid
the headless Chrome stalls observed earlier). After two formula tweaks the
algorithm is robust:

- ✅ **0/50 good markers sink** (target < 5%)
- ✅ **49–50/50 bad markers sink** (target > 90%)
- ✅ **20/20 spam markers recognised** (target > 80%)
- ✅ **10/10 random seeds PASS** (full fleet test)

Reproducible:
```
cd sandbox
node simulator.mjs --seed=42      # canonical
bash run-fleet.sh                 # 10-seed sweep
```

A user-facing demo is at `sandbox/demo.html` — click-driven likes / reports,
time fast-forward, real-time `algorithm.js` integration so the user can
sanity-check the same code that the simulator validated.

---

## Algorithm changes (v3.2 → v3.3)

Both changes live in `sandbox/stage2_visual/js/algorithm.js`.

### 1. `exposureRate` — report penalty weighted 1.5×

```diff
- const healthScore = heat - penalty;
+ const healthScore = heat - 1.5 * penalty;
```

**Why**: Negative signals are more costly than positive ones because misleading
information harms more than an unenthusiastic user costs. Without this, bad
markers in long-τ types (cairn τ=180, scenic τ=90) lingered in `borderline`
even when reports out-numbered likes.

### 2. `lifeLeft` — reports also drain the lifetime budget

```diff
  const heat = currentHeat(marker.likes || [], effectiveNow, params.tau);
- return params.baseLifetime + lifeBoost(heat, params.boost) - effectiveDays;
+ const penalty = reportPenalty(marker.reports || [], effectiveNow, params.tau);
+ return params.baseLifetime
+   + lifeBoost(heat, params.boost)
+   - lifeBoost(penalty, params.boost)
+   - effectiveDays;
```

**Why**: Without subtracting reports from `lifeLeft`, a misleading marker with
low likes but high reports could survive its base lifetime indefinitely (low
likes = low boost, but no penalty either). Reports now decay with the same τ
and use the same `boost` factor as likes, giving symmetrical magnitudes.

---

## Simulation methodology

`simulator.mjs` runs:

- **1000 virtual walkers** drawn from `stage0_research/personas_distribution.json`
  (explorer_solo 30%, social_group 40%, lurker_silent 20%, critic_skeptical 4%,
  enthusiast_creator 5%, spammer 0.5%, malicious_reporter 0.5%).
- **150 markers** in 4 categories (50 good, 50 bad, 30 neutral, 20 spam) across
  5 types each (danger, supply, junction, scenic, cairn).
- **90 simulated days × 3 encounters/walker/day** = 270k encounter events.
- Each encounter: persona's `decide()` returns `like / report / ignore` based on
  community context + type preference. A category quality filter then suppresses
  unrealistic actions (95% of bad-marker likes / good-marker reports / 98% of
  spam-marker likes are downgraded to `ignore`, modelling that real users react
  to actual content quality).
- Spammers (always-like) and malicious reporters (always-report) bypass the
  quality filter — that's their attack model.

The seed-driven RNG (`makeRng(SEED)`) is xorshift32; results are 100% reproducible.

---

## PRD success metrics — actuals

| Metric | Target | seed=42 | Fleet (10 seeds) |
|---|---|---|---|
| Good marker sink rate | < 5% | 0.0% | 0.0% all seeds |
| Bad marker sink rate | > 90% | 100.0% | 98–100%, all PASS |
| Spam recognition rate | > 80% | 100.0% | 100% all seeds |
| Robustness | all PASS | ✅ | 10/10 ✅ |

Definition of "sink": `markerStatus ∈ {sunk, archived, heartbeat, weak}` —
i.e. exposure < 50% so most users never see the marker.

---

## Files in this evidence folder

| File | What |
|---|---|
| `verdict.md` | This document |
| `sim-state.json` | Last canonical run (seed=42) — buckets, verdicts, persona dist |
| `sim-report.md` | Last canonical run — markdown summary |
| `sim-stdout.log` | Per-day trace + per-marker breakdown for last run |
| `fleet-results.log` | All 10 seeds PASS/FAIL summary |

---

## Why no Playwright

The pre-existing `qa_sandbox.js` Playwright runner hung on Chromium launch in
this environment — `node qa_sandbox.js` would spawn Chrome but never produce
stdout. Per the user's directive ("绕过任何可能卡壳的东西 mcp 或者任何"), the
algorithmic correctness verdict was instead built on a pure Node simulator that
exercises the same `algorithm.js` module the browser would use. The HTML demo
(`demo.html`) is for human inspection — `simulator.mjs` is the authoritative
auto-verdict.

---

## Next

Algorithm verdict is ✅ ACCEPTED. Sprint goals 1 (math) + 2 (modules) + 3
(visual + auto-verification) are all complete with quantitative evidence.

If subsequent product changes touch `algorithm.js`, re-run `bash run-fleet.sh`
— a regression that drops any seed's verdict below PASS is the canary.
