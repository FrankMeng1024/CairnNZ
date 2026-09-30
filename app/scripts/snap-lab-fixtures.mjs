import crypto from 'node:crypto';

const ORIGIN = Object.freeze({ lat: -43.5321, lng: 172.6362 });
const METERS_PER_DEG_LAT = 111_320;
const PROFILE_INTERVAL_S = Object.freeze({ primary: 5, sparse: 15, adversarial: 7 });
const TRUE_BLACKOUT_START_FRACTION = 0.38;
const TRUE_BLACKOUT_END_FRACTION = 0.64;
const PHYSICAL_GAP_THRESHOLD_MS = 120_000;

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const round = (value, digits = 7) => Number(value.toFixed(digits));

function hashSeed(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function metresToCoordinate(point) {
  const latitudeRadians = ORIGIN.lat * Math.PI / 180;
  return {
    lat: round(ORIGIN.lat + point.y / METERS_PER_DEG_LAT),
    lng: round(ORIGIN.lng + point.x / (METERS_PER_DEG_LAT * Math.cos(latitudeRadians))),
  };
}

function localDistance(left, right) {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

function polylineLength(points) {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) length += localDistance(points[index - 1], points[index]);
  return length;
}

function interpolatePolyline(points, fraction) {
  const target = clamp(fraction, 0, 1) * polylineLength(points);
  let walked = 0;
  for (let index = 1; index < points.length; index += 1) {
    const edge = localDistance(points[index - 1], points[index]);
    if (walked + edge >= target || index === points.length - 1) {
      const along = edge <= 0 ? 0 : clamp((target - walked) / edge, 0, 1);
      return {
        x: points[index - 1].x + (points[index].x - points[index - 1].x) * along,
        y: points[index - 1].y + (points[index].y - points[index - 1].y) * along,
      };
    }
    walked += edge;
  }
  return { ...points.at(-1) };
}

function scaleRoute(points, scale) {
  return points.map(point => ({ x: point.x * scale, y: point.y * scale }));
}

function zigZagSwitchback(length, width, turns) {
  const points = [{ x: 0, y: 0 }];
  for (let index = 1; index <= turns; index += 1) {
    points.push({ x: index * length / turns, y: index % 2 === 0 ? 0 : width });
  }
  return points;
}

function circle(centerX, centerY, radius, samples, phase = 0) {
  return Array.from({ length: samples + 1 }, (_, index) => {
    const angle = phase + Math.PI * 2 * index / samples;
    return { x: centerX + Math.cos(angle) * radius, y: centerY + Math.sin(angle) * radius };
  });
}

function routeDefinition(caseId, mode) {
  const modeScale = mode === 'run' ? 1.65 : 1;
  const straight = metres => scaleRoute([{ x: 0, y: 0 }, { x: metres, y: 0 }], modeScale);
  const definitions = {
    SL01: straight(900),
    SL02: straight(760),
    SL03: straight(520),
    SL04: straight(800),
    SL05: scaleRoute([{ x: 0, y: 0 }, { x: 330, y: 0 }, { x: 660, y: 35 }], modeScale),
    SL06: scaleRoute([{ x: 0, y: 0 }, { x: 260, y: 0 }, { x: 520, y: 80 }, { x: 780, y: 80 }], modeScale),
    SL07: scaleRoute([{ x: 0, y: 0 }, { x: 300, y: 0 }, ...zigZagSwitchback(420, 70, 8).slice(1).map(point => ({ x: point.x + 300, y: point.y }))], modeScale),
    SL08: scaleRoute([{ x: 0, y: 0 }, { x: 260, y: 0 }, { x: 340, y: 50 }, { x: 420, y: -35 }, { x: 520, y: 70 }, { x: 650, y: 0 }, { x: 930, y: 0 }], modeScale),
    SL09: scaleRoute([{ x: 0, y: 0 }, { x: 180, y: 0 }, { x: 180, y: 110 }, { x: 360, y: 110 }, { x: 360, y: 220 }, { x: 560, y: 220 }], modeScale),
    SL10: scaleRoute([{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 120, y: 12 }, { x: 620, y: 12 }, { x: 660, y: 0 }, { x: 760, y: 0 }], modeScale),
    SL11: scaleRoute([{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 120, y: 12 }, { x: 500, y: 12 }, { x: 560, y: 45 }, { x: 700, y: 45 }], modeScale),
    SL12: scaleRoute([{ x: 0, y: 0 }, { x: 420, y: 260 }], modeScale),
    SL13: scaleRoute([{ x: 0, y: 9 }, { x: 760, y: 9 }], modeScale),
    SL14: scaleRoute([{ x: 0, y: 0 }, { x: 180, y: 0 }, { x: 260, y: 20 }, { x: 330, y: 70 }, { x: 350, y: 150 }, { x: 350, y: 360 }], modeScale),
    SL15: scaleRoute([{ x: 0, y: 0 }, { x: 480, y: 0 }, { x: 0, y: 0 }, { x: 210, y: 0 }], modeScale),
    SL16: scaleRoute([
      ...circle(130, 0, 120, 20),
      ...circle(390, 0, 120, 20).slice(1),
      ...circle(650, 0, 120, 20, Math.PI).slice(1),
    ], modeScale),
    SL17: scaleRoute(zigZagSwitchback(680, 85, 12), modeScale),
    SL18: scaleRoute([{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 110 }, { x: 650, y: 110 }], modeScale),
    SL19: scaleRoute([{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 330, y: 45 }, { x: 300, y: 0 }, { x: 760, y: 0 }], modeScale),
    SL20: scaleRoute([{ x: 0, y: 0 }, { x: 240, y: 0 }, { x: 360, y: 65 }, { x: 620, y: 65 }], modeScale),
    SL21: straight(680),
    SL22: scaleRoute([{ x: 0, y: 0 }, { x: 340, y: 0 }, { x: 450, y: 60 }, { x: 790, y: 60 }], modeScale),
    SL23: scaleRoute([{ x: 0, y: 0 }, { x: 650, y: 0 }, { x: 650, y: 180 }, { x: 1_300, y: 180 }, { x: 1_300, y: -80 }, { x: 2_100, y: -80 }], modeScale),
    SL24: scaleRoute([
      { x: 0, y: 0 }, { x: 1_000, y: 0 }, { x: 1_300, y: 80 },
      ...zigZagSwitchback(1_100, 180, 12).slice(1).map(point => ({ x: point.x + 1_300, y: point.y + 80 })),
      { x: 2_800, y: 0 }, { x: 4_100, y: 0 }, { x: 5_000, y: 260 },
      { x: 6_200, y: 260 },
    ], modeScale),
  };
  return definitions[caseId];
}

function caseDurationSeconds(caseId) {
  if (caseId === 'SL01') return 720;
  if (caseId === 'SL03') return 1_020;
  if (caseId === 'SL23') return 1_800;
  if (caseId === 'SL24') return 7_200;
  return ['SL07', 'SL08', 'SL16', 'SL17', 'SL19', 'SL20', 'SL22'].includes(caseId) ? 900 : 660;
}

function availableMapFor(caseId, truth) {
  const mapPath = (id, name, points, kind = 'pedestrian') => ({ id, name, kind, points });
  const all = truth.map(point => ({ x: point.x, y: point.y }));
  const straightArterial = y => [{ x: truth[0].x, y }, { x: truth.at(-1).x, y }];
  switch (caseId) {
    case 'SL04':
    case 'SL19': {
      const third = Math.floor(all.length / 3);
      return [
        mapPath('mapped-before', 'Mapped before gap', all.slice(0, third + 1)),
        mapPath('mapped-after', 'Mapped after gap', all.slice(third * 2)),
      ];
    }
    case 'SL08': {
      const third = Math.floor(all.length / 3);
      return [
        mapPath('city-before', 'City path', all.slice(0, third + 1)),
        mapPath('city-after', 'Return city path', all.slice(third * 2)),
      ];
    }
    case 'SL09':
      return [
        mapPath('internal', 'Residential internal path', all),
        mapPath('arterial', 'External arterial', straightArterial(-24), 'arterial'),
      ];
    case 'SL10':
      return [mapPath('arterial', 'Arterial behind wall', straightArterial(-1), 'arterial')];
    case 'SL11':
      return [
        mapPath('internal', 'Mapped internal path', all),
        mapPath('arterial', 'Nearby arterial', straightArterial(-9), 'arterial'),
      ];
    case 'SL12':
      return [mapPath('perimeter', 'Plaza perimeter', [all[0], { x: all[0].x, y: all.at(-1).y }, all.at(-1)], 'road')];
    case 'SL13': {
      const endX = all.at(-1).x;
      const supportedEndX = endX * 0.42;
      return [
        mapPath('supported-positive', 'Supported pedestrian path', [
          { x: all[0].x, y: all[0].y },
          { x: supportedEndX, y: all[0].y },
        ], 'pedestrian'),
        mapPath('parallel-a', 'Parallel A', [
          { x: supportedEndX + 35, y: 0 }, { x: endX, y: 0 },
        ], 'road'),
        mapPath('parallel-b', 'Parallel B', [
          { x: supportedEndX + 35, y: 18 * (endX / 760) }, { x: endX, y: 18 * (endX / 760) },
        ], 'road'),
      ];
    }
    case 'SL17':
      return [
        mapPath('trail', 'Mapped switchback trail', all, 'trail'),
        mapPath('shortcut-road', 'Direct service road', [all[0], all.at(-1)], 'road'),
      ];
    case 'SL24': {
      const fifth = Math.floor(all.length / 5);
      return [
        mapPath('urban-early', 'Urban early', all.slice(0, fifth + 1)),
        mapPath('parallel-road', 'Parallel road', all.slice(fifth, fifth * 2 + 1).map(point => ({ x: point.x, y: point.y - 16 })), 'arterial'),
        mapPath('mapped-trail', 'Mapped trail', all.slice(fifth * 2, fifth * 3 + 1), 'trail'),
        mapPath('urban-late', 'Urban late', all.slice(fifth * 4)),
      ];
    }
    default:
      return [mapPath('supported-route', caseId === 'SL07' ? 'Mapped pedestrian trail' : 'Mapped pedestrian route', all, caseId === 'SL07' ? 'trail' : 'pedestrian')];
  }
}

function scenarioFractions(caseId, durationSeconds) {
  if (caseId === 'SL03') {
    return [
      { fromS: 0, toS: 180, fromFraction: 0, toFraction: 0.32 },
      { fromS: 180, toS: 240, fromFraction: 0.32, toFraction: 0.32, stopped: true },
      { fromS: 240, toS: 420, fromFraction: 0.32, toFraction: 0.55 },
      { fromS: 420, toS: 600, fromFraction: 0.55, toFraction: 0.55, stopped: true },
      { fromS: 600, toS: 720, fromFraction: 0.55, toFraction: 0.72 },
      { fromS: 720, toS: 900, fromFraction: 0.72, toFraction: 0.72, stopped: true },
      { fromS: 900, toS: durationSeconds, fromFraction: 0.72, toFraction: 1 },
    ];
  }
  if (caseId === 'SL18') {
    return [
      { fromS: 0, toS: durationSeconds * 0.4, fromFraction: 0, toFraction: 0.45 },
      { fromS: durationSeconds * 0.4, toS: durationSeconds * 0.62, fromFraction: 0.45, toFraction: 0.45, stopped: true },
      { fromS: durationSeconds * 0.62, toS: durationSeconds, fromFraction: 0.45, toFraction: 1 },
    ];
  }
  return [{ fromS: 0, toS: durationSeconds, fromFraction: 0, toFraction: 1 }];
}

function truthAtSecond(route, phases, second) {
  const phase = phases.find(item => second >= item.fromS && second <= item.toS) ?? phases.at(-1);
  const fraction = phase.toS <= phase.fromS
    ? phase.toFraction
    : phase.fromFraction + (phase.toFraction - phase.fromFraction) * (second - phase.fromS) / (phase.toS - phase.fromS);
  return { ...interpolatePolyline(route, fraction), stopped: Boolean(phase.stopped), routeFraction: fraction };
}

function profileInterval(caseId, profileId) {
  if (caseId === 'SL23' && profileId === 'primary') return 1;
  if (caseId === 'SL23' && profileId === 'sparse') return 15;
  if (caseId === 'SL24' && profileId === 'sparse') return 20;
  return PROFILE_INTERVAL_S[profileId];
}

function generateRawEvents({ caseId, mode, profileId, seed, route, durationSeconds }) {
  const random = mulberry32(hashSeed(`${caseId}:${mode}:${profileId}:${seed}`));
  const phases = scenarioFractions(caseId, durationSeconds);
  const intervalS = profileInterval(caseId, profileId);
  const baseTimeMs = Date.UTC(2026, 8, 30, 0, 0, 0) + hashSeed(`${caseId}:${mode}`) % 10_000_000;
  const events = [];
  const truthTimeline = [];
  let biasEastM = 0;
  let biasNorthM = 0;
  let lastTruth = null;
  let deliveryBatchEndMs = baseTimeMs;
  for (let second = 0, ordinal = 1; second <= durationSeconds; second += intervalS, ordinal += 1) {
    const truth = truthAtSecond(route, phases, second);
    truthTimeline.push({
      observationTimeMs: baseTimeMs + second * 1_000,
      local: { x: round(truth.x, 3), y: round(truth.y, 3) },
      stopped: truth.stopped,
      routeFraction: round(truth.routeFraction, 6),
    });
    const inBlackout = ['SL04', 'SL19', 'SL24'].includes(caseId)
      && second > durationSeconds * TRUE_BLACKOUT_START_FRACTION
      && second < durationSeconds * TRUE_BLACKOUT_END_FRACTION;
    if (inBlackout) continue;
    const correlatedStrength = profileId === 'adversarial' ? 3.2 : profileId === 'sparse' ? 1.8 : 1.2;
    biasEastM = biasEastM * 0.94 + (random() - 0.5) * correlatedStrength;
    biasNorthM = biasNorthM * 0.94 + (random() - 0.5) * correlatedStrength;
    const stoppedDrift = truth.stopped ? (profileId === 'adversarial' ? 2.2 : 1.1) : 0;
    let eastNoiseM = biasEastM + Math.sin(ordinal / 5) * correlatedStrength + (random() - 0.5) * 1.2 + stoppedDrift * Math.sin(ordinal / 3);
    let northNoiseM = biasNorthM + Math.cos(ordinal / 7) * correlatedStrength + (random() - 0.5) * 1.2 + stoppedDrift * Math.cos(ordinal / 4);
    let accuracyM = profileId === 'adversarial' ? 9 : profileId === 'sparse' ? 7 : 5;
    if (['SL05', 'SL18', 'SL19'].includes(caseId) && second > durationSeconds * 0.35 && second < durationSeconds * 0.58) {
      accuracyM = ordinal % 5 === 0 ? 58 : 27;
      eastNoiseM += ordinal % 7 === 0 ? 45 : 8;
      northNoiseM += ordinal % 7 === 0 ? -32 : 6;
    }
    if (caseId === 'SL18' && ordinal % 37 === 0) {
      accuracyM = ordinal % 74 === 0 ? 4 : 72;
      eastNoiseM += 38;
      northNoiseM -= 31;
    }
    const observedLocal = { x: truth.x + eastNoiseM, y: truth.y + northNoiseM };
    const observationTimeMs = baseTimeMs + second * 1_000;
    let deliveryTimeMs = observationTimeMs + 120;
    if (caseId === 'SL06' || profileId === 'sparse') {
      const batchMs = caseId === 'SL06' ? 30_000 : 15_000;
      deliveryBatchEndMs = Math.max(deliveryBatchEndMs, Math.ceil((observationTimeMs - baseTimeMs + 1) / batchMs) * batchMs + baseTimeMs);
      deliveryTimeMs = deliveryBatchEndMs;
    }
    const trueSpeedMps = !lastTruth || truth.stopped ? 0 : localDistance(lastTruth, truth) / intervalS;
    const speed = ordinal % 9 === 0 ? null : ordinal % 7 === 0 ? 0 : round(trueSpeedMps, 3);
    const coordinate = metresToCoordinate(observedLocal);
    events.push({
      ordinal,
      observationTimeMs,
      deliveryTimeMs,
      appState: caseId === 'SL06' && Math.floor(second / 90) % 2 === 1 ? 'background' : 'active',
      observedLocal: { x: round(observedLocal.x, 3), y: round(observedLocal.y, 3) },
      coordinate,
      accuracyM,
      speedMps: speed,
      speedAccuracyMps: speed == null ? null : profileId === 'adversarial' ? 2.5 : 0.8,
      source: 'simulator',
    });
    lastTruth = truth;
  }
  if (profileId === 'adversarial' && events.length > 12) {
    const duplicate = { ...events[8], ordinal: events.at(-1).ordinal + 1, deliveryTimeMs: events[10].deliveryTimeMs };
    events.splice(11, 0, duplicate);
    const outOfOrder = events.splice(15, 1)[0];
    if (outOfOrder) events.splice(18, 0, outOfOrder);
  }
  return { events, truthTimeline, baseTimeMs, intervalS };
}

function oracleFor(caseId) {
  const localOnly = ['SL10', 'SL12'].includes(caseId);
  const hybrid = ['SL04', 'SL08', 'SL11', 'SL17', 'SL19', 'SL24'].includes(caseId);
  const positiveRoadCoverage = ['SL01', 'SL02', 'SL04', 'SL07', 'SL08', 'SL09', 'SL11', 'SL13']
    .includes(caseId);
  return {
    expectedSelection: localOnly ? 'local' : hybrid ? 'hybrid_or_safe_local' : 'refined_or_hybrid',
    wrongCorridorOccupationM: 0,
    inventedGapCrossings: 0,
    preserveChronology: true,
    preserveStructures: ['SL14', 'SL15', 'SL16', 'SL17', 'SL19'].includes(caseId),
    requiresPositiveRoadCoverage: positiveRoadCoverage,
    trueGapExpected: ['SL04', 'SL19', 'SL24'].includes(caseId),
    offlineThenUpgrade: caseId === 'SL20',
    walFaultRecovery: caseId === 'SL22',
    slowDiagnostics: caseId === 'SL21',
  };
}

function lifecycleFor(caseId) {
  return {
    trueBlackout: ['SL04', 'SL19', 'SL24'].includes(caseId),
    blackoutStartFraction: TRUE_BLACKOUT_START_FRACTION,
    blackoutEndFraction: TRUE_BLACKOUT_END_FRACTION,
    offlineAtFinish: caseId === 'SL20',
    restoreOnlineAfterColdOpen: caseId === 'SL20',
    slowDiagnosticWriteMs: caseId === 'SL21' ? 180 : 0,
    walReadFaultOnce: caseId === 'SL22',
    yieldedFinish: caseId === 'SL22',
  };
}

function transportConfigFor(caseId, profileId) {
  if (caseId === 'SL21') {
    return {
      failureMode: profileId === 'primary'
        ? 'timeout'
        : profileId === 'sparse' ? 'nomatch' : 'auth-then-unavailable',
    };
  }
  return {
    failureMode: 'none',
    forceLowMatchingConfidence: false,
  };
}

export function generateSnapLabFixture(contractCase, mode, profile) {
  if (!contractCase?.caseId || !['hike', 'run'].includes(mode) || !profile?.id) {
    throw new Error('snap_lab_fixture_contract_invalid');
  }
  const caseId = contractCase.caseId;
  const route = routeDefinition(caseId, mode);
  if (!route) throw new Error(`snap_lab_fixture_case_unknown:${caseId}`);
  const durationSeconds = caseDurationSeconds(caseId);
  const raw = generateRawEvents({
    caseId,
    mode,
    profileId: profile.id,
    seed: profile.seed,
    route,
    durationSeconds,
  });
  const truth = route.map((point, index) => ({
    index,
    local: { x: round(point.x, 3), y: round(point.y, 3) },
    coordinate: metresToCoordinate(point),
  }));
  const mapPaths = availableMapFor(caseId, route).map(path => ({
    ...path,
    localPoints: path.points.map(point => ({ x: round(point.x, 3), y: round(point.y, 3) })),
    coordinates: path.points.map(metresToCoordinate),
  })).map(({ points: _points, ...path }) => path);
  const sl10Scale = caseId === 'SL10' ? route.at(-1).x / 760 : 1;
  const fixture = {
    schema: 'cairn.snaplab.generated-fixture.v1',
    caseId,
    mode,
    profile: profile.id,
    seed: profile.seed,
    contractIntent: {
      scenario: contractCase.scenario,
      transportFixture: contractCase.transportFixture,
      oracleRequirements: contractCase.oracleRequirements,
    },
    durationSeconds,
    clock: {
      observationStartMs: raw.baseTimeMs,
      observationEndMs: raw.baseTimeMs + durationSeconds * 1_000,
      observationIntervalSeconds: raw.intervalS,
      deliveryMode: caseId === 'SL06' || profile.id === 'sparse' ? 'batched' : 'streamed',
    },
    // The latent truth timeline is private scorer/reviewer authority. The app
    // runner receives only rawEvents + availableMap + lifecycle. Keeping this
    // in a separate object makes accidental matcher leakage mechanically easy
    // to detect at the bridge boundary.
    truthPrivate: { origin: ORIGIN, controlPoints: truth, timeline: raw.truthTimeline },
    availableMap: {
      origin: ORIGIN,
      paths: mapPaths,
      barriers: caseId === 'SL10' ? [{
        id: 'internal-wall',
        kind: 'impermeable-wall',
        from: metresToCoordinate({ x: 100 * sl10Scale, y: 6 * sl10Scale }),
        to: metresToCoordinate({ x: 640 * sl10Scale, y: 6 * sl10Scale }),
      }] : [],
    },
    rawEvents: raw.events,
    lifecycle: lifecycleFor(caseId),
    oraclePrivate: oracleFor(caseId),
    transportScenario: contractCase.transportFixture,
    transportConfig: transportConfigFor(caseId, profile.id),
  };
  return { ...fixture, fixtureSha256: sha256(JSON.stringify(fixture)) };
}

export function generateAuthoritativeFixtures(matrix) {
  const fixtures = [];
  for (const contractCase of matrix.cases) {
    for (const mode of ['hike', 'run']) {
      for (const profile of matrix.profiles) fixtures.push(generateSnapLabFixture(contractCase, mode, profile));
    }
  }
  return fixtures;
}

export function validateFixtureSet(fixtures, matrix) {
  const ids = new Set(fixtures.map(fixture => `${fixture.caseId}/${fixture.mode}/${fixture.profile}`));
  const expected = matrix.cases.flatMap(contractCase => (
    ['hike', 'run'].flatMap(mode => matrix.profiles.map(profile => `${contractCase.caseId}/${mode}/${profile.id}`))
  ));
  const duplicateCount = fixtures.length - ids.size;
  const missing = expected.filter(id => !ids.has(id));
  const malformed = fixtures.filter(fixture => {
    const observationTimes = fixture.rawEvents
      .map(event => event.observationTimeMs)
      .sort((left, right) => left - right);
    const maximumObservationGapMs = observationTimes.slice(1).reduce((maximum, time, index) => (
      Math.max(maximum, time - observationTimes[index])
    ), 0);
    return fixture.rawEvents.length < 4
      || fixture.truthPrivate.controlPoints.length < 2
      || !/^[a-f0-9]{64}$/.test(fixture.fixtureSha256)
      || fixture.rawEvents.some(event => event.deliveryTimeMs < event.observationTimeMs)
      || (fixture.lifecycle.trueBlackout && maximumObservationGapMs <= PHYSICAL_GAP_THRESHOLD_MS);
  }).map(fixture => `${fixture.caseId}/${fixture.mode}/${fixture.profile}`);
  return {
    expectedCount: expected.length,
    actualCount: fixtures.length,
    duplicateCount,
    missing,
    malformed,
    valid: fixtures.length === expected.length && duplicateCount === 0 && missing.length === 0 && malformed.length === 0,
  };
}

export const snapLabFixtureUtils = Object.freeze({
  metresToCoordinate,
  polylineLength,
  sha256,
});
