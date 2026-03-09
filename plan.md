# 微信小程序 — 酒吧歌手与服务员点歌计划

## 概要
目标：为酒吧歌手与服务员实现一款微信小程序，满足：
- 歌手记录每日演唱并统计每首歌频次；
- 服务员代表顾客点歌（输入歌曲名/歌手名/桌号），点歌功能仅对 `waiter` 生效；
- 歌手可实时查看点歌请求，并对每条请求做出操作：加入“今日待唱”或标记为“不会唱”；
- 歌手可维护“会唱曲目”（`knownSongs`），服务员可快速选择；
- 系统支持高频歌曲自动加入“待学习”清单（可配置窗口与阈值）。

技术栈建议：微信云开发（云函数 + 云数据库），小程序原生前端（可选 Taro/uni-app 跨端）。

---

## 实施步骤（高层）
1. 需求确认与角色定义（`singer`, `waiter`）。
2. 数据库 schema 设计与索引。 
3. 云函数 / API 设计与实现（含权限校验）。
4. 前端页面开发（歌手端 + 服务员端）与实时订阅。
5. 自动化规则（高频 -> ToLearn）与去重策略。 
6. 测试、部署、文档与上线。

---

## 里程碑与估时（单人开发估计）
- 第 1 周：需求细化、schema、云函数骨架、基础录入/点歌页面。
- 第 2 周：实时订阅、歌手响应流程、TodayPlaylist、knownSongs 管理。
- 第 3 周：阈值规则、导出/备份、权限硬化、测试与修正。
总计：约 2–3 周（按优先级可迭代发布）。

---

## 数据模型（cloud database collections）
- `Users`
  - `id` (string) — 主键
  - `openid` (string) — 微信登录标识
  - `displayName` (string)
  - `role` ("singer" | "waiter")
  - `knownSongs` (array of { songId?, title, artist }) — 歌手会唱列表
  - `createdAt`, `updatedAt`

- `Songs`（可选标准库）
  - `songId`, `title`, `artist`, `extraNotes`, `createdAt`

- `SingingEntries`（歌手演唱记录）
  - `entryId`, `singerId`, `songId?`, `title`, `artist`, `date`(ISO), `duration?`, `notes?`, `createdAt`

- `RequestEntries`（服务员点歌记录）
  - `requestId`, `singerId`, `songId?`, `title`, `artist`, `waiterId`, `waiterName?`, `tableNumber`, `date`, `status` (`pending`|`accepted`|`rejected`), `singerAction` (`added_today`|`marked_cannot_sing`|null), `operatorOpenid`, `createdAt`, `updatedAt`

- `TodayPlaylist`（今日待唱）
  - `id`, `singerId`, `songId?`, `title`, `artist`, `sourceRequestId?`, `addedBy` (`singer` | `system`), `position` (number), `status` (`todo`|`done`), `createdAt`

- `ToLearn`（待学习/高频）
  - `id`, `singerId`, `songId?`, `title`, `artist`, `reason`, `count`, `windowDays`, `addedAt`, `status`

说明：在 `RequestEntries` 中同时保存明文 `title/artist`，避免对 `Songs` 表的强依赖并保持历史一致性。

---

## 云函数 / API 列表与职责
- `recordSinging(payload)`
  - 输入: `{ singerId, title, artist, date?, duration?, notes? }`
  - 权限: 仅 `singer` 自己或系统可调用
  - 操作: 写 `SingingEntries`，可触发 `evaluateToLearn`（延迟或同步）

- `recordRequest(payload)`
  - 输入: `{ singerId, title, artist, tableNumber, waiterId }`
  - 权限: 仅 `waiter`（后端校验 caller 的 role）
  - 操作: 写 `RequestEntries` (status=pending)，返回 `{ requestId, status }`；实施去重策略（同一桌同歌 5 分钟内视为重复）

- `getPendingRequests(params)`
  - 输入: `{ singerId, statusFilter?, limit?, since? }`
  - 操作: 歌手拉取其未处理或指定状态的点歌列表

- `singerRespondRequest(payload)`
  - 输入: `{ requestId, action }`，action ∈ { `accept`, `reject` }
  - 权限: 仅对应 `singerId` 的歌手能操作
  - 操作: 更新 `RequestEntries.status` 与 `singerAction`；若 `accept`，则写入 `TodayPlaylist` 并返回 `todayPlaylistId`

- `getSingerKnownSongs(singerId)` / `updateSingerKnownSongs(payload)`
  - 管理 `knownSongs`，便于服务员快速选歌

- `evaluateToLearn(singerId, windowDays, threshold)`
  - 作用: 聚合窗口内 `SingingEntries` + `RequestEntries`（或以 `title+artist` 标准化后）统计次数，超过阈值则写入/更新 `ToLearn`
  - 触发: 可由定时器（每日）或在写操作后异步触发

- `exportCSV(params)`（可选）
  - 导出时间范围内的记录，供备份/数据分析

所有写操作统一记录 `operatorOpenid`、`createdAt`、`updatedAt`，返回 JSON。错误应返回标准化错误对象 `{ code, message }`。

---

## 权限与安全策略
- 认证：微信小程序 `wx.login` -> 云函数换取 `openid`，云端以 `openid` 识别用户并读取 `Users.role`。
- 后端强校验：无论前端如何控制，后端云函数必须校验 `callerOpenid` 与 `Users.role`；`recordRequest` 仅在 `role == waiter` 时允许写入。
- 最小权限原则：歌手只能读取/操作其相关条目；服务员只能读取自己提交的请求与目标歌手的 `knownSongs`。
- 审计日志：所有写入记录 `operatorOpenid` 以便追踪与调试。

---

## 前端页面（最小集合）
- 歌手端：
  - `home`：今日演唱摘要、快速录入按钮、今日待唱预览
  - `request_singer`：点歌队列（实时订阅），每条显示：歌曲名、歌手名、桌号、服务员名、时间、操作按钮 `加入今日待唱` / `标记不会唱`
  - `today_playlist`：今日待唱，可调整顺序与标记已唱
  - `known_songs`：管理 `knownSongs`
  - `statistics`：按歌/按时间窗口查看频率

- 服务员端（手机）：
  - `request_waiter`：快速点歌表单（title, artist, tableNumber），可选择目标歌手并从其 `knownSongs` 快速选择
  - `my_requests`：服务员查看自己提交的请求及状态

交互要点：
- 点歌提交后返回 `requestId` 与即时状态；歌手端通过实时订阅或短轮询立即可见；歌手处理后服务员端显示更新状态。

---

## 实时同步与通知
- 推荐使用云数据库实时订阅（小程序端 subscribe）以获得 `RequestEntries` 状态变化推送。歌手端订阅 `RequestEntries`（filter: singerId && status==pending）。
- 可选：使用微信订阅消息在关键事件（歌手 accept/reject）时通知对应服务员（需授权模板消息权限）。

---

## 业务规则与边界条件
- 仅 `waiter` 可点歌（前后端校验）。
- 去重策略：同一桌同一歌曲在短时间（默认 5 分钟，可配置）内视为重复，支持合并或忽略策略。
- 歌手 `accept` 后才将请求加入 `TodayPlaylist`。
- 歌手 `reject` 时记录为 `marked_cannot_sing`，并可触发通知给服务员。
- `knownSongs` 由歌手维护，服务员可读取以减少输入错误。

---

## 自动化规则与统计
- 高频自动加入 `ToLearn`：默认窗口 `30` 天，阈值 `>=7` 次（可配置）。
- 实现方式：聚合 `SingingEntries` 与 `RequestEntries`（按 `title+artist` 规范化）在时间窗口内计数，超过阈值写入或更新 `ToLearn`。
- 触发时机：推荐每日定时任务或在写操作后异步触发，防止同步性能影响。

---

## 索引与性能建议
- `RequestEntries` 建索引： `{ singerId:1, status:1, createdAt:-1 }`。
- `TodayPlaylist` 建索引： `{ singerId:1, status:1, position:1 }`。
- `SingingEntries` 建索引： `{ singerId:1, date:1 }` 以便统计查询。

---

## 测试用例（关键路径）
1. 权限测试：非 `waiter` 不能 `recordRequest`；非 `singer` 不能响应歌手接口。
2. 流程测试：服务员提交 -> 歌手实时接收 -> 歌手 `accept` -> `TodayPlaylist` 出现 -> 服务员看到状态变更。
3. 去重测试：同一桌短时重复点歌合并/忽略行为正确。
4. 自动化测试：在窗口内生成超过阈值事件，验证 `ToLearn` 创建。
5. 导出测试：CSV 导出格式与内容完整性。

---

## 错误处理与恢复策略
- 网络中断：服务员端实现短期本地缓存与重试机制；避免重复写入需使用唯一 requestId 或幂等 token。
- 数据不一致：`RequestEntries` 保留明文 `title/artist`，避免 Songs 表变更影响历史记录展示。
- 并发：写入使用事务或乐观锁以防止重复创建 `ToLearn` 或 `TodayPlaylist` 条目。

---

## 交付物清单（建议）
- `cloud/functions/`：
  - `recordSinging.js`
  - `recordRequest.js`
  - `singerRespondRequest.js`
  - `evaluateToLearn.js`
  - `exportCSV.js`（可选）

- `cloud/database/schema.md`：字段说明与 JSON 示例（建议作为下一步生成）
- `miniprogram/pages/`：
  - `home/`, `request_waiter/`, `request_singer/`, `today_playlist/`, `known_songs/`, `statistics/`
- `README.md`：部署与测试说明、微信订阅消息配置等

---

## 示例接口交互（示例请求/返回）
- `recordRequest` 请求体：
```json
{ "singerId": "s123", "title": "至少还有你", "artist": "SingerA", "tableNumber": "A12", "waiterId": "w456" }
```
- `recordRequest` 返回：
```json
{ "requestId": "r789", "status": "pending", "createdAt": "2026-03-09T12:00:00Z" }
```
- `singerRespondRequest` 请求体：
```json
{ "requestId": "r789", "action": "accept" }
```
- 返回：
```json
{ "requestId": "r789", "status": "accepted", "todayPlaylistId": "p001" }
```

---

## 下一步建议（二选一或组合）
- 生成 `cloud/database/schema.md`（含 JSON 示例与索引配置）。
- 生成云函数伪代码（Node.js 风格，含权限校验与 DB 操作示例）。
- 生成小程序前端核心页面示例（WXML + JS）用于歌手点歌队列与服务员点歌表单。

请回复你要我接着生成的项，例如：`schema`、`functions`、`frontend` 或组合（例如 `schema,functions`）。
