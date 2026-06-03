using UnityEngine;
using Unity.XR.CoreUtils;
using UnityEngine.XR.ARFoundation;

/// <summary>
/// Spike scene: proves AR Foundation + ARKit pipeline works end-to-end.
/// Shows a white cylinder anchored 2m in front of the user at ground level.
/// No DS visuals yet - just confirms the integration path works.
/// </summary>
public class SpikeARController : MonoBehaviour
{
    [Header("Spike References")]
    public ARPlaneManager planeManager;
    public ARSession arSession;

    [Header("Spawn")]
    public GameObject spikePillarPrefab;

    private bool _pillarSpawned = false;
    private ARPlane _firstPlane = null;

    void OnEnable()
    {
        if (planeManager != null)
            planeManager.trackablesChanged.AddListener(OnPlanesChanged);
    }

    void OnDisable()
    {
        if (planeManager != null)
            planeManager.trackablesChanged.RemoveListener(OnPlanesChanged);
    }

    private void OnPlanesChanged(ARTrackablesChangedEventArgs<ARPlane> args)
    {
        if (_pillarSpawned) return;

        foreach (var plane in args.added)
        {
            // Accept the first horizontal floor plane detected
            if (plane.alignment == UnityEngine.XR.ARSubsystems.PlaneAlignment.HorizontalUp)
            {
                _firstPlane = plane;
                SpawnSpikePillar(plane.center);
                _pillarSpawned = true;
                break;
            }
        }
    }

    private void SpawnSpikePillar(Vector3 position)
    {
        if (spikePillarPrefab == null)
        {
            // Fallback: create a primitive cylinder if no prefab assigned
            var go = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
            go.transform.position = position + Vector3.up * 0.5f;
            go.transform.localScale = new Vector3(0.1f, 1.0f, 0.1f);

            var mat = new Material(Shader.Find("Universal Render Pipeline/Lit"));
            mat.color = Color.white;
            go.GetComponent<Renderer>().material = mat;

            Debug.Log("[SpikeAR] Pillar spawned at " + position + " (primitive fallback)");
        }
        else
        {
            Instantiate(spikePillarPrefab, position, Quaternion.identity);
            Debug.Log("[SpikeAR] Pillar spawned at " + position + " (prefab)");
        }
    }
}
