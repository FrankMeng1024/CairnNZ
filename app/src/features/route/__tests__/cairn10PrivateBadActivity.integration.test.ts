import fs from 'node:fs';
import crypto from 'node:crypto';
import { segmentTrace } from '../../activity/activityContracts';
import { createImportedOrderedDraft, orderedDraftPoints, routePointDistanceM } from '../orderedRouteDraft';
import { classifyDrawTransactionWithDiagnostics } from '../routeEditTransactions';
import { canonicalRouteGeometry, canonicalRouteGeometryFingerprint } from '../canonicalRouteGeometry';
import { buildRouteDisplayGeometry } from '../routeDisplayGeometry';
import type { RoutePoint } from '../../../store/useRouteStore';
import type { TrackPoint } from '../../../store/useSessionStore';

// Shared by the real-browser Mapbox gate; loaded here to exercise the exact
// same negative oracle against the protected Route 99 copy.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { verifyRouteDisplayCoverage } = require('../../../../scripts/lib/route-display-coverage-oracle.cjs');

const fixturePath = process.env.CAIRN10_PRIVATE_BAD_ROUTE_FIXTURE;
const privateTest = fixturePath ? test : test.skip;

const decode = (value: string) => JSON.parse(Buffer.from(value, 'hex').toString('utf8'));
const fingerprint = (value: unknown) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const straightStroke = (points: RoutePoint[], start: number, end: number): RoutePoint[] => {
  const a = points[start];
  const b = points[end];
  return Array.from({ length: 5 }, (_, index) => ({
    lat: a.lat + (b.lat - a.lat) * index / 4,
    lng: a.lng + (b.lng - a.lng) * index / 4,
  }));
};

describe('Cairn #10 private read-only Activity 2139 classification matrix', () => {
  privateTest('fixed ordinary strokes work before Trim while a true repeated occurrence stays safe', () => {
    const lines = fs.readFileSync(fixturePath!, 'utf8').trim().split(/\n/).map(line => line.split('\t'));
    const canonical = (decode(lines[0][0]) as Array<TrackPoint & {
      segmentId?: string;
      segmentStartReason?: TrackPoint['segmentStartReason'];
      segment_id?: string;
      segment_start_reason?: string;
    }>).map(point => ({
      ...point,
      segmentId: point.segmentId ?? point.segment_id,
      segmentStartReason: point.segmentStartReason
        ?? point.segment_start_reason as TrackPoint['segmentStartReason'],
    }));
    const savedPoints = decode(lines[1][0]) as RoutePoint[];
    const savedDraft = decode(lines[1][1]);
    const segments = segmentTrace(canonical).segments
      .filter(segment => segment.length >= 2)
      .map(segment => segment.map(point => ({ lat: point.lat, lng: point.lng, alt: point.alt ?? null })));
    const draft = createImportedOrderedDraft({
      draftId: 'activity:2139:cairn10-isolated',
      ownerId: 'private-owner-redacted',
      segments,
    });
    const originalFingerprint = fingerprint(orderedDraftPoints(draft));
    const cases = [
      { id: 'straight-80-140', stroke: straightStroke(canonical, 80, 140) },
      { id: 'local-300-360', stroke: straightStroke(canonical, 300, 360) },
      { id: 'near-repeat-500-560', stroke: straightStroke(canonical, 500, 560) },
    ].map(item => ({
      id: item.id,
      result: classifyDrawTransactionWithDiagnostics(draft, item.stroke, undefined, 20),
    }));

    const end = canonical.at(-1)!;
    const appendTarget = Array.from({ length: 8 }, (_, index) => index * Math.PI / 4)
      .map(bearing => ({
        lat: end.lat + Math.cos(bearing) * 35 / 111_000,
        lng: end.lng + Math.sin(bearing) * 35 / (111_000 * Math.cos(end.lat * Math.PI / 180)),
      }))
      .find(target => Math.min(...canonical.slice(0, -1).map(point => routePointDistanceM(point, target))) > 20);
    expect(appendTarget).toBeDefined();
    const appendStroke: RoutePoint[] = [end, appendTarget!];
    const append = classifyDrawTransactionWithDiagnostics(draft, appendStroke, undefined, 20);

    console.log('cairn10-private-classification', JSON.stringify({
      activityPointCount: canonical.length,
      activitySegmentCounts: segments.map(segment => segment.length),
      activityFingerprint: fingerprint(canonical),
      savedPointCount: savedPoints.length,
      savedPartCount: savedDraft.parts?.length ?? 0,
      savedFingerprint: fingerprint(savedPoints),
      originalFingerprint,
      cases: cases.map(item => ({
        id: item.id,
        intent: item.result.intent.kind,
        startCandidates: item.result.diagnostics.startCandidates.length,
        endCandidates: item.result.diagnostics.endCandidates.length,
        ambiguity: item.result.diagnostics.ambiguityReason,
      })),
      append: {
        intent: append.intent.kind,
        startCandidates: append.diagnostics.startCandidates.length,
        endCandidates: append.diagnostics.endCandidates.length,
      },
    }));

    expect(cases.map(item => item.result.intent.kind)).toEqual(['replace', 'replace', 'replace']);
    expect(append.intent.kind).toBe('append');
    expect(fingerprint(orderedDraftPoints(draft))).toBe(originalFingerprint);
  });

  privateTest('Route 99 four-part saved geometry passes bidirectional coverage and save/reopen parity', () => {
    const lines = fs.readFileSync(fixturePath!, 'utf8').trim().split(/\n/).map(line => line.split('\t'));
    const savedPoints = decode(lines[1][0]) as RoutePoint[];
    const savedDraft = decode(lines[1][1]);
    const canonical = canonicalRouteGeometry({ orderedDraft: savedDraft, points: savedPoints });
    const display = buildRouteDisplayGeometry(canonical);
    const expectedLines = display.baseLines.map(line => ({
      id: line.id,
      occurrenceIds: line.occurrenceIds,
      coverageIds: line.coverageIds,
      coordinates: line.coordinates.map(point => [point.lng, point.lat]),
    }));
    const displayLines = [...display.ordinaryLines, ...display.repeatLanes].map(line => ({
      id: line.id,
      occurrenceIds: line.occurrenceIds,
      coverageIds: line.coverageIds,
      coordinates: line.coordinates.map(point => [point.lng, point.lat]),
      role: 'canonical-presentation',
    }));
    const coverage = verifyRouteDisplayCoverage({ expectedLines, displayLines });
    const omittedAndDuplicated = verifyRouteDisplayCoverage({
      expectedLines,
      displayLines: displayLines.length >= 2
        ? [displayLines[0], displayLines[0], ...displayLines.slice(2)]
        : [],
    });
    const before = canonicalRouteGeometryFingerprint(canonical);
    const reopened = canonicalRouteGeometry({
      orderedDraft: JSON.parse(JSON.stringify(savedDraft)),
      points: JSON.parse(JSON.stringify(savedPoints)),
    });

    console.log('cairn10-private-route-99-oracle', JSON.stringify({
      savedPointCount: savedPoints.length,
      orderedPartCount: savedDraft.parts?.length ?? 0,
      canonicalLineCount: expectedLines.length,
      canonicalFingerprint: before,
      coveragePass: coverage.pass,
      coverageMetrics: coverage.metrics,
      negativePass: omittedAndDuplicated.pass,
      negativeReasons: omittedAndDuplicated.reasons,
      connectorCount: display.turnConnectors.length,
      reopenFingerprint: canonicalRouteGeometryFingerprint(reopened),
    }));

    expect(savedPoints).toHaveLength(62);
    expect(savedDraft.parts).toHaveLength(4);
    expect(coverage.pass).toBe(true);
    expect(omittedAndDuplicated.pass).toBe(false);
    expect(canonicalRouteGeometryFingerprint(reopened)).toBe(before);
  });
});
