# running — Playwright Execution Log

## Environment
- 414×896. Web bypass. No __cairnStores.

## Scenario S01 (idle entry): pass
- Screenshot: S01-running-idle.png
- Observation vs Hiking:
  - Same layout (Back, Enable GPS pill, map placeholder, route selector, Start button)
  - **DIFFERENT palette**: Free Run icon uses blue (matches home Running card), Start Running button is SOLID GREEN filled (vs Hiking's white pill)
  - Added: "Screen locks automatically" hint with lock icon below Start Running button
- **Consistency finding**: Start Hiking and Start Running have inconsistent primary CTA styling. Hiking = white pill with green text/icon; Running = solid green pill with white text/icon. Both are the "start" action — should look the same or the intentional difference should be documented.

## Scenarios S02+: skip
- Same rationale as hiking: no GPS / no store injection possible. Static code review governs.
