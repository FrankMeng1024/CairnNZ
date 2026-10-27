# Australia acceptance checklist

Every item needs timestamp, tester, backend SHA, hostname and evidence path. “Endpoint exists” is not equivalent to business acceptance.

## Platform

- [ ] `preflight` passes on the purchased Sydney host; region/instance/disk identity recorded.
- [ ] Security group/UFW: 80/443 public, 22 trusted CIDR, 3001/3306 not public.
- [ ] MySQL/backend healthy after reboot; exact image Git label matches deployed SHA.
- [ ] TLS chain/hostname/renewal dry run pass.
- [ ] CPU, memory, disk, health, backup-age and TLS alerts reach an operator.
- [ ] Daily SQL backup lands in separate encrypted Sydney storage.
- [ ] A backup is restored into an empty disposable DB and manifests match.
- [ ] Cron disabled on staging; exactly one scheduler on production candidate.

## Data

- [ ] Migration ledger equals source latest migration.
- [ ] Canonical schema hash and every table count match.
- [ ] Full table checksums match during final write freeze.
- [ ] Foreign-key orphan report is all zero.
- [ ] Export-file archive hashes/counts match; download links use intended hostname.
- [ ] No unrelated shared schemas/files are present.

## API/business on AU staging

- [ ] Register and verification email (Owner QA address only).
- [ ] Email/password login, token refresh/expiry, logout and account recovery.
- [ ] Existing-account Google and Apple login only if provider configuration is complete.
- [ ] Create Hike and Run Activity, pause/resume/finish, upload and read back.
- [ ] Offline Activity queues locally, reconnects once and produces no duplicate.
- [ ] Memory/Fog sync, city loading, Mine/Friends/Both authorization and no cross-user leakage.
- [ ] Add/accept/reject Friend and sharing enable/disable authorization.
- [ ] Create/read/edit/withdraw Cairn; discovery flow for an already-authorized QA fixture only.
- [ ] Route read/create/save/delete and received-route remove permissions.
- [ ] Account export build/download/delete and persistent export path.
- [ ] Debug snapshot upload/read policy using synthetic image only.
- [ ] Push token registration, one Owner QA push, receipt/drain/purge.
- [ ] Resend verification/reset/support flow to Owner QA address only.
- [ ] Public pilot remains fail-closed unless the exact approved allowlist/policy is present.
- [ ] No unexpected 5xx, secret/token logging or raw private coordinates in operational logs.

No WebSocket/SSE implementation was found; mark that line N/A only after source identity is reconfirmed.

## Client/routing

- [ ] Current production iPhone build reaches AU staging through an explicitly authorized test path.
- [ ] Existing production build continues to use `api.yiiling.cn`; no hard-coded production IP.
- [ ] CORS for approved Web origin; disallowed origin rejected.
- [ ] Apple/Google audience and callback/domain configuration match production.
- [ ] DNS old/new values and TTL captured; rollback access tested without changing production.

## Release verdict

- **AU_STAGING_READY** only when platform/data/business staging rows pass.
- **PRODUCTION_CUTOVER_READY** only after final source freeze, exact final comparison, legal/privacy gate, real current-iPhone test, rollback proof and separate Owner authorization.
- Any failed data consistency, auth, Activity sync, Memory authorization, backup restore or rollback item is a cutover blocker.
