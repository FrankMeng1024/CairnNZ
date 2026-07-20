"""Save nginx API usage to json for Phase 2 merge."""
import json
data = {
    "captured": "2026-07-20",
    "window_days": 30,
    "source": "aliyun /var/log/nginx/access.log{,.1,.2..14.gz}",
    "note": "excludes scanner traffic (/api/.env, sonicos, phpunit, graphql, v2/cmdb, etc)",
    "endpoints": {
        "GET /api/sessions/:id": 13576,
        "POST /api/edit-diag": 6364,
        "GET /api/markers": 87,
        "GET /api/auth/me": 75,
        "GET /api/feature-flags": 71,
        "GET /api/sessions": 64,
        "GET /api/routes": 38,
        "POST /api/auth/login": 17,
        "PATCH /api/sessions/:id/append-points": 14,
        "GET /api/circle/fog": 13,
        "POST /api/sessions/start": 12,
        "PATCH /api/sessions/:id/save": 10,
        "GET /api/memory/points": 9,
        "PATCH /api/sessions/:id": 5,
        "DELETE /api/memory-subscriptions/:id": 5,
        "POST /api/memory-subscriptions": 4,
        "POST /api/memory/points": 4,
        "POST /api/auth/refresh": 4,
        "POST /api/markers": 2,
        "GET /api/memory-subscriptions": 2,
        "GET /api/friends/requests": 2,
        "GET /api/friends": 2,
        "DELETE /api/sessions/:id": 2,
        "GET /api/circle/markers": 1,
    }
}
p = 'C:/ClaudeCodeProjects/Cairn/_review/2026-07-market-research/nginx_api_usage.json'
with open(p,'w',encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
print(f'Written {p}')
print(f'Total endpoints: {len(data["endpoints"])}')
