"""
Merge planning fields from local data.js into remote data.js.

Reads:
  - Local:  ./js/data.js (has state.planning + cards[i].planning)
  - Remote: /tmp/remote-data.js (downloaded via scp)

Writes:
  - /tmp/merged-data.js — remote content with ONLY the planning additions:
    1. inserts top-level "planning" key (the 6 release/phase rows)
    2. for each card by id, copies the card.planning subfield from local
  - Everything else (story.cards titles/subs/status/order, overview, modules,
    timeline, etc.) is left exactly as remote had it.

This is a one-shot deploy aid; idempotent.
"""
import re
import json
import sys

LOCAL  = './js/data.js'
REMOTE = './_remote-data.js'
OUTPUT = './_merged-data.js'

def parse_data_js(path):
    with open(path, 'r', encoding='utf-8') as f:
        txt = f.read()
    m = re.search(r'const DEFAULT_DATA\s*=\s*(\{.*?\n\});', txt, re.DOTALL)
    if not m:
        raise SystemExit(f'cannot find DEFAULT_DATA in {path}')
    return txt, m, json.loads(m.group(1))

local_txt,  local_m,  local_data  = parse_data_js(LOCAL)
remote_txt, remote_m, remote_data = parse_data_js(REMOTE)

# 1. copy top-level planning structure
if 'planning' in local_data:
    remote_data['planning'] = local_data['planning']
    print(f'  + state.planning: {len(local_data["planning"]["releases"])} releases')

# 2. copy per-card planning by card.id
local_card_planning = {c['id']: c.get('planning') for c in local_data['story']['cards'] if 'planning' in c}
copied = 0
skipped_missing = 0
for c in remote_data['story']['cards']:
    if c['id'] in local_card_planning and local_card_planning[c['id']] is not None:
        c['planning'] = local_card_planning[c['id']]
        copied += 1
    else:
        skipped_missing += 1
print(f'  + cards.planning copied: {copied}, no-match: {skipped_missing}')

# Write back to remote-style file
pretty = json.dumps(remote_data, ensure_ascii=False, indent=2)
new_txt = remote_txt[:remote_m.start()] + 'const DEFAULT_DATA = ' + pretty + ';' + remote_txt[remote_m.end():]
with open(OUTPUT, 'w', encoding='utf-8') as f:
    f.write(new_txt)
print(f'wrote {OUTPUT}')
