# Revision-02 baseline checkpoint

- Previous delivery: `/Users/mzm/Desktop/cairn_personal_friends_01.zip`
- Verified previous delivery SHA-256: `59ac7c6d6b39269964a98cf0f605b4689b322e8632a9c27d367785d9a54e15bf`
- Optional reviewer archive: not present at task start; its absence is non-blocking.
- Repository HEAD and `origin/master`: `9b92be3efef3a355d71491ec250cb6df62878a23`
- Revision-01 tracked working patch SHA-256: `0d183a666809c6f579242c61a6e3c7408330ad25582f49f1e40da292b76efb79`
- Client marker: `O60`; app version: `0.2.6`; no OTA publication was performed by this task.
- Production image at task start: `sha256:5a6620ff54cc5b1b5b3de0b49dab89f172fcd7590208f333b66a87384aed8f73`; reported healthy.
- Isolated review image at task start: `sha256:23d0229f41136f7e3b89c863f7f712094efffc9d9db9c2b0f3f5a4f779b3c54d`; container `cairn-pf-review-9b92be3`; schema `cairn_pf_review_2f8cd36`; HTTPS health green.
- Backend/schema baseline is through migration `037`.
- Current dirty source matches the delivered revision-01 candidate. Existing unrelated work is preserved in place.

The three reviewer findings were confirmed as live implementation mechanisms before repair:

- PF-R1: an in-flight projection read is guarded only by account identity and the selection captured at request start; persistence is not generation-fenced.
- PF-R2: a declared 250 m privacy radius is compared directly with Web Mercator coordinate deltas.
- PF-R3: equal-or-weaker spatial duplicates return before retaining a later time-qualified observation; mutation is inferred from coverage-array length.

The retained W1/W2/W3 reports contain completion times later than the actual prior delivery. Their original files will be preserved and an erratum will mark unrecoverable completion times unknown.
