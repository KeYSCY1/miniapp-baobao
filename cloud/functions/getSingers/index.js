const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  // 尝试标准 DB 查询；若运行在本地 mock 环境，回退到 cloud.__collections.Users
  try {
    const res = await db.collection('Users').where({ role: 'singer' }).get()
    const list = (res && res.data) ? res.data.map(u => ({ id: u._id || u.openid || null, displayName: u.displayName || '歌手' })) : []
    if (list.length > 0) return { success: true, singers: list }
  } catch (e) {
    // 忽略，尝试 fallback
  }

  // fallback for mock: check internal collections if available
  try {
    const internal = cloud.__collections && cloud.__collections.Users
    if (internal) {
      // internal may be object map or array
      if (Array.isArray(internal)) {
        const list = internal.filter(u => u.role === 'singer').map(u => ({ id: u._id || u.openid || null, displayName: u.displayName || '歌手' }))
        return { success: true, singers: list }
      } else {
        const list = Object.keys(internal).filter(k => internal[k] && internal[k].role === 'singer').map(k => ({ id: k, displayName: internal[k].displayName || '歌手' }))
        return { success: true, singers: list }
      }
    }
  } catch (e) {
    // ignore
  }

  return { success: true, singers: [] }
}
