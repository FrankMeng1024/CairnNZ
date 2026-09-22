# Controlled Public Cairn pilot operations

Public v1 is text-only and is disabled unless the backend process has
`PUBLIC_CAIRN_PILOT_ENABLED=1`. Production must omit that exact opt-in. The
capability endpoint remains readable so clients can hide Public authoring;
all publication, discovery, Detail, interaction, and operator endpoints return
`PUBLIC_PILOT_DISABLED` while disabled. Legacy bbox discovery remains gone.

## Operator entry

Use a short-lived token for a user whose `users.public_cairn_operator` value
was provisioned server-side. Never put that token or role grant in the app or
repository.

```sh
cd backend
CAIRN_OPERATOR_API_URL=https://review.example.invalid \
CAIRN_OPERATOR_TOKEN='<short-lived-token>' \
npm run public:operator -- submissions pending
```

Inspect the returned exact `publication_epoch`, `content_revision`, plain text,
and synthetic/review coordinates before deciding:

```sh
npm run public:operator -- decide 123 approve 'reviewed exact revision'
npm run public:operator -- reports pending
npm run public:operator -- dispose 45 reviewed 'triaged; no automatic penalty'
```

The server rejects ordinary users and stale publication revisions. Approve and
restore affect downstream access immediately. Reject, suspend, author
withdrawal, audience change, and deletion remove current online authority.
Restore resets the eligibility timestamp, so observations made during a
suspension cannot qualify after restoration.

## Rollback and containment

1. Remove `PUBLIC_CAIRN_PILOT_ENABLED=1` and restart only the targeted service.
2. Verify `/api/public-cairns/capabilities` reports `enabled:false`.
3. Verify publication/discovery/Detail/operator paths return 404 with
   `PUBLIC_PILOT_DISABLED`, and `/api/markers/public` remains 410.
4. Do not drop migration 041 tables during incident containment. Retaining
   rows preserves auditability and allows forward recovery.
5. Personal/Friends save, Finish, Memory, grants, and borrowed Routes remain
   independent of this flag.

Reports are not an emergency service. No response-time or staffing promise is
made. The product should use an existing configured support contact only; an
unset support contact remains explicitly unset.
