#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CAMPAIGN_LIMITS = Object.freeze({
  navigation: 120,
  mapLoad: 200,
  staticImage: 200,
  tilequery: 250,
  estimatedCostUsd: 5,
});

// Public pay-as-you-go first-paid-tier prices verified on 2026-10-01.
// The campaign assumes the free tier is exhausted and does not silently
// subtract account allowance that could not be verified read-only.
export const CAMPAIGN_UNIT_COST_USD = Object.freeze({
  matching: 2 / 1_000,
  directions: 2 / 1_000,
  mapLoad: 5 / 1_000,
  staticImage: 1 / 1_000,
  tilequery: 1.5 / 1_000,
});

const DEFAULT_LEDGER = path.join(
  os.homedir(),
  'Desktop',
  'Cairn_RealMap_Snap_Final_Review',
  'request-cost-ledger.json',
);

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function totals(entries) {
  const attempted = entries.filter(entry => entry.state !== 'released-before-dispatch');
  const count = product => attempted.filter(entry => entry.product === product).length;
  const matching = count('matching');
  const directions = count('directions');
  const mapLoad = count('mapLoad');
  const staticImage = count('staticImage');
  const tilequery = count('tilequery');
  const estimatedCostUsd = matching * CAMPAIGN_UNIT_COST_USD.matching
    + directions * CAMPAIGN_UNIT_COST_USD.directions
    + mapLoad * CAMPAIGN_UNIT_COST_USD.mapLoad
    + staticImage * CAMPAIGN_UNIT_COST_USD.staticImage
    + tilequery * CAMPAIGN_UNIT_COST_USD.tilequery;
  return {
    matching,
    directions,
    navigation: matching + directions,
    mapLoad,
    staticImage,
    tilequery,
    estimatedCostUsd: Number(estimatedCostUsd.toFixed(6)),
  };
}

function assertWithinLimits(nextTotals) {
  if (nextTotals.navigation > CAMPAIGN_LIMITS.navigation) throw new Error('campaign_navigation_limit');
  if (nextTotals.mapLoad > CAMPAIGN_LIMITS.mapLoad) throw new Error('campaign_map_load_limit');
  if (nextTotals.staticImage > CAMPAIGN_LIMITS.staticImage) throw new Error('campaign_static_image_limit');
  if (nextTotals.tilequery > CAMPAIGN_LIMITS.tilequery) throw new Error('campaign_tilequery_limit');
  if (nextTotals.estimatedCostUsd > CAMPAIGN_LIMITS.estimatedCostUsd + 1e-9) {
    throw new Error('campaign_cost_limit');
  }
}

function freshLedger() {
  const createdAt = new Date().toISOString();
  return {
    schema: 'cairn.real-map-snap.request-ledger.v1',
    campaign: 'O70 Urban / Mountain / Mixed REAL_MAP',
    createdAt,
    updatedAt: createdAt,
    authority: {
      tokenSource: 'EAS production environment / EXPO_PUBLIC_MAPBOX_TOKEN',
      tokenPersisted: false,
      billingPlanChanged: false,
      accountSpecificRemainingAllowanceKnown: false,
    },
    pricing: {
      verifiedAt: '2026-10-01',
      assumption: 'public pay-as-you-go first paid tier; free allowance exhausted',
      unitCostUsd: CAMPAIGN_UNIT_COST_USD,
      officialUrl: 'https://www.mapbox.com/pricing',
    },
    limits: CAMPAIGN_LIMITS,
    plan: {
      plannedNavigationMaximum: 90,
      reservedDiagnosisAndConfirmation: 30,
      firstSentinels: ['U01/hike-normal', 'U04/hike-normal', 'M01/hike-normal', 'M02/hike-normal', 'X01/hike-normal', 'X02/hike-normal'],
      mapStrategy: 'one reusable GL map instance where practical; no map load per evidence layer',
    },
    entries: [],
    totals: totals([]),
  };
}

function readLedger(ledgerPath) {
  if (!fs.existsSync(ledgerPath)) return freshLedger();
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  if (ledger?.schema !== 'cairn.real-map-snap.request-ledger.v1' || !Array.isArray(ledger.entries)) {
    throw new Error('campaign_ledger_invalid');
  }
  ledger.totals = totals(ledger.entries);
  assertWithinLimits(ledger.totals);
  return ledger;
}

function atomicWrite(ledgerPath, ledger) {
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  const temporary = `${ledgerPath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(ledger, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, ledgerPath);
  fs.chmodSync(ledgerPath, 0o600);
}

async function withLock(ledgerPath, operation) {
  const lockPath = `${ledgerPath}.lock`;
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  const startedAt = Date.now();
  let descriptor = null;
  while (descriptor === null) {
    try {
      descriptor = fs.openSync(lockPath, 'wx', 0o600);
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      if (Date.now() - startedAt > 10_000) throw new Error('campaign_ledger_lock_timeout');
      await sleep(25);
    }
  }
  try {
    const ledger = readLedger(ledgerPath);
    const result = await operation(ledger);
    ledger.updatedAt = new Date().toISOString();
    ledger.totals = totals(ledger.entries);
    assertWithinLimits(ledger.totals);
    atomicWrite(ledgerPath, ledger);
    return result;
  } finally {
    fs.closeSync(descriptor);
    fs.unlinkSync(lockPath);
  }
}

export function requestIdentityFingerprint(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export async function initializeCampaignLedger(ledgerPath = DEFAULT_LEDGER) {
  await withLock(ledgerPath, ledger => {
    if (ledger.entries.length !== 0) return;
    ledger.totals = totals(ledger.entries);
  });
  return readLedger(ledgerPath);
}

export async function reserveCampaignRequest({
  ledgerPath = DEFAULT_LEDGER,
  product,
  caseId,
  activityId = null,
  requestFingerprint,
  purpose,
}) {
  if (!Object.hasOwn(CAMPAIGN_UNIT_COST_USD, product)) throw new Error('campaign_product_invalid');
  let reservation;
  await withLock(ledgerPath, ledger => {
    const priorIdentityAttempt = [...ledger.entries].reverse().find(entry => (
      entry.requestFingerprint === requestFingerprint
      && entry.state !== 'released-before-dispatch'
    ));
    reservation = {
      id: `campaign-request-${String(ledger.entries.length + 1).padStart(3, '0')}`,
      product,
      caseId,
      activityId,
      purpose,
      requestFingerprint,
      repeatedIdentityOf: priorIdentityAttempt?.id ?? null,
      reservedAt: new Date().toISOString(),
      dispatchedAt: null,
      completedAt: null,
      state: 'reserved',
      httpStatus: null,
      semanticCode: null,
      elapsedMs: null,
      responseBytes: null,
      errorCategory: null,
      provenance: 'LIVE_HTTP',
      tokenPersisted: false,
    };
    const prospective = [...ledger.entries, reservation];
    assertWithinLimits(totals(prospective));
    ledger.entries.push(reservation);
  });
  return { ...reservation };
}

export async function markCampaignRequestDispatched(id, ledgerPath = DEFAULT_LEDGER) {
  await withLock(ledgerPath, ledger => {
    const entry = ledger.entries.find(item => item.id === id);
    if (!entry || entry.state !== 'reserved') throw new Error('campaign_reservation_not_dispatchable');
    entry.dispatchedAt = new Date().toISOString();
    entry.state = 'dispatched';
  });
}

export async function completeCampaignRequest(id, patch, ledgerPath = DEFAULT_LEDGER) {
  await withLock(ledgerPath, ledger => {
    const entry = ledger.entries.find(item => item.id === id);
    if (!entry || !['reserved', 'dispatched'].includes(entry.state)) {
      throw new Error('campaign_reservation_not_completable');
    }
    entry.completedAt = new Date().toISOString();
    entry.state = patch.state ?? 'completed';
    entry.httpStatus = patch.httpStatus ?? null;
    entry.semanticCode = patch.semanticCode ?? null;
    entry.elapsedMs = patch.elapsedMs ?? null;
    entry.responseBytes = patch.responseBytes ?? null;
    entry.errorCategory = patch.errorCategory ?? null;
  });
}

export async function releaseUndispatchedCampaignRequest(id, ledgerPath = DEFAULT_LEDGER) {
  await withLock(ledgerPath, ledger => {
    const entry = ledger.entries.find(item => item.id === id);
    if (!entry || entry.state !== 'reserved') throw new Error('campaign_reservation_not_releasable');
    entry.completedAt = new Date().toISOString();
    entry.state = 'released-before-dispatch';
    entry.errorCategory = 'not-dispatched';
  });
}

export function readCampaignLedger(ledgerPath = DEFAULT_LEDGER) {
  return readLedger(ledgerPath);
}

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const command = process.argv[2] ?? 'status';
  const ledgerPath = path.resolve(argument('--ledger', DEFAULT_LEDGER));
  if (command === 'init') await initializeCampaignLedger(ledgerPath);
  else if (command !== 'status') throw new Error(`Unknown command: ${command}`);
  const ledger = readCampaignLedger(ledgerPath);
  process.stdout.write(`${JSON.stringify({ ledgerPath, totals: ledger.totals, limits: ledger.limits, entries: ledger.entries.length }, null, 2)}\n`);
}
