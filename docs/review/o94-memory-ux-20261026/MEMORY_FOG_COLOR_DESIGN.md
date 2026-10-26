# Mine / Friends / Both 填充色

三个 source 由既有 `combinePreparedCoverage` 产生互斥几何：Mine-only、Friends-only、真实 overlap。O94 只改变 presentation token，不改变 Memory 证据、授权、半径、洞、覆盖 revision 或 Friends 隐私。

| Theme | Mine | Friends | Both |
|---|---|---|---|
| Day | `#327252` / 0.32 | `#396FA3` / 0.32 | `#A35F32` / 0.36 |
| Sunset | `#5B7650` / 0.33 | `#3D718A` / 0.34 | `#A76545` / 0.38 |
| Night | `#8DB77C` / 0.36 | `#61A9D0` / 0.36 | `#D69258` / 0.40 |

Mine 使用森林绿，Friends 使用冷蓝，Both 使用暖赭橙。三者都以填充为首要识别，细线仅是辅助。Legend 直接读取同一组 token，显示实心 swatch，因此不会出现 legend 与地图含义漂移。

本机三主题截图均使用相同 synthetic geometry/camera。Mapbox rendered-feature 计数在每个主题中为 Mine 2、Friends 2、Both 4；人工查看可区分三类且底图道路仍可读。证据见外部交付包 `EVIDENCE/MAP_VISUALS/`。

边界：本机使用 source-free QA style，不代表 Hosted Standard 或 iPhone Day/Sunset/Night 验收。真实 Mapbox tile 对比度由 Owner T02/T06 复核。
