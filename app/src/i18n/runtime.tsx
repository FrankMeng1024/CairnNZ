import React from 'react';
import { getLocales } from 'expo-localization';
import { CAIRN_TEXT, type CairnPluralText, type CairnTextKey } from './cairnText';

export type CairnRuntimeLocale = 'en-NZ' | 'ja-JP' | 'en-XA';
export type CairnTextParams = Readonly<Record<string, string | number | Date | null | undefined>>;

let localeOverride: CairnRuntimeLocale | null = null;
let revision = 0;
const listeners = new Set<() => void>();
let cachedDeviceLocale: 'en-NZ' | 'ja-JP' | null = null;

export function normalizeCairnLocale(languageTag?: string | null): 'en-NZ' | 'ja-JP' {
  const normalized = String(languageTag ?? '').replace('_', '-').toLowerCase();
  if (normalized === 'ja' || normalized.startsWith('ja-')) return 'ja-JP';
  return 'en-NZ';
}

function deviceLocale(): 'en-NZ' | 'ja-JP' {
  if (cachedDeviceLocale) return cachedDeviceLocale;
  try {
    cachedDeviceLocale = normalizeCairnLocale(getLocales()[0]?.languageTag);
  } catch {
    cachedDeviceLocale = 'en-NZ';
  }
  return cachedDeviceLocale;
}

export function getCairnLocale(): CairnRuntimeLocale {
  return localeOverride ?? deviceLocale();
}

export function setCairnLocaleOverride(locale: CairnRuntimeLocale | null): void {
  if (localeOverride === locale) return;
  localeOverride = locale;
  revision += 1;
  listeners.forEach(listener => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): number {
  return revision;
}

function pluralValue(value: string | CairnPluralText, locale: 'en-NZ' | 'ja-JP', params: CairnTextParams): string {
  if (typeof value === 'string') return value;
  const count = Number(params.count);
  if (count === 0 && value.zero) return value.zero;
  const category = new Intl.PluralRules(locale).select(Number.isFinite(count) ? count : 0);
  return category === 'one' ? value.one : value.other;
}

function interpolate(value: string, params: CairnTextParams): string {
  return value.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (_match, name: string) => {
    const candidate = params[name];
    if (candidate instanceof Date) return formatCairnDate(candidate);
    if (typeof candidate === 'number') return formatCairnNumber(candidate);
    return candidate == null ? '' : String(candidate);
  });
}

function pseudoExpand(value: string): string {
  const expanded = value.replace(/[aeiouAEIOU]/g, match => `${match}${match.toLowerCase()}`);
  return `⟦${expanded} ···⟧`;
}

export function cairnText(key: CairnTextKey, params: CairnTextParams = {}): string {
  const entry = CAIRN_TEXT[key];
  const active = getCairnLocale();
  const resolvedLocale = active === 'ja-JP' ? 'ja-JP' : 'en-NZ';
  if (!entry) {
    const fallback = CAIRN_TEXT['common.text-unavailable'][resolvedLocale]
      ?? CAIRN_TEXT['common.text-unavailable']['en-NZ'];
    return active === 'en-XA' ? pseudoExpand(fallback) : fallback;
  }
  const candidate = entry[resolvedLocale] ?? entry['en-NZ'];
  const rendered = interpolate(pluralValue(candidate, resolvedLocale, params), params);
  return active === 'en-XA' ? pseudoExpand(rendered) : rendered;
}

export function formatCairnNumber(value: number, options?: Intl.NumberFormatOptions): string {
  const locale = getCairnLocale() === 'ja-JP' ? 'ja-JP' : 'en-NZ';
  return new Intl.NumberFormat(locale, options).format(value);
}

export function formatCairnDate(value: Date | number, options?: Intl.DateTimeFormatOptions): string {
  const locale = getCairnLocale() === 'ja-JP' ? 'ja-JP' : 'en-NZ';
  return new Intl.DateTimeFormat(locale, options ?? { day: 'numeric', month: 'short', year: 'numeric' })
    .format(value instanceof Date ? value : new Date(value));
}

/** Rerenders descendants on a QA locale switch without remounting them. */
export function LocalizationBoundary({ children }: { children: React.ReactNode }): React.JSX.Element {
  React.useSyncExternalStore(subscribe, snapshot, snapshot);
  // Produce a fresh root element so ordinary descendants update their copy,
  // while React preserves component identity, local state and native maps.
  return <>{React.Children.map(children, child => React.isValidElement(child) ? React.cloneElement(child) : child)}</>;
}

if (typeof globalThis !== 'undefined') {
  (globalThis as typeof globalThis & {
    __cairnI18n?: {
      getLocale: typeof getCairnLocale;
      setLocaleOverride: typeof setCairnLocaleOverride;
    };
  }).__cairnI18n = {
    getLocale: getCairnLocale,
    setLocaleOverride: setCairnLocaleOverride,
  };
}
