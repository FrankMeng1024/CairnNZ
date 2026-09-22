# Decisions and boundaries

- Keep unpublished candidate `O60`; archive revision does not increment the OTA marker.
- Maintain one primary product-code writer.
- Treat coverage, presence witnesses, display geometry, and friend projections as separate authorities.
- Keep the existing 30 m personal evidence footprint as the single configured radius.
- Never use Final, planned, borrowed, simulator, cached friend, or display geometry as personal exploration or encounter truth.
- A source/account/grant/resource generation invalidates late reads and queued cache writes; a deliberate later valid selection starts a fresh generation.
- Use a bounded presence journal so spatial coverage dedupe cannot erase a later eligible presence fact.
- Shared-content cache validity is bounded by the original server authorization and never renewed by hydration, access, retry, or local clock rollback.
- Borrowed-Route active recovery stores only immutable essential display geometry and server-issued use authority; terminal acknowledgement is retryable but local cleanup is immediate.
- Correct the existing renderer instead of adding a second rendering system or another smoothing pass.
- Backend changes are deployed from an explicit scoped manifest after local and disposable-database gates; no unrelated dirty files enter the payload.
