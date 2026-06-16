// Phase 1A.2 — PersistenceFactory.
//
// Single point of platform routing. CAIRN code never news up an
// IAnchorPersistence directly; always goes through Create().
//
// Routing:
//   - UNITY_EDITOR  → NullPersistence
//   - UNITY_IOS     → ArkitWorldMapPersistence
//   - UNITY_ANDROID → ArcoreStubPersistence (NotSupported, 见 ADR-002)
//   - else          → NullPersistence (defensive default)

namespace Cairn.AR.V025.Core
{
    public static class PersistenceFactory
    {
        public static IAnchorPersistence Create()
        {
#if UNITY_EDITOR
            return new NullPersistence();
#elif UNITY_IOS
            return new ArkitWorldMapPersistence();
#elif UNITY_ANDROID
            return new ArcoreStubPersistence();
#else
            return new NullPersistence();
#endif
        }
    }
}
