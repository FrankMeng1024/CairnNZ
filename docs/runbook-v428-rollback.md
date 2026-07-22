# v428 Rollback Runbook

**When to use**: v428 上线后发现 blocker,需要紧急回退到 v427。

## 症状 → 决定回退

如果生产报告以下之一,立即执行本 runbook:
- 用户报告 memory tab 无法打开 (5+ 用户)
- 面板显示错误名字 (e.g., "Shanghaishi" 未清洗) 或空白
- 高亮 layer 崩溃 Mapbox
- Backend `/api/hierarchy/deepest` p95 > 5s
- MySQL spatial index build 失败 / 死锁

## Rollback 步骤 (3-5 分钟)

### 1. 后端回退 (数据 + code)

```bash
# SSH 到阿里云
ssh root@122.51.174.118

# a. 回滚数据库 regions 表 (drop v428 版本)
docker exec ainews-db mysql -uroot -p'<pw>' cairn -e "
  DROP TABLE IF EXISTS regions_v428_backup;
  RENAME TABLE regions TO regions_v428_backup;
"

# b. 从 v427 SQL 恢复 (若保留了 v427 seed 文件)
# 或者跑 v427 seed 脚本重建
cd /var/www/cairn-backend
git checkout v427-tag  # 或 commit sha
docker cp backend/scripts/seed-hierarchy/regions.sql ainews-db:/tmp/regions-v427.sql
docker exec ainews-db bash -c "mysql -uroot -p'<pw>' cairn < /tmp/regions-v427.sql"

# c. Restart backend 加载 v427 code
docker restart cairn-backend

# d. 验证
curl https://api.yiiling.cn/api/hierarchy/panel?region_id=world \
     -H "Authorization: Bearer <test-token>" | jq .
# 应返回 v427 shape (state ∈ 'explored'/'locked', 无 marker_count)
```

### 2. Client 回退 (OTA)

```bash
# 本地 checkout v427 commit
cd C:/ClaudeCodeProjects/Cairn/app
git checkout <v427-commit-sha>

# 发 v429 OTA (回退到 v427 client bundle)
# v429 版本号,但 payload 是 v427 code
# 修 OTA_VERSION 428 → 429
git commit -am "v429 rollback: revert to v427 client bundle"
git push origin master
npx eas update --branch production --message "v429 rollback: back to v427"
```

## 数据保留

- `regions_v428_backup` 表保留 7 天,用于 forensic 分析
- v428 seed 相关文件 (`_review/v428-plan/*`) 已归档,不删
- `tmp/` 下载源可以 restore 需要时重跑 `download.js`

## Recovery post-mortem

回退后必须写:
- `_review/v428-postmortem.md` — 什么坏了,为什么 4-eye 没抓到,下次 v428.1 怎么防
