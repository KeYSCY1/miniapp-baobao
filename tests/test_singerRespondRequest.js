// 本地测试 singerRespondRequest 云函数（使用 mock wx-server-sdk）
const path = require('path')
process.env.MOCK_OPENID = 'waiter_openid_1'

const cloud = require('wx-server-sdk')
// 预填充 Users 数据
cloud.__collections.Users['waiter_openid_1'] = { role: 'waiter', displayName: '测试服务员' }
cloud.__collections.Users['singer_openid_1'] = { role: 'singer', displayName: '测试歌手' }

// 引入被测函数和 recordRequest
const recordFn = require(path.resolve(__dirname, '../cloud/functions/recordRequest/index.js'))
const respFn = require(path.resolve(__dirname, '../cloud/functions/singerRespondRequest/index.js'))

async function run() {
  console.log('=== 创建请求（由服务员提交） ===')
  const ev1 = { requestId: 'req_for_singer_1', singerId: 'singer_openid_1', title: '情人的眼泪', artist: '歌手A', requesterName: '服务员A', tableId: 'T1' }
  const r1 = await recordFn.main(ev1, {})
  console.log('record result:', r1)

  console.log('\n=== 歌手拒绝（非法操作：用非歌手身份） ===')
  process.env.MOCK_OPENID = 'waiter_openid_1'
  const r_reject_bad = await respFn.main({ requestId: 'req_for_singer_1', action: 'reject' }, {})
  console.log('reject by waiter:', r_reject_bad)

  console.log('\n=== 歌手接受（正确流程） ===')
  process.env.MOCK_OPENID = 'singer_openid_1'
  const r_accept = await respFn.main({ requestId: 'req_for_singer_1', action: 'accept' }, {})
  console.log('accept result:', r_accept)

  console.log('\n=== TodayPlaylist 内容 ===')
  console.log(cloud.__collections.TodayPlaylist)

  console.log('\n=== RequestEntries 内容 ===')
  console.log(cloud.__collections.RequestEntries)
}

run().catch(e=>{ console.error(e); process.exit(1) })
