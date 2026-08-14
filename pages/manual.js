import { useState, useEffect } from 'react'
import Head from 'next/head'
import { api } from '../lib/api'

// スタッフ向け操作マニュアル。認証不要（店舗のスタッフ全員が、Claudeのアカウントなどを持たなくても
// このURLを開くだけで読める）。店舗の実際の設定（getSettings、既にお客様画面・管理画面が使っている
// 公開・無認証のAPI）を読み取り、その店舗で実際に有効になっている機能だけを操作対象として案内する。
// 業態（コース制の飲食店／担当者制の美容院や整体等／シンプルな受付のみ等）によって使う機能が異なるため、
// 業態ごとに別のマニュアルを手動で管理するのではなく、1つのページが店舗設定に自動で合わせる方式にしている。
//
// 設定の取得が終わるまで（または失敗した場合）は、業態に偏った文言（「コース」等）や、章の
// 表示/非表示が途中で切り替わるレイアウトシフトを避けるため、確定するまでは本文を出さずローディング
// 表示のみにする（テスト全部隊レビューで指摘：読み込み中に飲食店語彙がデフォルト表示される問題／
// 章がちらつく問題への対応）。
// pages/index.jsと同じキャッシュキーを共有する（同じ店舗設定なので、お客様画面かこのページの
// どちらかを先に開いていれば、もう片方も初回から即座に表示できる）。
const SETTINGS_CACHE_KEY = 'kaiya_settings_cache_v1'

export default function Manual() {
  const [s, setS] = useState(null)
  const [loadErr, setLoadErr] = useState(false)

  useEffect(() => {
    let hasCached = false
    try {
      const cached = localStorage.getItem(SETTINGS_CACHE_KEY)
      if (cached) {
        const parsed = JSON.parse(cached)
        if (parsed && parsed.success) { setS(parsed); hasCached = true }
      }
    } catch {}
    api.getSettings().then((sr) => {
      if (sr && sr.success) {
        setS(sr)
        try { localStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(sr)) } catch {}
      } else if (!hasCached) {
        setLoadErr(true)
      }
    }).catch(() => { if (!hasCached) setLoadErr(true) })
  }, [])

  if (!s && !loadErr) {
    return (
      <div className="ld-wrap">
        <p>読み込み中...</p>
        <style jsx>{`
          .ld-wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #EFEDE4; color: #6E6656; font-family: "Hiragino Kaku Gothic ProN","Yu Gothic Medium","Noto Sans JP",sans-serif; }
          @media (prefers-color-scheme: dark) { .ld-wrap { background: #121C19; color: #93A399; } }
        `}</style>
      </div>
    )
  }

  return <ManualContent s={s} loadErr={loadErr} />
}

function ManualContent({ s, loadErr }) {
  // s が取得できなかった場合は、業態を問わない中立的な文言にし、設定に依存する章（⑤⑥）は
  // 存在を確認できない以上出さない（誤って「無い機能」を案内するより、控えめに倒す）。
  const itemLabel = s ? (s.itemLabel || 'ご予約') : 'ご予約'
  const itemIcon = s ? (s.itemIcon || '📋') : '📋'
  const staffOn = !!(s && s.staffAssignmentEnabled)
  const guestCountOn = !s || s.guestCountEnabled !== false
  const waitlistOn = !!(s && s.featureFlags && s.featureFlags.waitlistEnabled)
  const kasshikiOn = !!(s && s.featureFlags && s.featureFlags.kasshikiEnabled)
  // Code.gs側のgetSettingsコメントの通り、この2つはスタッフマニュアルの機能一覧に載せるために
  // featureFlagsへ追加されたが、追加当時この一覧（catalog）自体への反映が漏れていた
  // （汎用化テスト・ラウンド45での指摘：オフの機能どころか機能の存在自体が一覧から丸ごと欠落していた）。
  const estimateFlowOn = !!(s && s.featureFlags && s.featureFlags.estimateFlowEnabled)
  const recurringBookingOn = !!(s && s.featureFlags && s.featureFlags.recurringBookingEnabled)
  // 複数担当者同時アサイン（admin.jsのEditModal）はON/OFFの設定トグルを持たず、staffAssignmentEnabledかつ
  // 担当者が2名以上登録されている場合に常に使える機能のため、機能一覧には載せず（③編集の案内文でのみ言及）。
  const multiStaffOn = staffOn && !!(s && Array.isArray(s.staffRoster) && s.staffRoster.length > 1)
  const bizName = (s && s.restaurantName) || '店舗'
  // 導入ウィザード（admin.js）で業種ごとに設定できる呼び方（スタイリスト・整備士・車両等）。
  // admin.js側の画面表示もこの値を使うようになったため、マニュアルもここに合わせて一致させる。
  const itemPeople = (s && s.staffLabel) || '担当者'
  // 「ご来店」は業態によって呼び方が異なる（クリニックの「ご来院」、面接の「ご来訪」等）ため、
  // staffLabelと同じくvisitNounで設定化されている（Code.gsのgetSettingsコメント参照）。見積・承認フローは
  // 特定の業態にロックされたON/OFFトグルではなく配信設定タブからどの業態でも切り替えられるため
  // （汎用化テスト・ラウンド46での指摘：以前は「来店」に固定していたが、クリニック等がONにした場合に
  // admin.js側の表記（ご来院）と食い違っていた）、ここも他の箇所と同じくvisitNounを使う。
  const visitNoun = (s && s.visitNoun) || '来店'
  // 見積内訳（部品代・工賃）は車修理工場を想定した固定の日本語文言のまま全業態向けマニュアルに
  // 出続けていた（業種経営者陣視点レビュー・ラウンド49で指摘、ラウンド50で設定化）。visitNoun等と
  // 同じくCode.gs側のgetSettingsが返す値をそのまま使う。
  const estimatePartsLabel = (s && s.estimatePartsLabel) || '部品代'
  const estimateLaborLabel = (s && s.estimateLaborLabel) || '工賃'

  // 章番号（TOC・各章の見出し番号）を、実際に表示される章だけを数えて動的に振り直す。
  // 以前は⑤⑥（キャンセル待ち／臨時休み）が固定の番号で、機能がOFFの店舗ではその番号が
  // 欠番になり「④の次が⑥」のように見えて分かりにくかった（スタッフ目線レビューでの指摘）。
  const CIRCLED_NUMS = ['①','②','③','④','⑤','⑥','⑦','⑧','⑨','⑩']
  const sectionOrder = ['login', 'calendar', 'add', 'edit', ...(waitlistOn ? ['waitlist'] : []), ...(staffOn ? ['dayoff'] : []), 'accounts', 'trouble']
  const secNum = {}
  sectionOrder.forEach((id, i) => { secNum[id] = { c: CIRCLED_NUMS[i] || `${i + 1}.`, n: String(i + 1).padStart(2, '0') } })

  // 以下のマニュアル本文は「今オンになっている機能だけ」を操作対象として案内する（オフの機能の
  // 手順まで載せると実際の画面と合わず迷わせるため）。ただし、それだけだと「オフにしている機能の
  // 存在自体を誰も知らない」という抜け漏れが生まれるため、末尾の機能一覧では設定に関わらず全機能を
  // 一覧表示し、ON/OFFの状態を明示する。ここに新しい設定トグルを追加した場合は、この一覧にも
  // 追記すること（追記を忘れると同じ「オフの機能が誰にも見えない」問題が再発する）。
  const catalog = s ? [
    { name: '担当者指名（スタッフ指名予約）', on: !!s.staffAssignmentEnabled, desc: 'お客様が特定の担当者を指名して予約できるようにする' },
    { name: '人数選択', on: s.guestCountEnabled !== false, desc: 'お客様に人数を選ばせる（OFFの場合は常に1名扱い）' },
    { name: '貸切予約', on: kasshikiOn, desc: '貸切予約が入った日は他の予約を自動的にブロックする' },
    // capacityModelが'perStaff'（担当者単位の空き状況で判定する業態）の場合、この設定はバックエンドの
    // 判定に一切使われないデッドセッティングになる（admin.jsの配信設定タブでも同じ理由でこの業態には
    // 表示自体を出していない）。マニュアルの機能一覧でも同じ基準で出し分ける。
    ...(s.capacityModel !== 'perStaff' ? [
      { name: '1名利用は相席時のみ受付', on: !!(s.featureFlags && s.featureFlags.singleDinerRequiresCompanyEnabled), desc: 'ONの場合、1名様のご予約は他のお客様の予約が既にある日のみ受付する' },
    ] : []),
    { name: '定期予約（シリーズ予約）', on: recurringBookingOn, desc: '同じ内容の予約を複数回分まとめてお申し込みいただけるようにする（美容院の定期施術・車検の点検等）' },
    { name: '見積・承認フロー', on: estimateFlowOn, desc: `${visitNoun}前に金額が確定しない業態向けに、見積金額を提示してお客様の承諾を待てるようにする（承諾後の作業完了通知も含む）` },
    { name: 'キャンセル待ち', on: waitlistOn, desc: '満席の日にお客様がキャンセル待ちに登録できるようにする' },
    { name: '期限後の変更・キャンセル依頼', on: !!(s.featureFlags && s.featureFlags.lateRequestEnabled), desc: '受付期限を過ぎた後も、お客様から店舗への依頼だけは送れるようにする' },
    { name: '増枠（繁忙期の上限を一時的に増やす）', on: !!(s.capacityBoosts && s.capacityBoosts.length > 0), desc: '設定タブで期間を指定して上限を一時的に増やす' },
    { name: '広告枠', on: !!s.adBannerEnabled, desc: '予約完了画面・マイ予約画面に広告を表示する' },
    { name: 'メールアドレス収集（ゲスト向け確認メール）', on: !!s.emailCollectionEnabled, desc: 'LINEを使わないお客様にも確認メールを送れるようにする' },
    { name: '英語対応', on: !!(s.enabledLanguages && s.enabledLanguages.includes('en')), desc: 'お客様の予約画面を英語表示にも切り替えられるようにする' },
  ] : []

  return (
    <>
      <Head>
        <title>{`${bizName} 予約システム スタッフマニュアル`}</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <header className="hero">
        <span className="eyebrow">{itemIcon} {bizName} 予約システム</span>
        <h1>スタッフ操作マニュアル</h1>
        <p className="sub">管理画面（admin）の日々の使い方をまとめています。困ったときはまずこのページの「こんな時は」を確認してください。</p>
        <div className="meta">このページはスタッフ全員に共有してかまいません（ログイン不要）</div>
      </header>

      <nav className="toc">
        <a href="#login">{secNum.login.c}ログイン</a>
        <a href="#calendar">{secNum.calendar.c}予約一覧の見方</a>
        <a href="#add">{secNum.add.c}電話予約を入れる</a>
        <a href="#edit">{secNum.edit.c}変更・キャンセル</a>
        {waitlistOn && <a href="#waitlist">{secNum.waitlist.c}キャンセル待ち</a>}
        {staffOn && <a href="#dayoff">{secNum.dayoff.c}{itemPeople}の臨時休み</a>}
        <a href="#accounts">{secNum.accounts.c}個人アカウント</a>
        <a href="#trouble">{secNum.trouble.c}こんな時は</a>
        <a href="#catalog">機能一覧</a>
      </nav>

      <div className="wrap">
        {loadErr && (
          <div className="callout warn" style={{ marginTop: 24 }}>
            <span className="icon" aria-hidden="true">⚠️</span>
            <div>店舗設定を読み込めなかったため、この店舗固有の表示調整ができていません。以下は共通の操作方法です。</div>
          </div>
        )}

        <section className="card" id="login">
          <div className="kicker"><span className="num">{secNum.login.n}</span></div>
          <h2>ログインする</h2>
          <p>管理画面のURLを開くと、まずログイン画面が表示されます。ログイン方法は2種類あります。</p>
          <table className="role-table">
            <tbody>
              <tr><th>ログイン方法</th><th>お名前欄</th><th>権限</th></tr>
              <tr><td>共通パスワードのみ</td><td>空欄のまま</td><td><b>店長</b>として全操作可（これまでと同じ）</td></tr>
              <tr><td>個人アカウント</td><td>自分の名前を入力</td><td>「店長」または「スタッフ」（{secNum.accounts.c}で作成した権限に従う）</td></tr>
            </tbody>
          </table>
          <div className="callout tip">
            <span className="icon" aria-hidden="true">💡</span>
            <div><b>個人アカウントを作っていない場合</b>は、お名前欄は空欄のままで大丈夫です。これまで通り共通パスワードだけでログインできます。何も変わりません。</div>
          </div>
          <ol className="steps">
            <li><span className="label">管理画面を開く</span><span className="detail">お店で使っているブラウザのブックマークから開きます。</span></li>
            <li><span className="label">お名前を入力（個人アカウントを使う場合のみ）</span><span className="detail">個人アカウントを持っているスタッフは、ここに自分の名前を入力します。</span></li>
            <li><span className="label">パスワードを入力してログイン</span><span className="detail">共通パスワード、または個人アカウントのパスワードを入力します。</span></li>
          </ol>
        </section>

        <hr className="wave" />

        <section className="card" id="calendar">
          <div className="kicker"><span className="num">{secNum.calendar.n}</span></div>
          <h2>予約一覧の見方</h2>
          <p>ログイン後の最初の画面（<span className="ui">予約一覧</span>タブ）で、カレンダーと当日の予約状況が確認できます。</p>
          <table className="legend">
            <tbody>
              <tr><td><span className="badge b-green">確定あり</span></td><td>その日に確定した予約がある日（カレンダーの色）</td></tr>
              <tr><td><span className="badge b-amber">停止枠あり</span></td><td>一部を予約不可にしている日（カレンダーの色）</td></tr>
              <tr><td><span className="badge b-red">休業日</span></td><td>お店が休みに設定されている日（カレンダーの色）</td></tr>
            </tbody>
          </table>
          {/* 「営業時間変更あり」はカレンダー本体の色ではなく、日付をタップした先の詳細パネルにだけ
              テキストバッジで表示される（スタッフ目線レビューでの指摘：カレンダーが青くなると案内していたが
              実際には青いマス目は存在しない）。上の表から外し、詳細パネルの説明として案内し直す。 */}
          <p>日付をタップすると、その日の予約一覧{s && s.capacityModel !== 'perStaff' && '・残数'}{waitlistOn && '・キャンセル待ちの件数'}が表示され、その日だけ営業時間を変更している場合は<span className="badge b-blue">営業時間変更あり</span>のバッジも出ます。「🔄 最新の予約に更新」を押すと、他のスタッフが今入れた予約もすぐ反映されます。</p>
          <div className="callout tip">
            <span className="icon" aria-hidden="true">💡</span>
            <div>ご{visitNoun}日から<b>35日以上前</b>の予約は、一覧が長くなりすぎないよう自動的に別の記録（アーカイブ）に移動し、この一覧には出てこなくなります。古いご予約について問い合わせがあった場合は、店長にご相談ください（データダウンロード機能で確認できます）。</div>
          </div>
          <p>個々の予約にも、電話対応や当日の判断の参考になる印が付きます。</p>
          <table className="legend">
            <tbody>
              {/* 色は管理画面（admin.js）の実際のバッジ表示と一致させている（スタッフ目線レビューでの指摘：
                  以前は既存の.badgeクラス（緑・アンバー）を流用していたが、実際の画面はオレンジ・赤だった）。
                  以前はインラインstyleの固定色で実装していたため、ダークモードで他のバッジ（b-red/b-amber/
                  b-blue）と同じ「明るいパステルが暗背景に浮く」問題から漏れていた（Appleデザイン視点
                  レビュー・ラウンド26での指摘）。専用クラス化しダークモード上書きも用意する。 */}
              <tr><td><span className="badge b-repeat">常連・{visitNoun}N回目</span></td><td>過去に{visitNoun}実績があるお客様</td></tr>
              <tr><td><span className="badge b-blue">初めてのご{visitNoun}</span></td><td>今回が初回のお客様</td></tr>
              <tr><td><span className="badge b-noshow">⚠️過去に無断キャンセルN回</span></td><td>過去に無断キャンセルの記録があるお客様（電話予約時の再確認等の判断材料にしてください）</td></tr>
            </tbody>
          </table>
        </section>

        <hr className="wave" />

        <section className="card" id="add">
          <div className="kicker"><span className="num">{secNum.add.n}</span></div>
          <h2>電話予約を入れる</h2>
          <p>お客様から電話でご予約を受けたときは、その場で管理画面に入力します。</p>
          <ol className="steps">
            <li><span className="label">日付を選ぶ</span><span className="detail">カレンダーで対象の日付をタップします。</span></li>
            <li><span className="label">「＋ 新規登録」を押す</span>
              <span className="detail">
                「新規予約登録」の画面が開きます。お名前・電話番号・時間{guestCountOn && '・人数'}
                {/* admin.js側の実際の表示条件はs.courses.length > 0のみで、bookingModeは見ていない
                    （「コース無し」業態でも、電話予約用にスタッフだけが選べるコースを登録できる仕様の
                    ため。スタッフ目線レビューでの指摘：この案内文だけbookingModeで絞ってしまっていて、
                    実際には出るはずの${itemLabel}欄の案内が抜けるケースがあった）。 */}
                {s && s.courses && s.courses.length > 0 && `・${itemLabel}`}
                {staffOn && `・ご指名（${itemPeople}）`}などを入力します。
              </span>
            </li>
            <li><span className="label">「予約を登録する」を押す</span><span className="detail">空きがあれば通常どおり保存されます。</span></li>
          </ol>
          <div className="callout warn">
            <span className="icon" aria-hidden="true">⚠️</span>
            <div>
              満席・休業日などの制限に引っかかると、<b>「強制登録（休業日を無視）」</b>というチェックボックスを使うよう案内が出ることがあります。これは<b>本来の制限を無視して無理に登録する</b>機能です。常連のお得意様の特別対応や、システムの都合と実際のお店の状況がズレている場合にのみ使ってください。使う前に一声、店長に確認するのがおすすめです。
            </div>
          </div>
        </section>

        <hr className="wave" />

        <section className="card" id="edit">
          <div className="kicker"><span className="num">{secNum.edit.n}</span></div>
          <h2>予約を変更・キャンセルする</h2>
          <p>予約一覧の各予約から、変更・キャンセル・削除ができます。「キャンセル扱い」と「削除」は別の操作です。</p>
          <table className="role-table">
            <tbody>
              <tr><th>操作</th><th>予約の記録</th><th>使う場面</th></tr>
              <tr><td>キャンセル扱いにする</td><td className="yes">残る（あとで見返せる）</td><td>お客様都合のキャンセルなど、通常のキャンセル</td></tr>
              <tr><td>削除する</td><td className="no">残らない（取り消せない）</td><td>入力ミスの取り消しなど、記録として不要な場合のみ</td></tr>
            </tbody>
          </table>
          <p>どちらの操作にも確認のポップアップが出ます。削除については「LINEでスタッフに通知するか」も選べます。</p>
          {kasshikiOn && (
            <>
              <p className="detail" style={{ color: 'var(--muted)', fontSize: 13 }}>貸切予約が入っている日は、他の予約が自動的にブロックされます（同席不可）。</p>
              <div className="callout warn">
                <span className="icon" aria-hidden="true">⏳</span>
                <div>
                  貸切・大人数のご相談としてお客様が予約すると、ステータスが<b>「要確認」</b>のまま登録されます（予約一覧では「要確認（承認待ち）」の印が付きます）。内容を確認して問題なければ、予約の編集画面からステータスを<b>「確定」</b>に変更してください。「要確認」のままだと、お客様への確定案内が送られません。確定に変えるとLINE登録済みの方にはLINEで、メールアドレスが登録されている方にはメールでも案内が届きます（LINE・メール両方登録している方には両方に届きます。重複ではなく仕様です）。LINE・メールどちらも登録が無い電話予約のお客様には、お手数ですが確定した旨を電話でご連絡ください。
                </div>
              </div>
            </>
          )}
          {estimateFlowOn && (
            <div className="callout tip">
              <span className="icon" aria-hidden="true">💰</span>
              <div>
                {visitNoun}前に金額が確定しない業態向けに、編集画面には<b>「見積」</b>欄があります。金額（必要なら{estimatePartsLabel}・{estimateLaborLabel}の内訳）を入力して<b>「見積を送る（お客様に通知されます）」</b>を押すと、お客様にLINE・メールで通知が届き、お客様は自分の画面から<b>承諾・辞退</b>を選べます（辞退してもご{visitNoun}の予約自体は取り消されません）。承諾された後は<b>「作業完了を通知（お引き取り案内）」</b>を押して、対応が終わったことをお知らせしてください。
              </div>
            </div>
          )}
          {recurringBookingOn && (
            <div className="callout tip">
              <span className="icon" aria-hidden="true">🔁</span>
              <div>
                定期予約（シリーズ予約）の各回には<b>「🔁 定期予約（シリーズ）」</b>欄が表示されます。今回だけキャンセルしたい場合は通常の予約と同じくステータスを「キャンセル」に変更してください。今後の回もまとめてキャンセルしたい場合は<b>「このシリーズの今後の予約をまとめてキャンセル」</b>を押します（本日より前の回・既にキャンセル済みの回には影響しません）。
              </div>
            </div>
          )}
          {multiStaffOn && (
            <div className="callout tip">
              <span className="icon" aria-hidden="true">👥</span>
              <div>
                1件の予約に主担当（ご指名）以外の{itemPeople}も同時に必要な場合は、編集画面の<b>「全員が同時に必要な追加担当者」</b>で該当する{itemPeople}にチェックを入れてください（例：カラー施術で主担当スタイリスト＋アシスタント）。誰でもよい場合は<b>「誰か1人でよい追加担当者（柔軟な候補）」</b>で候補を複数チェックすると、そのうち空いている1人が自動的に割り当てられます。
              </div>
            </div>
          )}
        </section>

        {waitlistOn && (
          <>
            <hr className="wave" />
            <section className="card" id="waitlist">
              <div className="kicker"><span className="num">{secNum.waitlist.n}</span></div>
              <h2>キャンセル待ちに対応する</h2>
              <p>満席の日に、お客様がキャンセル待ちに登録できます。登録内容は<span className="ui">通知</span>タブの一覧に、日付ごとにまとめて表示されます（日付をタップした先の詳細画面ではありません）。{/* スタッフ目線レビューでの指摘：以前はカレンダーの日付詳細画面に表示されると案内していたが、実際の機能は日付を問わず全件を横断表示する通知タブの中にある */}</p>
              <p className="detail" style={{ color: 'var(--muted)', fontSize: 13 }}>キャンセルが出た場合、LINE登録済みのお客様には自動でお知らせが届きます。LINEをお持ちでない方への連絡が必要な場合のみ、スタッフから電話等でご案内してください。いずれも先着順の考え方で、ご案内を約束するものではありません。</p>
              {/* スタッフ目線レビューでの指摘：通知タブ自体（キャンセル待ち一覧を含む）は個人アカウントの
                  スタッフには表示されない（店長権限のみ）。⑤の臨時休みと同じ制約だが、以前はここにだけ
                  注記が無く、キャンセル待ちへの対応方法をスタッフ向けに案内しているのに、実際にはスタッフの
                  画面にその一覧が出てこないという食い違いがあった。 */}
              <div className="callout tip">
                <span className="icon" aria-hidden="true">💡</span>
                <div><b>通知タブは店長権限のログインでのみ表示されます</b>（{secNum.accounts.c}参照）。個人アカウントでログインしているスタッフの画面には、このキャンセル待ち一覧は表示されません。対応が必要な場合は店長に確認してください。</div>
              </div>
            </section>
          </>
        )}

        {staffOn && (
          <>
            <hr className="wave" />
            <section className="card" id="dayoff">
              <div className="kicker"><span className="num">{secNum.dayoff.n}</span></div>
              <h2>{itemPeople}の臨時休みを設定する</h2>
              <p>設定タブの「指名できる{itemPeople}一覧」から、特定の日付だけを休みにできます（通常のシフトはそのまま、その日だけ指名を受け付けなくなります）。</p>
              <div className="callout tip">
                <span className="icon" aria-hidden="true">💡</span>
                <div>この操作は<b>店長権限のログインでのみ表示されます</b>（{secNum.accounts.c}参照）。スタッフのログインでは設定タブ自体が表示されないため、臨時休みが必要な場合は店長に伝えてください。</div>
              </div>
            </section>
          </>
        )}

        <hr className="wave" />

        <section className="card" id="accounts">
          <div className="kicker"><span className="num">{secNum.accounts.n}</span></div>
          <h2>スタッフ個人アカウント（店長のみ）</h2>
          <p>設定タブの「スタッフ個人ログイン」から、個人アカウントを作成・削除できます。この操作は店長権限のログインでのみ表示されます。</p>
          <table className="role-table">
            <tbody>
              <tr><th>権限</th><th>できること</th></tr>
              <tr><td>店長</td><td>予約管理・設定変更・顧客データ・アカウント管理など全操作</td></tr>
              <tr><td>スタッフ</td><td>予約の登録・確認・変更のみ（設定変更・価格変更・顧客データダウンロードは不可）</td></tr>
            </tbody>
          </table>
          <div className="callout tip">
            <span className="icon" aria-hidden="true">💡</span>
            <div>個人アカウントを作らなくても運用に支障はありません。全員が共通パスワードのままでも、これまでと同じように使えます。</div>
          </div>
        </section>

        <hr className="wave" />

        <section className="card" id="trouble">
          <div className="kicker"><span className="num">{secNum.trouble.n}</span></div>
          <h2>こんな時は</h2>
          <table className="legend">
            <tbody>
              <tr><td>パスワードを何度も間違えた</td><td>一定回数間違えると数分間ロックされます。少し時間をおいてから再度お試しください。</td></tr>
              <tr><td>お客様から「予約できない」と連絡があった</td><td>その日が休業日・満席・停止枠になっていないか、日付の詳細画面で確認してください。</td></tr>
              <tr><td>他のスタッフが入れた予約が見えない</td><td>「🔄 最新の予約に更新」を押してください。自動更新ではないため、手動更新が必要です。</td></tr>
              <tr><td>それでも解決しない</td><td>店長・システム担当に連絡してください。</td></tr>
            </tbody>
          </table>
        </section>

        <hr className="wave" />

        <section className="card" id="catalog">
          <h2>この店舗で使える機能</h2>
          <p>ここまでの手順は今オンになっている機能だけを説明していますが、<b>この予約システム自体が持っている機能を全て一覧</b>で示すと以下の通りです。オフの機能は今の画面には出てきませんが、無くなったわけではありません。</p>
          {catalog.length > 0 ? (
            <table className="role-table">
              <tbody>
                <tr><th>機能</th><th>状態</th><th>説明</th></tr>
                {catalog.map(c => (
                  <tr key={c.name}>
                    <td>{c.name}</td>
                    <td><span className={`badge ${c.on ? 'b-green' : 'b-off'}`}>{c.on ? 'ON' : 'OFF'}</span></td>
                    <td style={{ color: 'var(--ink-soft)' }}>{c.desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p style={{ color: 'var(--muted)' }}>店舗設定を読み込めなかったため、この一覧は表示できません。</p>
          )}
          <div className="callout tip">
            <span className="icon" aria-hidden="true">💡</span>
            <div>OFFになっている機能を使いたい場合は、店長または導入担当にご相談ください。設定タブから切り替えられます。</div>
          </div>
        </section>
      </div>

      <footer>{bizName} 予約システム — スタッフ操作マニュアル</footer>

      <style jsx global>{`
        /* --mutedは#6E6656で、本文が乗る背景（--paper/--bg）では4.5:1超だが、機能一覧のOFFバッジ
           （.badge.b-off、背景--line）に乗せると約3.9:1でWCAG AAの4.5:1に届いていなかった
           （Appleデザインチーム視点レビュー・ラウンド50での指摘、admin.js側で扱った--text-muted/
           --text-faintのコントラスト是正と同種の問題）。他の用途（本文中の.meta等）は元々十分な
           余裕があるため、少し濃くしてもそちらの見た目はほぼ変わらない。 */
        :root { --bg:#EFEDE4; --paper:#F8F6EF; --ink:#1F2E2B; --ink-soft:#3B4A46; --muted:#5A5344; --accent:#0F6E5C; --accent-soft:#DCEAE4; --warm:#C9642A; --warm-soft:#F5E3D3; --line:#DCD5C2; --shadow:rgba(31,46,43,.08); }
        :global(html), :global(body) { margin: 0; background: var(--bg); color: var(--ink); font-family: "Hiragino Kaku Gothic ProN","Yu Gothic Medium","Noto Sans JP",sans-serif; line-height: 1.9; }
        .hero { padding: 56px 20px 40px; text-align: center; background: linear-gradient(180deg, var(--paper), var(--bg)); border-bottom: 1px solid var(--line); }
        .eyebrow { display: inline-flex; align-items: center; gap: 8px; font-size: 12px; letter-spacing: .12em; color: var(--accent); font-weight: 700; margin-bottom: 14px; }
        h1 { font-family: "Hiragino Mincho ProN","Yu Mincho",serif; font-size: clamp(26px,4vw,34px); margin: 0 0 10px; font-weight: 600; }
        h2 { font-family: "Hiragino Mincho ProN","Yu Mincho",serif; font-size: 21px; margin: 0 0 18px; font-weight: 600; }
        .sub { color: var(--ink-soft); font-size: 15px; margin: 0; max-width: 520px; margin-inline: auto; }
        .meta { margin-top: 18px; font-size: 12px; color: var(--muted); }
        .toc { position: sticky; top: 0; z-index: 10; background: var(--paper); border-bottom: 1px solid var(--line); overflow-x: auto; white-space: nowrap; padding: 10px 16px; box-shadow: 0 2px 8px var(--shadow); }
        .toc a { display: inline-block; font-size: 12.5px; color: var(--ink-soft); text-decoration: none; padding: 6px 12px; border-radius: 20px; margin-right: 4px; }
        .toc a:hover { background: var(--accent-soft); color: var(--accent); }
        .wrap { max-width: 760px; margin: 0 auto; padding: 0 20px 100px; }
        .card { background: var(--paper); border: 1px solid var(--line); border-radius: 14px; padding: 28px 28px 8px; margin-top: 28px; box-shadow: 0 1px 3px var(--shadow); scroll-margin-top: 56px; }
        .kicker .num { font-size: 13px; font-weight: 700; color: var(--accent); letter-spacing: .05em; }
        .card p { color: var(--ink-soft); font-size: 15px; }
        .ui { color: var(--accent); font-weight: 700; }
        ol.steps { list-style: none; margin: 0; padding: 0; counter-reset: step; }
        ol.steps > li { position: relative; padding: 4px 0 22px 40px; counter-increment: step; border-left: 2px solid var(--line); margin-left: 13px; }
        ol.steps > li:last-child { border-left-color: transparent; padding-bottom: 6px; }
        ol.steps > li::before { content: counter(step); position: absolute; left: -13px; top: 0; width: 26px; height: 26px; background: var(--accent); color: var(--paper); border-radius: 50%; font-size: 13px; font-weight: 700; display: flex; align-items: center; justify-content: center; }
        ol.steps > li .label { font-weight: 700; color: var(--ink); display: block; margin-bottom: 3px; }
        ol.steps > li .detail { color: var(--ink-soft); font-size: 14.5px; }
        .callout { display: flex; gap: 12px; border-radius: 10px; padding: 14px 16px; margin: 16px 0 22px; font-size: 14px; line-height: 1.8; }
        .callout .icon { font-size: 18px; flex-shrink: 0; }
        .callout.tip { background: var(--accent-soft); color: var(--ink); }
        .callout.warn { background: var(--warm-soft); color: var(--ink); }
        .callout b { color: var(--warm); }
        .callout.tip b { color: var(--accent); }
        table.legend, table.role-table { width: 100%; border-collapse: collapse; margin: 10px 0 22px; font-size: 14px; }
        table.legend td { padding: 7px 4px; border-bottom: 1px solid var(--line); vertical-align: top; }
        table.legend td:first-child { width: 130px; white-space: nowrap; }
        .role-table th, .role-table td { border: 1px solid var(--line); padding: 10px 12px; text-align: left; }
        .role-table th { background: var(--accent-soft); color: var(--ink); font-weight: 700; font-size: 13px; }
        .role-table td.yes { color: var(--accent); font-weight: 700; }
        .role-table td.no { color: var(--muted); }
        .badge { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 700; padding: 3px 10px; border-radius: 20px; }
        .badge.b-red { background: #FBE4E2; color: #A23E3E; }
        .badge.b-amber { background: #FBEBD2; color: #9A6B14; }
        .badge.b-blue { background: #E1EBFA; color: #2A5AA0; }
        .badge.b-green { background: var(--accent-soft); color: var(--accent); }
        .badge.b-off { background: var(--line); color: var(--muted); }
        .badge.b-repeat { background: #fff3e0; color: #e65100; }
        .badge.b-noshow { background: #ffebee; color: #c62828; }
        .wave { border: none; height: 18px; margin: 34px 0 0; background: none; position: relative; }
        .wave::before { content: ""; position: absolute; inset: 0; background-image: radial-gradient(circle at 10px 0, transparent 9px, var(--line) 9.5px, transparent 10px); background-size: 20px 18px; background-repeat: repeat-x; opacity: .7; }
        footer { text-align: center; color: var(--muted); font-size: 12px; padding: 40px 20px 10px; }
        @media (max-width: 520px) { .card { padding: 22px 18px 6px; } .hero { padding: 42px 16px 30px; } }
        @media (prefers-color-scheme: dark) {
          :root { --bg:#121C19; --paper:#17221E; --ink:#EAEEE9; --ink-soft:#C5D1C9; --muted:#93A399; --accent:#4FCBAA; --accent-soft:#1F352D; --warm:#F0985C; --warm-soft:#35271C; --line:#2B3934; --shadow:rgba(0,0,0,.35); }
          /* b-red/b-amber/b-blueは固定hexで、b-green/b-offと違いCSS変数化されておらず、
             ダークモードでは明るいパステルの背景に暗い文字色のまま浮いて見えていた
             （Appleデザイン視点レビューでの指摘）。ここで暗背景向けの配色に上書きする。 */
          .badge.b-red { background: #3A2323; color: #F0A8A0; }
          .badge.b-amber { background: #3A2E17; color: #F0C87A; }
          .badge.b-blue { background: #1E2C40; color: #9FC0EF; }
          .badge.b-repeat { background: #3A2E17; color: #F0C87A; }
          .badge.b-noshow { background: #3A2323; color: #F0A8A0; }
        }
      `}</style>
    </>
  )
}
