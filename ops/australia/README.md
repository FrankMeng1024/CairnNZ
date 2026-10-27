# Cairn Australia operations

Status: Phase 1 preparation. Nothing here changes DNS or production by itself.

Primary entry point:

```bash
sudo ./ops/australia/scripts/au.sh --env /etc/cairn-au/au.env preflight
```

Typical staging sequence after the host is purchased:

```bash
sudo ./ops/australia/scripts/au.sh --env /etc/cairn-au/au.env bootstrap
sudo ./ops/australia/scripts/au.sh --env /etc/cairn-au/au.env security
sudo ./ops/australia/scripts/au.sh --env /etc/cairn-au/au.env preflight
sudo ./ops/australia/scripts/au.sh --env /etc/cairn-au/au.env init-db
sudo ./ops/australia/scripts/au.sh --env /etc/cairn-au/au.env restore --dump /secure/path/cairn.sql.gz --ledger /secure/path/migrations_applied
sudo ./ops/australia/scripts/au.sh --env /etc/cairn-au/au.env migrate
sudo ./ops/australia/scripts/au.sh --env /etc/cairn-au/au.env deploy --backend-only
sudo ./ops/australia/scripts/au.sh --env /etc/cairn-au/au.env verify
```

Read `AU_DEPLOYMENT_PLAN.md`, `AU_DATA_MIGRATION.md` and `AU_CUTOVER_AND_ROLLBACK.md` before execution. `cutover-preflight` proves gates but intentionally never edits DNS. Production traffic change needs a separate Owner authorization.
