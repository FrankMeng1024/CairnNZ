# Package manifest notes

The delivery root contains this Revision 02 review/evidence directory, relevant current source/test files, exact scoped patches, the frozen work-package references, all preflight inputs, and selected unchanged Revision 01 authority records needed by the timing erratum.

`FILE_MANIFEST.sha256` is generated after staging and lists the SHA-256 of every other file in the delivery. The outer `.zip.sha256` sidecar authenticates the completed archive.

Excluded: `.env` files, credentials, authentication tokens, private database dumps, real private coordinate exports, `node_modules`, build caches, unrelated source/artifacts, full Xcode/native builds, and any OTA/App Store payload.

Synthetic NZ fixture coordinates and disposable review actor identifiers remain in test/evidence files. They are not real-user data or field evidence.

