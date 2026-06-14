# AR_MESH_VERIFY — independent grep audit

Cross-checked main agent claims by running grep myself. All numbers below are bash output, not main-agent text.

## CairnAR.unity ARMeshManager status
- GUID `968053edfd89749c48f4ea5d444abf64` 出现次数: **1** (line 1132)
- 所在 GameObject: `m_Name: AR Mesh Manager` (fileID 1460941093, line 1093)
- Transform fileID 1460941094, line 1110: `m_Father: {fileID: 1186103885}`
- fileID 1186103885 = Transform of `XR Origin (AR)` (GameObject fileID 1186103881, line 869, m_Name line 883)
- 字段值 (MonoBehaviour fileID 1460941095, lines 1124-1144):
  - `m_MeshPrefab: {fileID: 0}` (空 — 真机 mesh 渲染需要 prefab,但 detection/subsystem 不强求)
  - `m_Density: 0.5`
  - `m_Normals: 1`
  - `m_Tangents: 0`
  - `m_TextureCoordinates: 0`
  - `m_Colors: 0`
  - `m_ConcurrentQueueSize: 4`
  - `m_Enabled: 1`
- 唯一 .unity 命中: 仅 `CairnAR.unity` (find -exec grep -l 返回 1 文件)

## SceneSetup.cs status
- 行 193: `var meshGo = new GameObject("AR Mesh Manager");`
- 行 194: `meshGo.transform.SetParent(xrOriginGo.transform, false);` — 真挂 XR Origin 子节点
- 行 195: `var meshManager = meshGo.AddComponent<ARMeshManager>();`
- 行 196: Debug.Log 确认四个 manager 都 added
- 注释 187-192 解释了 v0.2.4 R2.2/R2.6 修复背景 (LiDAR 检测之前永远 false)

## Build path
- `BuildScript.cs:65` — `SceneSetup.SetupAndSave();` 在 build 入口被调用 (try/catch 包住, 失败 EditorApplication.Exit(1))
- `BuildScript.cs:15` 注释: "Always re-runs SceneSetup.SetupAndSave() so CI is deterministic"
- 真机 EAS build 路径: `SetupAndSave` 重建 scene → save → build → baked scene 包含上面 fileID 1460941093 这个 GO
- 即便 baked scene 被覆盖,SetupAndSave 也会重新 AddComponent ARMeshManager (源代码层保证)

## Verdict
- **ARMeshManager 真在生产 scene** ✓ (GUID 命中 1 次, parent 是 XR Origin (AR), 字段合法)
- **SceneSetup.cs 也真有 AddComponent** ✓ (行号 195, 真 SetParent xrOriginGo)
- **BuildScript 真跑 SetupAndSave** ✓ (行 65)
- 真机 LiDAR Pro 设备 ARMeshManager.subsystem 应能启动 → `FindFirstObjectByType<ARMeshManager>()` 返非 null → R2.2/R2.6 LiDAR 检测路径解锁
- **Sub#3 PROD_PATH_AUDIT 是过时数据**, USER_SYMPTOM_AUDIT 报 0 命中也对不上当前 scene 文件 — 当前 scene 与 SceneSetup.cs 一致,主 agent 这次说法可信

## Caveat (诚实声明)
- `m_MeshPrefab: {fileID: 0}` — 空 prefab 意味着 AR mesh **不会被渲染成可见 mesh**, 但 ARMeshSubsystem 仍会 running (LiDAR 探测正常). 如果 R2 路径只用 `subsystem.running` 判断 LiDAR,这就够; 如果还指望渲染 mesh debug 可视化,需另配 prefab.
- 没真机跑过 — 无法证明 subsystem.running 在真 LiDAR Pro 上真返 true. 只能说 scene 配置层面 OK.
