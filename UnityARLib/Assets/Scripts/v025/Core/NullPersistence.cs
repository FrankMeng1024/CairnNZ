// Phase 1A.5 — NullPersistence (Editor / fallback default).
//
// Always returns NoCache for Load + NotSupported for Save.
// Used by PersistenceFactory in Editor mode and on platforms where neither
// ARKit nor ARCore stub applies. Lets Editor PlayMode tests run without an
// actual AR session.

using System;
using System.Threading;
using System.Threading.Tasks;

namespace Cairn.AR.V025.Core
{
    public sealed class NullPersistence : IAnchorPersistence
    {
        public bool IsPlatformSupported => false;

        public Task<PersistenceResult> SaveAsync(string spaceId, CancellationToken cancel)
        {
            if (spaceId == null) throw new ArgumentNullException(nameof(spaceId));
            if (cancel.IsCancellationRequested) return Task.FromResult(PersistenceResult.Cancelled());
            return Task.FromResult(PersistenceResult.NotSupported("NullPersistence: no platform backing (Editor / no AR runtime)"));
        }

        public Task<PersistenceResult> LoadAsync(string spaceId, CancellationToken cancel)
        {
            if (spaceId == null) throw new ArgumentNullException(nameof(spaceId));
            if (cancel.IsCancellationRequested) return Task.FromResult(PersistenceResult.Cancelled());
            return Task.FromResult(PersistenceResult.NoCache());
        }
    }
}
