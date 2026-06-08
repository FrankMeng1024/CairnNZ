# Cairn AR — Local Autonomous Iteration

> 怎么在不开 Unity Editor 的情况下，全自动迭代 Cairn AR 视觉。
> 这是 v187 portal cairn 开发期间用过的方法，AI agent 可以自己跑这个循环：
> **修代码 → build → 截图 → 看图 → 判断 → 改 → 重复**，无人参与。

## 前提

- Unity 6000.0.76f1 装在 `C:\tools\Unity\6000.0.76f1\Editor\Unity.exe`
- ffmpeg 在 PATH（用于把 PNG sequence 拼 GIF）
- Bash shell（Git Bash on Windows OK）

## 一、自动化构建 Standalone Win64 testbed

```bash
UNITY="/c/tools/Unity/6000.0.76f1/Editor/Unity.exe"
PROJECT="/c/ClaudeCodeProjects/Cairn/UnityARLib"
LOG="/c/ClaudeCodeProjects/Cairn/UnityARLib/Logs/testbed-build.log"
rm -f /c/ClaudeCodeProjects/Cairn/UnityARLib/Temp/UnityLockfile  # 清残留 lock
"$UNITY" -batchmode -nographics -quit \
  -projectPath "$PROJECT" \
  -executeMethod ShaderTestbedBuilder.BuildWindowsPlayer \
  -logFile "$LOG"
echo "EXIT=$?"
grep -E "Build result|=== SUCCESS" "$LOG" | tail
```

`ShaderTestbedBuilder.BuildWindowsPlayer` 是 Editor 脚本，做：
1. 调 `SceneSetup.SetupAndSave()` 重建 production scene 资源（material、shader、URP asset）
2. 调 `ShaderTestbedSceneBuilder.BuildScene()` 创建独立 testbed scene（camera + spawner + harness）
3. `BuildPipeline.BuildPlayer` 出 Win64 .exe

**第一次 build：~5 分钟**（编 shader）。后续 build：**~1 分钟**（增量）。

## 二、自动化运行 + 截图

```bash
cd /c/ClaudeCodeProjects/Cairn/UnityARLib/Builds/ShaderTestbed
# 单帧截图
./ShaderTestbed.exe \
  --out result.png \
  --width 1280 --height 720 \
  --frames 60 \
  --type danger \
  --cam-dist 2.0
```

`ShaderTestbedHarness.cs` 读 cmdline 参数：
- `--type` = `danger | junction | water | hut | cairn | all`（all = 5 个并排）
- `--cam-dist` = 摄像头距 cairn 多远（米）
- `--frames` = 等多少 frame 后截图（warmup 用）
- `--out` = PNG 输出路径
- `--width / --height` = 分辨率

Player 自动 spawn cairn → 等 N 帧 → `cam.Render() + ReadPixels` → 写 PNG → `Application.Quit()`。

## 三、自动化看图

Claude 多模态 Read tool 直接读 PNG：
```
Read /path/to/result.png
```
返回视觉描述 → agent 可以判断 cairn 颜色对不对 / 大小 / 位置 / icon 是否清晰。

## 四、自动化生成 GIF（验证动画）

```bash
cd /c/ClaudeCodeProjects/Cairn/UnityARLib/Builds/ShaderTestbed
rm -f gif-frame-*.png
for i in $(seq 1 30); do
  f=$((50 + i * 3))   # 53, 56, 59... 至 140
  ./ShaderTestbed.exe \
    --out gif-frame-$(printf '%02d' $i).png \
    --width 800 --height 500 \
    --frames $f \
    --type danger \
    --cam-dist 2.5 >/dev/null 2>&1
done
ffmpeg -y -framerate 12 -i gif-frame-%02d.png -loop 0 \
  -vf "split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4" \
  cairn-motion.gif
```

输出 `cairn-motion.gif`（~400KB，2.5 秒循环）。Agent 可读 GIF 第一帧（或者跳到 N 帧验证动画在动）。

## 五、迭代循环（一次完整改 → build → 看图）

```bash
# 假设要调 halo 强度
# 1. 改代码（PortalSpawner.cs `quadScale * 2.6` → `* 1.6`）
sed -i 's/quadScale \* 2\.6f/quadScale * 1.6f/' UnityARLib/Assets/Scripts/PortalSpawner.cs

# 2. build
UNITY="/c/tools/Unity/6000.0.76f1/Editor/Unity.exe"
"$UNITY" -batchmode -nographics -quit \
  -projectPath /c/ClaudeCodeProjects/Cairn/UnityARLib \
  -executeMethod ShaderTestbedBuilder.BuildWindowsPlayer \
  -logFile /tmp/build.log
[ $? -eq 0 ] || { echo "BUILD FAILED"; cat /tmp/build.log | grep -E "error CS|Compile" | head; exit 1; }

# 3. 跑 + 截图
cd /c/ClaudeCodeProjects/Cairn/UnityARLib/Builds/ShaderTestbed
./ShaderTestbed.exe --out r.png --width 1280 --height 720 --frames 90 --type all --cam-dist 5

# 4. agent Read r.png → 判断
# 5. 不满意 → 回 step 1 改不同参数
```

**典型一轮：90 秒**。我在 v187 开发期间跑了 30+ 轮，全自动。

## 六、常见 batchmode 故障 + 解决

| 故障 | 原因 | 解决 |
|------|------|------|
| `HandleProjectAlreadyOpenInAnotherInstance` | 你 Editor 还开着 OR 之前 batchmode 没退干净 | `rm -f UnityARLib/Temp/UnityLockfile` + 杀残留 Unity 进程 (`powershell Stop-Process -Name Unity -Force`) |
| `294,912 variants` shader compile，几小时不完 | URP 全 keyword 矩阵被强制保留 | 检查 `m_AlwaysIncludedShaders` 没乱加 URP/Lit 等大 shader；只该有 Cairn/* |
| Player 全 magenta | URP RP asset 没 wire 进 GraphicsSettings | `SceneSetup.EnsureURPRenderPipelineAsset()` 必须设 `GraphicsSettings.defaultRenderPipeline` 和 `QualitySettings.renderPipeline`（**仅 standalone build 用，iOS 别设 GraphicsSettings 全局**） |
| Player 看到 cairn 是黑色方块 | particle material 没 sprite | `PortalSpawner.GetOrCreateSoftCircleTex()` 运行时生成软圆 sprite |
| Build 完 exe 时间没变 | Unity 觉得 Player 项目 cache 还有效，没出新 exe | 看 `Builds/ShaderTestbed/ShaderTestbed_Data/` 目录，`level0` / `globalgamemanagers` 时间戳变了就是 build 真跑了；exe + UnityPlayer.dll 是 launcher，不会变 |
| iOS CI build 时 shader 编译 8 小时 | URP/Lit 在 AlwaysIncludedShaders 强制保留全 variant | **千万别**把 `Universal Render Pipeline/Lit` 加进 AlwaysIncludedShaders；URP 自己的 stripper 会保留实际用的 |

## 七、AR 真机看 — 不是本地能搞的

本地 testbed = standalone Win64 **没 ARCameraBackground**，模拟不到 AR camera feed。**必须 EAS Build → iPhone 装 IPA**。

但本地能做：
- Cairn 视觉本身（颜色、形状、shader、动画）
- ParticleSystem 行为
- Distance LOD（用 `--cam-dist` 模拟远近）
- 5 type 一致性

iPhone 才能验证：
- ARCameraBackground feed 正确 blit（看 RN 的 ARDebugOverlay 上的 URPDiag/CamDiag/VolumeDiag — v187.7.11 加的）
- iOS Metal HDR + bloom 实际效果
- TrackedPoseDriver 跟相机
- 多 cairn 在真实 GPS 坐标

## 八、跨 Unity 版本（76f1 vs 36f1 CI）

**问题**：本地 76f1 写的 .asset，CI 36f1 build 时反序列化可能丢字段（Unity 6 patch 间偶尔有 schema 变化）。

**解决**（v187.7.12 起）：`tools/asset-fingerprint.sh` 计算关键 asset 的 SHA-256。两侧都跑这个脚本：
- 本地：build 后 `bash tools/asset-fingerprint.sh > tools/asset-hashes-local.txt`
- CI：workflow 里 emit 到 Editor.log
- pre-EAS gate：比对，不一致就 fail

**这样保留 76f1 本地自动化能力，CI 仍 36f1，drift 可见**。

## 九、AI agent 跑这个循环的 prompt 模式

```
你的目标：让 cairn 的 portal halo 明显但不挡 AR 摄像头。
循环：
1. cd /c/ClaudeCodeProjects/Cairn
2. 改 UnityARLib/Assets/Scripts/PortalSpawner.cs 里 quadScale * 2.6f
3. cd UnityARLib && batchmode build (上面命令)
4. cd Builds/ShaderTestbed && run --out r.png
5. Read r.png 看视觉
6. 判断：halo 直径占画面 < 20%? Y 完成；N → 调 quadScale 系数 → step 2
最大迭代 5 次。每次记录决策到 docs/agent-iteration-log.md
```

## 十、关键文件索引

| 文件 | 作用 |
|------|------|
| `UnityARLib/Assets/Editor/ShaderTestbedBuilder.cs` | Build entry — `[MenuItem]` + `executeMethod` 入口 |
| `UnityARLib/Assets/Editor/ShaderTestbedSceneBuilder.cs` | 程序化创建 ShaderTestbed.unity scene |
| `UnityARLib/Assets/Scripts/ShaderTestbedHarness.cs` | Player 端：parse cmdline → spawn → 截图 → quit |
| `UnityARLib/Assets/Editor/ShaderVariantStripper.cs` | IPreprocessShaders — 仅 standalone strip URP variants |
| `UnityARLib/Assets/Editor/CairnShaderInclude.cs` | IPreprocessBuildWithReport — 把 Cairn/* shader 加 AlwaysIncluded |
| `UnityARLib/Assets/Editor/SceneSetup.cs` | 主 scene 程序化构建 + URP RP asset 创建 + ARBackgroundRendererFeature 注册 |
| `tools/asset-fingerprint.sh` | 计算 .asset SHA-256（drift monitor） |

## 历史

- v186 之前：每次手开 Unity Editor 看效果，1 轮 5+ 分钟
- v187 期间：上述自动化建立，1 轮 90 秒，agent 自己跑了 30+ 轮
- v187.7.12: 加 asset fingerprint + link.xml 防 IL2CPP strip，跨版本安全
