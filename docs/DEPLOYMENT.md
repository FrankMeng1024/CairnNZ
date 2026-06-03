# Cairn Backend Deployment

## Prerequisites
- Docker & Docker Compose v2 installed on target server
- Port 3001 (backend) and 3306 (MySQL) available, OR adjust `docker-compose.yml`
- Bash shell

## One-Shot Deploy

```bash
# On your server
git clone <repo>
cd Cairn/docker
cp .env.example .env
nano .env                    # ← edit secrets (passwords + telemetry key)
chmod +x deploy.sh
./deploy.sh
```

### Required `.env` values
- `DB_ROOT_PASSWORD` — strong random
- `DB_PASSWORD` — strong random (used by app)
- `JWT_SECRET` — ≥32 chars random
- `CAIRN_TELEMETRY_API_KEY` — shared with Cairn app's `expo-constants` → use this in DebugScreen "Backend API Key" field

### Verify

```bash
curl http://localhost:3001/health
# { "status":"ok", "service":"cairn-backend", "db":"ok", ... }

curl -X POST http://localhost:3001/api/telemetry/sessions \
  -H "X-API-Key: $(grep CAIRN_TELEMETRY_API_KEY .env | cut -d= -f2)" \
  -H "Content-Type: application/json" \
  -d '{"session_id":"smoke-test","events":[]}'
# { "ok":true, "session_id":"smoke-test", "events_received":0, "bytes":0 }
```

## App Configuration

In Cairn app, set:
- `EXPO_PUBLIC_BACKEND_URL=https://your.server/api` (or http://server-ip:3001/api)
- Telemetry API key entered in **Settings → Debug → Backend API Key**

## Smoke test the deployed backend

After deploying, run an end-to-end smoke test from anywhere with network access
to the server (your laptop):

```bash
# From the repo root
node backend/scripts/smoke-telemetry.js \
  --url http://YOUR_SERVER_IP:3001 \
  --key YOUR_TELEMETRY_API_KEY
```

The script will:
1. GET `/health` — verify backend is up
2. POST `/api/telemetry/sessions` — upload a fake JSONL session
3. GET `/api/telemetry/sessions` — list it
4. GET `/api/telemetry/sessions/<id>` — fetch full content
5. POST with wrong API key — verify 401 reject

All five steps must pass before pointing the real iPhone app at the backend.

## Maintenance

```bash
docker compose logs -f backend          # Tail logs
docker compose restart backend           # Restart
docker compose down                      # Stop everything (data persists)
docker compose down -v                   # ⚠️ WIPE database too
```

## Migrations

Migrations 001-006 are baked into `init.sql` and applied on first DB startup.
For new migrations:
1. Drop new SQL into `backend/src/migrations/00X_*.sql`
2. Either rebuild from scratch (`docker compose down -v && deploy.sh`)
3. Or `docker exec -i cairn-db mysql -ucairn -p$DB_PASSWORD cairn < migration.sql`

## Backup

```bash
docker exec cairn-db mysqldump -u root -p$DB_ROOT_PASSWORD cairn > cairn-backup-$(date +%Y%m%d).sql
```

## Common Issues

| Symptom | Fix |
|---|---|
| Backend "Database connection failed" | Wait — db healthcheck takes 30s on first boot |
| Port 3306 collision | Edit `docker-compose.yml` `ports: - "3307:3306"` |
| `npm ci` fails behind GFW | Already configured to use `registry.npmmirror.com`. If still fails, check network/proxy. |
| Container OOM kills | Edit `docker-compose.yml`, add `mem_limit: 512m` to service |
