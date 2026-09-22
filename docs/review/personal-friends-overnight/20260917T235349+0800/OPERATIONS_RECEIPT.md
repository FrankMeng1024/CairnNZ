# Operations receipt

## Targets and authority

Operations followed `docs/operations/PRODUCTION_BACKEND_DEPLOY.md` and the explicit authorization in package file 06.

- Production checkout: `/opt/githubRepos/Cairn`
- Production API: `https://api.yiiling.cn`
- Isolated review API: `https://api.yiiling.cn/pf-review-o60`
- Review schema: `cairn_pf_review_2f8cd36`
- Review container: `cairn-pf-review-9b92be3`, loopback-only upstream `127.0.0.1:3008`
- Review DB user is schema-restricted; cron/email/telemetry/test-unneeded writers are disabled.
- Review data and identities are synthetic. No production account or private row was used as a fixture.

## Pre-change safety

- Captured current checkout, services, proxy, migration ledger, and actual schema.
- Created `/var/backups/cairn/personal-friends-pre037-20260917T170607Z/` with root-only mode.
- Full dump: 91,984,791 bytes, SHA-256 `c291e02b8f4eca6c5dee0aba22bf41bff252983645a22547f1dcef05c0c274fb`.
- Schema dump SHA-256 `1de885e11f5acd8b26f895c74ecaf4ef12238178778f04c0cc83542be5a2d71c`.
- Config archive SHA-256 `c6bc0774334ac4ba83750f186b4cc75273a07d2d325fded21cf7745f28c7c95f`.
- Gzip integrity passed. Migration 035/036/037 mechanics were rehearsed against disposable real MySQL before production.

## Executed production operations

1. Ran the canonical command `sudo -n bash /opt/githubRepos/Cairn/docker/deploy.sh`.
2. Applied additive migrations 035, 036, and 037; postconditions passed. No DROP, TRUNCATE, reset, or destructive backfill was used.
3. Built/recreated only the backend service and verified health plus the unauthenticated fail-closed smoke.
4. Post-deploy logs exposed a prepared-statement incompatibility in bounded friend-request cleanup (`LIMIT ?`). A new source diagnosis and regression test produced commit `9b92be3`; the canonical deploy was then run once more. It applied zero additional migrations.
5. Final production checkout is `9b92be3efef3a355d71491ec250cb6df62878a23`; image is `sha256:5a6620ff54cc5b1b5b3de0b49dab89f172fcd7590208f333b66a87384aed8f73`; health is green; auth sweep reports seven-day grace and zero hard deletions/errors.

## Executed review operations

- Created a dedicated schema and restricted DB identity, migrated through 037, and confirmed zero production-user copying.
- Built exact review image `sha256:23d0229f41136f7e3b89c863f7f712094efffc9d9db9c2b0f3f5a4f779b3c54d` with source label `9b92be3efef3a355d71491ec250cb6df62878a23`.
- Started the healthy loopback-only container and added the bounded `/pf-review-o60/` path to the existing TLS virtual host.
- Preserved Nginx backups at `/var/backups/cairn/cairn-api.available.before-pf-review.20260917T180633Z` and `/var/backups/cairn/cairn-api.enabled.before-pf-review.20260917T180633Z`; `nginx -t` passed before graceful reload.
- Final active Nginx config SHA-256: `3205a395b81e83330c1fcf20f8cbefaf5fd75b596f18311d17b8532c87a92805`.
- External HTTPS review and production health both return 200 with HSTS. Old diagnostic review containers were stopped, not deleted; only the exact O60 review container remains active.
- Seeded two private synthetic owner-review identities through authenticated API state. Credential handoff is outside the archive with mode 600.

## Outcome and rollback

Production and review are healthy. The schema is additive and the preferred rollback is a forward fix or restoring the backed-up backend/config while retaining the legacy raw endpoint deny. Data-bearing 037 objects are not to be dropped. Review rollback is: remove the bounded proxy location using the recorded backup, graceful Nginx reload, and stop the loopback review container; production remains independent.

## Explicitly not performed

No OTA publication, native build/signing, App Store/TestFlight change, paid service, public MySQL exposure, real-user test, production fixture injection, user-data deletion, schema reset, or unrelated service deployment occurred.
