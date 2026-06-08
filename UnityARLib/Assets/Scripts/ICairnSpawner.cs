/// <summary>
/// Common interface for cairn spawners. v186 MultiSpawner (DS strand
/// cylinder) and v187 PortalSpawner (magic-circle portal) both implement
/// this so SceneSetup can swap the visual without touching CairnBridge.
///
/// MonoBehaviour-style methods (no MonoBehaviour inheritance here — this
/// is a C# interface; both spawners are MonoBehaviours that satisfy it).
///
/// Lifecycle contract:
///   1. SpawnStrand(req) — RN pushes a cairn. Idempotent w.r.t. duplicate
///      `req.id`: if already spawned, no-op. Sets HasSpawned=true.
///   2. ClearAll() — destroy all spawned cairns + reset state. Used on
///      AR session reset or scene change.
///   3. HasSpawned — true if at least one cairn is currently rendered.
///   4. IsFallback — for v186 diagnostic flow only. v187 returns false
///      always (no fallback path).
///
/// Reasoning: This swap was originally done with a bare cast in SceneSetup,
/// but CairnBridge held a typed `MultiSpawner spawner` reference, so
/// ICairnSpawner makes the swap explicit and type-safe.
/// </summary>
public interface ICairnSpawner
{
    bool HasSpawned { get; }
    bool IsFallback { get; }
    void SpawnStrand(CairnBridge.SpawnRequest data);
    void ClearAll();
}
