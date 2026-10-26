# O94 iOS OTA 发布记录

## Client 与 binary compatibility

- Published client commit：`2577ecad2e643f26c8cace34862f9bb334043a1f`
- Tree：`e18e012910245b483e040811d90be1aa3f04fe4b`
- Worktree at publish：clean
- Home marker：O94，仅既有一个 marker
- App：0.2.6；installed target：Build 65
- Runtime：`0.2.6-o66`，与 Build 65 精确匹配
- Bundle：`com.yiiling.cairn`
- EAS CLI：22.4.0
- Candidate fingerprint：`eb6dc08fdfcc06f8084ea852406fd41d1df3169f`，与 O93 client candidate 相同

本轮无 package/native dependency、plugin、permission、entitlement、SDK、autolinking、runtime 或 build-number 变化，因此不需要新 binary。

## Backend compatibility

- Deployed backend SHA：`5913e3e0fce26e397366e41ccb5a5d27b1daa1ec`
- Image：`sha256:456c16bd0d5a05f323083ce81386e4b6eae82493250ddd5fb1151972e96c5e90`
- Migration ledger：057
- Container：healthy；health/db：ok
- Public route-registration probes：Mine snapshot unauthenticated 401；Friends snapshot unauthenticated 401；不是 404。
- O94 没有 API/DB/backend diff，没有未部署 server prerequisite。

## Publication

- Channel / branch：`production / production`
- Channel paused：false
- Platform：iOS only
- Environment：production
- Message：`O94 Owner Test - Memory UX and Route Location Consistency`
- iOS Update ID：`01a17728-2342-7ffe-8dc7-8d11f9d3098d`
- Update group：`b5bf0a54-c47c-4cc8-aed8-32dff1ef6c15`
- EAS `update:view` 和 publication result 均确认成功。

## Safe rollback prerequisite

保留 O93 group `84ddb750-7c7e-4489-8ee9-befebd7865ab` 和 update `01a17663-7122-7e2d-b400-4c466f632ad2`。若物理验收发现 O94 client blocker，可在确认 backend 保持当前 snapshot-compatible 版本后，由获授权操作者执行：

```sh
cd app
npx eas-cli@22.4.0 update:republish \
  --group 84ddb750-7c7e-4489-8ee9-befebd7865ab \
  --destination-channel production \
  --platform ios \
  --message "Rollback production iOS to preserved O93" \
  --non-interactive
```

本轮没有执行 rollback。不要把 backend 回退到不支持 snapshot contract 的版本。
