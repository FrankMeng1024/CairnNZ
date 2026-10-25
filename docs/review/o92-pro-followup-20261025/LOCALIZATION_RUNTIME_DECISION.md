# Localization Runtime Decision

当前产品决策是 **English only**：所有正式用户可见 app-owned 文案固定使用 `en-NZ`。

- 系统语言、系统 Region、GPS、地图城市、朋友位置、IP 均不参与 locale 决策。
- 不新增语言设置入口。
- 单一目录 `app/src/i18n/cairnText.ts` 保留 en-NZ、ja-JP draft/pending、key、参数、上下文和翻译状态。
- `normalizeCairnLocale` 作为未来目录能力保留，但 production runtime 不调用设备 locale 决定界面语言。
- 只有 `NODE_ENV !== 'production'` 时，测试才能显式调用 QA override 验证 `ja-JP` 或 `en-XA`；正式 bundle 不暴露 `globalThis.__cairnI18n`。
- 日语完成度不影响当前 TestFlight 判断。未来启用任何非英语语言必须是单独产品/发布决策。

验收：

- en-NZ / en-US / ja-JP / zh-CN 设备输入均解析为 en-NZ。
- 代表性 App root、Auth、Memory、Route、Friends、Settings key 均与 catalog `en-NZ` authority 相同。
- `check:text`：2,539 entries、3,045 callsites、en-NZ 100%；10 approved Japanese、6 draft、2,523 pending。
- production iOS Hermes bundle 可导出，且 strings 检查 `__cairnI18n ABSENT`。
- 非生产 locale 切换测试仍证明组件不 remount、Route draft/Friends selection/camera 不丢失；该入口普通用户不可达。

