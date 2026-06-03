/**
 * persona.js — Persona behavior model + decision engine
 *
 * Loads stage0_research/personas_distribution.json
 * Implements 5-context classifier from v3.3 spec:
 *   1. see_high_like_low_report
 *   2. see_low_like_high_report
 *   3. see_neutral_no_data
 *   4. matches_personal_judgment
 *   5. contradicts_personal_judgment
 */

let _distribution = null;

export async function loadDistribution(path = '../stage0_research/personas_distribution.json') {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load distribution: ${res.status}`);
  _distribution = await res.json();
  return _distribution;
}

export function getDistribution() {
  if (!_distribution) throw new Error('Distribution not loaded yet');
  return _distribution;
}

// ======================================================================
// Persona type preferences (from v3.2 §9.1)
// Used to determine matches/contradicts based on marker type
// ======================================================================

const TYPE_PREFERENCE = {
  explorer_solo:      { danger: 0.85, supply: 0.80, junction: 0.75, scenic: 0.50, cairn: 0.40 },
  social_group:       { danger: 0.70, supply: 0.70, junction: 0.65, scenic: 0.75, cairn: 0.55 },
  enthusiast_creator: { danger: 0.80, supply: 0.80, junction: 0.75, scenic: 0.70, cairn: 0.65 },
  lurker_silent:      { danger: 0.60, supply: 0.55, junction: 0.50, scenic: 0.55, cairn: 0.45 },
  critic_skeptical:   { danger: 0.85, supply: 0.75, junction: 0.70, scenic: 0.40, cairn: 0.30 },
  spammer:            { danger: 0.50, supply: 0.50, junction: 0.50, scenic: 0.50, cairn: 0.50 },
  malicious_reporter: { danger: 0.40, supply: 0.40, junction: 0.40, scenic: 0.40, cairn: 0.40 },
};

// ======================================================================
// Context classification (v3.2 §9.1, refined)
//   Priority 1 — community signals (high/low likes & reports) override
//                because actual data is stronger than prior preference.
//   Priority 2 — type preference (matches/contradicts) when no clear signal
//   Priority 3 — neutral
// ======================================================================

export function classifyContext(personaType, marker) {
  const likes = marker.likes?.length ?? 0;
  const reports = marker.reports?.length ?? 0;

  // Priority 1: community signals
  // High like + low report → trust community
  if (likes >= 5 && (reports === 0 || likes / (reports + 1) >= 5)) {
    return 'see_high_like_low_report';
  }
  // Low like + high report → community warns
  if (reports >= 3 && likes < reports * 2) {
    return 'see_low_like_high_report';
  }

  // Priority 2: cognitive prior (no clear community signal yet)
  const pref = TYPE_PREFERENCE[personaType]?.[marker.type] ?? 0.5;
  if (pref > 0.7) return 'matches_personal_judgment';
  if (pref < 0.3) return 'contradicts_personal_judgment';

  // Priority 3: truly neutral
  return 'see_neutral_no_data';
}

// ======================================================================
// Decision engine — sample action from probability distribution
// ======================================================================

export function decide(personaType, marker, rng = Math.random) {
  const dist = getDistribution();
  const persona = dist.personas[personaType];
  if (!persona) throw new Error(`Unknown persona: ${personaType}`);

  // Special: spammer/malicious have separate behavior model
  if (personaType === 'spammer') {
    return decideSpammer(persona, rng);
  }
  if (personaType === 'malicious_reporter') {
    return decideMalicious(persona, rng);
  }

  const context = classifyContext(personaType, marker);
  const ctxBehavior = persona.behavior?.encounter_marker?.[context];
  if (!ctxBehavior) {
    // Fallback to neutral
    return { action: 'ignore', context };
  }

  const r = rng();
  if (r < ctxBehavior.like_prob) {
    return { action: 'like', context };
  }
  if (r < ctxBehavior.like_prob + ctxBehavior.report_prob) {
    return {
      action: 'report',
      reason: sampleReason(ctxBehavior.report_reason_dist, rng),
      context,
    };
  }
  return { action: 'ignore', context };
}

function sampleReason(reasonDist, rng) {
  if (!reasonDist) return 'other';
  const r = rng();
  let cum = 0;
  for (const [reason, prob] of Object.entries(reasonDist)) {
    cum += prob;
    if (r < cum) return reason;
  }
  return 'other';
}

// ======================================================================
// Spammer behavior — focused on rapid like/unlike toggling
// ======================================================================

function decideSpammer(persona, rng) {
  // Spammers mostly target a specific marker; for simplicity always like
  const r = rng();
  if (r < 0.7) return { action: 'like', context: 'spam_target' };
  if (r < 0.85) return { action: 'unlike', context: 'spam_toggle' };
  return { action: 'ignore', context: 'spam_idle' };
}

// ======================================================================
// Malicious reporter behavior — concentrated on reporting specific targets
// ======================================================================

function decideMalicious(persona, rng) {
  const dist = persona.behavior?.encounter_marker;
  const targetProb = dist?.report_specific_target_prob ?? 0.7;
  const randomProb = dist?.report_random_prob ?? 0.2;

  const r = rng();
  if (r < targetProb + randomProb) {
    return {
      action: 'report',
      reason: sampleReason(dist?.report_reason_dist, rng),
      context: 'malicious',
    };
  }
  return { action: 'ignore', context: 'malicious_idle' };
}

// ======================================================================
// Population builder — generate walkers based on distribution
// ======================================================================

export function buildPopulation(totalCount) {
  const dist = getDistribution();
  const personas = dist.personas;

  // Compute target counts based on share_in_population
  const counts = {};
  let allocated = 0;
  for (const [type, p] of Object.entries(personas)) {
    counts[type] = Math.round(totalCount * p.share_in_population);
    allocated += counts[type];
  }
  // Adjust for rounding error — add to largest group
  const diff = totalCount - allocated;
  if (diff !== 0) {
    const largest = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    counts[largest] += diff;
  }

  const walkers = [];
  let nextId = 0;
  for (const [type, count] of Object.entries(counts)) {
    for (let i = 0; i < count; i++) {
      walkers.push(createWalker(nextId++, type));
    }
  }
  return walkers;
}

// ======================================================================
// Walker factory
// ======================================================================

export function createWalker(id, personaType) {
  return {
    id,
    personaType,
    // Position state — set by simulator (trail, segment, t)
    trailIdx: 0,
    segIdx: 0,
    segT: 0,
    direction: 1,
    speed: 0.001,
    // Track visited markers — to enforce "one vote per marker"
    visited: new Map(),  // markerId → { liked, reported }
    // Group state (for social_group persona)
    groupId: null,
    isGroupLeader: false,
    // Encounter cooldown — don't decide on same marker every frame
    lastEncounterT: new Map(),  // markerId → timestamp
  };
}

// ======================================================================
// Group dynamics (v3.2 §17, persona social_group)
// 30% solo / 70% groups (size 2/3-4/5+)
// ======================================================================

export function assignGroups(walkers) {
  const socialWalkers = walkers.filter(w => w.personaType === 'social_group');
  const dist = getDistribution();
  const sizeDist = dist.group_dynamics?.group_size_distribution ?? { '1': 0.3, '2': 0.35, '3-4': 0.25, '5+': 0.1 };

  let nextGroupId = 1;
  const remaining = [...socialWalkers];

  while (remaining.length > 0) {
    const r = Math.random();
    let size = 1;
    let cum = 0;
    for (const [bucket, prob] of Object.entries(sizeDist)) {
      cum += prob;
      if (r < cum) {
        if (bucket === '1') size = 1;
        else if (bucket === '2') size = 2;
        else if (bucket === '3-4') size = 3 + Math.floor(Math.random() * 2);
        else if (bucket === '5+') size = 5 + Math.floor(Math.random() * 3);
        break;
      }
    }
    size = Math.min(size, remaining.length);
    const group = remaining.splice(0, size);
    const gid = nextGroupId++;
    group.forEach((w, i) => {
      w.groupId = gid;
      w.isGroupLeader = (i === 0);
    });
  }
}

// ======================================================================
// Encounter cooldown — prevent re-deciding on same marker too frequently
// ======================================================================

const ENCOUNTER_COOLDOWN_MS = 60 * 1000; // 60s simulated time

export function canDecide(walker, markerId, now) {
  const last = walker.lastEncounterT.get(markerId);
  if (!last) return true;
  return (now - last) > ENCOUNTER_COOLDOWN_MS;
}

export function recordEncounter(walker, markerId, now) {
  walker.lastEncounterT.set(markerId, now);
}
