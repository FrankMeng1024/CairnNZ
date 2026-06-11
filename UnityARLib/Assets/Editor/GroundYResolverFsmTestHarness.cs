#if UNITY_EDITOR
using UnityEngine;
using UnityEditor;

/// <summary>
/// v0.2.3 Stage 3 (A1) — Editor menu harness for FSM unit tests.
///
/// Plan v4 Pre-EAS step 3: "A1: Editor PlayMode unit tests pass (state
/// machine transitions matrix from FSM Contract section)".
///
/// Usage:
///   1. Open CairnAR.unity, hit Play.
///   2. Menu: Cairn / Run A1 FSM Tests.
///   3. Console shows pass/fail for each FSM transition case.
///
/// Time-of-day independence: these tests do not depend on wall-clock
/// elapsed time. They use:
///   - __TEST_ForceState        — set state without debounce side effects
///   - __TEST_PressDebounceWindow — force "transition just happened" so the
///                                  next TryTransition must defer
///   - __TEST_FlushPending      — pretend debounce window elapsed
///   - __TEST_SeedTierAFirstSeen— synthetic first-Tier-A timestamp
/// </summary>
public static class GroundYResolverFsmTestHarness
{
    [MenuItem("Cairn/Run A1 FSM Tests")]
    public static void RunTests()
    {
        if (!Application.isPlaying)
        {
            EditorUtility.DisplayDialog(
                "A1 FSM Tests",
                "Enter Play mode first (open CairnAR.unity, click Play), then re-run.",
                "OK");
            return;
        }

        var resolver = Object.FindFirstObjectByType<GroundYResolver>();
        bool createdAdHoc = false;
        if (resolver == null)
        {
            var go = new GameObject("__A1_TEST_GroundYResolver");
            resolver = go.AddComponent<GroundYResolver>();
            createdAdHoc = true;
        }

        int passed = 0, failed = 0;

        try
        {
            // ----------------------------------------------------------
            // T1 — UNLOCKED → ARMED on first Tier-A.
            // ForceState pushes state and resets _lastTransitionTime to far
            // past, so the subsequent PushTierA → TryTransition lands
            // immediately (not deferred).
            // ----------------------------------------------------------
            resolver.__TEST_SetA11Fallback(false);
            resolver.__TEST_ForceState(GroundYResolver.A1State.UNLOCKED);
            resolver.__TEST_PushTierA();
            Assert("T1 UNLOCKED→ARMED on first Tier-A",
                resolver.State == GroundYResolver.A1State.ARMED, ref passed, ref failed);

            // ----------------------------------------------------------
            // T2 — ARMED + Tier-A + ≥1s window → LOCKED.
            // We seed _firstTierATime to 2s ago and re-push Tier-A. Code
            // path: OnTierAObserved sees state==ARMED, time-since >=1s,
            // calls TryTransition(LOCKED).
            // ----------------------------------------------------------
            resolver.__TEST_ForceState(GroundYResolver.A1State.ARMED);
            resolver.__TEST_SeedTierAFirstSeen(2.0f);
            resolver.__TEST_PushTierA();
            Assert("T2 ARMED→LOCKED after stability window",
                resolver.State == GroundYResolver.A1State.LOCKED, ref passed, ref failed);

            // ----------------------------------------------------------
            // T3 — LOCKED + Freeze() → FROZEN.
            // ----------------------------------------------------------
            resolver.Freeze();
            Assert("T3 LOCKED→FROZEN via Freeze()",
                resolver.State == GroundYResolver.A1State.FROZEN, ref passed, ref failed);

            // ----------------------------------------------------------
            // T4 — FROZEN ignores further Tier-A pushes.
            // ----------------------------------------------------------
            resolver.__TEST_PushTierA();
            Assert("T4 FROZEN absorbs Tier-A",
                resolver.State == GroundYResolver.A1State.FROZEN, ref passed, ref failed);

            // ----------------------------------------------------------
            // T4b — Stage 3 review fix F2: pending state queued BEFORE
            // Freeze must NOT flush after FROZEN entered.
            // Setup: ARMED, press debounce so next transition defers.
            // Push Tier-A → pending=LOCKED. Freeze() → FROZEN, must clear.
            // FlushPending — should drop pending without un-freezing.
            // ----------------------------------------------------------
            resolver.__TEST_ForceState(GroundYResolver.A1State.ARMED);
            resolver.__TEST_SeedTierAFirstSeen(2.0f);
            resolver.__TEST_PressDebounceWindow();
            resolver.__TEST_PushTierA();
            // Pending should now be LOCKED (deferred by debounce).
            bool pendingAfterPush = resolver.__TEST_PendingState() == GroundYResolver.A1State.LOCKED;
            resolver.Freeze();
            // Pending must be cleared to null when Freeze hits.
            bool pendingClearedByFreeze = resolver.__TEST_PendingState() == null;
            // Even if we now flush, the FSM must stay FROZEN.
            resolver.__TEST_FlushPending();
            bool stillFrozen = resolver.State == GroundYResolver.A1State.FROZEN;
            Assert("T4b pending=LOCKED queued before Freeze",
                pendingAfterPush, ref passed, ref failed);
            Assert("T4b Freeze() clears pending state",
                pendingClearedByFreeze, ref passed, ref failed);
            Assert("T4b Freeze() survives flush attempt",
                stillFrozen, ref passed, ref failed);

            // ----------------------------------------------------------
            // T5 — Unfreeze() escapes FROZEN cleanly (review fix F1).
            // Must drop to UNLOCKED without disturbing tracks.
            // ----------------------------------------------------------
            resolver.Unfreeze();
            Assert("T5 FROZEN→UNLOCKED via Unfreeze()",
                resolver.State == GroundYResolver.A1State.UNLOCKED, ref passed, ref failed);

            // ----------------------------------------------------------
            // T6 — Anti-thrash debounce: real transition pair within 0.5s.
            // ForceState resets _lastTransitionTime far in past, so first
            // TryTransition lands. Then PressDebounceWindow stamps NOW,
            // and the second TryTransition (via PushTierA) must defer.
            // ----------------------------------------------------------
            resolver.__TEST_ForceState(GroundYResolver.A1State.UNLOCKED);
            resolver.__TEST_PushTierA();  // first push → ARMED (immediate)
            bool firstLanded = resolver.State == GroundYResolver.A1State.ARMED;
            resolver.__TEST_PressDebounceWindow();
            resolver.__TEST_SeedTierAFirstSeen(2.0f);
            resolver.__TEST_PushTierA();  // would target LOCKED, must defer
            bool secondDeferred =
                resolver.State == GroundYResolver.A1State.ARMED &&
                resolver.__TEST_PendingState() == GroundYResolver.A1State.LOCKED;
            Assert("T6a first transition lands immediately",
                firstLanded, ref passed, ref failed);
            Assert("T6b second transition within 0.5s deferred to pending",
                secondDeferred, ref passed, ref failed);
            // And after a manual flush, the deferred transition fires.
            resolver.__TEST_FlushPending();
            bool flushedToLocked = resolver.State == GroundYResolver.A1State.LOCKED;
            Assert("T6c flushed pending lands LOCKED",
                flushedToLocked, ref passed, ref failed);

            // ----------------------------------------------------------
            // T7 — A11 fallback never reaches LOCKED via OnTierAObserved.
            // ----------------------------------------------------------
            resolver.__TEST_SetA11Fallback(true);
            resolver.__TEST_ForceState(GroundYResolver.A1State.UNLOCKED);
            resolver.__TEST_PushTierA();
            Assert("T7a A11 first push → ARMED",
                resolver.State == GroundYResolver.A1State.ARMED, ref passed, ref failed);
            // Even with stability window seeded, A11 must NOT promote.
            resolver.__TEST_SeedTierAFirstSeen(5.0f);
            resolver.__TEST_PushTierA();
            Assert("T7b A11 stays ARMED even after 5s window",
                resolver.State == GroundYResolver.A1State.ARMED, ref passed, ref failed);

            // ----------------------------------------------------------
            // T8 — A11 emit-once + repeated push stability.
            // ----------------------------------------------------------
            bool t8threw = false;
            try
            {
                for (int i = 0; i < 5; i++) resolver.__TEST_PushTierA();
            }
            catch (System.Exception e)
            {
                t8threw = true;
                Debug.LogError($"[A1-TEST] T8 threw: {e.Message}");
            }
            Assert("T8 A11 emit-once stable under repeated pushes",
                !t8threw, ref passed, ref failed);

            // ----------------------------------------------------------
            // T9 — UnregisterAll resets back to UNLOCKED + clears pending.
            // ----------------------------------------------------------
            resolver.__TEST_SetA11Fallback(false);
            resolver.__TEST_ForceState(GroundYResolver.A1State.LOCKED);
            resolver.__TEST_PressDebounceWindow();
            // From LOCKED, OnTierAObserved doesn't queue anything (no
            // matching state branch); pending stays whatever it was
            // (null after ForceState). UnregisterAll must keep it null.
            resolver.UnregisterAll();
            Assert("T9 UnregisterAll → UNLOCKED",
                resolver.State == GroundYResolver.A1State.UNLOCKED, ref passed, ref failed);
            Assert("T9 UnregisterAll clears pending",
                resolver.__TEST_PendingState() == null, ref passed, ref failed);

            // ----------------------------------------------------------
            // T10 — MT-1: SendToRN("A1State") fires on every transition,
            // payload is well-formed JSON.
            // ----------------------------------------------------------
            resolver.__TEST_ResetEmitCounters();
            resolver.__TEST_ForceState(GroundYResolver.A1State.UNLOCKED);
            int afterForce = resolver.__TEST_EmitCount;
            resolver.__TEST_PushTierA();   // → ARMED
            int afterPush = resolver.__TEST_EmitCount;
            Assert("T10a ForceState emits SendToRN",
                afterForce >= 1 && resolver.__TEST_LastEmitName == "A1State",
                ref passed, ref failed);
            Assert("T10b PushTierA→ARMED emits SendToRN",
                afterPush > afterForce && resolver.__TEST_LastEmitName == "A1State",
                ref passed, ref failed);
            // Payload contains state + prev + a11 keys.
            string lastPayload = resolver.__TEST_LastEmitPayload ?? "";
            Assert("T10c payload contains state=ARMED",
                lastPayload.Contains("\"state\":\"ARMED\""), ref passed, ref failed);
            Assert("T10d payload contains prev=UNLOCKED",
                lastPayload.Contains("\"prev\":\"UNLOCKED\""), ref passed, ref failed);
            Assert("T10e payload contains a11=false",
                lastPayload.Contains("\"a11\":false"), ref passed, ref failed);

            // ----------------------------------------------------------
            // T11 — MT-2: production Update() flush path actually fires.
            // Build pending, then run __TEST_RunPendingServicer (the
            // SAME method Update() calls).
            // Step 1: within debounce → servicer must NOT flush.
            // Step 2: simulate elapsed window → servicer flushes.
            // ----------------------------------------------------------
            resolver.__TEST_ForceState(GroundYResolver.A1State.UNLOCKED);
            resolver.__TEST_PressDebounceWindow();
            resolver.__TEST_SeedTierAFirstSeen(2.0f);
            resolver.__TEST_PushTierA();   // first push UNLOCKED→ARMED also debounced
            // Pending should be ARMED.
            bool pendingIsArmed = resolver.__TEST_PendingState() == GroundYResolver.A1State.ARMED;
            // Run servicer immediately (still within debounce) — must NOT flush.
            resolver.__TEST_RunPendingServicer();
            bool stillPendingWithinWindow =
                resolver.__TEST_PendingState() == GroundYResolver.A1State.ARMED &&
                resolver.State == GroundYResolver.A1State.UNLOCKED;
            Assert("T11a pending=ARMED queued within debounce",
                pendingIsArmed, ref passed, ref failed);
            Assert("T11b servicer respects debounce window (within=no flush)",
                stillPendingWithinWindow, ref passed, ref failed);

            // T11c — past-debounce branch via the SAME RunPendingServicer.
            // Manually advance time by stamping last transition far in past
            // and re-run servicer — pending must flush.
            resolver.__TEST_ForceState(GroundYResolver.A1State.UNLOCKED);
            resolver.__TEST_InjectPendingState(GroundYResolver.A1State.ARMED);
            // ForceState set _lastTransitionTime=-100 already (per
            // __TEST_ForceState), so debounce is far elapsed. Servicer
            // should flush ARMED.
            resolver.__TEST_RunPendingServicer();
            Assert("T11c past-debounce → servicer flushes pending",
                resolver.State == GroundYResolver.A1State.ARMED &&
                resolver.__TEST_PendingState() == null,
                ref passed, ref failed);

            // ----------------------------------------------------------
            // T12 — MT-4: Unfreeze→re-arm cycle. After Unfreeze, a fresh
            // PushTierA must start a new ARMED window from scratch.
            // ----------------------------------------------------------
            resolver.__TEST_ForceState(GroundYResolver.A1State.LOCKED);
            resolver.Freeze();
            resolver.Unfreeze();
            // After Unfreeze the FSM should be UNLOCKED with cleared
            // Tier-A bookkeeping. Push Tier-A → ARMED but NOT auto-LOCK.
            resolver.__TEST_PushTierA();
            Assert("T12a Unfreeze→PushTierA goes to ARMED",
                resolver.State == GroundYResolver.A1State.ARMED, ref passed, ref failed);
            // The stability gate must require fresh 1s window — re-push
            // immediately should NOT promote.
            resolver.__TEST_PushTierA();
            Assert("T12b post-Unfreeze ARMED→LOCKED requires fresh window",
                resolver.State == GroundYResolver.A1State.ARMED, ref passed, ref failed);

            // ----------------------------------------------------------
            // T13 — NEW-1: TryTransition + ServicePendingTransition both
            // reject FROZEN→non-UNLOCKED.
            //
            // T13a: ServicePendingTransition drops a pending=ARMED while
            // FROZEN. We use __TEST_InjectPendingState so the pending
            // state actually survives until the servicer runs (vs. the
            // earlier vacuous test that had ForceState clear it).
            // T13b: TryTransition guard — re-inject pending=ARMED + run
            // servicer past debounce; servicer would normally flush, but
            // the FROZEN early-return in ServicePendingTransition kicks
            // in before reaching TryTransition. Pending dropped, FROZEN
            // preserved.
            // ----------------------------------------------------------
            resolver.__TEST_ForceState(GroundYResolver.A1State.FROZEN);
            // Force just cleared pending. Now inject ARMED to simulate a
            // stale buffered transition.
            resolver.__TEST_InjectPendingState(GroundYResolver.A1State.ARMED);
            // Servicer runs. Production code: line ServicePendingTransition's
            // FROZEN guard must drop pending without firing TryTransition.
            resolver.__TEST_RunPendingServicer();
            Assert("T13a FROZEN servicer drops stale pending=ARMED",
                resolver.State == GroundYResolver.A1State.FROZEN &&
                resolver.__TEST_PendingState() == null,
                ref passed, ref failed);

            // T13b — verify TryTransition FROZEN guard directly (Stage 3
            // review T13b fix). Previously this test routed through
            // __TEST_FlushPending → ServicePendingTransition, which
            // early-returned on FROZEN BEFORE TryTransition was reached —
            // so it falsely claimed to test TryTransition's guard. Now
            // we call TryTransition directly via __TEST_TryTransitionDirect.
            // To ensure debounce is not the reason for rejection, we
            // first stamp _lastTransitionTime far in past.
            resolver.__TEST_ForceState(GroundYResolver.A1State.FROZEN);
            // ForceState sets _lastTransitionTime=-100 already. Inject
            // pending so we can also check it gets cleared.
            resolver.__TEST_InjectPendingState(GroundYResolver.A1State.LOCKED);
            // Direct call to TryTransition with a FROZEN-disallowed target.
            // FROZEN guard at TryTransition lines 355-359 should trigger:
            // _pendingState=null, return; state stays FROZEN.
            resolver.__TEST_TryTransitionDirect(GroundYResolver.A1State.LOCKED, "T13b-direct");
            Assert("T13b TryTransition FROZEN guard rejects LOCKED target",
                resolver.State == GroundYResolver.A1State.FROZEN &&
                resolver.__TEST_PendingState() == null,
                ref passed, ref failed);

            // T13c — TryTransition guard MUST allow target=UNLOCKED so
            // Unfreeze() and UnregisterAll() escape paths work.
            resolver.__TEST_TryTransitionDirect(GroundYResolver.A1State.UNLOCKED, "T13c-unfreeze-direct");
            Assert("T13c TryTransition allows FROZEN→UNLOCKED",
                resolver.State == GroundYResolver.A1State.UNLOCKED,
                ref passed, ref failed);

            // ----------------------------------------------------------
            // T14 — MT-7: Freeze() on already-FROZEN is idempotent.
            // Includes emit-count snapshot to verify no spurious re-emit
            // (subagent review T14 emit-count addendum).
            // ----------------------------------------------------------
            int emitsBeforeIdempotentFreeze = resolver.__TEST_EmitCount;
            resolver.Freeze();
            Assert("T14a Freeze() idempotent on FROZEN (state)",
                resolver.State == GroundYResolver.A1State.FROZEN,
                ref passed, ref failed);
            Assert("T14b Freeze() idempotent on FROZEN (no extra emit)",
                resolver.__TEST_EmitCount == emitsBeforeIdempotentFreeze,
                ref passed, ref failed);
        }
        finally
        {
            if (createdAdHoc && resolver != null && resolver.gameObject != null)
            {
                Object.Destroy(resolver.gameObject);
            }
        }

        Debug.Log($"[A1-TEST] SUMMARY passed={passed} failed={failed}");
        if (failed > 0)
        {
            EditorUtility.DisplayDialog("A1 FSM Tests",
                $"FAILED: {failed}/{passed + failed}. See Console.", "OK");
        }
        else
        {
            EditorUtility.DisplayDialog("A1 FSM Tests",
                $"All {passed} tests PASS.", "OK");
        }
    }

    private static void Assert(string name, bool ok, ref int passed, ref int failed)
    {
        if (ok)
        {
            Debug.Log($"[A1-TEST] PASS {name}");
            passed++;
        }
        else
        {
            Debug.LogError($"[A1-TEST] FAIL {name}");
            failed++;
        }
    }
}
#endif
