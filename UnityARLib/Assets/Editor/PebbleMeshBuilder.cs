#if UNITY_EDITOR
using UnityEditor;
using UnityEngine;

/// <summary>
/// PebbleMeshBuilder — Editor utility that generates 3 oblate spheroid
/// pebble meshes (Pebble_S/M/L.asset) per cinematic-ar-rebuild.md §D.1.
///
/// Logo proportions:
///   - Top   pebble: 0.15m wide × 0.10m tall, oblate-Y
///   - Mid   pebble: 0.22m wide × 0.16m tall
///   - Bot   pebble: 0.30m wide × 0.22m tall
///   - Stack centered on Y; total stack height ≈ 0.5m
///
/// ~60 tris each (8 lat × 6 lon ≈ 96 tris — within budget). Mesh is
/// generated procedurally via UV-sphere with axis scaling. Saved to
/// Assets/Meshes/Pebble_*.asset for runtime reference by PortalSpawner.
///
/// Usage: Unity menu Cairn ▸ Build Pebble Meshes (or via batchmode
/// -executeMethod PebbleMeshBuilder.BuildAll for CI).
/// </summary>
public static class PebbleMeshBuilder
{
    private const string MESH_DIR = "Assets/Meshes";

    [MenuItem("Cairn/Build Pebble Meshes")]
    public static void BuildAll()
    {
        if (!System.IO.Directory.Exists(MESH_DIR))
        {
            System.IO.Directory.CreateDirectory(MESH_DIR);
        }
        // Logo proportions: top (small) → bottom (large).
        BuildOne("Pebble_S", 0.15f * 0.5f, 0.10f * 0.5f);
        BuildOne("Pebble_M", 0.22f * 0.5f, 0.16f * 0.5f);
        BuildOne("Pebble_L", 0.30f * 0.5f, 0.22f * 0.5f);
        AssetDatabase.SaveAssets();
        AssetDatabase.Refresh();
        Debug.Log("[PebbleMeshBuilder] Saved 3 pebbles to " + MESH_DIR);
    }

    private static void BuildOne(string name, float halfWidth, float halfHeight)
    {
        const int latSegs = 8;
        const int lonSegs = 12;
        Mesh m = new Mesh();
        m.name = name;

        var verts = new System.Collections.Generic.List<Vector3>();
        var norms = new System.Collections.Generic.List<Vector3>();
        var uvs   = new System.Collections.Generic.List<Vector2>();
        var tris  = new System.Collections.Generic.List<int>();

        for (int i = 0; i <= latSegs; i++)
        {
            float lat = Mathf.PI * i / latSegs;            // 0 → π
            float sLat = Mathf.Sin(lat);
            float cLat = Mathf.Cos(lat);
            for (int j = 0; j <= lonSegs; j++)
            {
                float lon = 2 * Mathf.PI * j / lonSegs;     // 0 → 2π
                float sLon = Mathf.Sin(lon);
                float cLon = Mathf.Cos(lon);

                Vector3 unit = new Vector3(sLat * cLon, cLat, sLat * sLon);
                Vector3 pos = new Vector3(
                    unit.x * halfWidth,
                    unit.y * halfHeight,
                    unit.z * halfWidth);
                // Normal of an oblate spheroid: gradient of
                //   (x/a)^2 + (y/b)^2 + (z/a)^2 = 1
                // → (x/a^2, y/b^2, z/a^2), normalized.
                Vector3 n = new Vector3(
                    pos.x / (halfWidth * halfWidth),
                    pos.y / (halfHeight * halfHeight),
                    pos.z / (halfWidth * halfWidth)).normalized;
                verts.Add(pos);
                norms.Add(n);
                uvs.Add(new Vector2((float)j / lonSegs, (float)i / latSegs));
            }
        }
        int row = lonSegs + 1;
        for (int i = 0; i < latSegs; i++)
        {
            for (int j = 0; j < lonSegs; j++)
            {
                int a = i * row + j;
                int b = a + 1;
                int c = a + row;
                int d = c + 1;
                tris.Add(a); tris.Add(c); tris.Add(b);
                tris.Add(b); tris.Add(c); tris.Add(d);
            }
        }
        m.SetVertices(verts);
        m.SetNormals(norms);
        m.SetUVs(0, uvs);
        m.SetTriangles(tris, 0);
        m.RecalculateBounds();
        m.UploadMeshData(false);

        string path = $"{MESH_DIR}/{name}.asset";
        var existing = AssetDatabase.LoadAssetAtPath<Mesh>(path);
        if (existing != null)
        {
            EditorUtility.CopySerialized(m, existing);
            Debug.Log($"[PebbleMeshBuilder] Updated {path} (verts={verts.Count}, tris={tris.Count/3})");
        }
        else
        {
            AssetDatabase.CreateAsset(m, path);
            Debug.Log($"[PebbleMeshBuilder] Created {path} (verts={verts.Count}, tris={tris.Count/3})");
        }
    }
}
#endif
