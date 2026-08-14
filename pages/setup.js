import { useState, useRef, useEffect } from 'react'
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
  // 「接続設定」「完了」両画面の警告文言が、質問（Q_STAFF_LABEL等）で既定と異なる呼び方に変更しても
  // preset.settings.staffLabel/countUnit（プリセットの生の既定値）のまま表示され続けるdriftがあった
  // （admin.js側のSetupWizardで発見・修正した同種の問題。業種経営者陣視点レビュー・第42回での指摘）。
  // 実際に適用される設定（質問の回答を反映した値）を使うように修正する。
  const resolvedSettings = preset ? { ...preset.settings, ...buildPresetPatch(preset, answers, customText).settingsPatch } : {}

  // このページ自体は「1店舗を初めて立ち上げる非技術者の店主」が唯一かつ最初に触るフォームであり、
  // admin.js側のSetupWizard（ログイン後の業種プリセット再適用）と違って画面遷移前に他の画面を
  // 経由していないため、ステップの見通しの悪さが特に不安につながりやすい（Appleデザインチーム視点
  // レビュー・ラウンド50での指摘）。admin.js SetupWizardのwizardStepIndex/進捗バーと同じ考え方で
  // 現在位置（n/合計）を算出する。質問が無い業種・業種未選択（skipCategory）の場合は
  // category→connectionの2ステップ、質問がある業種の場合はcategory→questions→connectionの3ステップ。
  const hasQuestions = !!(preset && preset.questions && preset.questions.length > 0)
  const totalSteps = hasQuestions ? 3 : 2
  const stepIndex = step === 'category' ? 1 : step === 'questions' ? 2 : step === 'connection' ? totalSteps : 0

  // ステップ（category/questions/connection/submitting/done/error）が画面ごと丸ごと入れ替わる
  // SPA的な作りなのに、切り替わったこと自体をスクリーンリーダーへ伝える手段が無かった
  // （お客様画面index.jsの画面遷移時のscreenRef、admin.js SetupWizardのstepContentRefと同じ問題。
  // Appleデザインチーム視点レビュー・ラウンド50での指摘）。各ステップのコンテンツ領域へフォーカスを
  // 移し、見出し（後述のh2）から読み上げさせる。
  const stepContentRef = useRef(null)
  useEffect(() => {
    window.scrollTo(0, 0)
    const el = stepContentRef.current
    if (el) {
      if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1')
      el.focus({ preventScroll: true })
    }
  }, [step])

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
          <h1 style={{ fontSize: 20, fontWeight: 'bold', color: 'var(--text-primary)', margin: 0 }}>予約システム 初期設定</h1>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>この店舗専用の予約システムを立ち上げます</div>
        </div>

        {/* 進行状況（質問が無い業種・業種未選択は2ステップ、質問がある業種は3ステップ）。
            admin.js SetupWizardの進捗バーと同じ見た目にする。バー自体は下のh2見出しに埋め込んだ
            「ステップn/合計」と同じ情報の視覚的な重複表示のため、スクリーンリーダーには二重に
            読ませずaria-hidden（見出し側だけで読み上げさせる）。 */}
        {(step === 'category' || step === 'questions' || step === 'connection') && (
          <div aria-hidden="true" style={{ display: 'flex', gap: 6, alignItems: 'center', width: '100%', maxWidth: 560 }}>
            {Array.from({ length: totalSteps }).map((_, i) => (
              <span key={i} style={{ height: 4, borderRadius: 2, flex: 1, background: i < stepIndex ? '#06c755' : 'var(--border-light)' }} />
            ))}
            <span style={{ fontSize: 11, color: 'var(--text-faint)', marginLeft: 6, whiteSpace: 'nowrap' }}>{stepIndex}/{totalSteps}</span>
          </div>
        )}

        {step === 'category' && (
          <div style={card} ref={stepContentRef}>
            <h2 style={{ fontSize: 15, fontWeight: 'bold', color: 'var(--text-primary)', margin: '0 0 12px' }}>ステップ{stepIndex}/{totalSteps}：業種を選ぶ</h2>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>お店・施設の業種に近いものを選んでください。次の画面で、業種に応じた追加の質問に答えるだけで基本設定が組み立てられます（後から管理画面でいつでも変更できます）。</div>
            {categories.map(cat => (
              <div key={cat} style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 'bold', color: 'var(--text-faint)', letterSpacing: '0.03em', marginBottom: 6 }}>{cat}</div>
                <div style={{ display: 'grid', gap: 8 }}>
                  {VERTICAL_PRESETS.filter(p => p.category === cat).map(p => (
                    <button key={p.key} onClick={() => pickCategory(p.key)}
                      style={{ display: 'flex', gap: 12, alignItems: 'flex-start', textAlign: 'left', padding: '12px 14px', border: '1.5px solid var(--border-light)', borderRadius: 10, background: 'var(--bg-card)', cursor: 'pointer' }}>
                      <span aria-hidden="true" style={{ fontSize: 20, lineHeight: 1, flexShrink: 0 }}>{p.icon}</span>
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
          <div style={card} ref={stepContentRef}>
            <h2 style={{ fontSize: 15, fontWeight: 'bold', color: 'var(--text-primary)', margin: '0 0 12px' }}>ステップ{stepIndex}/{totalSteps}：{preset.label}向けの追加質問</h2>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>分からなければ既定のままで問題ありません。</div>
            <div style={{ display: 'grid', gap: 16, marginBottom: 20 }}>
              {preset.questions.map(q => (
                <div key={q.id}>
                  <label htmlFor={`su-q-${q.id}`} style={labelStyle}>{q.question}</label>
                  <select id={`su-q-${q.id}`} value={String(answers[q.id])} style={inputStyle}
                    onChange={e => {
                      const raw = e.target.value
                      const opt = q.options.find(o => String(o.value) === raw)
                      setAnswers(a => ({ ...a, [q.id]: opt ? opt.value : raw }))
                    }}>
                    {q.options.map(o => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
                    {q.allowCustom && <option value="__custom__">その他（自由入力）</option>}
                  </select>
                  {q.allowCustom && answers[q.id] === '__custom__' && (
                    <input value={customText[q.id] || ''} placeholder="呼び方を入力" aria-label={`${q.question}（自由入力）`} style={{ ...inputStyle, marginTop: 8 }}
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
          <div style={card} ref={stepContentRef}>
            <h2 style={{ fontSize: 15, fontWeight: 'bold', color: 'var(--text-primary)', margin: '0 0 4px' }}>ステップ{stepIndex}/{totalSteps}：店舗情報・接続設定</h2>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>LINEトークン・LIFF ID・グループIDは、LINE Developersコンソールでの作業がまだの場合は空欄のままで進められます（後から管理画面の「設定」タブ「接続設定」で追加できます）。</div>
            {/* SetupWizard（admin.js、ログイン後の業態プリセット変更）の確認画面には元々あった警告が、
                こちらの初期設定画面には無く、担当者単位モデルの業種を選んだ店舗が「初期設定完了」と
                思い込んだまま担当者を1人も登録せず、全予約が対応不可になる事故に気づけなかった
                （テスト部隊監査・2026-08-10での指摘）。同じ警告文言なのに配色がSetupWizard側（amber）と
                ここ（warning）で違っていた不統一も合わせて解消する（Apple CEO視点レビュー・2026-08-11の指摘）。 */}
            {needsStaff && (
              <div style={{ background: 'var(--amber-bg)', border: '1px solid var(--amber-border)', color: 'var(--amber-text)', borderRadius: 8, padding: '10px 14px', fontSize: 12, marginBottom: 16 }}>
                {/* 「担当者」という一般語だけ固定で、選んだ業態の実際の呼び方（整備士・医師・講師等、
                    preset.settings.staffLabel）に追従していなかった（業種経営者陣視点レビュー・
                    ラウンド38での指摘：この警告を読む店主が自分の業態に翻訳し直す必要があった）。 */}
                ⚠️ 「{preset.label}」は{resolvedSettings.staffLabel || '担当者'}単位の容量管理です。初期設定完了後、必ず管理画面の「設定」タブから{resolvedSettings.staffLabel || '担当者'}を最低1{resolvedSettings.countUnit || '名'}登録してください（登録するまで、お客様の予約が全て「対応不可」になります）。
              </div>
            )}
            {/* 業種を選ばずに進んだ場合（skipCategory()、presetKey=''）、settingsPatch/fsetPatchが
                送られずCode.gs側の生の既定値（飲食店＝貝屋和光を前提にした値）がそのまま適用される。
                従来はこの選択をした店主にその事実がどこにも伝わらず、美容院や整備工場等が「貸切（買い切り）
                受付ON」「1名利用は相席が前提ON」のまま運用開始してしまう事故があった（ラウンド40での指摘）。
                業種選択自体をやり直させる／最も近いプリセットを強制する案より低リスクな「明示的な警告」を
                選択：どの既定値が残るか・どこで直せるかをこの画面と完了画面の両方で必ず知らせる。 */}
            {!preset && (
              <div style={{ background: 'var(--amber-bg)', border: '1px solid var(--amber-border)', color: 'var(--amber-text)', borderRadius: 8, padding: '10px 14px', fontSize: 12, marginBottom: 16 }}>
                ⚠️ 業種を選択しなかったため、以下の設定は飲食店（コース制）向けの既定値のまま適用されます。当てはまらない場合は、初期設定完了後に必ず管理画面の「設定」タブでそれぞれ見直してください。
                <ul style={{ margin: '6px 0 0', paddingLeft: 18, lineHeight: 1.6 }}>
                  <li>貸切（買い切り）予約の受付：有効（「設定」タブ→配信設定「貸切対応」）</li>
                  <li>1名でのご来店は相席が前提：有効（「設定」タブ→配信設定「1名利用の相席ルール」）</li>
                  <li>空き枠の管理方式：日ごとの空き枠（daily）（「設定」タブ「容量モデル」）</li>
                  <li>「ご利用目的」の選択肢：飲食店向け（誕生日・記念日／接待・会食／友人・仲間と／家族で／デート／その他）（「設定」タブ「予約時の質問項目」）</li>
                  {/* Apple CEO視点レビュー・ラウンド41での指摘：上記4件だけでは飲食店向け既定値の
                      一部しか警告していなかった（Code.gsのdefaultFeatureSettings/getSettings等の
                      既定値を確認し、以下4件も同種の見落としがあると判明）。 */}
                  <li>予約経路の選択肢：食べログを含む（「設定」タブ「予約経路」）</li>
                  <li>同伴者情報の入力欄：有効（「設定」タブ→配信設定「同伴者情報」）</li>
                  <li>店舗固有機能タブの通知セクション：食べログ・カレンダー同期向けの項目が既定表示（「通知」タブ「店舗固有機能」）</li>
                  <li>変更・キャンセルの受付締切：来店の2〜3日前22:00（飲食店の会席コース発注を前提。「設定」タブ「受付締切」）</li>
                  {/* Apple CEO視点レビュー・ラウンド52での指摘：見積/承認フロー（Code.gsのdefaultFeatureSettings()で
                      全店舗共通で既定ON＝車修理工場向けに新設した機能）は、業種プリセットを選んだ場合は
                      buildPresetPatchが飲食店・美容院等の各プリセットで明示的にOFFへ上書きするため気付かれ
                      なかったが、業種を選ばずに進んだ場合（このブロック）はfsetPatch自体が送られず、Code.gs側の
                      生の既定値（見積/承認フローON）がそのまま残る。上記のリストは「飲食店向け既定値が残る」
                      項目のみを警告していたが、これは方向が逆（車修理工場向けの機能が飲食店等にも残る）の
                      見落としだった。 */}
                  <li>見積/承認フロー（予約編集画面の部品代・工賃入力欄、お客様への見積送信機能）：有効（車修理工場・クリニック等、来店前の金額事前承諾を想定した機能です。「設定」タブ→配信設定「見積/承認フロー」でOFFにできます）</li>
                  {/* 最終監査ラウンド53：見積/承認フローと全く同じ構造の見落とし。postVisitFollowUp（来店後の
                      お礼・口コミ依頼）はCode.gsのdefaultFeatureSettings()で全店舗共通・既定ON（口コミ依頼含む）
                      だが、業種プリセットを選んだ場合はinterview（面接/カウンセリング）で丸ごとOFF、
                      clinic（クリニック）で口コミ依頼のみOFFへbuildPresetPatchが明示的に上書きする
                      （公平性・医療広告ガイドラインの観点でのレビュー指摘、round38付近）。業種を選ばずに
                      進んだ場合（このブロック）はその上書きが一切効かず、Code.gs側の生の既定値（お礼メッセージ・
                      口コミ依頼とも有効）がそのまま残ってしまう見落としが未警告だったため追加する。 */}
                  <li>来店後のお礼・口コミ依頼：有効（面接/カウンセリング・クリニック等、来店後のお礼メッセージや口コミ依頼の自動送信が業種にそぐわない場合は「設定」タブ→配信設定「来店後のお礼・口コミ依頼」でOFFにできます）</li>
                </ul>
              </div>
            )}

            <div style={{ marginBottom: 14 }}>
              <label htmlFor="su-restaurantName" style={labelStyle}>店舗の正式名称 *</label>
              <input id="su-restaurantName" value={form.restaurantName} onChange={set('restaurantName')} placeholder="例：喫茶 巡" style={inputStyle} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label htmlFor="su-restaurantShort" style={labelStyle}>店舗の短縮名 *</label>
              <input id="su-restaurantShort" value={form.restaurantShort} onChange={set('restaurantShort')} placeholder="例：巡" style={inputStyle} />
              <div style={hintStyle}>Googleカレンダーの予定タイトルの照合に使われます（後から変更すると既存予約の空き枠計算に影響するため、決めたらなるべく変更しないでください）</div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label htmlFor="su-calendarId" style={labelStyle}>予約管理用Googleカレンダーのメールアドレス *</label>
              <input id="su-calendarId" value={form.calendarId} onChange={set('calendarId')} placeholder="例：shop-name@gmail.com" style={inputStyle} />
              {/* 直前の店舗短縮名フィールドには説明があるのに、この項目だけ何のための入力か・
                  どこで確認できるかの案内が無かった（業種経営者陣視点レビュー・ラウンド38での指摘：
                  非技術者の店主が初めて設定する際に最も迷いやすい項目の一つ）。 */}
              <div style={hintStyle}>予約を反映させたいGoogleカレンダーのアドレスです。カレンダーの設定画面（歯車アイコン→「カレンダーの設定」→対象カレンダーを選択）の「カレンダーの統合」欄にある「カレンダーID」をそのまま貼り付けてください（Googleアカウントのメールアドレスと同じ場合もあります）。</div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label htmlFor="su-adminPassword" style={labelStyle}>管理画面パスワード *</label>
              <input id="su-adminPassword" type="password" value={form.adminPassword} onChange={set('adminPassword')} style={inputStyle} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label htmlFor="su-adminPasswordConfirm" style={labelStyle}>管理画面パスワード（確認） *</label>
              <input id="su-adminPasswordConfirm" type="password" value={form.adminPasswordConfirm} onChange={set('adminPasswordConfirm')} style={inputStyle} />
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
                <label htmlFor="su-lineToken" style={labelStyle}>LINE Messaging APIのチャンネルアクセストークン</label>
                <input id="su-lineToken" value={form.lineToken} onChange={set('lineToken')} style={inputStyle} />
              </div>
              <div style={{ marginBottom: 10 }}>
                <label htmlFor="su-liffId" style={labelStyle}>LIFF ID</label>
                <input id="su-liffId" value={form.liffId} onChange={set('liffId')} style={inputStyle} />
              </div>
              <div>
                <label htmlFor="su-staffGroupId" style={labelStyle}>スタッフ通知用LINEグループID</label>
                <input id="su-staffGroupId" value={form.staffGroupId} onChange={set('staffGroupId')} style={inputStyle} />
              </div>
            </div>

            {/* index.js/admin.jsの入力バリデーションエラー（inputErr/cfErr等）と同じ、role="alert"
                （暗黙のaria-live="assertive"）が、このページのバリデーションエラーにだけ無かった
                （Appleデザインチーム視点レビュー・ラウンド50での指摘）。この分岐はステップ変更を
                伴わず同じ画面内に出現するため、上のフォーカス移動（stepContentRef）だけでは
                スクリーンリーダーに気づかれない。 */}
            {formErr && <div role="alert" aria-live="assertive" style={{ background: 'var(--danger-bg)', border: '1px solid var(--danger-border)', color: 'var(--danger-text)', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 14 }}>{formErr}</div>}

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setStep(preset ? (preset.questions.length ? 'questions' : 'category') : 'category')} style={btnGray}>← 戻る</button>
              <button onClick={submit} style={btnPrimary}>この内容で初期設定する</button>
            </div>
          </div>
        )}

        {step === 'submitting' && (
          <div style={card} ref={stepContentRef}>
            <div role="status" aria-live="polite">
              <h2 style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 14, fontWeight: 'normal', margin: 0, padding: '20px 0' }}>設定を反映しています…</h2>
            </div>
          </div>
        )}

        {step === 'done' && result && (
          <div style={card} ref={stepContentRef}>
            <div aria-hidden="true" style={{ fontSize: 24, textAlign: 'center', marginBottom: 8 }}>✅</div>
            <h2 style={{ fontSize: 15, fontWeight: 'bold', color: 'var(--text-primary)', textAlign: 'center', margin: '0 0 16px' }}>初期設定が完了しました</h2>
            {result.warning && (
              <div style={{ background: 'var(--warning-bg)', border: '1px solid var(--warning-border)', color: 'var(--warning-text)', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 14 }}>{result.warning}</div>
            )}
            {needsStaff && (
              <div style={{ background: 'var(--amber-bg)', border: '1px solid var(--amber-border)', color: 'var(--amber-text)', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 14 }}>
                ⚠️ 管理画面にログインしたら、{resolvedSettings.staffLabel || '担当者'}を最低1{resolvedSettings.countUnit || '名'}登録してください（登録するまでお客様の予約が全て「対応不可」になります）。
              </div>
            )}
            {!preset && (
              <div style={{ background: 'var(--amber-bg)', border: '1px solid var(--amber-border)', color: 'var(--amber-text)', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 14 }}>
                ⚠️ 業種を選択しなかったため、以下は飲食店（コース制）向けの既定値のまま反映されています。当てはまらない場合は、管理画面の「設定」タブでそれぞれ見直してください。
                <ul style={{ margin: '6px 0 0', paddingLeft: 18, lineHeight: 1.6 }}>
                  <li>貸切（買い切り）予約の受付：有効（配信設定「貸切対応」）</li>
                  <li>1名でのご来店は相席が前提：有効（配信設定「1名利用の相席ルール」）</li>
                  <li>空き枠の管理方式：日ごとの空き枠（daily）（「容量モデル」）</li>
                  <li>「ご利用目的」の選択肢：飲食店向け（誕生日・記念日／接待・会食／友人・仲間と／家族で／デート／その他）（「予約時の質問項目」）</li>
                  <li>予約経路の選択肢：食べログを含む（「予約経路」）</li>
                  <li>同伴者情報の入力欄：有効（配信設定「同伴者情報」）</li>
                  <li>店舗固有機能タブの通知セクション：食べログ・カレンダー同期向けの項目が既定表示（「通知」タブ「店舗固有機能」）</li>
                  <li>変更・キャンセルの受付締切：来店の2〜3日前22:00（「受付締切」）</li>
                  {/* 上の警告ブロック（接続設定画面）と同じ内容を、送信後にもう一度確認できるようこの完了画面にも
                      揃える（ラウンド52での指摘）。 */}
                  <li>見積/承認フロー（予約編集画面の部品代・工賃入力欄、お客様への見積送信機能）：有効（車修理工場・クリニック等、来店前の金額事前承諾を想定した機能です。配信設定「見積/承認フロー」でOFFにできます）</li>
                  {/* 最終監査ラウンド53：上の警告ブロック（接続設定画面）と同じ理由で、こちらの完了画面にも揃える。 */}
                  <li>来店後のお礼・口コミ依頼：有効（面接/カウンセリング・クリニック等、来店後のお礼メッセージや口コミ依頼の自動送信が業種にそぐわない場合は配信設定「来店後のお礼・口コミ依頼」でOFFにできます）</li>
                </ul>
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
          <div style={card} ref={stepContentRef}>
            <h2 style={{ fontSize: 15, fontWeight: 'bold', color: 'var(--text-primary)', margin: '0 0 12px' }}>エラーが発生しました</h2>
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
          /* --text-muted/--text-faintは元々#888/#aaaで、白(#fff)〜ごく薄いグレー(#fafafa)の
             背景に対してそれぞれ約3.5:1・2.3:1しかなく、WCAG AAの通常文字4.5:1に届いていなかった
             （admin.jsのラウンド49で見つかった同種の問題と同じ現象だが、この:rootはadmin.js側とは
             別ファイルの独立したグローバルスタイルのため、admin.js側の修正は自動的には適用されて
             いなかった。Appleデザインチーム視点レビュー・ラウンド50での指摘）。admin.js側で検証済みの
             値をベースに、--bg-subtle(#fafafa)側でも4.5:1を満たすよう--text-faintのみ僅かに
             濃くして採用する（明暗の相対関係＝faintの方がmutedより淡い、は維持）。
             ラウンド50時点の#737373は--bg-subtle(#fafafa)に対しては約4.54:1で通っていたが、
             このページの本体背景である--bg-page(#f5f5f5)（141行目付近、ステップ進捗表示
             「n/合計」がカードの外＝ここに直接乗る）に対しては未確認のままで、実測すると
             約4.35:1しか無くWCAG AA未達だった（bg-subtleだけ検証しbg-pageは見ていなかった。
             admin.js側も同じ観点で見直した結果、そちらの#767676も対--bg-page約4.17:1で
             同様に未達と判明。Appleデザインチーム視点レビュー・ラウンド51でのクロスページ
             一貫性監査）。最も暗い--bg-pageに対しても4.5:1を超える値まで底上げし、
             admin.js側と同じ#6d6d6dへ統一する（対白4.75:1・対--bg-page 4.75:1・
             対--bg-subtle 4.96:1）。 */
          --text-muted: #666666;
          --text-faint: #6d6d6d;
          --shadow-sm: rgba(0,0,0,.08);
          --danger-bg: #ffebee;
          --danger-border: #ffcccc;
          --danger-text: #c62828;
          --warning-bg: #fff3e0;
          --warning-border: #ffe0b2;
          /* 旧#e65100は背景#fff3e0に対し約3.46:1でWCAG AAの4.5:1未達（ラウンド50での指摘）。
             同系統の濃いオレンジへ底上げする。 */
          --warning-text: #b23c00;
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
            /* 旧#6b7178は背景#1c2126に対し約3.3:1でWCAG AA未達（admin.js側ラウンド49と同じ現象、
               同じ理由でこの:rootには自動反映されていなかった。ラウンド50での指摘）。admin.js側で
               検証済みの修正後の値を採用する。 */
            --text-faint: #868c93;
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
