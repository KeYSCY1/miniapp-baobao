// 本地模拟服务员端流程：getSingers -> 选歌手 -> recordRequest
const path = require('path')
process.env.MOCK_OPENID = 'waiter_openid_1'

const cloud = require('wx-server-sdk')
// 预填充 Users 数据
cloud.__collections.Users['waiter_openid_1'] = { role: 'waiter', displayName: '测试服务员' }
cloud.__collections.Users['singer_openid_A'] = { role: 'singer', displayName: '歌手A' }
cloud.__collections.Users['singer_openid_B'] = { role: 'singer', displayName: '歌手B' }

const getSingers = require(path.resolve(__dirname, '../cloud/functions/getSingers/index.js'))
const recordRequest = require(path.resolve(__dirname, '../cloud/functions/recordRequest/index.js'))

async function run() {
  console.log('=== 调用 getSingers ===')
  const gs = await getSingers.main({}, {})
  console.log('getSingers result:', gs)

  const singers = (gs && gs.singers) || []
  if (singers.length === 0) {
    console.log('no singers available')
    return
  }
  const chosen = singers[0]
  console.log('chosen singer:', chosen)

  console.log('\n=== 提交点歌请求 ===')
  const ev = { requestId: 'wf_req_1', singerId: chosen.id, title: '北京欢迎你', artist: '群星', requesterName: '服务员小张', tableId: 'B2' }
  const rr = await recordRequest.main(ev, {})
  console.log('recordRequest result:', rr)

  console.log('\n=== RequestEntries in mock DB ===')
  console.log(cloud.__collections.RequestEntries)
}

run().catch(e=>{ console.error(e); process.exit(1) })
