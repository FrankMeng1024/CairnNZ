"""
Frontend static import graph BFS.
Start from App.tsx + RootNavigator.tsx, expand via all import/require/lazy statements.
Output: reachable_frontend.json = { reachable: [...paths], all_ts_files: [...], dead: [...] }
"""
import os, re, json, sys
sys.stdout.reconfigure(encoding='utf-8')

APP_ROOT = 'C:/ClaudeCodeProjects/Cairn/app'
SRC = os.path.join(APP_ROOT, 'src')
ENTRIES = [
    os.path.join(APP_ROOT, 'App.tsx'),
    os.path.join(APP_ROOT, 'index.ts'),
    os.path.join(APP_ROOT, 'MigratorRetryPrompt.tsx'),
]

# Collect all .ts/.tsx files in app/src + app/*.tsx (top level)
ALL_TS = []
for root, dirs, files in os.walk(APP_ROOT):
    # skip node_modules, dist, __tests__, __mocks__, __fixtures__, _spike, _self_test_out, _review, tests, research, tasks, docs, plugins, scripts (unless needed)
    parts = set(root.replace('\\','/').split('/'))
    if any(p in parts for p in ('node_modules','dist','__tests__','__mocks__','__fixtures__','_spike','_self_test_out','_review','research','tasks')):
        continue
    for f in files:
        if f.endswith(('.ts','.tsx')) and not f.endswith('.d.ts'):
            full = os.path.join(root, f).replace('\\','/')
            ALL_TS.append(full)

print(f'Total TS/TSX files: {len(ALL_TS)}')

# Build resolver: given import path from file X, return absolute path
def resolve_import(from_file, import_path):
    if import_path.startswith('.'):
        base = os.path.dirname(from_file)
        target = os.path.normpath(os.path.join(base, import_path)).replace('\\','/')
    else:
        # non-relative → node_modules or absolute alias. Skip external
        return None
    # try extensions
    for ext in ['.tsx','.ts','/index.tsx','/index.ts']:
        candidate = target + ext
        if os.path.isfile(candidate):
            return candidate.replace('\\','/')
    return None

IMPORT_RE = re.compile(r'''(?:import\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?|(?:require|import)\s*\(\s*)['"]([^'"]+)['"]''')

def extract_imports(file_path):
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception:
        return []
    imports = []
    for m in IMPORT_RE.finditer(content):
        path = m.group(1)
        resolved = resolve_import(file_path, path)
        if resolved:
            imports.append(resolved)
    return imports

# BFS from entries
reachable = set()
queue = []
for e in ENTRIES:
    e = e.replace('\\','/')
    if os.path.isfile(e):
        reachable.add(e)
        queue.append(e)

while queue:
    curr = queue.pop(0)
    imports = extract_imports(curr)
    for imp in imports:
        if imp not in reachable:
            reachable.add(imp)
            queue.append(imp)

print(f'Reachable files: {len(reachable)}')

# Dead = ALL - reachable
all_set = set(ALL_TS)
dead = sorted(all_set - reachable)
print(f'Dead candidates: {len(dead)}')

# Save
out = {
    'entries': [e.replace('\\','/') for e in ENTRIES],
    'total_files': len(ALL_TS),
    'reachable_count': len(reachable),
    'dead_count': len(dead),
    'reachable': sorted(reachable),
    'dead': dead,
}
out_path = 'C:/ClaudeCodeProjects/Cairn/_review/2026-07-market-research/reachable_frontend.json'
with open(out_path, 'w', encoding='utf-8') as f:
    json.dump(out, f, ensure_ascii=False, indent=2)
print(f'\nWritten: {out_path}')

# Print top 30 dead files (largest first)
print('\n=== Top 30 dead by size ===')
dead_sized = []
for d in dead:
    try:
        sz = os.path.getsize(d)
        dead_sized.append((sz, d))
    except:
        pass
dead_sized.sort(reverse=True)
for sz, path in dead_sized[:30]:
    rel = path.replace(APP_ROOT+'/','')
    print(f'  {sz:>7} bytes  {rel}')
