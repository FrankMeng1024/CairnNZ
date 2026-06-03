# EAS Build & Update Guide

## 何时需要重新 Build（消耗额度）

以下情况**必须重新 build**：
- 新增含原生模块的 npm 包（如新的 expo-* 插件、@rnmapbox/maps 等）
- 修改 `app.json`（权限、bundle ID、插件配置等）
- 修改 `eas.json`
- 升级 Expo SDK 版本

## 何时可以用 OTA 更新（不消耗额度）

以下情况**直接 OTA 推送**，用户下次打开 app 自动更新：
- 修改 `.tsx` / `.ts` / `.js` 组件或逻辑
- 修改样式、颜色、文字
- 修改图片等静态资源
- 修改 API 调用逻辑
- 绝大多数功能迭代

## OTA 更新命令

```bash
cd app
eas update --branch production --message "描述本次更新内容"
```

## 重新 Build 命令

```bash
cd app
eas build --profile production --platform ios
```

## 额度说明

- Expo 免费版：每月 **30 次** build
- OTA update：**无限次**，免费

## 安装方式

- Build 完成后 Expo 会发邮件 + 控制台给下载链接
- iOS 通过 TestFlight 或直接 OTA 安装（取决于 profile）
- 生产包需要通过 TestFlight 分发给测试用户

## Bundle ID

- iOS: `com.yiiling.cairn`
- Android: `com.cairn.app`
