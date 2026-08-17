/**
 * useExplorationStats — computes "how much of the current country have I explored?"
 *
 * R114/O26 (2026-08-14): powers the Home hero badge.
 *
 * Adaptive display (per user + GPT concept):
 *   ≥1%:   "2.4% of New Zealand"
 *   0.1-1%: "0.35% of New Zealand"
 *   <0.1%:  "12 km² of New Zealand"    // never show 0.00%
 *   0 km²:  "0 km² of New Zealand"     // empty state
 *
 * Country area lookup ships as a small static table for the countries
 * we care about first (NZ, CN, JP, AU, US, GB, DE, FR, CA, TH, VN, KR,
 * SG, MY, ID). Missing countries fall back to km² display only.
 */
import { useEffect, useState } from 'react';
import { useMemoryStore } from '../features/memory/store/useMemoryStore';
import { resolveCurrentCountry } from '../services/countryService';

// Country area in km². Source: World Bank / geonames.
// Only 15 seed countries; extend as we open new markets.
const COUNTRY_AREA_KM2: Record<string, number> = {
  NZ: 268_021,
  CN: 9_596_961,
  JP: 377_975,
  AU: 7_692_024,
  US: 9_833_517,
  GB: 243_610,
  DE: 357_022,
  FR: 643_801,
  CA: 9_984_670,
  TH: 513_120,
  VN: 331_212,
  KR: 100_363,
  SG: 719,
  MY: 330_803,
  ID: 1_904_569,
};

// R114/O26 approximation — memory stores raw GPS points (~1 sample/s while
// hiking). We don't yet ship an H3-cell counter, so we degrade to a coarse
// heuristic: divide the point count by an empirical points-per-km² constant.
// Field-measured: a 5 km hike on a single trail unlocks fog over roughly
// 1.5–3 km² depending on width — so ~1500 points ≈ 2 km² average.
// This is intentionally conservative to avoid inflating the number.
// TODO(O27+): replace with real H3-cell unique-count once we ship the
// h3-js bucketing store.
const POINTS_PER_KM2 = 750;

export type ExplorationDisplay = {
  countryName: string | null;   // "New Zealand" or null if unknown
  primaryText: string;          // "2.4%" | "0.35%" | "12 km²" | "0 km²"
  hasCountry: boolean;          // false → show country-agnostic copy
};

export function useExplorationStats(): ExplorationDisplay {
  const memoryPoints = useMemoryStore(s => s.points);
  const [country, setCountry] = useState<{ name: string; code: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const c = await resolveCurrentCountry();
      if (cancelled) return;
      if (c) setCountry({ name: c.countryName, code: c.countryCode });
    })();
    return () => { cancelled = true; };
  }, []);

  const cellCount = memoryPoints.length;
  const exploredKm2 = cellCount / POINTS_PER_KM2;

  // No country → show total km² only (no denominator)
  if (!country) {
    return {
      countryName: null,
      primaryText: cellCount === 0 ? '0 km²' : formatKm2(exploredKm2),
      hasCountry: false,
    };
  }

  const countryArea = COUNTRY_AREA_KM2[country.code];

  // Empty state
  if (cellCount === 0) {
    return {
      countryName: country.name,
      primaryText: '0 km²',
      hasCountry: true,
    };
  }

  // Unknown country area → km² only
  if (!countryArea) {
    return {
      countryName: country.name,
      primaryText: formatKm2(exploredKm2),
      hasCountry: true,
    };
  }

  const pct = (exploredKm2 / countryArea) * 100;
  if (pct >= 1) {
    return {
      countryName: country.name,
      primaryText: `${pct.toFixed(1)}%`,
      hasCountry: true,
    };
  }
  if (pct >= 0.1) {
    return {
      countryName: country.name,
      primaryText: `${pct.toFixed(2)}%`,
      hasCountry: true,
    };
  }
  return {
    countryName: country.name,
    primaryText: formatKm2(exploredKm2),
    hasCountry: true,
  };
}

function formatKm2(km2: number): string {
  if (km2 < 1) return `${km2.toFixed(1)} km²`;
  if (km2 < 10) return `${km2.toFixed(1)} km²`;
  return `${Math.round(km2)} km²`;
}
