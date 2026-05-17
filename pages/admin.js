import { useState, useEffect, useRef } from 'react'
import Head from 'next/head'
import { api } from '../lib/api'

const TIME_SLOTS = ['17:00', '17:30', '18:00', '18:30', '19:00', '19:30', '20:00', '20:30', '21:00']
const STATUSES = ['確定', 'キャンセル', 'カレンダー削除']
const SOURCES = ['電話', '食べログ', 'LINE', 'ウォークイン', 'その他']
const GUESTS = ['1', '2', '3', '4', '5', '6', '7', '8']

function toYMD(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fmtDate(ymd) {
  if (!ymd) return ''
  const d = new Date(ymd.replace(/\//g, '-') + 'T00:00:00')
  const w = ['日', '月', '火', '水', '木', '金', '土']
  return `${d.getMonth() + 1}/${d.getDate()}（${w[d.getDay()]}）`
}

function statusStyle(s) {
  if (s === '確定') return { background: '#e8f5e9', color: '#2e7d32' }
  if (s === 'キャンセル') return { background: '#ffebee', color: '#c62828' }
  return { background: '#fff3e0', color: '#e65100' }
}

function Toast({ msg, type }) {
  if (!msg) return null
  return (
    <div style={{
      position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
      background: type === 'error' ? '#e53935' : '#06c755',
      color: '#fff', padding: '12px 24px', borderRadius: 8,
      fontSize: 14, fontWeight: 'bold', zIndex: 9999,
      boxShadow: '0 4px 12px rgba(0,0,0,.25)', whiteSpace: 'nowrap',
    }}>{msg}</div>
  )
}

function Field({ label, children, span }) {
  return (
    <div style={span ? { gridColumn: '1 / -1' } : {}}>
      <div style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  )
}

const iStyle = {
  width: '100%', padding: '9px 12px',
  border: '1.5px solid #e0e0e0', borderRadius: 8,
  fontSize: 14, background: '#fafafa', fontFamily: 'inherit',
}

export default function Admin() {
  const pwRef = useRef('')
  const [authed, setAuthed] = useState(false)
  const [pwd, setPwd] = useState('')
  const [loginErr, setLoginErr] = useState('')
  const [loggingIn, setLoggingIn] = useState(false)
  const [tab, setTab] = useState('list')
  const [toast, setToast] = useState({ msg: '', type: 'ok' })

  // List
  const today = typeof window !== 'undefined' ? toYMD(new Date()) : ''
  const [filter, setFilter] = useState({ dateFrom: '', dateTo: '', status: '全て' })
  const [reservations, setReservations] = useState([])
  const [listLoading, setListLoading] = useState(false)
  const [editRes, setEditRes] = useState(null)
  const [editData, setEditData] = useState({})
  const [editSaving, setEditSaving] = useState(false)
  const [delId, setDelId] = useState(null)

  // Add
  const emptyAdd = {
    date: '', time: '', name: '', phone: '', guests: '2',
    course: '季節の貝焼きコース', notes: '', source: '電話',
    lineUserId: '', isKasshiki: false, forceAdd: false,
  }
  const [addData, setAddData] = useState(emptyAdd)
  const [addErr, setAddErr] = useState('')
  const [adding, setAdding] = useState(false)

  // Blocked
  const [blocked, setBlocked] = useState([])
  const [blockLoading, setBlockLoading] = useState(false)
  const [newDate, setNewDate] = useState('')
  const [newReason, setNewReason] = useState('')

  function showToast(msg, type = 'ok') {
    setToast({ msg, type })
    setTimeout(() => setToast({ msg: '', type: 'ok' }), 3000)
  }

  useEffect(() => {
    if (typeof window === 'undefined') return
    // Init today filter
    setFilter(f => ({ ...f, dateFrom: toYMD(new Date()) }))
    // Restore session
    const saved = sessionStorage.getItem('admin_pw')
    if (saved) {
      api.adminAuth(saved).then(r => {
        if (r.ok) {
          pwRef.current = saved
          setPwd(saved)
          setAuthed(true)
        }
      }).catch(() => {})
    }
  }, [])

  useEffect(() => {
    if (authed) {
      loadList(pwRef.current)
      loadBlocked(pwRef.current)
    }
  }, [authed])

  async function doLogin() {
    const p = pwd.trim()
    if (!p) return setLoginErr('パスワードを入力してください')
    setLoggingIn(true)
    setLoginErr('')
    try {
      const r = await api.adminAuth(p)
      if (r.ok) {
        pwRef.current = p
        sessionStorage.setItem('admin_pw', p)
        setAuthed(true)
      } else {
        setLoginErr('パスワードが正しくありません')
      }
    } catch {
      setLoginErr('通信エラーが発生しました')
    }
    setLoggingIn(false)
  }

  async function loadList(p, f) {
    setListLoading(true)
    try {
      const r = await api.adminGetReservations(p || pwRef.current, f || filter)
      setReservations(r.list || [])
    } catch { setReservations([]) }
    setListLoading(false)
  }

  async function loadBlocked(p) {
    setBlockLoading(true)
    try {
      const r = await api.adminGetBlockedDates(p || pwRef.current)
      setBlocked(r.list || [])
    } catch { setBlocked([]) }
    setBlockLoading(false)
  }

  function openEdit(res) {
    setEditRes(res)
    setEditData({
      name: res.name, phone: res.phone,
      date: res.date.replace(/\//g, '-'),
      time: res.time, guests: String(res.guests),
      course: res.course, notes: res.notes || '',
      status: res.status, source: res.source || 'その他',
    })
  }

  async function saveEdit() {
    setEditSaving(true)
    try {
      const r = await api.adminUpdateReservation(pwRef.current, {
        id: editRes.id,
        ...editData,
        date: editData.date.replace(/-/g, '/'),
      })
      if (r.success) {
        showToast('更新しました')
        setEditRes(null)
        loadList()
      } else {
        showToast(r.error || '更新に失敗しました', 'error')
      }
    } catch { showToast('通信エラー', 'error') }
    setEditSaving(false)
  }

  async function deleteRes(id) {
    try {
      const r = await api.adminDeleteReservation(pwRef.current, id)
      if (r.success) {
        showToast('削除しました')
        setDelId(null)
        loadList()
      } else {
        showToast(r.error || '削除に失敗しました', 'error')
      }
    } catch { showToast('通信エラー', 'error') }
  }

  async function addReservation() {
    if (!addData.date || !addData.time || !addData.name || !addData.phone) {
      return setAddErr('日付・時間・名前・電話番号は必須です')
    }
    setAdding(true)
    setAddErr('')
    try {
      const r = await api.adminAddReservation(pwRef.current, addData)
      if (r.blocked && !addData.forceAdd) {
        setAddErr('⚠️ ' + r.reason + '\n「強制登録」にチェックして再送信してください。')
        setAdding(false)
        return
      }
      if (r.success) {
        showToast('登録しました（ID：' + r.id + '）')
        setAddData(emptyAdd)
        setTab('list')
        loadList()
      } else {
        setAddErr(r.error || '登録に失敗しました')
      }
    } catch { setAddErr('通信エラーが発生しました') }
    setAdding(false)
  }

  async function addBlocked() {
    if (!newDate) return showToast('日付を選択してください', 'error')
    try {
      const r = await api.adminSetBlockedDate(pwRef.current, newDate, newReason)
      if (r.success) {
        showToast('休業日を設定しました')
        setNewDate('')
        setNewReason('')
        loadBlocked()
      } else {
        showToast(r.error || '設定に失敗しました', 'error')
      }
    } catch { showToast('通信エラー', 'error') }
  }

  async function removeBlocked(date) {
    try {
      const r = await api.adminRemoveBlockedDate(pwRef.current, date)
      if (r.success) { showToast('削除しました'); loadBlocked() }
      else showToast(r.error || 'エラー', 'error')
    } catch { showToast('通信エラー', 'error') }
  }

  if (!authed) {
    return (
      <>
        <Head><title>ログイン | 貝屋和光 管理画面</title></Head>
        <div style={{ minHeight: '100vh', background: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 16, padding: '40px 32px', width: '100%', maxWidth: 360, boxShadow: '0 4px 20px rgba(0,0,0,.1)' }}>
            <h1 style={{ textAlign: 'center', fontSize: 18, fontWeight: 'bold', marginBottom: 6 }}>貝屋和光 管理画面</h1>
            <p style={{ textAlign: 'center', fontSize: 12, color: '#888', marginBottom: 28 }}>管理者パスワードを入力してください</p>
            <input
              type="password" value={pwd}
              onChange={e => setPwd(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && doLogin()}
              placeholder="パスワード"
              style={{ ...iStyle, fontSize: 16, padding: '13px 14px', marginBottom: 12 }}
            />
            {loginErr && <p style={{ color: '#e53935', fontSize: 13, marginBottom: 10 }}>{loginErr}</p>}
            <button
              disabled={loggingIn} onClick={doLogin}
              style={{ width: '100%', padding: 16, background: '#06c755', color: '#fff', border: 'none', borderRadius: 12, fontSize: 16, fontWeight: 'bold', cursor: 'pointer' }}>
              {loggingIn ? '認証中...' : 'ログイン'}
            </button>
          </div>
        </div>
        <style jsx global>{`* { box-sizing:border-box; margin:0; padding:0; } body { font-family:-apple-system,'Hiragino Sans',sans-serif; }`}</style>
      </>
    )
  }

  return (
    <>
      <Head><title>管理画面 | 貝屋和光</title></Head>

      {/* Header */}
      <div style={{ background: '#06c755', padding: '14px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, zIndex: 10 }}>
        <h1 style={{ fontSize: 16, fontWeight: 'bold', color: '#fff' }}>貝屋和光 管理画面</h1>
        <button
          onClick={() => { sessionStorage.removeItem('admin_pw'); setAuthed(false); setPwd(''); pwRef.current = '' }}
          style={{ background: 'rgba(255,255,255,.2)', border: 'none', color: '#fff', padding: '6px 14px', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>
          ログアウト
        </button>
      </div>

      {/* Tabs */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e0e0e0', display: 'flex' }}>
        {[['list', '予約一覧'], ['add', '新規登録'], ['block', '休業日設定']].map(([id, label]) => (
          <button
            key={id} onClick={() => setTab(id)}
            style={{
              flex: 1, padding: '13px 8px', border: 'none', background: 'transparent',
              fontSize: 13, fontWeight: 'bold', cursor: 'pointer',
              borderBottom: tab === id ? '3px solid #06c755' : '3px solid transparent',
              color: tab === id ? '#06c755' : '#666',
            }}>
            {label}
          </button>
        ))}
      </div>

      <div style={{ padding: 16, maxWidth: 960, margin: '0 auto' }}>

        {/* ── RESERVATION LIST ── */}
        {tab === 'list' && (
          <>
            {/* Filter bar */}
            <div style={{ background: '#fff', borderRadius: 12, padding: 16, marginBottom: 12, boxShadow: '0 1px 3px rgba(0,0,0,.08)' }}>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <Field label="開始日">
                  <input type="date" value={filter.dateFrom}
                    onChange={e => setFilter(f => ({ ...f, dateFrom: e.target.value }))}
                    style={{ ...iStyle, width: 'auto' }} />
                </Field>
                <Field label="終了日">
                  <input type="date" value={filter.dateTo}
                    onChange={e => setFilter(f => ({ ...f, dateTo: e.target.value }))}
                    style={{ ...iStyle, width: 'auto' }} />
                </Field>
                <Field label="ステータス">
                  <select value={filter.status}
                    onChange={e => setFilter(f => ({ ...f, status: e.target.value }))}
                    style={{ ...iStyle, width: 'auto' }}>
                    {['全て', '確定', 'キャンセル'].map(s => <option key={s}>{s}</option>)}
                  </select>
                </Field>
                <button
                  onClick={() => loadList()}
                  style={{ padding: '9px 20px', background: '#06c755', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 'bold', cursor: 'pointer', alignSelf: 'flex-end' }}>
                  検索
                </button>
              </div>
            </div>

            {listLoading ? (
              <div style={{ textAlign: 'center', padding: 40, color: '#aaa' }}>読み込み中...</div>
            ) : reservations.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: '#aaa' }}>予約が見つかりません</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,.08)' }}>
                  <thead>
                    <tr style={{ background: '#f8f8f8', fontSize: 12, color: '#666' }}>
                      {['日付', '時間', '名前', '人数', '経路', 'ステータス', '操作'].map(h => (
                        <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 'bold', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {reservations.map(r => (
                      <tr key={r.id} style={{ borderTop: '1px solid #f0f0f0', fontSize: 13 }}>
                        <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>{fmtDate(r.date)}</td>
                        <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>{r.time}〜{r.endTime}</td>
                        <td style={{ padding: '10px 12px' }}>{r.name}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'center' }}>{r.guests}名</td>
                        <td style={{ padding: '10px 12px' }}>{r.source || '-'}</td>
                        <td style={{ padding: '10px 12px' }}>
                          <span style={{ ...statusStyle(r.status), padding: '3px 8px', borderRadius: 4, fontSize: 11, fontWeight: 'bold' }}>
                            {r.status}
                          </span>
                        </td>
                        <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                          <button onClick={() => openEdit(r)}
                            style={{ padding: '5px 12px', background: '#e3f2fd', color: '#1565c0', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer', marginRight: 6 }}>
                            編集
                          </button>
                          {delId === r.id ? (
                            <>
                              <button onClick={() => deleteRes(r.id)}
                                style={{ padding: '5px 10px', background: '#e53935', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer', marginRight: 4 }}>
                                確認
                              </button>
                              <button onClick={() => setDelId(null)}
                                style={{ padding: '5px 10px', background: '#f0f0f0', color: '#666', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>
                                取消
                              </button>
                            </>
                          ) : (
                            <button onClick={() => setDelId(r.id)}
                              style={{ padding: '5px 12px', background: '#ffebee', color: '#c62828', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>
                              削除
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* ── ADD RESERVATION ── */}
        {tab === 'add' && (
          <div style={{ background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,.08)' }}>
            <h2 style={{ fontSize: 15, fontWeight: 'bold', marginBottom: 16 }}>新規予約登録</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
              <Field label="来店日 *">
                <input type="date" value={addData.date}
                  onChange={e => setAddData(d => ({ ...d, date: e.target.value }))} style={iStyle} />
              </Field>
              <Field label="時間 *">
                <select value={addData.time}
                  onChange={e => setAddData(d => ({ ...d, time: e.target.value }))} style={iStyle}>
                  <option value="">-- 選択 --</option>
                  {TIME_SLOTS.map(s => <option key={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="お名前 *">
                <input type="text" value={addData.name} placeholder="山田 太郎"
                  onChange={e => setAddData(d => ({ ...d, name: e.target.value }))} style={iStyle} />
              </Field>
              <Field label="電話番号 *">
                <input type="tel" value={addData.phone} placeholder="090-0000-0000"
                  onChange={e => setAddData(d => ({ ...d, phone: e.target.value }))} style={iStyle} />
              </Field>
              <Field label="人数">
                <select value={addData.guests}
                  onChange={e => setAddData(d => ({ ...d, guests: e.target.value }))} style={iStyle}>
                  {GUESTS.map(n => <option key={n}>{n}</option>)}
                </select>
              </Field>
              <Field label="経路">
                <select value={addData.source}
                  onChange={e => setAddData(d => ({ ...d, source: e.target.value }))} style={iStyle}>
                  {SOURCES.map(s => <option key={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="LINE UserID（任意）">
                <input type="text" value={addData.lineUserId} placeholder="Uxxxxxxxx..."
                  onChange={e => setAddData(d => ({ ...d, lineUserId: e.target.value }))} style={iStyle} />
              </Field>
              <Field label="ご要望（任意）">
                <input type="text" value={addData.notes} placeholder="アレルギーなど"
                  onChange={e => setAddData(d => ({ ...d, notes: e.target.value }))} style={iStyle} />
              </Field>
            </div>
            <div style={{ marginTop: 14, display: 'flex', gap: 20 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={addData.isKasshiki}
                  onChange={e => setAddData(d => ({ ...d, isKasshiki: e.target.checked }))} />
                貸切プラン
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={addData.forceAdd}
                  onChange={e => setAddData(d => ({ ...d, forceAdd: e.target.checked }))} />
                強制登録（休業日を無視）
              </label>
            </div>
            {addErr && (
              <div style={{ marginTop: 12, background: '#fff0f0', border: '1px solid #ffcccc', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#e53935', whiteSpace: 'pre-line' }}>
                {addErr}
              </div>
            )}
            <button disabled={adding} onClick={addReservation}
              style={{ marginTop: 16, width: '100%', padding: 15, background: '#06c755', color: '#fff', border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 'bold', cursor: 'pointer' }}>
              {adding ? '登録中...' : '予約を登録する'}
            </button>
          </div>
        )}

        {/* ── BLOCKED DATES ── */}
        {tab === 'block' && (
          <>
            <div style={{ background: '#fff', borderRadius: 12, padding: 16, marginBottom: 12, boxShadow: '0 1px 3px rgba(0,0,0,.08)' }}>
              <h2 style={{ fontSize: 14, fontWeight: 'bold', marginBottom: 12 }}>休業日を追加</h2>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <Field label="日付 *">
                  <input type="date" value={newDate}
                    onChange={e => setNewDate(e.target.value)}
                    style={{ ...iStyle, width: 'auto' }} />
                </Field>
                <Field label="理由（任意）">
                  <input type="text" value={newReason} placeholder="定休日、貸切など..."
                    onChange={e => setNewReason(e.target.value)}
                    style={{ ...iStyle, minWidth: 180 }} />
                </Field>
                <button onClick={addBlocked}
                  style={{ padding: '9px 20px', background: '#06c755', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 'bold', cursor: 'pointer', alignSelf: 'flex-end' }}>
                  追加
                </button>
              </div>
            </div>

            <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,.08)' }}>
              {blockLoading ? (
                <div style={{ textAlign: 'center', padding: 30, color: '#aaa' }}>読み込み中...</div>
              ) : blocked.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 30, color: '#aaa' }}>休業日の設定はありません</div>
              ) : (
                blocked.map((b, i) => (
                  <div key={b.date} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '14px 16px',
                    borderBottom: i < blocked.length - 1 ? '1px solid #f0f0f0' : 'none',
                  }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 'bold' }}>
                        {b.date}　{fmtDate(b.date)}
                      </div>
                      {b.reason && (
                        <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{b.reason}</div>
                      )}
                    </div>
                    <button onClick={() => removeBlocked(b.date)}
                      style={{ padding: '6px 14px', background: '#ffebee', color: '#c62828', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>
                      削除
                    </button>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>

      {/* ── EDIT MODAL ── */}
      {editRes && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={e => e.target === e.currentTarget && setEditRes(null)}>
          <div style={{ background: '#fff', borderRadius: 16, padding: 24, width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ fontSize: 16, fontWeight: 'bold' }}>予約編集　<span style={{ fontSize: 12, color: '#888', fontWeight: 'normal' }}>{editRes.id}</span></h2>
              <button onClick={() => setEditRes(null)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#888', lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="お名前">
                <input type="text" value={editData.name}
                  onChange={e => setEditData(d => ({ ...d, name: e.target.value }))} style={iStyle} />
              </Field>
              <Field label="電話番号">
                <input type="tel" value={editData.phone}
                  onChange={e => setEditData(d => ({ ...d, phone: e.target.value }))} style={iStyle} />
              </Field>
              <Field label="来店日">
                <input type="date" value={editData.date}
                  onChange={e => setEditData(d => ({ ...d, date: e.target.value }))} style={iStyle} />
              </Field>
              <Field label="時間">
                <select value={editData.time}
                  onChange={e => setEditData(d => ({ ...d, time: e.target.value }))} style={iStyle}>
                  {TIME_SLOTS.map(s => <option key={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="人数">
                <select value={editData.guests}
                  onChange={e => setEditData(d => ({ ...d, guests: e.target.value }))} style={iStyle}>
                  {GUESTS.map(n => <option key={n}>{n}</option>)}
                </select>
              </Field>
              <Field label="ステータス">
                <select value={editData.status}
                  onChange={e => setEditData(d => ({ ...d, status: e.target.value }))} style={iStyle}>
                  {STATUSES.map(s => <option key={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="経路">
                <select value={editData.source}
                  onChange={e => setEditData(d => ({ ...d, source: e.target.value }))} style={iStyle}>
                  {SOURCES.map(s => <option key={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="ご要望">
                <input type="text" value={editData.notes}
                  onChange={e => setEditData(d => ({ ...d, notes: e.target.value }))} style={iStyle} />
              </Field>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <button disabled={editSaving} onClick={saveEdit}
                style={{ flex: 1, padding: 14, background: '#06c755', color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 'bold', cursor: 'pointer' }}>
                {editSaving ? '保存中...' : '保存する'}
              </button>
              <button onClick={() => setEditRes(null)}
                style={{ flex: 1, padding: 14, background: '#f0f0f0', color: '#666', border: 'none', borderRadius: 10, fontSize: 14, cursor: 'pointer' }}>
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}

      <Toast msg={toast.msg} type={toast.type} />
      <style jsx global>{`* { box-sizing:border-box; margin:0; padding:0; } body { font-family:-apple-system,'Hiragino Sans',sans-serif; background:#f5f5f5; }`}</style>
    </>
  )
}
