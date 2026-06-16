// Phase 1A — PersistenceResult factory unit tests.
// Round-2 #1A-4-3: prove every factory constructs a value with correct
// Outcome + IsSuccess + Diagnostic round-trip. Without these tests, a typo
// like `MapCorrupt → new PersistenceResult(Success, ...)` would slip through
// to Phase 4 callers.

using NUnit.Framework;
using Cairn.AR.V025.Core;

namespace Cairn.AR.V025.Tests.Unit
{
    public class PersistenceResultFactoryTests
    {
        [Test]
        public void Success_HasCorrectOutcome()
        {
            var r = PersistenceResult.Success();
            Assert.AreEqual(PersistenceOutcome.Success, r.Outcome);
            Assert.IsTrue(r.IsSuccess);
            Assert.AreEqual(string.Empty, r.Diagnostic);
        }

        [Test]
        public void NoCache_HasCorrectOutcome()
        {
            var r = PersistenceResult.NoCache();
            Assert.AreEqual(PersistenceOutcome.NoCache, r.Outcome);
            Assert.IsFalse(r.IsSuccess);
        }

        [Test]
        public void RelocalizeTimeout_RoundTripsDiagnostic()
        {
            var r = PersistenceResult.RelocalizeTimeout("waited 8000ms");
            Assert.AreEqual(PersistenceOutcome.RelocalizeTimeout, r.Outcome);
            Assert.IsFalse(r.IsSuccess);
            Assert.AreEqual("waited 8000ms", r.Diagnostic);
        }

        [Test]
        public void MapVersionMismatch_RoundTripsDiagnostic()
        {
            var r = PersistenceResult.MapVersionMismatch("ARKit 6 vs 7 binary differs");
            Assert.AreEqual(PersistenceOutcome.MapVersionMismatch, r.Outcome);
            Assert.IsFalse(r.IsSuccess);
            Assert.AreEqual("ARKit 6 vs 7 binary differs", r.Diagnostic);
        }

        [Test]
        public void MapCorrupt_RoundTripsDiagnostic()
        {
            var r = PersistenceResult.MapCorrupt("blob length 0");
            Assert.AreEqual(PersistenceOutcome.MapCorrupt, r.Outcome);
            Assert.IsFalse(r.IsSuccess);
            Assert.AreEqual("blob length 0", r.Diagnostic);
        }

        [Test]
        public void NotSupported_RoundTripsDiagnostic()
        {
            var r = PersistenceResult.NotSupported("Android v0.2.5 stub");
            Assert.AreEqual(PersistenceOutcome.NotSupported, r.Outcome);
            Assert.IsFalse(r.IsSuccess);
            Assert.AreEqual("Android v0.2.5 stub", r.Diagnostic);
        }

        [Test]
        public void IoError_RoundTripsDiagnostic()
        {
            var r = PersistenceResult.IoError("disk full");
            Assert.AreEqual(PersistenceOutcome.IoError, r.Outcome);
            Assert.IsFalse(r.IsSuccess);
            Assert.AreEqual("disk full", r.Diagnostic);
        }

        [Test]
        public void NetworkError_RoundTripsDiagnostic()
        {
            var r = PersistenceResult.NetworkError("OSS upload 502");
            Assert.AreEqual(PersistenceOutcome.NetworkError, r.Outcome);
            Assert.IsFalse(r.IsSuccess);
            Assert.AreEqual("OSS upload 502", r.Diagnostic);
        }

        [Test]
        public void Cancelled_HasCorrectOutcome()
        {
            var r = PersistenceResult.Cancelled();
            Assert.AreEqual(PersistenceOutcome.Cancelled, r.Outcome);
            Assert.IsFalse(r.IsSuccess);
        }

        [Test]
        public void NullDiagnostic_StoredAsEmptyString()
        {
            var r = PersistenceResult.IoError(null);
            Assert.AreEqual(string.Empty, r.Diagnostic, "null diagnostic must coalesce to empty string");
        }
    }
}
