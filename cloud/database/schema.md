# 数据库 Schema 设计（cloud database）

目标：支持 `singer` / `waiter` 的点歌流程，保证去重、幂等、统计和导出能力，并支持 TodayPlaylist 与 ToLearn 规则。

注意：字段名采用驼峰风格，所有时间字段均为 ISO8601 字符串或数据库 `Date` 类型，写入时带 `createdAt` / `updatedAt`。

---

## Collections 概览

- `Users` — 系统用户（歌手/服务员/管理员）
- `RequestEntries` — 服务员提交的点歌请求（主数据）
- `TodayPlaylist` — 歌手当天待唱列表（已被歌手接受的请求/手动添加）
- `SingingEntries` — 实际演唱记录（历史，用于统计与导出）
- `KnownSongs` — 歌手已掌握曲目库（可按歌手分组）
- `ToLearn` （可选/视图）— 高频待学曲目列表（由统计任务生成）

---

## `Users`

用途：存储用户身份与角色，用于权限校验。

示例文档：
{
  "_id": "openid_123",
  "role": "singer",        // 'singer' | 'waiter' | 'admin'
  "displayName": "小明",
  "avatarUrl": "https://...",
  "createdAt": "2026-03-09T10:00:00Z",
  "updatedAt": "2026-03-09T10:00:00Z"
}

建议索引：
- `_id`（默认主键）
- `role`

---

## `RequestEntries`

用途：保存每一次服务员点歌请求（原始记录，保留冗余 title/artist 以便历史回溯）。

字段说明：
- `requestId` (string) — 客户端生成的幂等 ID（建议 UUID）
- `singerId` (string) — 目标歌手的 `_id`（Users）
- `title` (string), `artist` (string)
- `requesterName` (string) — 服务员或点歌人备注
- `tableId` (string) — 可选，归属桌号/位置
- `status` (string) — 'pending' | 'accepted' | 'rejected' | 'cancelled'
- `duplicateOf` (string|null) — 若被视为重复则指向被合并的 requestId
- `operatorOpenid` (string|null) — 最后一次修改该记录的操作者（歌手/系统）
- `createdAt`, `updatedAt` (Date)

示例：
{
  "requestId":"r_6f7a8b",
  "singerId":"openid_123",
  "title":"月亮代表我的心",
  "artist":"邓丽君",
  "requesterName":"A 服务员",
  "tableId":"T12",
  "status":"pending",
  "duplicateOf": null,
  "operatorOpenid": null,
  "createdAt":"2026-03-09T10:05:00Z",
  "updatedAt":"2026-03-09T10:05:00Z"
}

建议索引：
- `{ singerId: 1, status: 1, createdAt: -1 }` — 快速拉取 pending
- `{ requestId: 1 }` — 幂等校验
- `{ singerId: 1, title: 1, artist: 1, createdAt: -1 }` — 去重/合并检索

去重逻辑建议：
- 客户端应发送 `requestId`（UUID）以保证幂等。
- 服务端额外在时间窗口（默认 5 分钟）内按 singerId + title + artist 检查重复。
- 重复时：可选择 `ignore`（返回已存在 ID）或 `merge`（将新元数据合并到已有记录并增加计数/notes）。推荐设置为 `merge` 并在 `duplicateOf` 字段保留指向。

---

## `TodayPlaylist`

用途：歌手当天的可操作播放列表（按 position 排序）。

字段：
- `_id`（自动）
- `singerId` (string)
- `sourceRequestId` (string|null) — 若由 RequestEntries 接受则指向该 requestId
- `title`, `artist`, `requestedBy`（冗余字段）
- `status` — 'queued' | 'playing' | 'played' | 'skipped'
- `position` (number) — 列表顺序
- `createdAt`, `updatedAt`, `operatorOpenid`

示例：
{
  "singerId":"openid_123",
  "sourceRequestId":"r_6f7a8b",
  "title":"月亮代表我的心",
  "artist":"邓丽君",
  "requestedBy":"A 服务员",
  "status":"queued",
  "position":1,
  "createdAt":"2026-03-09T10:10:00Z"
}

建议索引：
- `{ singerId: 1, position: 1 }`
- `{ singerId: 1, status: 1 }`

并发控制：
- 修改 `position` 或接受请求时，应使用事务（若云 DB 支持）或实现乐观锁（检查 `updatedAt`）。

---

## `SingingEntries`

用途：记录实际已演唱曲目（用于统计、ToLearn 与导出）。

字段：
- `singerId`, `title`, `artist`, `sourcePlaylistId` 或 `sourceRequestId`
- `duration`（可选），`auditedBy`（可选）
- `createdAt`（演唱时间）

示例：
{
  "singerId":"openid_123",
  "title":"月亮代表我的心",
  "artist":"邓丽君",
  "sourceRequestId":"r_6f7a8b",
  "createdAt":"2026-03-09T10:30:00Z"
}

建议索引：
- `{ singerId:1, createdAt: -1 }`
- `{ singerId:1, title:1, artist:1 }` — 用于频率统计

---

## `KnownSongs`

用途：歌手已知曲目表，供 ToLearn 排除与匹配。

字段：
- `singerId`, `title`, `artist`, `notes`, `createdAt`, `updatedAt`

示例：
{
  "singerId":"openid_123",
  "title":"月亮代表我的心",
  "artist":"邓丽君",
  "notes":"常客点歌",
  "createdAt":"2026-03-01T10:00:00Z"
}

建议索引：
- `{ singerId:1, title:1, artist:1 }`（唯一约束）

---

## ToLearn 统计与表/视图

- `ToLearn` 可作为定期任务输出到单独 collection，或通过聚合视图（按需生成）。
- 默认规则（可配置）: 时间窗口 30 天，阈值 >=7 次，且不在 `KnownSongs` 中。

示例聚合伪 SQL / Aggregation：
1. 在 `SingingEntries` 或 `RequestEntries`（被接受）中按 `title,artist` 聚合计数，筛选时间窗口与 singerId。
2. 排序取 count >= 阈值，排除 `KnownSongs` 中存在的曲目。

建议索引：
- `{ singerId:1, createdAt:1 }` 在原始表上以便快速范围扫描。

---

## 审计与权限

- 所有写操作记录 `operatorOpenid` 与 `createdAt`/`updatedAt`。
- 写操作均由云函数执行并校验 `Users.role`（例如：只有 `waiter` 可创建 RequestEntries，只有 `singer` 可 accept/reject 并写入 TodayPlaylist，`admin` 可导出）。

---

## 导出/备份建议

- 导出为 CSV 时字段：`createdAt, singerId, title, artist, requesterName, tableId, status`。
- 备份：定期把集合导出到云存储（例如按天分片 `backups/YYYY-MM-DD/*.json`）。

---

## 示例常用查询

- 拉取歌手 pending 请求：
  - find RequestEntries where `singerId=... AND status='pending'`，按 `createdAt` 降序。
- 歌手当天播放列表：
  - find TodayPlaylist where `singerId=...`，按 `position` 升序。
- 生成 ToLearn 列表：
  - 在 RequestEntries 或 SingingEntries 上按 `title,artist` 聚合计数并过滤窗口与阈值。

---

## 可选扩展

- `RequestCounts` 缓存表：用于高频统计，减少聚合压力。
- 支持 `requestSource`（小程序/扫码/后台）以便后续分析。

---

保存位置：建议将此文件放在项目中：[cloud/database/schema.md](cloud/database/schema.md)。

如需，我可以现在把该设计转换为迁移脚本或云端索引创建脚本（例如用于微信云 DB 索引配置）。
