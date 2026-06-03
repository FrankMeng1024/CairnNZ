# 心跳复活机制测试

**生成时间**: 2026-05-31T04:48:52.496Z

## 场景

一个内容其实有用的 marker (假阳性 bad), 第 0 天被 8 个恶意 reporter
集中攻击 → 进 heartbeat 状态 (曝光 5%). 接下来 60 天, 每天 100 个用户路过,
heartbeat sampling 让 5% 路过的人能看到, 这些人 70% 会 like.

测试 PRD: 心跳机制能否让被误判的 marker 复活到 healthy / borderline?

## 结果

- 测试 seed: 10 个
- 复活成功: 10 / 10
- 总评: ✅ PASS

| Seed | 初始状态 | 进入 heartbeat 天 | 复活天 | 最终状态 |
|---|---|---|---|---|
| 42 | heartbeat | n/a | 第 1 天 | healthy |
| 100 | heartbeat | n/a | 第 1 天 | healthy |
| 7 | heartbeat | n/a | 第 1 天 | healthy |
| 999 | heartbeat | n/a | 第 1 天 | healthy |
| 1234 | heartbeat | n/a | 第 1 天 | healthy |
| 5678 | heartbeat | n/a | 第 1 天 | healthy |
| 31415 | heartbeat | n/a | 第 1 天 | healthy |
| 27182 | heartbeat | n/a | 第 1 天 | healthy |
| 11111 | heartbeat | n/a | 第 1 天 | healthy |
| 99999 | heartbeat | n/a | 第 1 天 | healthy |

## 结论

算法的心跳机制 (heartbeat: 20% sample exposure) 在被误判后能让 marker 重新被发现, 收到正确的 like 信号后 healthScore 转正, 状态升回 healthy/borderline. 这是产品上的关键安全网 — 防止误举报永久压制好内容.
