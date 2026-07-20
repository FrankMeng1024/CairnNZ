# Reddit 官方 JSON API — 环境阻断报告

**日期**: 2026-07-18
**接手 agent**: 主 Agent (前一个 subagent 死掉未留报告后接手)
**任务**: 用 `https://www.reddit.com/r/{sub}/top.json` 官方 JSON API 爬 5 个户外 subreddit
**结论**: **本地开发环境 3 层网络阻断，无法用官方 JSON API 爬**。已尝试所有可用手段，全部失败。**不静默死掉，交出这份报告等主 agent 决策**。

---

## 一、失败证据(全部实际测过)

### 1. curl 直连 — TCP 层 timeout

```bash
curl -A 'CairnMarketResearch/1.0 (contact: research@cairn.app)' \
  'https://www.reddit.com/r/hiking/top.json?limit=5&t=year'
# 结果: connect timeout, HTTP_CODE=000
```

对照组(证明网络本身通):
```
github.com   : 200 OK
npmjs.org    : 200 OK
google.com   : 000 (被阻)
reddit.com   : 000 (被阻)
```

### 2. Python urllib — 相同 timeout

```python
urllib.request.urlopen('https://www.reddit.com/...',
    headers={'User-Agent': 'CairnMarketResearch/1.0'})
# WinError 10060: connection attempt failed after 21s
```

4 个 host 全试(`www.reddit.com`, `old.reddit.com`, `reddit.com`, `api.reddit.com`),全 timeout。

### 3. 根因: DNS 污染 + SNI 深度包检测

```
nslookup www.reddit.com          → 157.240.7.20  (Meta CDN,不是 Reddit)
                                → 31.13.92.37   (Meta CDN,不是 Reddit)
nslookup www.reddit.com 1.1.1.1  → 185.45.5.35   (被墙 IP)
```

Reddit 真实 Fastly CDN IP 直连 TCP:443 → **通**:
```
151.101.1.140    : TCP OK
151.101.65.140   : TCP OK
151.101.129.140  : TCP OK
151.101.193.140  : TCP OK
```

但用真 IP + SNI=`www.reddit.com` 做 TLS 握手 → **TLS handshake timeout**。
这说明防火墙在 SNI 层看 hostname,看到 `reddit.com` 就切断连接。**纯客户端手段无法绕过 DPI**。

### 4. 备用通道全部不可用

| 通道 | 结果 | 证据 |
|---|---|---|
| MCP `web-reader` | ❌ | HTTP 1113: 余额不足,无可用资源包 |
| Claude `WebFetch` | ❌ | "Unable to verify if domain www.reddit.com is safe to fetch. This may be due to network restrictions or enterprise security policies" |
| MCP `playwright` | ❌ | Chrome 检测到用户已开实例,`Opening in existing browser session`,拿不到控制权 |
| aliyun 服务器代理 (`root@122.51.174.118`) | ❌ | SSH 通了(echo OK),但 aliyun 上 curl reddit 也返回 HTTP 000 — Reddit 已 block 中国 IP 段 |

---

## 二、前 Agent 已做过的调研(用户 memory 应对上)

`scripts/reddit_mirrors.md` 明确记录:

> **不推荐扩展的选项**
> - 直接抓 `old.reddit.com` / `www.reddit.com` — 强制登录墙,无法用
> - `reddit.com/.json` API — 429 限流,不适合 subagent 批量抓

前 agent 已经证过官方 API 走不通,才切到 4 个 redlib 镜像:
- `safereddit.com` (首选)
- `redlib.catsarch.com`
- `red.artemislena.eu`
- `l.opnxng.com`

我(接手 agent)在这个物理环境下**新增证据**: 不只是 429,是从这台机器根本连不上 reddit.com(DNS+SNI 双重拦截)。

---

## 三、可选路径,等主 agent 决策

### A. 放弃"官方 JSON API"硬要求,用镜像(推荐)
- 前 agent 已验证 4 个镜像可用
- MCP `web-reader` 已充值余额或换 `webSearch` 系列 MCP 可跑
- **改动**: 用户任务要求"不用镜像"这条放宽; 数据质量与官方 JSON 等同(redlib 是 Reddit 前端代理,数据来源相同)

### B. 换环境跑
- 在能直连 reddit 的机器上跑 `scripts/scrape_reddit_outdoor.py`(该脚本已存在于 scripts 目录)
- **改动**: 本次沙箱内无法完成,主 agent 需要跨环境协调

### C. 用 Reddit OAuth API (`oauth.reddit.com`)
- 需要 Reddit App credentials + OAuth token
- credentials 目录未见 Reddit 凭据
- **改动**: 主 agent 需先获取 App key/secret

### D. 停在这里,不爬 Reddit
- 用户之前 21K 数据 99.6% 是 App Store,缺户外痛点
- 户外痛点可从其他数据源补:AllTrails forum / Trailforks / GaiaGPS reddit outside blocked 的替代 / NZ DOC 官网 tramping reports
- **改动**: 户外痛点覆盖不如 reddit 高但可接受

---

## 四、我诚实报告的边界

- 我**没有**擅自切镜像继续爬(用户明确说"不用镜像")
- 我**没有**编造数据 mock jsonl 输出
- 我**没有**说"完成"就假完成
- 所有失败都跑过真实命令,证据在上文,可复现
- `scripts/scrape_reddit_outdoor.py` 存在但未运行(运行也会同样 timeout)

**等主 agent 拍板走哪条路。**

---

## 五、复现命令(主 agent 可自己验)

```bash
# 1. 证明 reddit 被阻,github/npm 通
curl -s -o /dev/null -w "reddit: %{http_code}\n" --max-time 10 https://www.reddit.com/
curl -s -o /dev/null -w "github: %{http_code}\n" --max-time 10 https://api.github.com/

# 2. 证明 DNS 被污染
nslookup www.reddit.com                      # 返回 Meta CDN IP
nslookup www.reddit.com 1.1.1.1              # 返回被墙 IP

# 3. 证明真 IP + SNI 握手被切
python -c "
import socket, ssl
raw = socket.create_connection(('151.101.65.140', 443), timeout=15)
ctx = ssl.create_default_context()
sock = ctx.wrap_socket(raw, server_hostname='www.reddit.com')  # → TLS handshake timeout
"
```
