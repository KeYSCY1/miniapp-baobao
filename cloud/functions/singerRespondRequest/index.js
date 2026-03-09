// singerRespondRequest 云函数
// 处理歌手接受/拒绝请求；接受时写入 TodayPlaylist 并更新 RequestEntries 状态

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

/**
 * event 示例: { requestId, action: 'accept'|'reject' }
 */
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const operatorOpenid = wxContext.OPENID
  if (!operatorOpenid) return { success: false, error: 'NO_OPENID' }

  const { requestId, action } = event || {}
  if (!requestId || !action) return { success: false, error: 'MISSING_FIELDS' }
  if (action !== 'accept' && action !== 'reject') return { success: false, error: 'INVALID_ACTION' }

  // 检查操作者是否为该歌手或 admin
  try {
    const userDoc = await db.collection('Users').doc(operatorOpenid).get()
    const role = userDoc && userDoc.data && userDoc.data.role
    if (!role) return { success: false, error: 'USER_NOT_FOUND' }
    if (role !== 'singer' && role !== 'admin') return { success: false, error: 'FORBIDDEN', message: 'only singer or admin can respond' }
  } catch (e) {
    return { success: false, error: 'USER_CHECK_FAILED', detail: e.message }
  }

  // 查找请求
  let req
  try {
    const q = await db.collection('RequestEntries').where({ requestId }).get()
    if (!q || !q.data || q.data.length === 0) return { success: false, error: 'REQUEST_NOT_FOUND' }
    req = q.data[0]
  } catch (e) {
    return { success: false, error: 'DB_QUERY_FAILED', detail: e.message }
  }

  if (req.status !== 'pending') {
    return { success: false, error: 'INVALID_STATUS', message: `request already ${req.status}` }
  }

  const now = new Date()

  // 处理拒绝
  if (action === 'reject') {
    try {
      await db.collection('RequestEntries').where({ requestId }).update({ data: { status: 'rejected', operatorOpenid, updatedAt: now } })
      return { success: true, requestId, action: 'rejected' }
    } catch (e) {
      return { success: false, error: 'DB_UPDATE_FAILED', detail: e.message }
    }
  }

  // 处理接受：写入 TodayPlaylist 并更新 RequestEntries.status=accepted
  try {
    // 计算 position（取当前最大 position + 1）
    const last = await db.collection('TodayPlaylist').where({ singerId: req.singerId }).orderBy('position', 'desc').limit(1).get()
    let position = 1
    if (last && last.data && last.data.length > 0 && last.data[0].position) {
      position = last.data[0].position + 1
    }

    const playlistDoc = {
      singerId: req.singerId,
      sourceRequestId: req.requestId,
      title: req.title,
      artist: req.artist,
      requestedBy: req.requesterName || null,
      status: 'queued',
      position,
      operatorOpenid,
      createdAt: now,
      updatedAt: now
    }
    const insertRes = await db.collection('TodayPlaylist').add({ data: playlistDoc })

    await db.collection('RequestEntries').where({ requestId }).update({ data: { status: 'accepted', operatorOpenid, updatedAt: now } })

    return { success: true, requestId, action: 'accepted', playlistId: insertRes._id }
  } catch (e) {
    return { success: false, error: 'PROCESS_FAILED', detail: e.message }
  }
}
