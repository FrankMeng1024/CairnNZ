# Own Cairn mutation and state table

| Object state | Edit contract | Delete contract | User-visible truth | Automated coverage |
|---|---|---|---|---|
| Local committed / pending create | Rewrites the durable pending-create payload before updating the visible projection. Creation time, location, type, visibility, and Activity provenance stay unchanged. | Writes/retains the tombstone and discards the pending create. It cannot be uploaded later. | The Cairn remains a real local object. Save is acknowledged only after the durable local write. | `offlineCommittedEntity.test.ts`, `useMarkerStore.fastAck.test.ts`, `cairnPersonalContracts.test.ts` |
| Pending create already in flight | A revisioned local payload wins over an older acknowledgement. A later reconciliation sends the newer supported content. | Tombstone wins over a late create acknowledgement and the acknowledged server row is reconciled for deletion. | No duplicate row and no resurrection in Detail, Activity rows, Memory projection, or All Cairns. | `useMarkerStore.fastAck.test.ts`, `offlineCommittedEntity.test.ts`, backend `ownedCairnLibrary.test.js` |
| Synced Cairn, online success | Uses the supported authenticated update contract and updates the local projection only after success. | For modern stable identity, records durable local deletion first and then attempts remote deletion; a legacy server-only record stays visible until remote acknowledgement. | No early success. The accepted value is shared by Detail, All Cairns, Activity-linked rows, and marker projection. | `cairnPersonalContracts.test.ts`, `useMarkerStore.fastAck.test.ts` |
| Synced Cairn, update failure | Keeps the prior accepted Cairn truth and retains the draft for retry. | Keeps a legacy server-only object if deletion cannot commit. A modern tombstoned deletion may be shown as pending remote reconciliation. | Understandable failure copy; retry invokes the real operation; one in-flight action per object. | `cairnPersonalContracts.test.ts`; visual `CAIRN-VIS-015` |
| Deleted while a request is late | Owner and requested identity are rechecked before applying the response; tombstones filter hydration, list merge, and acknowledgement. | No cascade to Activity, Route, or ordinary accumulated Memory. | Detail returns to a valid prior context after durable deletion and does not navigate back into the removed page. | `useMarkerStore.fastAck.test.ts`, `markerTombstones.test.ts`, backend route contracts |
| Unsaved edit on close | Closing the edit sheet invokes discard/stay confirmation. | Not applicable. | Draft is not silently discarded. | `cairnPersonalContracts.test.ts`; shared confirmation path inspected |

Notes:

- Content editing is limited to supported name and note fields. Existing type/visibility are not reset.
- Legacy separatorless note content is treated as body-only. New encoded records use the shared title/body separator and preserve multiline and Unicode content.
- The additive server replay convergence for a pending create is implemented locally but requires backend deployment before it applies outside the isolated test environment.

