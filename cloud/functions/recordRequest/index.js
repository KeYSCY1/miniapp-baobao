// recordRequest 云函数
// 负责接收服务员点歌请求，进行权限校验、幂等与去重，并写入 RequestEntries

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

/**
 * event 示例: {
 *   requestId, singerId, title, artist, requesterName, tableId,
 *   dedupWindowMinutes (可选，默认 5)
 * }
 */
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const operatorOpenid = wxContext.OPENID

  if (!operatorOpenid) return { success: false, error: 'NO_OPENID' }

  const { requestId: clientRequestId, singerId, title, artist, requesterName, tableId } = event || {}
  if (!singerId || !title) return { success: false, error: 'MISSING_FIELDS', message: 'singerId/title required' }

  // 校验用户角色（只有 waiter 或 admin 可提交请求）
  try {
    const userDoc = await db.collection('Users').doc(operatorOpenid).get()
    const role = userDoc && userDoc.data && userDoc.data.role
    if (!role || (role !== 'waiter' && role !== 'admin')) {
      return { success: false, error: 'FORBIDDEN', message: 'only waiter or admin can create requests' }
    }
  } catch (e) {
    return { success: false, error: 'USER_CHECK_FAILED', detail: e.message }
  }

  const now = new Date()
  const requestId = clientRequestId || `r_${now.getTime()}_${Math.random().toString(36).slice(2,8)}`

  // 幂等：若存在相同 requestId 则直接返回
  try {
    const existing = await db.collection('RequestEntries').where({ requestId }).get()
    if (existing && existing.data && existing.data.length > 0) {
      return { success: true, requestId, duplicate: false, existing: existing.data[0] }
    }
  } catch (e) {
    // 继续尝试插入，但记录错误
    console.warn('idempotency check failed', e.message)
  }

  // 去重：查找在窗口期内相同 singerId+title+artist 的请求
  const windowMinutes = (event && event.dedupWindowMinutes) || 5
  const cutoff = new Date(Date.now() - windowMinutes * 60 * 1000)
  try {
    const dupQuery = await db.collection('RequestEntries').where({
      singerId,
      title,
      artist,
      createdAt: _.gte(cutoff)
    }).orderBy('createdAt', 'desc').limit(1).get()

    if (dupQuery && dupQuery.data && dupQuery.data.length > 0) {
      // 发现重复：插入一条记录但标记 duplicateOf
      const base = dupQuery.data[0]
      const doc = {
        requestId,
        singerId,
        title,
        artist,
        requesterName: requesterName || null,
        tableId: tableId || null,
        status: 'pending',
        duplicateOf: base.requestId || null,
        operatorOpenid,
        createdAt: now,
        updatedAt: now
      }
      const insertRes = await db.collection('RequestEntries').add({ data: doc })
      return { success: true, requestId, duplicate: true, duplicateOf: base.requestId, insertedId: insertRes._id }
    }
  } catch (e) {
    console.warn('dedup check failed', e.message)
  }

  // 非重复：插入新请求
  try {
    const newDoc = {
      requestId,
      singerId,
      title,
      artist,
      requesterName: requesterName || null,
      tableId: tableId || null,
      status: 'pending',
      duplicateOf: null,
      operatorOpenid,
      createdAt: now,
      updatedAt: now
    }
    const res = await db.collection('RequestEntries').add({ data: newDoc })
    return { success: true, requestId, insertedId: res._id }
  } catch (e) {
    return { success: false, error: 'DB_INSERT_FAILED', detail: e.message }
  }
}
