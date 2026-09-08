# CairnNZ three-theme visual authority audit

Audit-only evidence captured from the current unmodified production Home and Friends runtime at a 390×844 browser viewport.

The JPG/PNG captures named below are reproducible local-only outputs and are
ignored by Git. Recreate them with
`node app/scripts/three-theme-visual-authority-audit.mjs`; tracked metrics,
runtime-error text, and this audit remain the durable evidence.

- `three-theme-runtime-board.jpg`: Home, Friends main, Add Friend, and Profile across Day, Sunset, and Night.
- `three-theme-component-board.jpg`: direct component-level comparison across the same three themes.
- `captures/`: full-screen source captures.
- `components/`: uncropped runtime element captures used to compose the component board.
- `runtime-metrics.json`: viewport and source element bounds.
- `runtime-errors.txt`: browser runtime errors observed during capture.

The capture uses the production screens and production Sunny Day/Sunset/Night mapping through the existing Web-only QA store bridge. No production component, token, mapping, image, or navigation source was changed for this audit.
