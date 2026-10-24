# Cairn 单一文本目录使用说明

## 唯一人工编辑源

`app/src/i18n/cairnText.ts` 是 Cairn 自有、可见文本的唯一人工维护目录。组件、store 和 service 只能通过稳定 key 调用 `cairnText(...)`；不要在调用点再放一份英文 fallback，也不要另建 JSON、spreadsheet 或第二套翻译目录。

每条记录包含：

- `en-NZ`：完整的新西兰英文源文；
- `ja-JP`：已批准/QA 草稿译文，或明确的 `null`；
- `context`：含义与翻译注意事项；
- `surfaces`：出现位置；
- `params`：命名参数和类型；
- `layout`：长度、换行和无障碍限制；
- `translationStatus`：`source / approved / draft / pending`。

`ja-JP: null` 必须同时是 `pending`，运行时确定性回退到 `en-NZ`。这不是“已翻译”。本次仅有少量既有 approved 文本及明确标为 draft 的登录页 QA 样例，不能据此开放日文发布。

## 查找与修改

1. 在 `cairnText.ts` 中按界面文字、稳定 key 或 `surfaces` 查找。
2. 只修改该记录的目标语言和 `translationStatus`；保留 key。
3. 带 `{name}`、`{count}` 等参数时，两种语言必须保留同名参数。完整句子可重排参数，禁止拼接英文片段。
4. 数量用完整 plural 记录，不要在组件里加 `s`。日期、数字和单位通过 runtime formatter；协议/存储值仍保持稳定字节。
5. 用户写的 Cairn/Route 名称、姓名、邮箱、坐标、ID、日志、第三方地图文字和 attribution 不属于翻译源文。

## 验证

在 `app` 目录运行：

```sh
npm run check:text
npx jest src/i18n/__tests__/cairnText.test.tsx --runInBand
node scripts/cairn-text-check.mjs --report=/tmp/cairn-text-callsites.json
node scripts/cairn-text-routes-report.mjs --report=/tmp/cairn-text-routes.json
```

`check:text` 会阻止：新增未分类 UI literal、未知/dynamic key、空 en-NZ、重复/孤立 key、参数或 plural 不一致、日文状态不诚实、模块加载时冻结翻译，以及原生权限说明和目录不一致。

Web 布局复核可在已启动的 Expo Web 上运行：

```sh
CAIRN_PLAYWRIGHT_EXECUTABLE=/path/to/Chromium \
node scripts/cairn-text-visual-qa.mjs \
  --url=http://127.0.0.1:8081 \
  --output=/tmp/cairn-text-visual-qa
```

它检查 360/390/430 宽度、ja-JP QA 样例、伪扩展文本、空按钮、raw key 和横向溢出。浏览器 zoom 只是一项 Web 压力测试，不能替代 iOS Dynamic Type 或原生截图。

## 运行时与回退

- `ja`、`ja-*` → `ja-JP`；
- 英文变体及不支持的 locale → `en-NZ`；
- `en-XA` 仅是确定性的 QA 伪扩展 override；
- 缺失 ja-JP 条目 → `en-NZ`，不会显示 key、`undefined` 或空按钮；
- 切换 locale 由 `LocalizationBoundary` 触发重渲染，不重挂载导航树、地图或业务 store，因此不应清空 Route 草稿、Friends 选择或 camera。

正常发布仍遵守现有发布流程。本任务没有 push、部署、EAS Build、prebuild 或 OTA，也没有改变 O92 marker。

## 原生与外部边界

目录中的 `native.permission.*` 是权限说明的编辑权威；`cairn-native-text-check.mjs` 只读取并核对 `app.json`，不会运行 prebuild。权限说明进入已安装二进制仍需未来单独批准的原生构建。

以下内容不由 JS 目录控制：系统权限按钮、Mapbox/Apple attribution、地图地点标签、外部托管的隐私政策/EULA 页面。Cairn 自己的链接标题和解释仍在目录中；外部官方标题、support 邮箱、技术标识符必须在 exception inventory 中逐条说明，不能整目录豁免。
