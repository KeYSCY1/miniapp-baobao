// 本地测试 recordRequest 云函数（使用 mock wx-server-sdk）
const path = require('path')
process.env.MOCK_OPENID = 'waiter_openid_1'

const cloud = require('wx-server-sdk')
// 预填充 Users 数据
cloud.__collections.Users['waiter_openid_1'] = { role: 'waiter', displayName: '测试服务员' }

// 引入被测函数
const fn = require(path.resolve(__dirname, '../cloud/functions/recordRequest/index.js'))

async function run() {
  console.log('=== Test: first insert ===')
  const ev1 = { requestId: 'test-req-1', singerId: 'singer_1', title: '月亮代表我的心', artist: '邓丽君', requesterName: '服务员A', tableId: 'T1' }
  const r1 = await fn.main(ev1, {})
  console.log('result1:', r1)

  console.log('\n=== Test: idempotent insert (same requestId) ===')
  const r2 = await fn.main(ev1, {})
  console.log('result2:', r2)

  console.log('\n=== Test: duplicate by title within window ===')
  const ev3 = { requestId: 'test-req-2', singerId: 'singer_1', title: '月亮代表我的心', artist: '邓丽君', requesterName: '服务员B', tableId: 'T2' }
  const r3 = await fn.main(ev3, {})
  console.log('result3:', r3)

  console.log('\n=== Stored RequestEntries ===')
  console.log(cloud.__collections.RequestEntries)
}

run().catch(e=>{ console.error(e); process.exit(1) })
