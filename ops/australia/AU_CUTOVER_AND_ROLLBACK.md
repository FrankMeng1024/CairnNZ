# Australia cutover and rollback

## Non-negotiable gates

Production cutover is not authorized by this preparation. Before changing traffic, require all of:

- separate written Owner cutover authorization;
- exact backend SHA and client/backend protocol compatibility;
- AU staging acceptance, current iPhone test and external monitoring;
- recent source backup restored successfully;
- final write freeze and exact source/target manifests equal;
- cron active on no more than one writable stack;
- DNS TTL at or below 300 seconds and provider access tested;
- TLS valid on production hostname at AU;
- rollback drill completed before AU writes;
- privacy/legal transfer gate cleared;
- China host retained, healthy and write-frozen.

`cutover-preflight.sh` enforces evidence and creates a local readiness record, but deliberately does not mutate DNS.

## Authorized cutover sequence

1. Announce maintenance; stop new background mutations and confirm job queues are stable.
2. Freeze China mutations at nginx. Test representative POST/PATCH/DELETE returns 503 while health/read paths remain available.
3. Create final source backup, export archive, ledger and full manifest; transfer and verify hashes.
4. Restore into empty AU DB; apply only pending reviewed migrations; create full target manifest; compare.
5. Start exactly one AU backend with cron disabled; run full health/contracts/business validation against staging hostname.
6. Run `cutover-preflight`; retain its evidence.
7. Change the existing `api.yiiling.cn` A record to the AU Elastic IP using the provider console/API. Record old value, new value, timestamp and change ID.
8. Verify from multiple resolvers and a real current iPhone. Keep AU write-frozen until the production hostname reaches the intended server and health/contracts pass.
9. Enable AU writes. Only then enable the one AU scheduler. Leave China frozen.
10. Monitor error rate, latency, queues, email/push, disk and DB for at least the agreed observation period. Do not retire China during that period.

## Rollback matrix

| Condition | Action |
|---|---|
| DNS changed, AU writes never opened | Verify China is healthy/current, keep AU frozen, restore old DNS, then open China writes once traffic converges. |
| AU opened but no successful mutations (proven by logs/DB) | Treat as no-write only with recorded proof; follow prior row. |
| Any AU mutation succeeded | Freeze AU. Do not route to stale China. Take final AU backup and repair forward or reconcile AU delta into a clean China target before routing. |
| Data manifests differ before cutover | Stop. Do not change DNS or open writes. Rebuild target from a verified backup. |
| Client/API incompatibility | Keep source authoritative; fix/deploy a compatible backend to staging and repeat acceptance. Do not modify product logic during migration. |
| Privacy authorization missing | Stop before exporting real data. |

## DNS/cache details

TTL reduction does not invalidate already cached records. Keep both endpoints healthy through at least the prior TTL plus the agreed buffer. Existing keep-alive connections may continue briefly. Verify authoritative DNS and several public resolvers; do not infer convergence from one laptop.

## Old-host retirement

Retirement is a separate authorization after observation, verified AU backups/restores, no unresolved writes and privacy retention decisions. Before shutdown: final archival backup, secrets revocation/rotation plan, DNS/log evidence, secure erasure requirements and unrelated shared services identified. Never stop the shared host or MySQL as a Cairn-only action.
