import { useState } from 'react'
import Head from 'next/head'
import { api } from '../lib/api'
import { VERTICAL_PRESETS, buildPresetPatch } from '../lib/verticalPresets'

// 初期設定画面：GASエディタでのスクリプトプロパティ手動編集（setProperties()）を、Webフォームに
// 置き換える（SETUP.mdのSTEP2＋STEP3に相当）。GASプロジェクト作成・デプロイ・Vercelデプロイ・
// LINE Developersコンソールでの作業自体は無くならないが、非技術者が唯一つまずきやすかった
// 「スクリプトプロパティ表の手動編集」を無くす（2026-08-10、導入フロー大改修）。
//
// このページ自体は「1店舗＝1つの独立したGAS＋Vercelデプロイ」という既存の構成を前提にしている。
// 新しい店舗を増やす場合は、この構成をコピーして別のGAS／Vercelプロジェクトを立てた上で、その店舗用の
// このページを開く（店舗間のデータ・障害は完全に分離されたまま。詳細はSETUP.md参照）。
//
// initialSetup()自体は「SETUP_PROPERTIES_DONE_AT未設定の間だけ」動く自己ゲート付きのため、既に設定済みの
// 店舗でこのページを開いても、送信時にサーバー側で拒否される（事前チェックは行わず、送信時の応答だけで
// 判定する——「既に設定済みかどうか」を確認するための公開エンドポイントを新設するより、シンプルで安全）。

const inputStyle = {
  background: 'var(--bg-subtle)', color: 'var(--text-primary)', width: '100%', boxSizing: 'border-box',
  padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 14,
}
const labelStyle = { fontSize: 13, fontWeight: 'bold', color: 'var(--text-primary)', display: 'block', marginBottom: 6 }
const hintStyle = { fontSize: 12, color: 'var(--text-faint)', marginTop: 4 }
const btnPrimary = {
  background: '#06c755', color: '#fff', border: 'none', borderRadius: 8, padding: '12px 20px',
  fontSize: 15, fontWeight: 'bold', cursor: 'pointer',
}
const btnGray = {
  background: 'var(--bg-subtle)', color: 'var(--text-secondary)', border: '1px solid var(--border)',
  borderRadius: 8, padding: '12px 20px', fontSize: 15, cursor: 'pointer',
}
const card = {
  background: 'var(--bg-card)', borderRadius: 16, padding: 24, boxShadow: '0 1px 3px var(--shadow-sm)',
  maxWidth: 560, width: '100%', margin: '0 auto',
}

export default function Setup() {
  const [step, setStep] = useState('category') // 'category' | 'questions' | 'connection' | 'submitting' | 'done' | 'error'
  const [presetKey, setPresetKey] = useState('')
  const [answers, setAnswers] = useState({})
  const [customText, setCustomText] = useState({})
  const [form, setForm] = useState({
    restaurantName: '', restaurantShort: '', calendarId: '',
    adminPassword: '', adminPasswordConfirm: '',
    lineToken: '', liffId: '', staffGroupId: '',
  })
  const [formErr, setFormErr] = useState('')
  const [result, setResult] = useState(null)
  const [errMsg, setErrMsg] = useState('')

  const preset = VERTICAL_PRESETS.find(p => p.key === presetKey)
  const categories = [...new Set(VERTICAL_PRESETS.map(p => p.category))]
  const needsStaff = preset && preset.settings.capacityModel === 'perStaff'

  function pickCategory(key) {
    setPresetKey(key)
    const p = VERTICAL_PRESETS.find(pp => pp.key === key)
    const initial = {}
    ;(p.questions || []).forEach(q => { initial[q.id] = q.options[0].value })
    setAnswers(initial)
    setStep((p.questions && p.questions.length > 0) ? 'questions' : 'connection')
  }
  function skipCategory() {
    setPresetKey('')
    setStep('connection')
  }

  function set(field) {
    return e => setForm(f => ({ ...f, [field]: e.target.value }))
  }

  async function submit() {
    setFormErr('')
    if (!form.restaurantName.trim()) return setFormErr('店舗の正式名称を入力してください')
    if (!form.restaurantShort.trim()) return setFormErr('店舗の短縮名を入力してください')
    if (!form.calendarId.trim()) return setFormErr('Googleカレンダーのメールアドレスを入力してください')
    if (form.adminPassword.length < 4) return setFormErr('管理画面パスワードを4文字以上で設定してください')
    if (form.adminPassword !== form.adminPasswordConfirm) return setFormErr('パスワード（確認）が一致しません')

    const { settingsPatch, fsetPatch } = buildPresetPatch(preset, answers, customText)
    setStep('submitting')
    try {
      const r = await api.initialSetup({
        restaurantName: form.restaurantName.trim(),
        restaurantShort: form.restaurantShort.trim(),
        calendarId: form.calendarId.trim(),
        adminPassword: form.adminPassword,
        lineToken: form.lineToken.trim(),
        liffId: form.liffId.trim(),
        staffGroupId: form.staffGroupId.trim(),
        settingsPatch: preset ? settingsPatch : undefined,
        fsetPatch: preset ? fsetPatch : undefined,
      })
      if (r && r.success) {
        setResult(r)
        setStep('done')
      } else {
        setErrMsg((r && r.error) || 'システムエラーが発生しました。しばらくしてから再度お試しください。')
        setStep('error')
      }
    } catch (e) {
      setErrMsg('通信エラーが発生しました。しばらくしてから再度お試しください。')
      setStep('error')
    }
  }

  return (
    <>
      <Head><title>初期設定 | 予約システム</title></Head>
      <div style={{ minHeight: '100vh', background: 'var(--bg-page)', padding: '32px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        <div style={{ textAlign: 'center', marginBottom: 8 }}>
          <div style={{ fontSize: 20, fontWeight: 'bold', color: 'var(--text-primary)' }}>予約システム 初期設定</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>この店舗専用の予約システムを立ち上げます</div>
        </div>

        {step === 'category' && (
          <div style={card}>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>お店・施設の業種に近いものを選んでください。次の画面で、業種に応じた追加の質問に答えるだけで基本設定が組み立てられます（後から管理画面でいつでも変更できます）。</div>
            {categories.map(cat => (
              <div key={cat} style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 'bold', color: 'var(--text-faint)', letterSpacing: '0.03em', marginBottom: 6 }}>{cat}</div>
                <div style={{ display: 'grid', gap: 8 }}>
                  {VERTICAL_PRESETS.filter(p => p.category === cat).map(p => (
                    <button key={p.key} onClick={() => pickCategory(p.key)}
                      style={{ display: 'flex', gap: 12, alignItems: 'flex-start', textAlign: 'left', padding: '12px 14px', border: '1.5px solid var(--border-light)', borderRadius: 10, background: 'var(--bg-card)', cursor: 'pointer' }}>
                      <span style={{ fontSize: 20, lineHeight: 1, flexShrink: 0 }}>{p.icon}</span>
                      <span>
                        <span style={{ display: 'block', fontSize: 13, fontWeight: 'bold', color: 'var(--text-primary)' }}>{p.label}</span>
                        <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{p.hint}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <button onClick={skipCategory} style={{ ...btnGray, width: '100%', marginTop: 8 }}>当てはまる業種が無い（後で管理画面から設定する）</button>
          </div>
        )}

        {step === 'questions' && preset && (
          <div style={card}>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>「{preset.label}」向けの追加の質問です。分からなければ既定のままで問題ありません。</div>
            <div style={{ display: 'grid', gap: 16, marginBottom: 20 }}>
              {preset.questions.map(q => (
                <div key={q.id}>
                  <label style={labelStyle}>{q.question}</label>
                  <select value={String(answers[q.id])} style={inputStyle}
                    onChange={e => {
                      const raw = e.target.value
                      const opt = q.options.find(o => String(o.value) === raw)
                      setAnswers(a => ({ ...a, [q.id]: opt ? opt.value : raw }))
                    }}>
                    {q.options.map(o => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
                    {q.allowCustom && <option value="__custom__">その他（自由入力）</option>}
                  </select>
                  {q.allowCustom && answers[q.id] === '__custom__' && (
                    <input value={customText[q.id] || ''} placeholder="呼び方を入力" style={{ ...inputStyle, marginTop: 8 }}
                      onChange={e => setCustomText(c => ({ ...c, [q.id]: e.target.value }))} />
                  )}
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setStep('category')} style={btnGray}>← 業種を選び直す</button>
              <button onClick={() => setStep('connection')} style={btnPrimary}>次へ</button>
            </div>
          </div>
        )}

        {step === 'connection' && (
          <div style={card}>
            <div style={{ fontSize: 15, fontWeight: 'bold', marginBottom: 4, color: 'var(--text-primary)' }}>店舗情報・接続設定</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>LINEトークン・LIFF ID・グループIDは、LINE Developersコンソールでの作業がまだの場合は空欄のままで進められます（後から管理画面の「設定」タブ「接続設定」で追加できます）。</div>
            {/* SetupWizard（admin.js、ログイン後の業態プリセット変更）の確認画面には元々あった警告が、
                こちらの初期設定画面には無く、担当者単位モデルの業種を選んだ店舗が「初期設定完了」と
                思い込んだまま担当者を1人も登録せず、全予約が対応不可になる事故に気づけなかった
                （テスト部隊監査・2026-08-10での指摘）。同じ警告文言なのに配色がSetupWizard側（amber）と
                ここ（warning）で違っていた不統一も合わせて解消する（Apple CEO視点レビュー・2026-08-11の指摘）。 */}
            {needsStaff && (
              <div style={{ background: 'var(--amber-bg)', border: '1px solid var(--amber-border)', color: 'var(--amber-text)', borderRadius: 8, padding: '10px 14px', fontSize: 12, marginBottom: 16 }}>
                ⚠️ 「{preset.label}」は担当者単位の容量管理です。初期設定完了後、必ず管理画面の「設定」タブから担当者を最低1名登録してください（登録するまで、お客様の予約が全て「対応不可」になります）。
              </div>
            )}

            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>店舗の正式名称 *</label>
              <input value={form.restaurantName} onChange={set('restaurantName')} placeholder="例：喫茶 巡" style={inputStyle} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>店舗の短縮名 *</label>
              <input value={form.restaurantShort} onChange={set('restaurantShort')} placeholder="例：巡" style={inputStyle} />
              <div style={hintStyle}>Googleカレンダーの予定タイトルの照合に使われます（後から変更すると既存予約の空き枠計算に影響するため、決めたらなるべく変更しないでください）</div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>予約管理用Googleカレンダーのメールアドレス *</label>
              <input value={form.calendarId} onChange={set('calendarId')} placeholder="例：shop-name@gmail.com" style={inputStyle} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>管理画面パスワード *</label>
              <input type="password" value={form.adminPassword} onChange={set('adminPassword')} style={inputStyle} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>管理画面パスワード（確認） *</label>
              <input type="password" value={form.adminPasswordConfirm} onChange={set('adminPasswordConfirm')} style={inputStyle} />
              <div style={hintStyle}>ログイン後、管理画面の設定タブからいつでも変更できます</div>
            </div>

            <div style={{ borderTop: '1px solid var(--border-light)', paddingTop: 14, marginTop: 4, marginBottom: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 'bold', color: 'var(--text-secondary)', marginBottom: 10 }}>接続情報（任意・後で設定可）</div>
              {/* 取得方法の案内が完了画面（送信後）にしか出ておらず、まさにこれらを入力しようとしている
                  この画面ではノーガイドだった（Apple CEO視点レビュー・2026-08-11の指摘）。入力欄の直前に
                  簡単な取得先だけ先に示す（詳しい手順は完了画面・SETUP.mdを参照）。 */}
              <div style={{ fontSize: 11, color: 'var(--text-faint)', lineHeight: 1.7, marginBottom: 12 }}>
                LINE Developersコンソール（<code>developers.line.me</code>）でMessaging APIチャンネルを作成すると「チャンネルアクセストークン」を発行できます。同じくLIFFアプリを作成すると「LIFF ID」が発行されます。グループIDは、通知したいLINEグループにBotを招待してメッセージを送ると、初期設定完了後に管理画面から候補を確認できます。今わからなければ空欄で進めてください。
              </div>
              <div style={{ marginBottom: 10 }}>
                <label style={labelStyle}>LINE Messaging APIのチャンネルアクセストークン</label>
                <input value={form.lineToken} onChange={set('lineToken')} style={inputStyle} />
              </div>
              <div style={{ marginBottom: 10 }}>
                <label style={labelStyle}>LIFF ID</label>
                <input value={form.liffId} onChange={set('liffId')} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>スタッフ通知用LINEグループID</label>
                <input value={form.staffGroupId} onChange={set('staffGroupId')} style={inputStyle} />
              </div>
            </div>

            {formErr && <div style={{ background: 'var(--danger-bg)', border: '1px solid var(--danger-border)', color: 'var(--danger-text)', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 14 }}>{formErr}</div>}

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setStep(preset ? (preset.questions.length ? 'questions' : 'category') : 'category')} style={btnGray}>← 戻る</button>
              <button onClick={submit} style={btnPrimary}>この内容で初期設定する</button>
            </div>
          </div>
        )}

        {step === 'submitting' && (
          <div style={card}>
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 14, padding: '20px 0' }}>設定を反映しています…</div>
          </div>
        )}

        {step === 'done' && result && (
          <div style={card}>
            <div style={{ fontSize: 24, textAlign: 'center', marginBottom: 8 }}>✅</div>
            <div style={{ fontSize: 15, fontWeight: 'bold', color: 'var(--text-primary)', textAlign: 'center', marginBottom: 16 }}>初期設定が完了しました</div>
            {result.warning && (
              <div style={{ background: 'var(--warning-bg)', border: '1px solid var(--warning-border)', color: 'var(--warning-text)', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 14 }}>{result.warning}</div>
            )}
            {needsStaff && (
              <div style={{ background: 'var(--amber-bg)', border: '1px solid var(--amber-border)', color: 'var(--amber-text)', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 14 }}>
                ⚠️ 管理画面にログインしたら、担当者を最低1名登録してください（登録するまでお客様の予約が全て「対応不可」になります）。
              </div>
            )}
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.8, marginBottom: 16 }}>
              <div>店舗ID：<code>{result.storeId}</code></div>
              {result.spreadsheetUrl && <div>予約管理台帳：<a href={result.spreadsheetUrl} target="_blank" rel="noreferrer">開く</a></div>}
            </div>
            <div style={{ background: 'var(--bg-subtle)', borderRadius: 10, padding: 14, marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 'bold', color: 'var(--text-primary)', marginBottom: 8 }}>残りの手順（このページでは自動化していません）</div>
              <ul style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.8, paddingLeft: 18, margin: 0 }}>
                <li>LINE DevelopersコンソールでLIFFアプリを作成し、LIFF IDを取得（未入力の場合）</li>
                <li>VercelのNext.js環境変数 <code>NEXT_PUBLIC_LIFF_ID</code> を設定して再デプロイ</li>
                <li>LINE Webhook URLを <code>（VercelのURL）/api/line-webhook</code> に設定</li>
                <li>通知用LINEグループにBotを招待し、管理画面「通知設定」タブでグループBを確定</li>
                <li>リッチメニューのボタンリンクを <code>https://liff.line.me/（LIFF ID）</code> に設定</li>
              </ul>
              <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 8 }}>詳しくは SETUP.md のSTEP6〜8を参照してください。</div>
            </div>
            <a href="/admin" style={{ ...btnPrimary, display: 'block', textAlign: 'center', textDecoration: 'none', boxSizing: 'border-box' }}>管理画面にログインする</a>
          </div>
        )}

        {step === 'error' && (
          <div style={card}>
            <div style={{ background: 'var(--danger-bg)', border: '1px solid var(--danger-border)', color: 'var(--danger-text)', borderRadius: 8, padding: '14px', fontSize: 13, marginBottom: 16 }}>{errMsg}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>既に初期設定済みの店舗の場合、設定変更は管理画面から行ってください。</div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setStep('connection')} style={btnGray}>← 内容を修正する</button>
              <a href="/admin" style={{ ...btnPrimary, textDecoration: 'none', display: 'flex', alignItems: 'center' }}>管理画面へ</a>
            </div>
          </div>
        )}
      </div>
      <style jsx global>{`
        :root {
          color-scheme: light dark;
          --bg-page: #f5f5f5;
          --bg-card: #fff;
          --bg-subtle: #fafafa;
          --border: #ddd;
          --border-light: #eee;
          --text-primary: #333;
          --text-secondary: #555;
          --text-muted: #888;
          --text-faint: #aaa;
          --shadow-sm: rgba(0,0,0,.08);
          --danger-bg: #ffebee;
          --danger-border: #ffcccc;
          --danger-text: #c62828;
          --warning-bg: #fff3e0;
          --warning-border: #ffe0b2;
          --warning-text: #e65100;
          --amber-bg: #fff8e1;
          --amber-border: #ffe082;
          --amber-text: #8a6d00;
        }
        @media (prefers-color-scheme: dark) {
          :root {
            --bg-page: #14171a;
            --bg-card: #1c2126;
            --bg-subtle: #20252a;
            --border: #3a4149;
            --border-light: #2f353b;
            --text-primary: #e8eaed;
            --text-secondary: #b0b6bc;
            --text-muted: #8a9199;
            --text-faint: #6b7178;
            --shadow-sm: rgba(0,0,0,.4);
            --danger-bg: #3a1518;
            --danger-border: #6b2a2a;
            --danger-text: #ff7b72;
            --warning-bg: #3a2712;
            --warning-border: #6b4a1f;
            --warning-text: #ffab5c;
            --amber-bg: #362c10;
            --amber-border: #5c4a1f;
            --amber-text: #d9b64a;
          }
        }
      `}</style>
    </>
  )
}
