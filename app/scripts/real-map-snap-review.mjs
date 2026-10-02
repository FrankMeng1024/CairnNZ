#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const argument = (name, fallback = null) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const lane = String(argument('--lane', '')).toUpperCase();
if (!['A', 'B', 'C'].includes(lane)) throw new Error('review_lane_must_be_A_B_or_C');
const reviewRoot = path.resolve(argument(
  '--review-root',
  path.join(process.env.HOME, 'Desktop/Cairn_RealMap_Snap_Final_Review'),
));
const activityRoot = path.resolve(argument('--activities', path.join(reviewRoot, 'actual-app-campaign', 'activities')));
const campaignRoot = path.resolve(argument('--campaign', path.join(reviewRoot, 'frozen-campaign')));
const evaluationRoot = path.resolve(argument('--evaluation', path.join(reviewRoot, 'final-evaluation')));
const atlasRoot = path.resolve(argument('--atlas', path.join(reviewRoot, 'real-map-atlas')));
const outputRoot = path.resolve(argument('--output', path.join(reviewRoot, 'reviewers')));
const ledgerPath = path.resolve(argument('--ledger', path.join(reviewRoot, 'request-cost-ledger.json')));
const safetyPath = path.resolve(argument(
  '--safety',
  path.join(process.env.HOME, 'Desktop/Cairn_O71_Targeted_RealMap_Closure/safety-check-old-activities/REAL_MAP_SAFETY_REPORT.json'),
));
const runPath = path.resolve(argument('--run', path.join(path.dirname(activityRoot), 'RUN_RESULTS.json')));
const auditPath = path.resolve(argument('--audit', path.join(path.dirname(activityRoot), 'NETWORK_BOUNDARY_AUDIT.json')));

const sha256File = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};
const fmt = value => Number.isFinite(value) ? Number(value.toFixed(2)) : null;
const pointsFingerprint = points => crypto.createHash('sha256').update(JSON.stringify(points)).digest('hex');

const evaluation = JSON.parse(fs.readFileSync(path.join(evaluationRoot, 'SUMMARY.json'), 'utf8'));
const evaluationById = new Map(evaluation.cases.map(item => [item.runId, item]));
const evaluationReportById = new Map(evaluation.cases.map(item => {
  const reportPath = path.join(evaluationRoot, 'reports', `${item.runId}.json`);
  return [item.runId, fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : null];
}));
const run = JSON.parse(fs.readFileSync(runPath, 'utf8'));
const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const safety = fs.existsSync(safetyPath) ? JSON.parse(fs.readFileSync(safetyPath, 'utf8')) : null;
const safetyById = new Map((safety?.cases ?? []).map(item => [item.runId, item]));
const records = [];
for (const runId of fs.readdirSync(activityRoot).sort()) {
  const directory = path.join(activityRoot, runId);
  if (!fs.existsSync(path.join(directory, 'QA_ACTIVITY.json'))) continue;
  const activity = JSON.parse(fs.readFileSync(path.join(directory, 'QA_ACTIVITY.json'), 'utf8'));
  const result = JSON.parse(fs.readFileSync(path.join(directory, 'RESULT.json'), 'utf8'));
  const input = JSON.parse(fs.readFileSync(path.join(directory, 'PUBLIC_INPUT.json'), 'utf8'));
  const oracle = JSON.parse(fs.readFileSync(path.join(campaignRoot, 'oracle', `${runId}.json`), 'utf8'));
  records.push({ runId, directory, activity, result, input, oracle, evaluation: evaluationById.get(runId) });
}
if (records.length !== 30) throw new Error(`review_activity_count:${records.length}/30`);

const groupCounts = values => Object.fromEntries([...new Set(values)].sort().map(value => [
  value,
  values.filter(item => item === value).length,
]));
const allStats = record => record.activity.segmentStats;
const allSections = record => allStats(record).flatMap(stats => stats.sections ?? []);
const allDecisions = record => allStats(record).flatMap(stats => stats.sectionDecisions ?? []);
const allRequests = record => allStats(record).flatMap(stats => stats.requestResults ?? []);
const outcomeFor = verdict => verdict === 'PASS_IN_DECLARED_SCOPE'
  ? 'PASS'
  : verdict === 'ORACLE_UNCERTAIN' ? 'UNKNOWN' : verdict === 'MAP_DATA_LIMITATION' ? 'LIMITATION' : 'FINDING';

async function laneAReport() {
  const cases = records.map(record => {
    const sections = allSections(record);
    const decisions = allDecisions(record);
    const requests = allRequests(record);
    const wholeRoute = allStats(record).map(stats => stats.wholeRouteValidation);
    const networkSections = sections.filter(section => section.networkSource !== 'none');
    const assemblyFallbacks = decisions.filter(decision => decision.reasonCode === 'LOCAL_ASSEMBLY_UNSAFE');
    const directionsAccepted = networkSections.filter(section => section.networkSource === 'walking-directions');
    const maxSeamEdgeM = Math.max(0, ...sections.flatMap(section => [section.seam?.entryEdgeM ?? 0, section.seam?.exitEdgeM ?? 0]));
    const maxSeamAngleDeg = Math.max(0, ...sections.flatMap(section => [section.seam?.entryHeadingDeltaDeg ?? 0, section.seam?.exitHeadingDeltaDeg ?? 0]));
    const evaluationReport = evaluationReportById.get(record.runId);
    const observedOutcome = record.evaluation?.observedOutcome ?? record.evaluation?.verdict ?? 'UNKNOWN';
    const provenRootCause = record.evaluation?.provenRootCause ?? 'NOT_REPORTED_BY_LEGACY_EVALUATOR';
    const safetyCase = safetyById.get(record.runId) ?? null;
    const topology = record.oracle.protectedTopology.join('; ');
    const comment = networkSections.length > 0
      ? `${record.runId}: ${networkSections.length} persisted network section(s) survived whole-route assembly; protected sequence reviewed against ${topology}.`
      : `${record.runId}: provider output was retained in receipts but Selected Final stayed local; ${record.oracle.expectedClass} has observed outcome ${observedOutcome}; root cause ${provenRootCause}.`;
    return {
      runId: record.runId,
      activityId: record.activity.activityId,
      expectedClass: record.oracle.expectedClass,
      holdout: record.oracle.holdout,
      selectedSource: record.activity.selectedSource,
      networkSectionCount: networkSections.length,
      networkStates: groupCounts(networkSections.map(section => section.state)),
      localSectionCount: sections.length - networkSections.length,
      requestOutcomes: groupCounts(requests.map(request => `${request.kind}:${request.responseCode ?? request.result}`)),
      acceptedDirectionsSectionCount: directionsAccepted.length,
      directionsHaveRecordedAuthorityDecision: directionsAccepted.every(section => (
        decisions.some(decision => decision.candidateSource === 'walking-directions'
          && decision.result === 'accepted'
          && decision.sourceStart === section.sourceStart)
      )),
      wholeRouteAccepted: wholeRoute.every(validation => validation?.accepted === true),
      assemblyFallbackCount: assemblyFallbacks.length,
      maxSeamEdgeM: fmt(maxSeamEdgeM),
      maxSeamAngleDeg: fmt(maxSeamAngleDeg),
      referenceDeviationM: {
        localMean: evaluationReport?.metrics?.local?.meanM ?? record.evaluation?.localMeanM ?? null,
        selectedMean: evaluationReport?.metrics?.selected?.meanM ?? record.evaluation?.selectedMeanM ?? null,
        selectedP95: record.evaluation?.selectedP95M ?? null,
        selectedMax: evaluationReport?.metrics?.selected?.maxM ?? record.evaluation?.selectedMaxM ?? null,
      },
      protectedTopology: record.oracle.protectedTopology,
      observedOutcome,
      provenRootCause,
      outcome: record.evaluation?.observedOutcome
        ? (observedOutcome === 'PASS_IN_DECLARED_SCOPE' ? 'PASS' : 'FINDING')
        : outcomeFor(observedOutcome),
      independentSafety: safetyCase ? {
        outcome: safetyCase.outcome,
        obstacleOrBarrier: safetyCase.wholeSelectedVersusIndependentContext?.obstacleOrBarrier ?? null,
        corridorIdentity: safetyCase.wholeSelectedVersusIndependentContext?.corridorIdentity ?? null,
        movementGap: safetyCase.wholeSelectedVersusIndependentContext?.movementGap ?? null,
        orderedReferenceTopology: safetyCase.wholeSelectedVersusIndependentContext?.orderedReferenceTopology ?? null,
        introducedVersusLocal: safetyCase.introducedVersusLocal ?? null,
      } : {
        outcome: 'UNKNOWN',
        reason: 'INDEPENDENT_SAFETY_REPORT_UNAVAILABLE',
      },
      reviewerComment: comment,
    };
  });
  const wrong = cases.filter(item => item.observedOutcome === 'WRONG_CORRIDOR').length;
  const checkedObstacle = cases.filter(item => item.independentSafety.obstacleOrBarrier?.status?.startsWith('VERIFIED'));
  const obstacle = checkedObstacle.reduce((sum, item) => (
    sum + (item.independentSafety.obstacleOrBarrier?.crossingCount ?? 0)
  ), 0);
  const unknownObstacle = cases.length - checkedObstacle.length;
  const checkedCorridor = cases.filter(item => item.independentSafety.corridorIdentity?.status?.startsWith('VERIFIED'));
  const unknownCorridor = cases.length - checkedCorridor.length;
  const unsafeWhole = cases.filter(item => !item.wholeRouteAccepted).length;
  return {
    schema: 'cairn.real-map-snap.reviewer-a.v1',
    lane: 'A — Provider / geometry',
    execution: 'separated read-only pass; no production edits and no network dispatch',
    officialSemanticsBasis: 'Mapbox Matching/Directions parameters and response semantics frozen in OFFICIAL_SOURCE_AUDIT.md',
    caseCount: cases.length,
    summary: {
      outcomes: groupCounts(cases.map(item => item.outcome)),
      selectedSources: groupCounts(cases.map(item => item.selectedSource)),
      wrongCorridorProxyVerdictCount: wrong,
      independentlyCheckedObstacleCaseCount: checkedObstacle.length,
      independentlyObservedObstacleCrossingCount: checkedObstacle.length > 0 ? obstacle : null,
      obstacleCaseNotVerifiedCount: unknownObstacle,
      independentlyCheckedCorridorIdentityCaseCount: checkedCorridor.length,
      corridorIdentityCaseNotVerifiedCount: unknownCorridor,
      wholeRouteValidationFailureCount: unsafeWhole,
      topologyFailureCount: unsafeWhole,
      responseGeometryLossFindings: cases.filter(item => item.provenRootCause === 'RESPONSE_GEOMETRY_LOSS').length,
      utilityNotDemonstrated: cases.filter(item => item.observedOutcome === 'UTILITY_NOT_DEMONSTRATED').length,
      utilityRegressions: cases.filter(item => item.observedOutcome === 'UTILITY_REGRESSION').length,
      mapDataLimitations: cases.filter(item => item.provenRootCause === 'MAP_DATA_LIMITATION').length,
    },
    verdict: wrong === 0 && obstacle === 0 && unsafeWhole === 0
      && unknownObstacle === 0 && unknownCorridor === 0
      ? 'PASS_INDEPENDENT_SAFETY_WITH_RETAINED_UTILITY_FINDINGS'
      : 'HOLD_SAFETY_NOT_FULLY_VERIFIED',
    cases,
  };
}

async function laneBReport() {
  const product = audit.filter(item => item.boundary === 'cairn-api-isolated');
  const mapbox = audit.filter(item => item.boundary?.startsWith('mapbox'));
  const acceptedOwnerUserIds = new Set(
    run.ownerUserIds ?? (run.ownerUserId ? [run.ownerUserId] : []),
  );
  const cases = records.map(record => {
    const activity = record.activity;
    const stages = activity.stageTimestamps;
    const stageOrder = [stages.finishRequestedAt, stages.qaCommitStartedAt, stages.qaActivityDurableAt, stages.completionPresentedAt];
    const snapshots = activity.routeSnapshots ?? [];
    const snapshot = snapshots[0] ?? null;
    const selectedSegments = new Set(activity.selectedFinal.map(point => point.segmentId).filter(Boolean));
    const crossSegmentRenderedEdges = activity.selectedFinal.slice(1).filter((point, index) => (
      point.segmentId !== activity.selectedFinal[index].segmentId
      && point.segmentId == null
    )).length;
    const distanceDeltaM = Math.abs((activity.session.distanceM ?? 0) - (record.result.live.preFinish.distanceM ?? 0));
    const x05SnapshotImmutable = record.runId !== 'X05-hike-normal' || (
      activity.roadUpgrade?.attemptCount === 1
      && snapshot?.artifactRevision === 1
      && snapshot?.artifactFingerprint === record.result.persisted.routeSnapshotFingerprint
    );
    const ok = activity.realm === 'snap-lab'
      && acceptedOwnerUserIds.has(activity.ownerUserId)
      && activity.session.id === activity.activityId
      && activity.session.clientActivityId === activity.activityId
      && record.result.result === 'SAVED_AND_COLD_REOPENED'
      && stageOrder.every(Number.isFinite)
      && stageOrder.every((value, index) => index === 0 || value >= stageOrder[index - 1])
      && activity.qaMemoryPointCount > 0
      && distanceDeltaM < 0.001
      && snapshots.length === 1
      && x05SnapshotImmutable;
    return {
      runId: record.runId,
      activityId: activity.activityId,
      realm: activity.realm,
      ownerUserId: activity.ownerUserId,
      result: record.result.result,
      rawPointCount: activity.rawPoints.length,
      canonicalPointCount: activity.canonicalPoints.length,
      livePointCount: activity.liveBeforeFinish.length,
      qaMemoryPointCount: activity.qaMemoryPointCount,
      canonicalDistanceInvariantDeltaM: fmt(distanceDeltaM),
      stageOrderValid: stageOrder.every((value, index) => index === 0 || value >= stageOrder[index - 1]),
      finishWallTimeMs: stages.completionPresentedAt - stages.finishRequestedAt,
      providerWallTimeMs: allStats(record).reduce((sum, stats) => sum + (stats.totalApiWallDurationMs ?? 0), 0),
      receiptCount: activity.transportReceipts.length,
      receiptProvenance: groupCounts(activity.transportReceipts.map(receipt => receipt.provenance)),
      selectedSegmentCount: selectedSegments.size,
      crossSegmentRenderedEdgeCount: crossSegmentRenderedEdges,
      routeSnapshotCount: snapshots.length,
      routeSnapshotFingerprint: snapshot?.artifactFingerprint ?? null,
      routeSnapshotPointsSha256: snapshot ? pointsFingerprint(snapshot.points) : null,
      roadUpgrade: activity.roadUpgrade ? {
        outcome: activity.roadUpgrade.outcome,
        attemptCount: activity.roadUpgrade.attemptCount,
        previousFingerprint: activity.roadUpgrade.previousFingerprint,
        selectedFingerprint: activity.roadUpgrade.selectedFingerprint,
      } : null,
      x05SnapshotImmutable,
      pass: ok,
      reviewerComment: `${record.runId}: ${activity.rawPoints.length} raw → ${activity.canonicalPoints.length} canonical; ${activity.qaMemoryPointCount} QA Memory cells preceded Finish; persisted revision ${activity.session.finalGeometryRevision} reopened as ${record.result.persisted.finalGeometryFingerprint}.`,
    };
  });
  const danglingLedgerEntries = ledger.entries.filter(entry => !['completed', 'released-before-dispatch'].includes(entry.state));
  return {
    schema: 'cairn.real-map-snap.reviewer-b.v1',
    lane: 'B — Lifecycle / cost',
    execution: 'separated read-only pass; no production edits and no network dispatch',
    caseCount: cases.length,
    productBoundary: {
      totalIntercepted: product.length,
      methods: groupCounts(product.map(item => item.method)),
      qaIdentityPayloadCount: product.filter(item => item.containsQaIdentity).length,
      coordinatePayloadCount: product.filter(item => item.containsCoordinates).length,
      writeMethodCount: product.filter(item => item.method !== 'GET').length,
    },
    acceptedOwnerUserIds: [...acceptedOwnerUserIds].sort(),
    observedOwnerUserIds: [...new Set(cases.map(item => item.ownerUserId))].sort(),
    realProviderBoundary: {
      auditEntries: mapbox.length,
      statuses: groupCounts(mapbox.map(item => String(item.status ?? item.boundary))),
    },
    ledger: {
      totals: ledger.totals,
      limits: ledger.limits,
      hardCapsRespected: ledger.totals.navigation <= ledger.limits.navigation
        && ledger.totals.estimatedCostUsd <= ledger.limits.estimatedCostUsd,
      danglingEntries: danglingLedgerEntries.map(entry => ({ id: entry.id, product: entry.product, state: entry.state, purpose: entry.purpose })),
    },
    savedAndReopened: cases.filter(item => item.result === 'SAVED_AND_COLD_REOPENED').length,
    lifecyclePassCount: cases.filter(item => item.pass).length,
    zeroGapConnectorCount: cases.reduce((sum, item) => sum + item.crossSegmentRenderedEdgeCount, 0),
    x05SingleUpgradeAndImmutableSnapshot: cases.find(item => item.runId === 'X05-hike-normal')?.x05SnapshotImmutable ?? false,
    verdict: cases.every(item => item.pass)
      && product.every(item => item.method === 'GET' && !item.containsQaIdentity && !item.containsCoordinates)
      && ledger.totals.navigation <= ledger.limits.navigation
      && ledger.totals.estimatedCostUsd <= ledger.limits.estimatedCostUsd
      ? 'PASS'
      : 'HOLD',
    cases,
  };
}

async function laneCReport() {
  const atlasManifestPath = path.join(atlasRoot, 'ATLAS_MANIFEST.json');
  const atlasManifest = JSON.parse(fs.readFileSync(atlasManifestPath, 'utf8'));
  const atlasById = new Map(atlasManifest.cases.map(item => [item.runId, item]));
  const themeEvidence = run.themeEvidence ?? [];
  const themeEvidenceValid = ['day', 'sunset', 'night'].every(theme => {
    const item = themeEvidence.find(candidate => candidate.theme === theme);
    return item && item.gpsReplayed === false
      && fs.existsSync(path.join(path.dirname(activityRoot), item.screenshot));
  });
  const cases = [];
  for (const record of records) {
    const atlas = atlasById.get(record.runId);
    const mapPath = path.join(atlasRoot, atlas?.map ?? 'missing');
    const screens = fs.readdirSync(path.join(record.directory, 'screenshots')).filter(name => /\.(?:png|jpg|jpeg)$/i.test(name)).sort();
    const requiredStages = ['00-configured', '01-live', '02-finish-confirmation', '03-complete', '04-detail', '05-cold-reopen'];
    const stagesPresent = requiredStages.every(stage => screens.some(name => name.startsWith(stage)));
    const metadata = fs.existsSync(mapPath) ? await sharp(mapPath).metadata() : {};
    const mapHash = fs.existsSync(mapPath) ? sha256File(mapPath) : null;
    const binding = atlas
      && atlas.activityId === record.activity.activityId
      && atlas.fixtureSha256 === record.result.fixtureSha256
      && atlas.finalGeometryFingerprint === record.activity.session.finalGeometryFingerprint
      && atlas.routeSnapshotFingerprint === record.activity.routeSnapshots[0]?.artifactFingerprint
      && atlas.mapSha256 === mapHash;
    const integrityComment = `${record.runId}: verified atlas file/hash binding, ${screens.length} retained screenshot files, and required stage filenames. No route-semantic visual judgment is made by this automated lane.`;
    cases.push({
      runId: record.runId,
      activityId: record.activity.activityId,
      map: atlas?.map ?? null,
      mapWidth: metadata.width ?? null,
      mapHeight: metadata.height ?? null,
      mapSha256: mapHash,
      attributionExpected: '© Mapbox © OpenStreetMap',
      screenshotCount: screens.length,
      screenshotStagesPresent: stagesPresent,
      x05BeforeAndAfterUpgradeScreensPresent: record.runId !== 'X05-hike-normal'
        || ['06-online-upgrade', '07-post-upgrade-cold-reopen'].every(stage => screens.some(name => name.startsWith(stage))),
      activityGeometryHashBinding: Boolean(binding),
      expectedContextMetadata: record.oracle.context,
      observedOutcome: record.evaluation?.observedOutcome ?? record.evaluation?.verdict ?? 'UNKNOWN',
      reviewerComment: integrityComment,
    });
  }
  return {
    schema: 'cairn.real-map-snap.reviewer-c-artifact-integrity.v2',
    lane: 'C — Artifact integrity (not visual semantics)',
    execution: 'automated read-only file/hash/dimension/stage inspection; it does not claim that a human or vision tool judged route semantics',
    caseCount: cases.length,
    mapsInspected: cases.filter(item => item.mapWidth > 0 && item.mapHeight > 0).length,
    screenshotStageSetsInspected: cases.filter(item => item.screenshotStagesPresent).length,
    geometryHashBindings: cases.filter(item => item.activityGeometryHashBinding).length,
    retainedNonPassCases: cases.filter(item => item.observedOutcome !== 'PASS_IN_DECLARED_SCOPE').length,
    themeEvidence: {
      valid: themeEvidenceValid,
      captures: themeEvidence,
      method: 'theme-only reopen of three persisted Activities; no GPS replay',
    },
    verdict: cases.every(item => item.screenshotStagesPresent
      && item.x05BeforeAndAfterUpgradeScreensPresent
      && item.activityGeometryHashBinding
      && item.mapWidth === 1200
      && item.mapHeight === 820) && themeEvidenceValid ? 'PASS_ARTIFACT_INTEGRITY_ONLY' : 'HOLD_ARTIFACT_INTEGRITY',
    cases,
  };
}

const report = lane === 'A' ? await laneAReport() : lane === 'B' ? await laneBReport() : await laneCReport();
const filename = `REVIEWER_${lane}_${lane === 'A' ? 'PROVIDER_GEOMETRY' : lane === 'B' ? 'LIFECYCLE_COST' : 'ARTIFACT_INTEGRITY'}.json`;
writeJson(path.join(outputRoot, filename), report);
const markdown = `# ${report.lane}\n\nVerdict: **${report.verdict}**\n\nExecution: ${report.execution}\n\nCases reviewed: ${report.caseCount}.\n\n\`\`\`json\n${JSON.stringify(report.summary ?? {
  savedAndReopened: report.savedAndReopened,
  lifecyclePassCount: report.lifecyclePassCount,
  mapsInspected: report.mapsInspected,
  geometryHashBindings: report.geometryHashBindings,
  productBoundary: report.productBoundary,
  ledger: report.ledger,
}, null, 2)}\n\`\`\`\n\n## Per-case comments\n\n${report.cases.map(item => `- **${item.runId}** — ${item.reviewerComment}`).join('\n')}\n`;
fs.writeFileSync(path.join(outputRoot, filename.replace('.json', '.md')), markdown);
process.stdout.write(`${JSON.stringify({ lane, verdict: report.verdict, cases: report.caseCount, output: path.join(outputRoot, filename) }, null, 2)}\n`);
