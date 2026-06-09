using UnityEngine;

/// <summary>
/// BillboardYaw — yaw-only LookAt camera.
///
/// Used by TypeChip (per cairn type icon) + LikeBadge (count badge) +
/// RuneText / StoneBackplate (TMP rune layer).
///
/// Yaw-only (not full LookAt) so vertical orientation is gravity-locked
/// — the chip/text doesn't tilt when user looks up/down. This matches
/// Pokémon GO and Avatar billboard conventions.
/// </summary>
[DefaultExecutionOrder(10000)] // run after camera positions update
public class BillboardYaw : MonoBehaviour
{
    private Transform _cam;

    void OnEnable()
    {
        if (Camera.main != null) _cam = Camera.main.transform;
    }

    void LateUpdate()
    {
        if (_cam == null && Camera.main != null) _cam = Camera.main.transform;
        if (_cam == null) return;

        Vector3 toCam = _cam.position - transform.position;
        toCam.y = 0; // yaw-only
        if (toCam.sqrMagnitude < 0.0001f) return;
        transform.rotation = Quaternion.LookRotation(-toCam.normalized, Vector3.up);
    }
}
