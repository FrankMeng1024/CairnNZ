# O70 real-map sentinel pass

Status: frozen after the six prescribed sentinels and before opening the three
holdouts.

The first real HTTP attempt for U01 reached Mapbox but the Playwright adapter
used `allHeaders()` instead of the supported `headers()` API. Both attempts are
retained in the request ledger as paid failures. The retry produced two HTTP
200 `Ok` responses and a persisted hybrid Activity. No attempt was erased.

| Run | Real Matching | HTTP/provider | Selected before fix | Finding |
|---|---:|---|---|---|
| U01 hike normal | 2 | 200 / Ok | hybrid | 494 m accepted; unsafe/no-benefit remainder local |
| U04 hike normal | 2 | 200 / Ok | local | correct: new park paths lacked reliable current authority |
| M01 hike normal | 3 | 200 / Ok | hybrid | supported Hooker trail islands accepted |
| M02 hike normal | 3 | 200 / Ok | hybrid | supported Queenstown Hill island accepted |
| X01 hike normal | 3 | 200 / Ok | local | valid central evidence rejected only at one ambiguity-boundary seam |
| X02 hike normal | 3 | two Ok, one NoSegment | local | new boardwalk absent; late road support fragmented/ambiguous |

The X01 captured-response replay demonstrated a general implementation defect:
77 central observations passed confidence, correspondence, ambiguity,
corridor, truth-envelope and topology gates, but an exit-heading mismatch at
the adjacent ambiguous observations rejected the entire island. The existing
`MAX_SEAM_TRIM = 3` policy constant was unused. The implemented fix trims only
the failing seam boundary, by at most three observations, and re-applies every
unchanged safety gate. Exact captured-response replay then selected a bounded
hybrid with one observation trimmed at the exit. X02 remained local, proving
the fix cannot manufacture provider coverage.

At sentinel freeze the ledger contained 18 Navigation attempts and an estimated
US$0.036 cost. The holdouts may now be opened for the final frozen-code pass.
