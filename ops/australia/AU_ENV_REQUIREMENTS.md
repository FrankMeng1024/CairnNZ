# Australia environment requirements

Copy `env/au.env.example` to `/etc/cairn-au/au.env`, mode 600, and fill it through the provider secret store or a protected SSH session. Do not paste long-lived private keys into chat and never prefix secrets with `EXPO_PUBLIC_`.

| Group | Variables | Rule |
|---|---|---|
| Source | `BACKEND_GIT_SHA`, `BACKEND_GIT_REF`, `CAIRN_REPO_URL` | Fetch named ref, require immutable SHA in its ancestry, then detached checkout; no floating deployment. |
| Database | `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `MYSQL_ROOT_PASSWORD` | New AU root/app passwords; app user is not root. Admin port remains loopback. |
| Token continuity | `JWT_SECRET`, `CAIRN_TELEMETRY_API_KEY` | Copy current values securely if existing sessions/telemetry clients must continue. Rotating JWT at cutover logs everyone out. |
| Nonce | `NONCE_SECRET` | Use a distinct strong value; assess continuity for outstanding signed links. |
| OAuth | `GOOGLE_CLIENT_ID`, `APPLE_BUNDLE_ID`, `APPLE_CLIENT_ID` | Copy verified production audiences. No provider secret value is committed. |
| Email | `RESEND_API_KEY`, `EMAIL_FROM` | Validate sender/domain from AU without emailing unrelated users. |
| Push | `EXPO_PUSH_ACCESS_TOKEN`, `PUSH_TRANSPORT` | Validate with Owner QA device only. |
| Public Cairn | `PUBLIC_CAIRN_*` | Default disabled. Copy only the already-approved policy/allowlist; never broaden it for migration. |
| Web | `API_DOMAIN`, `STAGING_DOMAIN`, `PUBLIC_API_BASE_URL`, `CORS_ORIGINS`, `TRUST_PROXY` | Stage on separate hostname; production hostname remains stable at cutover. |
| Exports | `EXPORT_DIR` | `/srv/cairn/exports` inside container, backed by persistent host directory. |
| Scheduling | `DISABLE_CRON` | `1` in staging. Set `0` only after one backend scheduler is proven and old scheduler is frozen. |
| Backup | `BACKUP_REMOTE`, retention | Encrypted Sydney destination; verify retrieval/restore, not upload alone. |

Before use, compare **key names only** between current production `.env` and this template. The read-only audit found production key names for DB, JWT, telemetry, CORS, Google, email/Resend and Public Cairn, but did not read secret values. Current production configuration did not visibly include every newer key (`NONCE_SECRET`, Apple IDs, Expo token, persistent export path); those must be confirmed, not guessed.

The template contains only placeholders. `preflight.sh` rejects the obvious placeholders, root as the application user, an invalid Git SHA and inadequate host sizing.
