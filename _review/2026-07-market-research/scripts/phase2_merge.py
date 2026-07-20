"""
Phase 2 · 三源合流决策矩阵
Merge:
  A · static import graph → reachable_frontend.json
  B · playwright runtime → runtime_loaded.json
  C · nginx 30d log → nginx_api_usage.json

Output:
  - phase2_backend_decision.json (backend endpoint 决策)
  - phase2_frontend_decision.json (frontend file 决策)
"""
import json, os, re
import sys
sys.stdout.reconfigure(encoding='utf-8')

BASE = 'C:/ClaudeCodeProjects/Cairn/_review/2026-07-market-research'

with open(f'{BASE}/reachable_frontend.json','r',encoding='utf-8') as f:
    A_static = json.load(f)
with open(f'{BASE}/runtime_loaded.json','r',encoding='utf-8') as f:
    B_runtime = json.load(f)
with open(f'{BASE}/nginx_api_usage.json','r',encoding='utf-8') as f:
    C_nginx = json.load(f)

# ── Backend endpoint 决策 ─────────────────────────────────────
# 遍历 backend/routes 提取所有真实存在的 endpoint
BACKEND = 'C:/ClaudeCodeProjects/Cairn/backend/src/routes'
backend_endpoints = {}  # "METHOD /api/xxx" -> file
route_files = [f for f in os.listdir(BACKEND) if f.endswith('.js')]

# 后端 mount 前缀 map（来自 backend/src/index.js）
MOUNT = {
    'auth.js':'/api/auth',
    'sessions.js':'/api/sessions',
    'markers.js':'/api/markers',
    'routes.js':'/api/routes',
    'friends.js':'/api/friends',
    'circle.js':'/api/circle',
    'memory.js':'/api/memory',
    'memory-subscriptions.js':'/api/memory-subscriptions',
    'telemetry.js':'/api/telemetry',
    'debug-snapshot.js':'/api/debug-snapshot',
    'hide.js':'/api/hide',
    'feature-flags.js':'/api/feature-flags',
}

for rf in route_files:
    mount = MOUNT.get(rf, '/api/' + rf.replace('.js',''))
    with open(os.path.join(BACKEND, rf),'r',encoding='utf-8') as f:
        content = f.read()
    for m in re.finditer(r'router\.(get|post|patch|put|delete)\s*\(\s*[\'\"]([^\'\"]+)[\'\"]', content):
        method = m.group(1).upper()
        subpath = m.group(2)
        # 归一 :id
        if subpath == '/':
            full = mount
        else:
            full = mount + subpath
        # normalize :xxx to :id
        full = re.sub(r':\w+', ':id', full)
        # nginx 里没有 param name 只有位置，我们对齐
        key = f'{method} {full}'
        backend_endpoints[key] = rf

# 30d nginx 数据
nginx_used = C_nginx['endpoints']  # {"METHOD /api/xxx": count}
# playwright 数据
runtime_used = B_runtime['endpoints']

# 合流：每个 backend endpoint 三源交叉
result = []
for ep, rf in sorted(backend_endpoints.items()):
    # 静态：backend 文件本身是否 reachable？(所有 route 文件都被 index.js 引用，所以都 reachable)
    static_ok = True
    # runtime playwright 是否调过？
    runtime_ok = ep in runtime_used
    # nginx 30d 是否有？
    nginx_ok = ep in nginx_used

    if runtime_ok and nginx_ok:
        verdict = 'KEEP (runtime + prod both used)'
    elif nginx_ok:
        verdict = 'KEEP (prod used, playwright missed - likely triggered by user action)'
    elif runtime_ok:
        verdict = 'KEEP (new feature, playwright hit)'
    else:
        verdict = 'SUSPECT (no runtime + no prod trace in 30d)'

    result.append({
        'endpoint': ep,
        'route_file': rf,
        'static': 'in bundle',
        'runtime_count': runtime_used.get(ep, 0),
        'nginx_30d_count': nginx_used.get(ep, 0),
        'verdict': verdict,
    })

# 分类输出
keep = [r for r in result if r['verdict'].startswith('KEEP')]
suspect = [r for r in result if r['verdict'].startswith('SUSPECT')]

print(f'Backend endpoints total: {len(result)}')
print(f'  KEEP: {len(keep)}')
print(f'  SUSPECT (no prod, no playwright): {len(suspect)}')
print()
print('=== SUSPECT endpoints (候选可疑清单) ===')
for r in suspect:
    print(f'  {r["endpoint"]} ({r["route_file"]})')

# ── Frontend file 决策 ─────────────────────────────────────
# static reachable = 编译进 bundle 的一定被引用（但不代表被 runtime 加载）
# static NOT reachable = 一定 dead (可以直接删)

frontend_dead = A_static['dead']  # 已经是静态判定 dead
frontend_reachable_count = A_static['reachable_count']

# Frontend dead 分类：按目录 group
from collections import defaultdict
dead_by_dir = defaultdict(list)
for f in frontend_dead:
    rel = f.replace('C:/ClaudeCodeProjects/Cairn/app/', '')
    parts = rel.split('/')
    if 'tests' in parts:
        d = 'tests'
    elif len(parts) >= 3 and parts[0] == 'src':
        d = f'src/{parts[1]}'
        if parts[1] == 'components' and len(parts) >= 4:
            d = f'src/components/{parts[2]}'  # 有子目录如 trails
    else:
        d = '/'.join(parts[:2])
    dead_by_dir[d].append(rel)

print(f'\n=== Frontend static-dead (43 files) 按目录 ===')
for d in sorted(dead_by_dir.keys()):
    print(f'\n{d} ({len(dead_by_dir[d])})')
    for f in dead_by_dir[d]:
        print(f'  {f}')

# Save
with open(f'{BASE}/phase2_backend_decision.json','w',encoding='utf-8') as f:
    json.dump({'total': len(result), 'keep': len(keep), 'suspect': len(suspect), 'all': result}, f, ensure_ascii=False, indent=2)
with open(f'{BASE}/phase2_frontend_decision.json','w',encoding='utf-8') as f:
    json.dump({
        'total_files': A_static['total_files'],
        'reachable': A_static['reachable_count'],
        'dead': len(frontend_dead),
        'dead_by_dir': dict(dead_by_dir),
    }, f, ensure_ascii=False, indent=2)
print(f'\n\nWritten phase2_backend_decision.json + phase2_frontend_decision.json')
