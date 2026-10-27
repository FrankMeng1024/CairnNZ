# Memory 写入权限表（冻结候选统一提交边界）

| 状态 | 唯一生产者 / 持有身份 | 消费者 | 提交资格 | 必须终止为 |
|---|---|---|---|---|
| account/auth incarnation | `useAppStore` 登录代际 | 全部 Memory stores/requests | viewer id 与登录代际都匹配 | active / retired |
| Memory navigation session | Memory flow owner | snapshot、scene、camera | session id 仍为 current | active / exited |
| 每好友 UI intent | checkbox 操作的 selection generation | picker、scope、visibility | 最新 per-source intent generation | selected / deselected |
| 每好友 server-confirmed selection | POST/DELETE ACK 或因果更新的 authority read | visibility selector、durable retry | account + source + mutation/read fence 匹配 | confirmed selected / confirmed deselected / uncertain queued |
| grant/episode/version/scope/proof | `/sources`、snapshot、renewal，按 grant identity | friend cache 与 visibility | 同 viewer/source/grant/episode/version/scope 且 proof 未过期 | valid / expired / revoked |
| coverage acquisition/cache | prepared Mine/Friend snapshot store | semantic partition、city index、Fog | account + session + source + grant + acquisition generation，且完整性成立 | complete-empty / complete-data / error / cancelled |
| scene/scope/loader/error | presentation coordinator | Memory UI、Fog | current target identity；camera 不参与 data target | ready / error-with-cache / error-without-cache / cancelled |
| camera | 最新明确 camera action | Mapbox Camera | action id 最新；数据回包无权写 camera | applied / superseded / cancelled |
| requests/queues/timers/hydrate | 各 owner 的 bounded coordinator | 对应 store | identity-fenced single-flight；旧 finally 不能释放新锁 | success / failure / timeout / cancelled |

统一规则：响应晚到和 HTTP 200 都不是提交资格。读回只能更新 grant authority 以及读取开始后未发生新选择提交的 source；选择 mutation 只能更新自己的 source，且 ACK 必须回显同一 selection chain/sequence/request；任何跨 account/session/grant/selection generation 的结果均丢弃或触发一次有界、身份明确的协调读取，不能直接改写当前 target。
