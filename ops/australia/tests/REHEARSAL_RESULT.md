# Synthetic migration rehearsal result

- Date: 2026-10-27
- Platform: local Docker Desktop, disposable `mysql:8.0.36`
- Data: repository synthetic fixture only; no production/private data
- Result: PASS

Validated:

- consistent dump + gzip integrity + SHA-256;
- empty-database restore;
- canonical schema, exact table counts and logical per-table content hashes;
- foreign-key orphan scan;
- migration ledger and export archive;
- rejection of non-empty restore target;
- rejection of a deliberately bad dump checksum;
- rejection of a deliberately injected FK orphan.

Raw transient containers/databases were removed after the run. MySQL 8.0.45 on the purchased Australia host is still required; this local 8.0.36 rehearsal is not AU staging evidence.

Separate image evidence: the Compose model and Node 20 lockfile dependency install passed. A full Dockerfile build is not claimed: the local Docker 20.10.8 seccomp implementation rejected Node worker-thread creation during build and does not support per-build security overrides. The modern AU Docker host must close that gate.
