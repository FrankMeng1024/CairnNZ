#!/usr/bin/env python3
"""
audit-names.py — v428
Dumps every ADM1 shapeName + proposed cleaned name for human review.
Also lists ADM0 (country) names.
"""

import json
import os
import re
import sys
from pathlib import Path

# Force UTF-8 stdout on Windows (Python 3.7+ compatible)
if sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

TMP = Path(__file__).parent / 'tmp'
ADM1_DIR = TMP / 'adm1'
ADM0_FILE = TMP / 'adm0-world.geojson'
METADATA_FILE = TMP / 'adm0-metadata.json'

SUFFIX_STRIP_ORDER = [
    ' Special Administrative Region',
    ' Autonomous Region',
    ' Municipality',
    ' Prefecture',
    ' Province',
    ' Territory',
    ' Region',
    ' State',
    ' District',
    ' County',
]

BLOCKLIST_AFTER_STRIP = {
    'Northern', 'Free', 'Southern', 'Western', 'Eastern', 'Central',
    'North', 'South', 'East', 'West', 'Australian Capital',
}

def clean_name(raw):
    """Try suffix strip with blocklist guard."""
    if not raw:
        return raw
    for suf in SUFFIX_STRIP_ORDER:
        if raw.endswith(suf):
            candidate = raw[:-len(suf)].strip()
            if candidate in BLOCKLIST_AFTER_STRIP:
                return raw  # keep original
            if len(candidate) < 3:
                return raw
            return candidate
    return raw

def dump_adm0():
    print('=' * 60)
    print('ADM0 (Countries)')
    print('=' * 60)
    with open(ADM0_FILE, encoding='utf-8') as f:
        d = json.load(f)
    features = d.get('features', [])
    print(f'Total ADM0 features: {len(features)}')
    for feat in features[:20]:
        p = feat['properties']
        raw = p.get('shapeName', '?')
        iso = p.get('shapeISO', '?')
        cleaned = clean_name(raw)
        marker = ' <-- CHANGED' if cleaned != raw else ''
        print(f'  {iso}: {raw} -> {cleaned}{marker}')
    print(f'  ... ({len(features) - 20} more)')

def dump_adm1_all():
    print()
    print('=' * 60)
    print('ADM1 (States / Regions) — per country')
    print('=' * 60)
    files = sorted(ADM1_DIR.glob('*.geojson'))
    total_features = 0
    changed_count = 0
    long_name_count = 0

    for path in files:
        iso = path.stem
        with open(path, encoding='utf-8') as f:
            d = json.load(f)
        feats = d.get('features', [])
        total_features += len(feats)
        names_raw = [x['properties'].get('shapeName') for x in feats]
        names_cleaned = [clean_name(n) for n in names_raw]

        print(f'\n{iso} ({len(feats)} features):')
        for r, c in zip(names_raw, names_cleaned):
            marker = ''
            if r != c:
                marker = ' <-- STRIPPED'
                changed_count += 1
            if c and len(c) > 25:
                marker += ' <-- LONG'
                long_name_count += 1
            print(f'  {r!r:40} -> {c!r}{marker}')

    print()
    print('=' * 60)
    print('SUMMARY')
    print('=' * 60)
    print(f'Total ADM1 features: {total_features}')
    print(f'Names that changed via suffix strip: {changed_count}')
    print(f'Names > 25 chars (may overflow panel): {long_name_count}')

if __name__ == '__main__':
    dump_adm0()
    dump_adm1_all()
