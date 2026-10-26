# Reproduction commands

Run from `app/` unless noted.

```sh
npx jest --runInBand \
  src/features/memory/__tests__/o94MemoryUx.test.ts \
  src/features/memory/__tests__/preparedMemoryCoverageStore.test.ts \
  src/features/memory/__tests__/friendMemoryAuthorizationOrdering.test.ts \
  src/features/memory/__tests__/fogPresentationContinuity.test.ts \
  src/features/memory/__tests__/fogReadinessAuthority.test.ts \
  src/features/memory/__tests__/memoryScopeToggle.test.tsx \
  src/features/memory/__tests__/o84RealFriendFogRender.integration.test.tsx \
  src/features/memory/__tests__/memoryFriendPickModal.test.tsx \
  src/screens/__tests__/orderedRouteEditorScreen.test.tsx \
  src/screens/__tests__/owner13Contracts.test.ts \
  src/i18n/__tests__/cairnText.test.tsx

npm run verify:route
npm run verify:changed
npm run verify:full
npm run check:text

CAIRN_O94_QA_OUTPUT=/tmp/cairn-o94-memory-ux-final \
  node scripts/o94-memory-ux-qa.mjs

npx expo export --platform ios --dev false --output-dir /tmp/cairn-o94-ios-export
```

The QA runner requires the repository's existing Web dependencies. It uses a local source-free style and synthetic coverage; it does not claim Hosted Standard or iPhone proof.
