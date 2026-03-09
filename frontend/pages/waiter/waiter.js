Page({
  data: {
    singers: [],
    selectedSingerIndex: 0,
    title: '',
    artist: '',
    requesterName: '',
    tableId: ''
  },
  onLoad() {
    // 拉取歌手列表
    if (wx.cloud && wx.cloud.callFunction) {
      wx.cloud.callFunction({ name: 'getSingers' }).then(res => {
        if (res && res.result && res.result.success) {
          const singers = res.result.singers || []
          this.setData({ singers })
        }
      }).catch(() => {})
    }
  },
  handleInput(e) {
    const key = e.currentTarget.dataset.key
    const val = e.detail && (e.detail.value || e.detail.value === '' ? e.detail.value : e.detail)
    const obj = {}
    obj[key] = val
    this.setData(obj)
  },
  onSingerChange(e) {
    const idx = e.detail && e.detail.value
    this.setData({ selectedSingerIndex: idx })
  },
  async submitRequest() {
    const { singers, selectedSingerIndex, title } = this.data
    const singer = singers && singers[selectedSingerIndex]
    if (!singer || !singer.id || !title) {
      wx.showToast({ title: '请选择歌手并填写歌曲标题', icon: 'none' })
      return
    }
    wx.showLoading({ title: '提交中...' })
    try {
      const res = await wx.cloud.callFunction({
        name: 'recordRequest',
        data: {
          requestId: `web_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
          singerId: singer.id,
          title: this.data.title,
          artist: this.data.artist,
          requesterName: this.data.requesterName,
          tableId: this.data.tableId
        }
      })
      wx.hideLoading()
      if (res && res.result && res.result.success) {
        wx.showToast({ title: '已提交', icon: 'success' })
        // 可选择清空表单或保留
        this.setData({ title: '', artist: '', requesterName: '', tableId: '' })
      } else {
        wx.showToast({ title: (res.result && (res.result.error || res.result.message)) || '提交失败', icon: 'none' })
      }
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: e.message || '网络错误', icon: 'none' })
    }
  }
})
