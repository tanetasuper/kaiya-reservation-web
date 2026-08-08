import { useState, useEffect, useRef, useMemo } from 'react'
import Head from 'next/head'
import Script from 'next/script'
import { api, setAdminPassword, setStaffIdentity } from '../lib/api'

const TIME_SLOTS = ['17:00','17:30','18:00','18:30','19:00','19:30','20:00','20:30','21:00']

function generateSlots(tr) {
  const slots = []
  const [sh, sm] = tr.start.split(':').map(Number)
  const [eh, em] = tr.end.split(':').map(Number)
  let cur = sh * 60 + sm
  const end = eh * 60 + em
  while (cur < end) {
    slots.push(`${String(Math.floor(cur/60)).padStart(2,'0')}:${String(cur%60).padStart(2,'0')}`)
    cur += 30
  }
  return slots
}
// 選択日の日付別オーバーライド→曜日別dailyHoursの順で時間選択肢を算出。
// どちらも使えない場合は既存のtimeRanges由来のフォールバックを使う。
function hoursToRanges(dayH) {
  const ranges = []
  if (dayH.lunchEnabled) ranges.push({ start: dayH.lunchStart, end: dayH.lunchEnd })
  if (dayH.dinnerEnabled) ranges.push({ start: dayH.dinnerStart, end: dayH.dinnerEnd })
  return ranges
}
function computeDaySlots(dateStr, dailyHours, fallbackSlots, dateOverrides) {
  if (dateStr) {
    const override = dateOverrides && dateOverrides[dateStr]
    const dow = new Date(dateStr + 'T00:00:00').getDay()
    const dayH = override || (dailyHours && dailyHours[String(dow)])
    if (dayH) {
      const dayRanges = hoursToRanges(dayH)
      if (dayRanges.length > 0) {
        const all = []
        dayRanges.forEach(tr => generateSlots(tr).forEach(s => { if (!all.includes(s)) all.push(s) }))
        if (all.length) return all.sort()
      }
    }
  }
  return fallbackSlots && fallbackSlots.length ? fallbackSlots : TIME_SLOTS
}
// 'グループA'='仙一・種谷・徳さんのみ（少人数）'、'グループB'='スタッフ全員'。現場に伝わる言葉に置き換える。
const NOTIFY_TARGET_OPTIONS = [['','スタッフ全員に通知（既定）'], ['A','一部の担当者だけに通知'], ['none','通知しない（記録には残ります）']]
// 'カレンダー削除'は元々このリストに入っていたが、コード全体を検索してもこの値をバックエンド
// （Code.gs）側で参照・特別扱いする箇所は一切無く、単に予約編集モーダルの選択肢として誰でも選べる
// だけの内部由来の値だった。選ぶと確認ダイアログ・お客様通知・カレンダー予定削除のいずれも発火せず
// （adminUpdateReservationの特別処理は'キャンセル'/'確定'のみが対象）、予約一覧（'確定'/'要確認'のみ
// 表示）からも静かに消える＝誤操作一つで確認・通知なしに予約が消失する事故要因だった
// （スタッフ目線レビュー・ラウンド26、審判団6人全会一致で最優先修正と判定）。正規の削除・キャンセルは
// 既存の「削除」ボタン・「キャンセルにする」ボタン経由で行う設計のため、この選択肢自体を除去する。
const STATUSES   = ['確定','要確認','キャンセル']
const SOURCES    = ['電話','食べログ','LINE','ウォークイン','その他']
const GUESTS     = ['1','2','3','4','5','6','7','8']
const WEEK       = ['日','月','火','水','木','金','土']

// 業態プリセット：関連する設定が複数箇所（設定タブ・配信設定タブ）に分散しているため、1つでも見落とすと
// 事故る（例：飲食店以外でsingleDinerRequiresCompanyがONのまま残る等）。イーロンマスク／ITコンサル／
// アップルデザインチーム視点の導入テストで繰り返し指摘されたため、代表的な業態をまとめて一括適用できるようにした。
// settingsパート・fsetパートは、それぞれ「設定」タブ・「配信設定」タブの保存ボタンで別々に保存する必要がある。
// 業態プリセットの土台となる共通バンドル。複数のプリセットが「itemLabel/itemIconだけ違って中身は同一」に
// なりがちなため（例：レンタカー屋とガイド制レジャーは同じperStaffバンドル）、ここで共通定義を1箇所に集約し、
// 見た目のプリセット一覧（店主が自分の業種名で選べる分かりやすさ）は保ったまま、内部の二重管理を防ぐ。
const FSET_KASSHIKI_ON  = { kasshiki:{ enabled:true },  singleDinerRequiresCompany:{ enabled:true } }
const FSET_KASSHIKI_OFF = { kasshiki:{ enabled:false }, singleDinerRequiresCompany:{ enabled:false } }
// 面接（候補者）・クリニック（患者）向け：飲食店の「無断キャンセル歴の表示」は業界的に一般的だが、
// この2業態にそのまま適用するのは公平性・プライバシーの観点で重みが違う（Apple CEO視点レビューでの指摘）。
// 導入時点の既定はOFFにし、必要な店舗は配信設定タブから自分でONにできるようにする（機能自体は削除しない）。
const FSET_KASSHIKI_OFF_NOSHOW_OFF = { ...FSET_KASSHIKI_OFF, noShowDetection:{ enabled:false } }
// 変更・キャンセルの受付期限（cutoffRules）は、以前はどのプリセットにも一度も設定されておらず、コード側の
// 既定値（2〜3日前22:00締切＝会席コースの食材発注を前提にした値）がそのまま全業態に適用されていた。
// 美容院・面接・クリニック・整備工場・学習塾のような「当日キャンセルが一般的」な業態が、飲食店基準の
// 締切をそのまま引き継いでしまう実害があった（Apple CEO視点レビューでの指摘：導入時点の設定だけで
// 完結するはずの「業態プリセット」の前提が、この項目だけ崩れていた）。同伴者情報等と同じ理由で、
// 過度に厳しくする側ではなく緩める側（当日23:59まで受付＝実質的に無制限）を既定にし、必要な店舗は
// 「設定」タブの曜日別・祝日別ルールから自分でより厳しい値に変更できるようにする。
// （飲食店2業態にはCUTOFF_SAME_DAYではなくCUTOFF_DINING_DEFAULTを明示設定する。理由は下記参照）
const CUTOFF_SAME_DAY = { '0':{daysBefore:0,time:'23:59'}, '1':{daysBefore:0,time:'23:59'}, '2':{daysBefore:0,time:'23:59'},
  '3':{daysBefore:0,time:'23:59'}, '4':{daysBefore:0,time:'23:59'}, '5':{daysBefore:0,time:'23:59'}, '6':{daysBefore:0,time:'23:59'},
  holiday:{daysBefore:0,time:'23:59'} }
// course_dining/simple_dining（飲食店2業態）だけは上記CUTOFF_SAME_DAYを設定せず、「一度も触られていない」
// という前提でコード側の既定値（2〜3日前22:00締切）に委ねていたが、他業態プリセット（CUTOFF_SAME_DAYを
// 明示設定）を一度適用・保存した店舗が後から飲食店プリセットに切り替えた場合、cutoffRulesキーが
// settingsPatchに含まれないため当日23:59という緩い締切がそのまま残ってしまう不整合があった
// （storeSpecificNotifSectionsで既に対策済みだった「一部プリセットだけ明示・残りは前の値が残る」問題と
// 同種のものが、この項目だけ見落とされていた。第25回レビュー、あらゆる業種の経営者陣視点での指摘・修正）。
// 飲食店側もコード側の既定値と同じ内容をここで明示し、プリセット切り替え時に必ず上書きされるようにする。
const CUTOFF_DINING_DEFAULT = { '0':{daysBefore:3,time:'22:00'}, '1':{daysBefore:2,time:'22:00'}, '2':{daysBefore:2,time:'22:00'},
  '3':{daysBefore:2,time:'22:00'}, '4':{daysBefore:2,time:'22:00'}, '5':{daysBefore:2,time:'22:00'}, '6':{daysBefore:2,time:'22:00'},
  holiday:{daysBefore:3,time:'22:00'} }
// 資産（車両・器材）1つを担当者1人として登録し、同時対応数=1で個別管理する業態（レンタカー・ガイド制レジャー等）
function assetPerStaffBundle(itemLabel, itemIcon) {
  return { bookingMode:'course', itemLabel, itemIcon, capacityModel:'perStaff', staffAssignmentEnabled:true, guestCountEnabled:true, companionInfoEnabled:false }
}
// 資産（自転車・器材）を台数だけで管理し、誰が対応するかは問わない業態（レンタサイクル・器材制レジャー等）
function assetByCountBundle(itemLabel, itemIcon) {
  return { bookingMode:'course', itemLabel, itemIcon, capacityModel:'timeSlot', staffAssignmentEnabled:false, guestCountEnabled:true, companionInfoEnabled:false }
}

// 設定テンプレートのエクスポート/インポートに含めるフィールド（複数店舗展開向け）。
// 店名・電話番号・URL・通知グループの説明・担当者一覧（実名）は店舗固有の情報のため意図的に含めない
// （別の店舗にそのまま持ち込むと、誤って元の店名や実在の担当者名が引き継がれてしまうため）。
// storeSpecificNotifSections（例：貝屋和光の「食べログ」「椎名さん」）とstaffRosterは、実名・外部
// サービス名等の店舗固有情報を含むため、意図的にテンプレートに含めない（別の店舗にそのまま
// 持ち込むと、無関係な実名・連携先がその店舗の管理画面にそのまま表示されてしまうため）。
// bookingNotes（予約確認時の注意事項・キャンセルポリシー）は元々ここに含まれていたが、messageTemplates・
// storeSpecificNotifSectionsと全く同じ理由（自由記述で実際の電話番号・店舗固有の文言が書かれがちで、
// お客様への確認メッセージにそのまま送信される）で店舗間の漏洩リスクがあるのに、この項目だけ除外漏れが
// あった（ITコンサル視点レビューでの指摘）。許可リストから外し、書き出し・読み込みの両方で対象外にする。
const TEMPLATE_SETTINGS_KEYS = [
  'maxSeats', 'courses', 'timeRanges', 'dailyHours', 'cutoffRules', 'seatsByWeekday', 'capacityModel',
  'q1Options', 'q3Options', 'bookingSources', 'bookingMode', 'itemLabel', 'itemIcon', 'staffAssignmentEnabled', 'staffLabel', 'countUnit', 'guestCountEnabled',
  'fixedGuestCount', 'companionInfoEnabled', 'defaultStayMin', 'defaultCourseName', 'unparseableGuestFallback',
  'emailCollectionEnabled', 'enabledLanguages',
]

// 導入ウィザード用の追加質問。業態を選んだだけでは決まらない「呼び方」「細かい運用ルール」を
// 追加で聞き、答えに応じてsettings/fsetの該当項目を上書きする。target/fieldはドット区切りのパス
// （fset側は{section}.{key}の2階層のみ想定）。質問が無い業態（既に十分シンプル）は空配列でよい
// ——「必要ない時に設定を強制しない」という方針上、聞くことが無いなら聞かない。
function setDeepPath(obj, path, value) {
  const parts = path.split('.')
  let cur = obj
  for (let i = 0; i < parts.length - 1; i++) { cur[parts[i]] = { ...(cur[parts[i]] || {}) }; cur = cur[parts[i]] }
  cur[parts[parts.length - 1]] = value
}
const Q_STAFF_LABEL = (options) => ({ id:'staffLabel', question:'スタッフ・担当の呼び方は？', short:'呼び方', target:'settings', field:'staffLabel', options, allowCustom:true })
const Q_COMPANION = { id:'companion', question:'同伴者情報（アレルギー等）の記録は必要ですか？', short:'同伴者情報', target:'settings', field:'companionInfoEnabled', options:[{value:false,label:'不要'},{value:true,label:'必要'}] }

// Q1（ご利用目的）・Q3（どのように当店を知ったか）の選択肢、通知設定タブの店舗固有セクションは、
// 「担当者」の呼び方と同じ種類の問題（業態依存の内容がハードコードされている）だったため、
// staffLabelと同じパターンでプリセットごとに既定値を持たせる。飲食店以外は「食べログ」を含めない。
const Q3_GENERIC = ['グーグルマップ', 'インターネット検索', 'SNS', '知人の紹介', 'その他']
const Q1_DINING  = ['誕生日・記念日', '接待・会食', '友人・仲間と', '家族で', 'デート', 'その他']
const Q3_DINING  = ['グーグルマップ', 'インターネット検索', '食べログ', 'SNS', '知人の紹介', 'その他']
const SOURCES_GENERIC = ['電話', 'LINE', 'ウォークイン', 'その他']
const SOURCES_DINING  = ['電話', '食べログ', 'LINE', 'ウォークイン', 'その他']
// 貝屋和光専用の通知セクション（Code.gsのdefaultStoreSpecificNotifSections()と同じ内容）。
// course_diningだけがこれを持つ想定だが、他プリセットと同様に明示的に設定しておく
// （他業態プリセットへ切り替えてからcourse_dining に戻すと、明示していない場合は
// バックエンドの既定値には戻らず、直前のプリセットの値[]が残ってしまうため）。
const STORE_SPECIFIC_SHIINA_TABELOG = [
  { section: '食べログ', rows: [
    { key: '食べログ_新規', label: '新規予約' },
    { key: '食べログ_変更', label: '予約変更' },
    { key: '食べログ_キャンセル', label: 'キャンセル' },
  ]},
  { section: '椎名さん（カレンダー同期）', rows: [
    { key: '椎名_同期', label: '新規同期' },
    { key: '椎名_変更', label: '変更検知' },
    { key: '椎名_削除', label: '削除検知' },
  ]},
]

const VERTICAL_PRESETS = [
  { key:'course_dining', category:'飲食店', label:'飲食店（コース制・懐石・フレンチ等）', icon:'🍽', hint:'貝屋和光の既定に近い形態。買い切り（貸切）需要があり、1名利用は相席が前提の業態向け。',
    settings:{ bookingMode:'course', itemLabel:'コース', itemIcon:'🍽', capacityModel:'daily', staffAssignmentEnabled:false, staffLabel:'担当者', countUnit:'名', guestCountEnabled:true, companionInfoEnabled:true,
      q1Options: Q1_DINING, q3Options: Q3_DINING, bookingSources: SOURCES_DINING, storeSpecificNotifSections: STORE_SPECIFIC_SHIINA_TABELOG, cutoffRules: CUTOFF_DINING_DEFAULT },
    fset: FSET_KASSHIKI_ON,
    questions:[
      { id:'kasshiki', question:'貸切（買い切り）のご予約を受け付けますか？', short:'貸切対応', target:'fset', field:'kasshiki.enabled', options:[{value:true,label:'受け付ける'},{value:false,label:'受け付けない'}] },
      { id:'company', question:'1名でのご来店は相席が前提ですか？', short:'1名利用の相席ルール', target:'fset', field:'singleDinerRequiresCompany.enabled', options:[{value:true,label:'はい、相席が前提'},{value:false,label:'いいえ、1名でも個別対応'}] },
    ] },
  { key:'simple_dining', category:'飲食店', label:'飲食店（コース無し・定食・町中華・カフェ等）', icon:'🍜', hint:'アラカルト中心、回転が速い、1人客が主体の業態向け。',
    settings:{ bookingMode:'simple', itemLabel:'ご予約', itemIcon:'🍽', capacityModel:'timeSlot', defaultStayMin:'40', defaultCourseName:'ご予約', staffAssignmentEnabled:false, staffLabel:'担当者', countUnit:'名', guestCountEnabled:true, companionInfoEnabled:false,
      q1Options: Q1_DINING, q3Options: Q3_DINING, storeSpecificNotifSections: [], bookingSources: SOURCES_DINING, cutoffRules: CUTOFF_DINING_DEFAULT },
    fset: FSET_KASSHIKI_OFF,
    questions:[ Q_COMPANION ] },
  { key:'salon', category:'美容・医療・面談系', label:'美容院・理容室', icon:'💇', hint:'スタイリスト（担当者）ごとの空き時間で予約可否が決まる業態向け。',
    settings:{ bookingMode:'course', itemLabel:'メニュー', itemIcon:'💇', capacityModel:'perStaff', staffAssignmentEnabled:true, guestCountEnabled:false, fixedGuestCount:'1', companionInfoEnabled:false, staffLabel:'スタイリスト', countUnit:'名',
      q1Options: ['カット・カラー等の通常メニュー', '特別な日のセット（結婚式・成人式等）', 'その他'], q3Options: Q3_GENERIC, storeSpecificNotifSections: [], bookingSources: SOURCES_GENERIC, cutoffRules: CUTOFF_SAME_DAY },
    fset: FSET_KASSHIKI_OFF,
    // 同伴者情報の質問は聞かない：guestCountEnabled:falseの業態は人数が常に1のため、
    // 現在の同伴者情報欄（2名以上の予約時にのみ表示）は選んでも実際には機能しない
    // （テスト全部隊レビューで発覚した既存の制約。UIの再設計をしない限り解消できない）。
    questions:[ Q_STAFF_LABEL([{value:'スタイリスト',label:'スタイリスト'},{value:'理容師',label:'理容師'},{value:'セラピスト',label:'セラピスト'}]) ] },
  { key:'interview', category:'美容・医療・面談系', label:'面接予約・カウンセリング予約', icon:'🗒️', hint:'候補者は常に1名、面接官（担当者）ごとの空き時間で管理する業態向け。',
    settings:{ bookingMode:'simple', itemLabel:'面談種別', itemIcon:'🗒️', capacityModel:'perStaff', defaultStayMin:'30', defaultCourseName:'面談', staffAssignmentEnabled:true, guestCountEnabled:false, fixedGuestCount:'1', companionInfoEnabled:false, staffLabel:'面接官', countUnit:'名',
      q1Options: ['新卒採用', '中途採用', 'カウンセリング', 'その他'], q3Options: Q3_GENERIC, storeSpecificNotifSections: [], bookingSources: SOURCES_GENERIC, cutoffRules: CUTOFF_SAME_DAY },
    // 来店後のお礼＋口コミ依頼（postVisitFollowUp）は既定でON（貝屋和光の飲食店前提を引き継いだまま）
    // だったが、面接・カウンセリングの候補者に「本日はご来店いただき、ありがとうございました。また
    // のお越しをお待ちしております」と送り、さらにGoogleレビューを依頼するのは、合否に関わらず
    // 業種として不適切（他業種経営者陣レビューでの指摘：飲食店の再来店施策をそのまま流用していた）。
    // 無断キャンセル検知を切った理由（公平性・プライバシー）と同種の問題のため、面接プリセットに限り
    // 丸ごとOFFにする（必要な店舗は配信設定タブから個別に再度ONにできる）。
    fset: { ...FSET_KASSHIKI_OFF_NOSHOW_OFF, postVisitFollowUp: { enabled: false } },
    questions:[ Q_STAFF_LABEL([{value:'面接官',label:'面接官'},{value:'カウンセラー',label:'カウンセラー'},{value:'担当者',label:'担当者'}]) ] },
  { key:'repair', category:'美容・医療・面談系', label:'車の修理・車検（整備工場）', icon:'🔧', hint:'整備士・リフト等を担当者として登録し、1件ずつ対応する業態向け。',
    settings:{ bookingMode:'course', itemLabel:'修理プラン', itemIcon:'🔧', capacityModel:'perStaff', staffAssignmentEnabled:true, guestCountEnabled:false, fixedGuestCount:'1', companionInfoEnabled:false, staffLabel:'整備士', countUnit:'名',
      q1Options: ['車検', '定期点検', '故障・修理', 'その他'], q3Options: Q3_GENERIC, storeSpecificNotifSections: [], bookingSources: SOURCES_GENERIC, cutoffRules: CUTOFF_SAME_DAY },
    // interview・clinicと同じ理由（法人契約・複数人が同じ電話番号/窓口を共有しがちな業態）で
    // 無断キャンセル検知はデフォルトOFFにする（業種経営者陣視点レビューでの指摘：この業態にも同じ
    // 不公平リスクがあるのに、以前はFSET_KASSHIKI_OFFのままだった）。
    fset: FSET_KASSHIKI_OFF_NOSHOW_OFF,
    questions:[ Q_STAFF_LABEL([{value:'整備士',label:'整備士'},{value:'担当者',label:'担当者'}]) ] },
  { key:'clinic', category:'美容・医療・面談系', label:'病院・クリニック', icon:'🩺', hint:'医師（担当者）ごとの空き時間で管理する業態向け。',
    settings:{ bookingMode:'course', itemLabel:'診療内容', itemIcon:'🩺', capacityModel:'perStaff', staffAssignmentEnabled:true, guestCountEnabled:false, fixedGuestCount:'1', companionInfoEnabled:false, staffLabel:'医師', countUnit:'名',
      q1Options: ['初診', '再診', '健康診断', 'その他'], q3Options: Q3_GENERIC, storeSpecificNotifSections: [], bookingSources: SOURCES_GENERIC, cutoffRules: CUTOFF_SAME_DAY },
    fset: FSET_KASSHIKI_OFF_NOSHOW_OFF,
    questions:[ Q_STAFF_LABEL([{value:'医師',label:'医師'},{value:'施術者',label:'施術者'},{value:'担当者',label:'担当者'}]) ] },
  { key:'tutoring', category:'美容・医療・面談系', label:'学習塾の面談予約', icon:'📚', hint:'講師・進路指導担当（担当者）ごとの空き時間で管理する業態向け。',
    settings:{ bookingMode:'simple', itemLabel:'面談種別', itemIcon:'📚', capacityModel:'perStaff', defaultStayMin:'30', defaultCourseName:'面談', staffAssignmentEnabled:true, guestCountEnabled:false, fixedGuestCount:'1', companionInfoEnabled:false, staffLabel:'講師', countUnit:'名',
      q1Options: ['体験授業', '保護者面談', '進路相談', 'その他'], q3Options: Q3_GENERIC, storeSpecificNotifSections: [], bookingSources: SOURCES_GENERIC, cutoffRules: CUTOFF_SAME_DAY },
    fset: FSET_KASSHIKI_OFF,
    questions:[ Q_STAFF_LABEL([{value:'講師',label:'講師'},{value:'担当者',label:'担当者'}]) ] },
  { key:'car_rental', category:'レンタル・レジャー系', label:'レンタカー屋', icon:'🚗', hint:'車両1台を担当者1名として登録する業態向け（日帰り・時間貸しのみ対応）。',
    settings: { ...assetPerStaffBundle('車種・プラン', '🚗'), staffLabel:'車両', countUnit:'台',
      q1Options: ['観光', 'ビジネス', '送迎', 'その他'], q3Options: Q3_GENERIC, storeSpecificNotifSections: [], bookingSources: SOURCES_GENERIC, cutoffRules: CUTOFF_SAME_DAY },
    // repair・interview・clinicと同じ理由で無断キャンセル検知はデフォルトOFF（法人契約・複数人が
    // 同じ電話番号/窓口を共有しがちな業態のため。業種経営者陣視点レビューでの指摘）。
    fset: FSET_KASSHIKI_OFF_NOSHOW_OFF,
    questions:[
      Q_STAFF_LABEL([{value:'車両',label:'車両'},{value:'クルマ',label:'クルマ'}]),
      { id:'guestCount', question:'ご利用人数（乗車人数等）をお客様に選ばせますか？', short:'利用人数の入力', target:'settings', field:'guestCountEnabled', options:[{value:true,label:'はい'},{value:false,label:'いいえ'}] },
    ] },
  { key:'bike_rental', category:'レンタル・レジャー系', label:'レンタサイクル', icon:'🚲', hint:'台数だけで管理したい場合向け（車種違いを分けたい場合はperStaffに変更）。日帰り・時間貸しのみ対応（複数日にわたる貸出は終了時刻の表示が崩れます）。',
    settings: { ...assetByCountBundle('レンタルプラン', '🚲'), countUnit:'台',
      q1Options: ['観光', 'ビジネス', 'その他'], q3Options: Q3_GENERIC, storeSpecificNotifSections: [], bookingSources: SOURCES_GENERIC, cutoffRules: CUTOFF_SAME_DAY },
    fset: FSET_KASSHIKI_OFF,
    questions:[] },
  { key:'leisure_guide', category:'レンタル・レジャー系', label:'レジャー予約（ガイド制／サップ・シュノーケル・ガラス工房等）', icon:'🏄', hint:'ガイド・指導員の人数がボトルネックになる業態向け。日帰り・時間貸しのみ対応（複数日にわたるツアーは終了時刻の表示が崩れます）。',
    settings: { ...assetPerStaffBundle('体験・ツアー', '🏄'), staffLabel:'ガイド', countUnit:'名',
      q1Options: ['観光・レジャー', '記念日', '団体利用', 'その他'], q3Options: Q3_GENERIC, storeSpecificNotifSections: [], bookingSources: SOURCES_GENERIC, cutoffRules: CUTOFF_SAME_DAY },
    fset: FSET_KASSHIKI_OFF,
    questions:[ Q_STAFF_LABEL([{value:'ガイド',label:'ガイド'},{value:'インストラクター',label:'インストラクター'},{value:'担当者',label:'担当者'}]) ] },
  // 以前はassetByCountBundle（timeSlotモデル、人数分だけ容量を減らす）を使っていたが、ボート等の
  // 「1台に複数人乗れる」器材だと人数分の減算が過小評価になる実バグがあった（業種経営者陣視点レビュー
  // での指摘）。assetPerStaffBundle（perStaffモデル）に変更：1台＝1つの予約枠として扱い、乗員人数は
  // 容量計算に影響しない（car_rental・leisure_guideと同じ、既に実績のある考え方）。
  { key:'leisure_equip', category:'レンタル・レジャー系', label:'レジャー予約（器材制／ボート・レンタル器材数で管理）', icon:'🚤', hint:'器材の台数がボトルネックになる業態向け（1台に複数人乗れる場合も対応）。日帰り・時間貸しのみ対応（複数日にわたる貸出は終了時刻の表示が崩れます）。',
    settings: { ...assetPerStaffBundle('体験・ツアー', '🚤'), staffLabel:'器材', countUnit:'台',
      q1Options: ['観光・レジャー', '記念日', '団体利用', 'その他'], q3Options: Q3_GENERIC, storeSpecificNotifSections: [], bookingSources: SOURCES_GENERIC, cutoffRules: CUTOFF_SAME_DAY },
    fset: FSET_KASSHIKI_OFF,
    questions:[ Q_STAFF_LABEL([{value:'器材',label:'器材'},{value:'ボート',label:'ボート'},{value:'車両',label:'車両'}]) ] },
]

function toYMD(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function ymdSlash(s) {
  return s ? s.replace(/-/g,'/') : ''
}
function fmtDate(ymd) {
  if (!ymd) return ''
  const d = new Date(ymd.replace(/\//g,'-')+'T00:00:00')
  return `${d.getMonth()+1}/${d.getDate()}（${WEEK[d.getDay()]}）`
}
function formatTime(val) {
  if (!val) return ''
  const s = String(val)
  if (/^\d{1,2}:\d{2}$/.test(s)) return s
  const d = new Date(s)
  if (!isNaN(d.getTime())) return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')
  return s
}
function statusStyle(s) {
  if (s==='確定')       return { background:'#e8f5e9', color:'#2e7d32' }
  if (s==='キャンセル') return { background:'#ffebee', color:'#c62828' }
  return { background:'#fff3e0', color:'#e65100' }
}
function notifLabel(type) {
  if (type==='new')    return { text:'新規予約', bg:'#e8f5e9', color:'#2e7d32' }
  if (type==='change') return { text:'変更',     bg:'#e3f2fd', color:'#1565c0' }
  if (type==='cancel') return { text:'キャンセル',bg:'#ffebee', color:'#c62828' }
  return { text: type, bg:'#f5f5f5', color:'#666' }
}
function fmtNotifDateTime(dt) {
  if (!dt) return ''
  const s = String(dt)
  const m = s.match(/(\d{4})\/(\d{2})\/(\d{2})\s(\d{2}):(\d{2})/)
  if (m) return `${parseInt(m[2])}/${parseInt(m[3])} ${m[4]}:${m[5]}`
  const d = new Date(s)
  if (!isNaN(d.getTime())) return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
  return s
}

// ── xlsx helper (requires SheetJS CDN) ───────────────────────────
function dlXlsx(rows, sheetName, filename) {
  const XLSX = window.XLSX
  if (!XLSX) { alert('Excelライブラリが読み込まれていません。ページを再読み込みしてください。'); return }
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.json_to_sheet(rows)
  const cols = rows.length > 0 ? Object.keys(rows[0]).map(k => ({ wch: Math.max(k.length*2, 12) })) : []
  ws['!cols'] = cols
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  XLSX.writeFile(wb, filename)
}

// ── Shared UI ─────────────────────────────────────────────────────
function Toast({ msg, type }) {
  if (!msg) return null
  return (
    <div style={{
      position:'fixed', bottom:24, left:'50%', transform:'translateX(-50%)',
      background: type==='error' ? '#e53935' : '#06c755',
      color:'#fff', padding:'12px 24px', borderRadius:8,
      fontSize:14, fontWeight:'bold', zIndex:9999,
      boxShadow:'0 4px 12px rgba(0,0,0,.25)', whiteSpace:'normal', textAlign:'center',
      maxWidth:'90vw', boxSizing:'border-box',
    }}>{msg}</div>
  )
}
// キーボード操作（Tab/Enter/Space/矢印/Escape/Home/End）とスクリーンリーダー対応（role/aria-*）を
// 備えたカスタムドロップダウン。マウスが使えない・画面が見えない方でも、ネイティブのselectと同じ
// 手順（Tabで来て矢印で選び、Enterで確定）で操作できるようにする。
let customSelectIdSeq = 0
function CustomSelect({ value, onChange, children, style, ariaLabel }) {
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const [focused, setFocused] = useState(false)
  const ref = useRef(null)
  const [pos, setPos] = useState({ top:0, left:0, width:0 })
  const idBase = useRef(null)
  if (!idBase.current) idBase.current = 'csel-' + (++customSelectIdSeq)

  const opts = [children].flat(Infinity).filter(c => c && c.props).map(c => ({
    val: c.props.value !== undefined ? String(c.props.value) : String(c.props.children ?? ''),
    label: String(c.props.children ?? ''),
  }))
  const curVal = String(value ?? '')
  const curIdx = opts.findIndex(o => o.val === curVal)
  const displayLabel = opts.find(o => o.val === curVal)?.label ?? curVal

  function openList() {
    if (ref.current) {
      const r = ref.current.getBoundingClientRect()
      setPos({ top: r.bottom, left: r.left, width: r.width })
    }
    setActiveIdx(curIdx >= 0 ? curIdx : 0)
    setOpen(true)
  }
  function closeList() { setOpen(false) }
  function selectIdx(i) {
    const opt = opts[i]
    if (opt) onChange({ target: { value: opt.val } })
    closeList()
  }
  function handleKeyDown(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (!open) openList()
      else selectIdx(activeIdx)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) openList()
      else setActiveIdx(i => Math.min(opts.length - 1, i < 0 ? 0 : i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) openList()
      else setActiveIdx(i => Math.max(0, i < 0 ? 0 : i - 1))
    } else if (e.key === 'Escape') {
      if (open) { e.preventDefault(); closeList() }
    } else if (e.key === 'Home') {
      if (open) { e.preventDefault(); setActiveIdx(0) }
    } else if (e.key === 'End') {
      if (open) { e.preventDefault(); setActiveIdx(opts.length - 1) }
    } else if (e.key === 'Tab') {
      closeList()
    }
  }

  return (
    <div style={{ position:'relative' }}>
      <div ref={ref} onClick={() => (open ? closeList() : openList())}
        onKeyDown={handleKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => { setFocused(false); closeList() }}
        tabIndex={0} role="combobox" aria-haspopup="listbox" aria-expanded={open}
        aria-controls={idBase.current + '-list'} aria-label={ariaLabel}
        aria-activedescendant={open && activeIdx >= 0 ? idBase.current + '-opt-' + activeIdx : undefined}
        style={{
          width:'100%', padding:'9px 12px',
          border:'1.5px solid #e0e0e0', borderRadius:8,
          fontSize:14, background:'#fafafa', fontFamily:'inherit',
          boxSizing:'border-box', cursor:'pointer',
          display:'flex', justifyContent:'space-between', alignItems:'center',
          outline: 'none',
          boxShadow: focused ? '0 0 0 3px rgba(6,199,85,.35)' : 'none',
          borderColor: focused ? '#06c755' : '#e0e0e0',
          ...style,
        }}>
        <span style={{ flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
          {displayLabel}
        </span>
        <span style={{ fontSize:10, color:'#888', marginLeft:6, flexShrink:0 }}>▼</span>
      </div>
      {open && <>
        <div style={{ position:'fixed', inset:0, zIndex:1998 }} onClick={() => setOpen(false)} />
        <div
          id={idBase.current + '-list'} role="listbox"
          onMouseDown={e => e.preventDefault()}
          onTouchStart={e => e.stopPropagation()}
          onTouchMove={e => e.stopPropagation()}
          style={{
            position:'fixed', top:pos.top, left:pos.left, width:pos.width,
            zIndex:1999, background:'#fff',
            border:'1.5px solid #e0e0e0', borderRadius:8,
            boxShadow:'0 4px 16px rgba(0,0,0,.18)',
            maxHeight:220, overflowY:'auto',
          }}>
          {opts.map((opt, i) => (
            <div key={i} id={idBase.current + '-opt-' + i} role="option" aria-selected={opt.val === curVal}
              onMouseEnter={() => setActiveIdx(i)}
              onClick={() => selectIdx(i)}
              style={{
                padding:'11px 14px', fontSize:14, cursor:'pointer',
                background: i === activeIdx ? '#dcedc8' : (opt.val === curVal ? '#e8f5e9' : '#fff'),
                color: opt.val === curVal ? '#2e7d32' : '#333',
                borderBottom: i < opts.length-1 ? '1px solid #f0f0f0' : 'none',
              }}>
              {opt.label}
            </div>
          ))}
        </div>
      </>}
    </div>
  )
}

function TimeSelect({ value, onChange }) {
  const parts = (value || '00:00').split(':')
  const h = parts[0] || '00'
  const m = parts[1] || '00'
  const hours = Array.from({length:24}, (_, i) => String(i).padStart(2,'0'))
  const mins = ['00','15','30','45']
  return (
    <div style={{ display:'flex', gap:4, alignItems:'center' }}>
      <CustomSelect value={h} onChange={e => onChange({ target:{ value:`${e.target.value}:${m}` }})} style={{ width:72 }}>
        {hours.map(hh => <option key={hh} value={hh}>{hh}</option>)}
      </CustomSelect>
      <span style={{ fontSize:13, color:'#888' }}>:</span>
      <CustomSelect value={m} onChange={e => onChange({ target:{ value:`${h}:${e.target.value}` }})} style={{ width:60 }}>
        {mins.map(mm => <option key={mm} value={mm}>{mm}</option>)}
      </CustomSelect>
    </div>
  )
}

// 「毎時○時ごろ」を選ぶための時刻セレクト（配信設定：リマインド送信時刻等）
function HourSelect({ value, onChange }) {
  const hours = Array.from({length:24}, (_, i) => String(i).padStart(2,'0'))
  const cur = String(value ?? 0).padStart(2,'0')
  return (
    <CustomSelect value={cur} onChange={e => onChange(parseInt(e.target.value, 10))} style={{ width:76 }}>
      {hours.map(h => <option key={h} value={h}>{h}時</option>)}
    </CustomSelect>
  )
}

// ON/OFFピルトグル（通知設定タブの型を共通化）
// OFF状態の文字色は元#777（背景#e0e0e0とのコントラスト比約3.4:1でWCAG AAの4.5:1未達）だったため、
// #555に変更（約5.6:1、Appleデザインチーム視点レビューでの指摘）。
function Pill({ on, onClick, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled}
      style={{
        padding:'4px 14px', borderRadius:20, border:'none', cursor: disabled ? 'default' : 'pointer', fontSize:12, fontWeight:'bold',
        background: on ? '#4caf50' : '#e0e0e0', color: on ? '#fff' : '#555', opacity: disabled ? 0.6 : 1,
      }}>
      {on ? 'ON' : 'OFF'}
    </button>
  )
}

function Field({ label, children, span }) {
  return (
    <div style={span ? { gridColumn:'1/-1' } : {}}>
      <div style={{ fontSize:11, color:'#666', marginBottom:4 }}>{label}</div>
      {children}
    </div>
  )
}
const iStyle = {
  width:'100%', padding:'9px 12px',
  border:'1.5px solid #e0e0e0', borderRadius:8,
  fontSize:14, background:'#fafafa', fontFamily:'inherit',
  boxSizing:'border-box',
}
const sStyle = {
  ...iStyle, cursor:'pointer',
}
// EditModal/AddModal専用：モバイルでのタップ領域確保のためminHeightを追加（他箇所のiStyle/sStyleには影響しない）
const mIStyle = { ...iStyle, minHeight:44 }
const mSStyle = { ...sStyle, minHeight:44 }
const btnGreen  = { padding:'9px 20px', background:'#06c755', color:'#fff', border:'none', borderRadius:8, fontSize:14, fontWeight:'bold', cursor:'pointer' }
const btnGray   = { padding:'9px 16px', background:'#f0f0f0', color:'#666', border:'none', borderRadius:8, fontSize:13, cursor:'pointer' }
const btnRed    = { padding:'6px 14px', background:'#ffebee', color:'#c62828', border:'none', borderRadius:6, fontSize:12, cursor:'pointer' }
const btnBlue   = { padding:'6px 12px', background:'#e3f2fd', color:'#1565c0', border:'none', borderRadius:6, fontSize:12, cursor:'pointer' }

// ── Calendar ──────────────────────────────────────────────────────
function AdminCalendar({ year, month, dayData, selected, onSelect }) {
  const firstDay    = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month+1, 0).getDate()
  const todayD      = new Date()
  const todayYMD    = `${todayD.getFullYear()}/${String(todayD.getMonth()+1).padStart(2,'0')}/${String(todayD.getDate()).padStart(2,'0')}`

  const cells = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) {
    const ymd  = `${year}/${String(month+1).padStart(2,'0')}/${String(d).padStart(2,'0')}`
    const info = dayData[ymd] || {}
    cells.push({ d, ymd, ...info, isToday: ymd===todayYMD, isSelected: ymd===selected })
  }

  return (
    <div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:2, marginBottom:4 }}>
        {WEEK.map((dn,i) => (
          <div key={dn} style={{ textAlign:'center', fontSize:11, fontWeight:'bold', padding:'4px 0',
            color: i===0?'#e53935':i===6?'#1565c0':'#888' }}>{dn}</div>
        ))}
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:2 }}>
        {cells.map((cell,i) => cell===null ? <div key={`e${i}`}/> : (
          <button key={cell.ymd}
            onClick={() => onSelect(cell.isSelected ? null : cell.ymd)}
            style={{
              padding:'4px 2px', textAlign:'center', fontSize:12, cursor:'pointer',
              border: cell.isSelected ? '2px solid #1565c0' : cell.isToday ? '2px solid #06c755' : '1px solid transparent',
              borderRadius:6,
              background: cell.isBlocked ? '#ffebee' : cell.seatBlock ? '#fff3e0' : cell.isSelected ? '#e8eaf6' : 'transparent',
              color: cell.isBlocked ? '#e53935' : (i%7===0)?'#e53935':(i%7===6)?'#1565c0':'#111',
              minHeight:42, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'flex-start',
              paddingTop:4,
            }}>
            <span style={{ fontWeight: cell.isToday?'bold':'normal' }}>{cell.d}</span>
            {cell.count > 0 && (
              <span style={{ fontSize:9, background:'#06c755', color:'#fff', borderRadius:8,
                padding:'1px 4px', marginTop:2, lineHeight:1.4 }}>{cell.count}件</span>
            )}
            {cell.seatBlock && !cell.isBlocked && (
              <span style={{ fontSize:9, color:'#e65100', marginTop:1, lineHeight:1 }}>-{cell.seatBlock}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

function CalNav({ year, month, onPrev, onNext }) {
  return (
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
      <button onClick={onPrev} style={{ ...btnGray, padding:'6px 16px', fontSize:15 }}>←</button>
      <span style={{ fontWeight:'bold', fontSize:15 }}>{year}年{month+1}月</span>
      <button onClick={onNext} style={{ ...btnGray, padding:'6px 16px', fontSize:15 }}>→</button>
    </div>
  )
}

// ── Edit Modal ────────────────────────────────────────────────────
function EditModal({ res, onClose, onSaved, showToast, timeSlots, dailyHours, dateOverrides, staffAssignmentEnabled, staffRoster, courses, itemLabel, bookingSources, guestCountEnabled, fixedGuestCount }) {
  const [data, setData] = useState({
    name:   res.name,
    phone:  res.phone,
    date:   res.date.replace(/\//g,'-'),
    time:   formatTime(res.time) || '',
    guests: String(res.guests),
    course: res.course,
    notes:  res.notes || '',
    status: res.status,
    source: res.source || 'その他',
    requestedStaff: res.requestedStaff || '',
    email:  res.email || '',
    notifyTarget: '',
  })
  const [saving, setSaving] = useState(false)
  const set = k => e => setData(d => ({...d, [k]: e.target.value}))
  const daySlots = useMemo(() => computeDaySlots(data.date, dailyHours, timeSlots, dateOverrides),
    [data.date, dailyHours, timeSlots, dateOverrides])

  async function save() {
    if (data.status === 'キャンセル' && res.status !== 'キャンセル') {
      if (!window.confirm(`${data.name}様　${data.date} ${data.time}〜の予約をキャンセル扱いに変更します。よろしいですか？`)) return
    }
    setSaving(true)
    try {
      const r = await api.adminUpdateReservation({ id:res.id, ...data, date: data.date.replace(/-/g,'/') })
      if (r.success) { showToast('更新しました'); onSaved() }
      else showToast(r.error||'更新に失敗しました','error')
    } catch { showToast('通信エラーが発生しました。もう一度お試しください','error') }
    setSaving(false)
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.5)', zIndex:200,
      display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}
      onClick={e => e.target===e.currentTarget && onClose()}>
      <div style={{ background:'#fff', borderRadius:16, padding:24, width:'100%', maxWidth:520, maxHeight:'90vh', overflowY:'scroll', WebkitOverflowScrolling:'touch' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
          <h2 style={{ fontSize:16, fontWeight:'bold' }}>予約編集 <span style={{ fontSize:11, color:'#aaa', fontWeight:'normal' }}>{res.id}</span></h2>
          <button onClick={onClose} aria-label="閉じる" style={{ background:'none', border:'none', fontSize:22, cursor:'pointer', color:'#888' }}>✕</button>
        </div>
        <div className="modalGrid">
          <Field label="お名前"><input type="text"   value={data.name}   style={mIStyle} onChange={set('name')}   /></Field>
          <Field label="電話番号"><input type="tel"  value={data.phone}  style={mIStyle} onChange={set('phone')}  /></Field>
          <Field label="来店日"> <input type="date"  value={data.date}   style={mIStyle} onChange={set('date')}   /></Field>
          <Field label="時間">
            <CustomSelect value={data.time} style={mSStyle} onChange={set('time')}>
              {daySlots.map(s => <option key={s}>{s}</option>)}
            </CustomSelect>
          </Field>
          {/* guestCountEnabled===falseの業態（面接・クリニック等、常に1名固定）では、お客様画面と同じく
              人数欄自体を出さない。以前はこの設定を見ずに常に人数セレクトを表示していたため、常に1名の
              業態でもスタッフが2名等を選べてしまい、実際には使われない数字が予約に残る混乱があった
              （スタッフ目線レビュー第24回での指摘）。 */}
          {guestCountEnabled !== false && (
            <Field label="人数">
              <CustomSelect value={data.guests} style={mSStyle} onChange={set('guests')}>
                {GUESTS.map(n => <option key={n}>{n}</option>)}
              </CustomSelect>
            </Field>
          )}
          {courses && courses.length > 0 && (
            <Field label={itemLabel || 'コース'}>
              <CustomSelect value={data.course} style={mSStyle} onChange={set('course')}>
                {!courses.some(c => c.name === data.course) && <option value={data.course}>{data.course}</option>}
                {courses.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
              </CustomSelect>
            </Field>
          )}
          <Field label="ステータス">
            <CustomSelect value={data.status} style={mSStyle} onChange={set('status')}>
              {STATUSES.map(s => <option key={s}>{s}</option>)}
            </CustomSelect>
          </Field>
          <Field label="経路">
            <CustomSelect value={data.source} style={mSStyle} onChange={set('source')}>
              {(bookingSources && bookingSources.length ? bookingSources : SOURCES).map(s => <option key={s}>{s}</option>)}
            </CustomSelect>
          </Field>
          <Field label="メモ"><input type="text" value={data.notes} style={mIStyle} onChange={set('notes')} /></Field>
          <Field label="メールアドレス（任意・LINE未使用のお客様向け）" span>
            <input type="email" value={data.email} placeholder="example@example.com" style={mIStyle} onChange={set('email')} />
          </Field>
          {staffAssignmentEnabled && (
            <Field label="ご指名">
              <CustomSelect value={data.requestedStaff} style={mSStyle} onChange={set('requestedStaff')}>
                <option value="">指名なし</option>
                {staffRoster.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
              </CustomSelect>
            </Field>
          )}
          <Field label="この変更の通知先">
            <CustomSelect value={data.notifyTarget} style={mSStyle} onChange={set('notifyTarget')}>
              {NOTIFY_TARGET_OPTIONS.map(([v,l]) => <option key={v||'default'} value={v}>{l}</option>)}
            </CustomSelect>
          </Field>
        </div>
        <div style={{ display:'flex', gap:10, marginTop:18 }}>
          <button disabled={saving} onClick={save}
            style={{ flex:1, padding:14, background:'#06c755', color:'#fff', border:'none', borderRadius:10, fontSize:14, fontWeight:'bold', cursor:'pointer' }}>
            {saving?'保存中...':'保存する'}
          </button>
          <button onClick={onClose}
            style={{ flex:1, padding:14, background:'#f0f0f0', color:'#666', border:'none', borderRadius:10, fontSize:14, cursor:'pointer' }}>
            閉じる（保存しない）
          </button>
        </div>
      </div>
      <style jsx>{`
        .modalGrid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
        @media (max-width:480px) { .modalGrid { grid-template-columns:1fr; } }
      `}</style>
    </div>
  )
}

// ── Add Modal ─────────────────────────────────────────────────────
function AddModal({ initialDate, onClose, onAdded, showToast, timeSlots, dailyHours, dateOverrides, staffAssignmentEnabled, staffRoster, courses, itemLabel, bookingSources, kasshikiEnabled, guestCountEnabled, fixedGuestCount }) {
  // guestCountEnabled===falseの業態（面接・クリニック・整備工場等、常に1名固定）では、お客様画面
  // （pages/index.js）はfixedGuestCountに固定して人数欄自体を出さない。この電話予約用フォームは
  // 以前この設定を一切見ておらず、常に「2」から始まる人数セレクトを表示していた（常に1名の業態でも
  // スタッフが人数を選べてしまい、実際には使われない・意味を持たない数字が予約データに残る混乱があった。
  // スタッフ目線レビュー第24回での指摘）。
  const [data, setData] = useState({
    date: initialDate ? initialDate.replace(/\//g,'-') : '',
    time:'', name:'', phone:'', guests: guestCountEnabled === false ? (fixedGuestCount || '1') : '2',
    course: (courses && courses[0]?.name) || '', notes:'', source:'電話', requestedStaff:'', email:'',
    lineUserId:'', isKasshiki:false, forceAdd:false, notifyTarget:'',
  })
  const [err, setErr]     = useState('')
  const [adding, setAdding] = useState(false)
  const set = k => e => setData(d => ({...d, [k]: e.target.value}))
  const daySlots = useMemo(() => computeDaySlots(data.date, dailyHours, timeSlots, dateOverrides),
    [data.date, dailyHours, timeSlots, dateOverrides])

  async function add() {
    if (!data.date||!data.time||!data.name||!data.phone) return setErr('日付・時間・名前・電話番号は必須です')
    if (data.forceAdd && !window.confirm('「強制登録」がオンです。休業日・受付停止枠などの制限を無視して登録します。よろしいですか？')) return
    setAdding(true); setErr('')
    try {
      const r = await api.adminAddReservation({...data, date: data.date.replace(/-/g,'/')})
      if (r.blocked && !data.forceAdd) {
        setErr('⚠️ '+r.reason+'\n「強制登録」にチェックして再送信してください。')
        setAdding(false); return
      }
      if (r.success) { showToast('登録しました（ID：'+r.id+'）'); onAdded() }
      // 強制登録済みでも一部のブロック（確定済み貸切日など）はforceAddで突破できず、その場合サーバーは
      // blocked:true＋reasonを返す（errは無い）。ここをr.errorだけ見ていると「登録に失敗しました」という
      // 汎用文言しか出ず、なぜ失敗したかスタッフに伝わらなかった（スタッフ視点レビューでの指摘）。
      else setErr(r.blocked ? r.reason : (r.error||'登録に失敗しました'))
    } catch { setErr('通信エラーが発生しました。もう一度お試しください') }
    setAdding(false)
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.5)', zIndex:200,
      display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}
      onClick={e => e.target===e.currentTarget && onClose()}>
      <div style={{ background:'#fff', borderRadius:16, padding:24, width:'100%', maxWidth:520, maxHeight:'90vh', overflowY:'scroll', WebkitOverflowScrolling:'touch' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
          <h2 style={{ fontSize:16, fontWeight:'bold' }}>新規予約登録</h2>
          <button onClick={onClose} aria-label="閉じる" style={{ background:'none', border:'none', fontSize:22, cursor:'pointer', color:'#888' }}>✕</button>
        </div>
        <div className="modalGrid">
          <Field label="来店日 *">  <input type="date" value={data.date} style={mIStyle} onChange={set('date')} /></Field>
          <Field label="時間 *">
            <CustomSelect value={data.time} style={mSStyle} onChange={set('time')}>
              <option value="">-- 選択 --</option>
              {daySlots.map(s => <option key={s}>{s}</option>)}
            </CustomSelect>
          </Field>
          <Field label="お名前 *">   <input type="text" value={data.name}  placeholder="山田 太郎"       style={mIStyle} onChange={set('name')}  /></Field>
          <Field label="電話番号 *"> <input type="tel"  value={data.phone} placeholder="090-0000-0000"   style={mIStyle} onChange={set('phone')} /></Field>
          {guestCountEnabled !== false && (
            <Field label="人数">
              <CustomSelect value={data.guests} style={mSStyle} onChange={set('guests')}>
                {GUESTS.map(n => <option key={n}>{n}</option>)}
              </CustomSelect>
            </Field>
          )}
          {courses && courses.length > 0 && (
            <Field label={itemLabel || 'コース'}>
              <CustomSelect value={data.course} style={mSStyle} onChange={set('course')}>
                {courses.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
              </CustomSelect>
            </Field>
          )}
          <Field label="経路">
            <CustomSelect value={data.source} style={mSStyle} onChange={set('source')}>
              {(bookingSources && bookingSources.length ? bookingSources : SOURCES).map(s => <option key={s}>{s}</option>)}
            </CustomSelect>
          </Field>
          <Field label="LINE UserID（任意）" span>
            <input type="text" value={data.lineUserId} placeholder="Uxxxxxxxx..." style={mIStyle}
              onChange={set('lineUserId')} />
          </Field>
          <Field label="メールアドレス（任意・LINE未使用のお客様向け）" span>
            <input type="email" value={data.email} placeholder="example@example.com" style={mIStyle} onChange={set('email')} />
          </Field>
          <Field label="メモ（任意）" span>
            <input type="text" value={data.notes} placeholder="ご要望など" style={mIStyle} onChange={set('notes')} />
          </Field>
          {staffAssignmentEnabled && (
            <Field label="ご指名">
              <CustomSelect value={data.requestedStaff} style={mSStyle} onChange={set('requestedStaff')}>
                <option value="">指名なし</option>
                {staffRoster.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
              </CustomSelect>
            </Field>
          )}
          <Field label="この登録の通知先">
            <CustomSelect value={data.notifyTarget} style={mSStyle} onChange={set('notifyTarget')}>
              {NOTIFY_TARGET_OPTIONS.map(([v,l]) => <option key={v||'default'} value={v}>{l}</option>)}
            </CustomSelect>
          </Field>
        </div>
        <div style={{ marginTop:12, display:'flex', gap:16 }}>
          {kasshikiEnabled && (
            <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:13, cursor:'pointer' }}>
              <input type="checkbox" checked={data.isKasshiki} onChange={e => setData(d=>({...d,isKasshiki:e.target.checked}))} />
              貸切プラン
            </label>
          )}
          <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:13, cursor:'pointer' }}>
            <input type="checkbox" checked={data.forceAdd} onChange={e => setData(d=>({...d,forceAdd:e.target.checked}))} />
            強制登録（休業日を無視）
          </label>
        </div>
        {err && (
          <div style={{ marginTop:10, background:'#fff0f0', border:'1px solid #ffcccc', borderRadius:8, padding:'10px 14px', fontSize:13, color:'#e53935', whiteSpace:'pre-line' }}>
            {err}
          </div>
        )}
        <button disabled={adding} onClick={add}
          style={{ marginTop:16, width:'100%', padding:15, background:'#06c755', color:'#fff', border:'none', borderRadius:12, fontSize:15, fontWeight:'bold', cursor:'pointer' }}>
          {adding?'登録中...':'予約を登録する'}
        </button>
      </div>
      <style jsx>{`
        .modalGrid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
        @media (max-width:480px) { .modalGrid { grid-template-columns:1fr; } }
      `}</style>
    </div>
  )
}

// 導入ウィザード：業種を選び、業種固有の追加質問（呼び方・貸切対応の有無等）に答えるだけで、
// 関連設定を一括で組み立てられるようにする。質問が無い業種（既にシンプルな設定で十分な業態）は
// 確認画面がすぐ出る——「必要ない時に設定を強制しない」という方針を、ここでも徹底する。
// pick→questions→confirmの3段階（質問が無い業種は2段階）。stepIndexは進行状況表示専用の連番。
function wizardStepIndex(step, hasQuestions) {
  if (step === 'pick') return 1
  if (step === 'questions') return 2
  return hasQuestions ? 3 : 2
}

function SetupWizard({ onClose, onApply }) {
  const [step, setStep] = useState('pick') // 'pick' | 'questions' | 'confirm'
  const [presetKey, setPresetKey] = useState('')
  const [answers, setAnswers] = useState({}) // id -> value
  const [customText, setCustomText] = useState({}) // id -> string（自由入力時）

  const preset = VERTICAL_PRESETS.find(p => p.key === presetKey)
  const hasQuestions = !!(preset && preset.questions && preset.questions.length > 0)
  const totalSteps = preset ? (hasQuestions ? 3 : 2) : 3
  const stepIndex = wizardStepIndex(step, hasQuestions)

  function pick(key) {
    setPresetKey(key)
    const p = VERTICAL_PRESETS.find(pp => pp.key === key)
    const initial = {}
    ;(p.questions || []).forEach(q => { initial[q.id] = q.options[0].value })
    setAnswers(initial)
    setStep((p.questions && p.questions.length > 0) ? 'questions' : 'confirm')
  }

  function buildResult() {
    const settingsPatch = { ...preset.settings }
    // preset.fset（貸切ON/OFF・無断キャンセル表示のデフォルト等）をまず土台として反映する。
    // 以前はここが空のままで、ウィザード経由での適用時だけpreset.fsetが一切効かなかった
    // （「業態を選んで直接適用」の方だけ効く、という2経路間の不整合があった）。
    const fsetPatch = {}
    Object.keys(preset.fset || {}).forEach(section => { fsetPatch[section] = { ...preset.fset[section] } })
    ;(preset.questions || []).forEach(q => {
      let v = answers[q.id]
      if (q.allowCustom && v === '__custom__') v = (customText[q.id] || '').trim() || (preset.settings[q.field] || '')
      if (q.target === 'settings') settingsPatch[q.field] = v
      else setDeepPath(fsetPatch, q.field, v)
    })
    return { settingsPatch, fsetPatch }
  }

  const needsStaff = preset && preset.settings.capacityModel === 'perStaff'
  const categories = [...new Set(VERTICAL_PRESETS.map(p => p.category))]

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.5)', zIndex:210,
      display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}
      onClick={e => e.target===e.currentTarget && onClose()}>
      <div style={{ background:'#fff', borderRadius:16, padding:24, width:'100%', maxWidth:560, maxHeight:'90vh', overflowY:'scroll', WebkitOverflowScrolling:'touch' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
          <h2 style={{ fontSize:16, fontWeight:'bold' }}>導入ウィザード</h2>
          <button onClick={onClose} aria-label="閉じる" style={{ background:'none', border:'none', fontSize:22, cursor:'pointer', color:'#888' }}>✕</button>
        </div>
        {/* 進行状況（質問が無い業種は2ステップ、ある業種は3ステップ） */}
        <div style={{ display:'flex', gap:6, alignItems:'center', marginBottom:16 }}>
          {Array.from({ length: totalSteps }).map((_, i) => (
            <span key={i} style={{ height:4, borderRadius:2, flex:1, background: i < stepIndex ? '#06c755' : '#eee' }} />
          ))}
          <span style={{ fontSize:11, color:'#aaa', marginLeft:6, whiteSpace:'nowrap' }}>{stepIndex}/{totalSteps}</span>
        </div>

        {step === 'pick' && (
          <>
            <div style={{ fontSize:12, color:'#888', marginBottom:16 }}>お店・施設の業種に近いものを選んでください。次の画面で、業種に応じた追加の質問（呼び方・運用ルール等）に答えるだけで設定が組み立てられます。</div>
            {categories.map(cat => (
              <div key={cat} style={{ marginBottom:16 }}>
                <div style={{ fontSize:11, fontWeight:'bold', color:'#aaa', letterSpacing:'0.03em', marginBottom:6 }}>{cat}</div>
                <div style={{ display:'grid', gap:8 }}>
                  {VERTICAL_PRESETS.filter(p => p.category === cat).map(p => (
                    <button key={p.key} onClick={() => pick(p.key)}
                      style={{ display:'flex', gap:12, alignItems:'flex-start', textAlign:'left', padding:'12px 14px', border:'1.5px solid #eee', borderRadius:10, background:'#fff', cursor:'pointer' }}>
                      <span style={{ fontSize:20, lineHeight:1, flexShrink:0 }}>{p.icon}</span>
                      <span>
                        <span style={{ display:'block', fontSize:13, fontWeight:'bold', color:'#333' }}>{p.label}</span>
                        <span style={{ display:'block', fontSize:11, color:'#999', marginTop:2 }}>{p.hint}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </>
        )}

        {step === 'questions' && preset && (
          <>
            <div style={{ fontSize:12, color:'#888', marginBottom:16 }}>「{preset.label}」向けの追加の質問です。分からなければ既定のままで問題ありません。</div>
            <div style={{ display:'grid', gap:16 }}>
              {preset.questions.map(q => (
                <div key={q.id}>
                  <label style={{ fontSize:13, fontWeight:'bold', color:'#333', display:'block', marginBottom:6 }}>{q.question}</label>
                  <CustomSelect value={String(answers[q.id])}
                    onChange={e => {
                      const raw = e.target.value
                      const opt = q.options.find(o => String(o.value) === raw)
                      setAnswers(a => ({ ...a, [q.id]: opt ? opt.value : raw }))
                    }} style={{ width:'100%' }}>
                    {q.options.map(o => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
                    {q.allowCustom && <option value="__custom__">その他（自由入力）</option>}
                  </CustomSelect>
                  {q.allowCustom && answers[q.id] === '__custom__' && (
                    <>
                      <input value={customText[q.id] || ''} placeholder="呼び方を入力"
                        onChange={e => setCustomText(c => ({ ...c, [q.id]: e.target.value }))}
                        style={{ marginTop:8, width:'100%' }} />
                      <div style={{ fontSize:11, color:'#aaa', marginTop:4 }}>空欄のまま進むと、既定の「{preset.settings[q.field]}」が使われます。</div>
                    </>
                  )}
                </div>
              ))}
            </div>
            <div style={{ display:'flex', gap:10, marginTop:20 }}>
              <button onClick={() => setStep('pick')} style={btnGray}>← 業種を選び直す</button>
              <button onClick={() => setStep('confirm')} style={btnGreen}>次へ</button>
            </div>
          </>
        )}

        {step === 'confirm' && preset && (
          <>
            <div style={{ fontSize:12, color:'#888', marginBottom:12 }}>この内容で設定します。コース一覧・営業時間・料金は変更されません（Q1・Q2の選択肢はこの業種向けの内容に変更されます）。</div>
            <div style={{ background:'#f8f9fa', borderRadius:10, padding:14, fontSize:13, color:'#444', lineHeight:1.8, marginBottom:12 }}>
              <div><b>業種：</b>{preset.label}</div>
              {(preset.questions || []).map(q => {
                let v = answers[q.id]
                if (q.allowCustom && v === '__custom__') v = customText[q.id] || `（未入力→既定「${preset.settings[q.field]}」）`
                const opt = q.options.find(o => o.value === answers[q.id])
                return <div key={q.id}><b>{q.short || q.question}：</b>{opt ? opt.label : String(v)}</div>
              })}
            </div>
            {needsStaff && (
              <div style={{ background:'#fff8e1', border:'1px solid #ffe082', borderRadius:8, padding:'10px 14px', fontSize:12, color:'#795548', marginBottom:12 }}>
                ⚠️ この業種は「{preset.settings.staffLabel || '担当者'}単位」の容量管理です。適用後、設定タブの一覧に最低1{preset.settings.countUnit || '名'}登録しないと、お客様の予約が全て「対応不可」になります。
              </div>
            )}
            <div style={{ fontSize:11, color:'#aaa', marginBottom:16 }}>適用後もまだ保存されていません。「設定」タブと「配信設定」タブ、両方の保存ボタンを押すまで反映されません。</div>
            <div style={{ display:'flex', gap:10 }}>
              <button onClick={() => setStep(preset.questions.length ? 'questions' : 'pick')} style={btnGray}>← 戻る</button>
              <button onClick={() => { const { settingsPatch, fsetPatch } = buildResult(); onApply(settingsPatch, fsetPatch, preset.label, needsStaff); }} style={btnGreen}>この内容で適用する</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Main Admin ────────────────────────────────────────────────────
export default function Admin() {
  const [authed,       setAuthed]       = useState(false)
  const [loginName,    setLoginName]    = useState('')
  const [loginPw,      setLoginPw]      = useState('')
  const [loginErr,     setLoginErr]     = useState('')
  const [loggingIn,    setLoggingIn]    = useState(false)
  // スタッフ個人ログイン（店長／スタッフの権限分け）。myRoleが空文字＝共通パスワード（店長、後方互換）。
  const [myRole,       setMyRole]       = useState('owner')
  const [myName,       setMyName]       = useState('')
  const isOwner = myRole === 'owner'
  // スタッフ個人アカウントの管理（店長のみ）
  const [staffAccounts, setStaffAccounts] = useState([])
  const [showAddAccount, setShowAddAccount] = useState(false)
  const [editingAccountId, setEditingAccountId] = useState(null)
  const [newAccountName, setNewAccountName] = useState('')
  const [newAccountPassword, setNewAccountPassword] = useState('')
  const [newAccountRole, setNewAccountRole] = useState('staff')
  const [savingAccount, setSavingAccount] = useState(false)
  const [showRecovery, setShowRecovery] = useState(false)
  const [recoveryCode, setRecoveryCode] = useState('')
  const [recoveryMsg,  setRecoveryMsg]  = useState({ text:'', ok:true })
  const [recovering,   setRecovering]   = useState(false)

  const [tab, setTab] = useState('reservations')
  const [toast,     setToast]     = useState({ msg:'', type:'ok' })

  // Calendar nav (shared)
  const [calYear,  setCalYear]  = useState(new Date().getFullYear())
  const [calMonth, setCalMonth] = useState(new Date().getMonth())

  // ── Reservations tab ────
  const [reservations,  setReservations]  = useState([])
  const [resLoading,    setResLoading]    = useState(false)
  const [selectedDate,  setSelectedDate]  = useState(null)
  const [editRes,       setEditRes]       = useState(null)
  const [cancelingResId, setCancelingResId] = useState(null)
  const [showAddModal,  setShowAddModal]  = useState(false)
  const [addInitDate,   setAddInitDate]   = useState(null)
  const [showSeatForm,  setShowSeatForm]  = useState(false)
  const [seatInput,     setSeatInput]     = useState({ seats:4, reason:'' })
  const [seatSaving,    setSeatSaving]    = useState(false)
  const [showHoursForm, setShowHoursForm] = useState(false)
  const [hoursInput,    setHoursInput]    = useState({ lunchEnabled:false, lunchStart:'11:30', lunchEnd:'14:00', dinnerEnabled:true, dinnerStart:'17:00', dinnerEnd:'21:00' })
  const [hoursSaving,   setHoursSaving]   = useState(false)

  // ── Block tab ────
  const [blocked,       setBlocked]       = useState([])
  const [seatBlocks,    setSeatBlocks]    = useState([])
  const [dateOverrides, setDateOverrides] = useState([])
  const [blockLoading,  setBlockLoading]  = useState(false)
  const [closedDayAdding, setClosedDayAdding] = useState(false)

  // ── System status（通知の自動停止セーフティ）────
  const [systemStopped, setSystemStopped] = useState(false)
  const [systemStopPersistent, setSystemStopPersistent] = useState(false)
  const [systemStopReason, setSystemStopReason] = useState('')
  const [systemStopRemainMin, setSystemStopRemainMin] = useState(0)
  const [resettingStop, setResettingStop] = useState(false)

  // ── Notifications tab ────
  const [notifs,          setNotifs]          = useState([])
  const [notifLoading,    setNotifLoading]    = useState(false)
  const [selectedNotifIds,setSelectedNotifIds]= useState(new Set())
  const [auditLog,        setAuditLog]        = useState([])
  const [auditLoading,    setAuditLoading]    = useState(false)
  const [showAuditLog,    setShowAuditLog]    = useState(false)
  const [waitlist,        setWaitlist]        = useState([])
  const [waitlistLoading, setWaitlistLoading] = useState(false)
  const [showWaitlist,    setShowWaitlist]    = useState(false)
  const [bizSummary,      setBizSummary]      = useState(null)
  // ── 配信設定タブ（LINE配信のタイミング・文言・機能ON/OFF。コード変更不要で店側が調整できる） ────
  const defaultFset = {
    reminders: { dayBeforeEnabled: true, dayBeforeHour: 18, weekBeforeEnabled: false, weekBeforeHour: 10 },
    postVisitFollowUp: { enabled: true, hour: 21, reviewRequestEnabled: true, reviewCooldownDays: 60, skipReviewForKasshiki: true },
    noShowDetection: { enabled: true, hour: 23 },
    nightlyHealthCheck: { enabled: true, hour: 3 },
    visitCountMessage: { mode: 'staffOnly' },
    kasshiki: { enabled: true },
    kasshikiFormalTone: { enabled: true },
    singleDinerRequiresCompany: { enabled: true },
    waitlist: { enabled: true },
    lateRequestButton: { enabled: true },
    messageTemplates: { postVisitThanks: '', reviewRequestLine: '' },
  }
  const [fset, setFset] = useState(defaultFset)
  const [presetChoice, setPresetChoice] = useState('')
  const [showWizard, setShowWizard] = useState(false)
  const [showQuickApply, setShowQuickApply] = useState(false)
  const templateFileInputRef = useRef(null)
  const [fsetLoading, setFsetLoading] = useState(false)
  const [fsetSaving, setFsetSaving] = useState(false)
  // ── 店舗の基本情報（店名・電話番号等）。他業態・他店舗への転用時にコード変更なしで変えられるようにする ──
  const [bizName, setBizName] = useState('貝屋和光')
  const [sysAdminContact, setSysAdminContact] = useState('管理者')
  // ── Settings tab ────
  const defCutoff = { daysBefore:2, time:'22:00' }
  const defCutoffRules = { '0':{ daysBefore:3, time:'22:00' }, '1':defCutoff, '2':defCutoff, '3':defCutoff, '4':defCutoff, '5':defCutoff, '6':{ daysBefore:2, time:'22:00' }, 'holiday':{ daysBefore:3, time:'22:00' } }
  const defTimeRanges = [{ type:'lunch', label:'ランチ', start:'11:30', end:'14:00' }, { type:'dinner', label:'ディナー', start:'17:00', end:'21:00' }]
  const defDailyHours = Object.fromEntries(['0','1','2','3','4','5','6'].map(d => [d, {
    lunchEnabled: d === '0' || d === '6',
    lunchStart: '11:30', lunchEnd: '14:00',
    dinnerEnabled: true,
    dinnerStart: '17:00', dinnerEnd: '21:00',
  }]))
  const [settings, setSettings] = useState({ maxSeats:8, courses:[], timeRanges: defTimeRanges, dailyHours: defDailyHours, cutoffRules: defCutoffRules, bookingNotes:'', seatsByWeekday:null, capacityModel:'daily', capacityBoosts:[],
    restaurantName:'貝屋和光', restaurantShort:'和光', restaurantTagline:'築地／貝焼き専門店', restaurantAddress:'', contactPhone:'080-9391-1475',
    systemAdminContact:'管理者', groupADescription:'少人数の管理者グループ', groupBDescription:'スタッフ全員グループ', webBaseUrl:'',
    q1Options:['誕生日・記念日', '接待・会食', '友人・仲間と', '家族で', 'デート', 'その他'],
    q3Options:['グーグルマップ', 'インターネット検索', '食べログ', 'SNS', '知人の紹介', 'その他'],
    bookingMode:'course', itemLabel:'コース', itemIcon:'🍽', staffAssignmentEnabled:false, staffLabel:'担当者', countUnit:'名', storeSpecificNotifSections:[], bookingSources:SOURCES_DINING, staffRoster:[], guestCountEnabled:true, fixedGuestCount:'1', companionInfoEnabled:true, defaultStayMin:150, defaultCourseName:'コース名', unparseableGuestFallback:8, emailCollectionEnabled:false, enabledLanguages:['ja'],
    adBannerEnabled:false, adBannerImageUrl:'', adBannerText:'', adBannerLinkUrl:'', adBannerPlacements:['done'], storeImageUrl:'',
    adminNotifyChannel:'line', adminAlertEmail:'' })
  const resCacheRef = useRef({})
  const settingsSnapshotRef = useRef(null)
  const fsetSnapshotRef = useRef(null)
  const [settingsDirty, setSettingsDirty] = useState(false)
  const [fsetDirty, setFsetDirty] = useState(false)
  const [settingsLoading,setSettingsLoading] = useState(false)
  const [settingsSaving, setSettingsSaving]  = useState(false)
  const [editCourseIdx,  setEditCourseIdx]   = useState(-1)
  const [editCourse,     setEditCourse]      = useState({})
  const [showAddCourse,  setShowAddCourse]   = useState(false)
  const [newCourse,      setNewCourse]       = useState({ name:'', price:'', description:'', duration:150, mealType:'dinner', imageUrl:'' })

  // ── Password change ────
  const [pwCurrent,   setPwCurrent]   = useState('')
  const [pwNew,       setPwNew]       = useState('')
  const [pwMsg,       setPwMsg]       = useState({ text:'', ok:true })
  const [pwChanging,  setPwChanging]  = useState(false)
  const [rcCurrent,        setRcCurrent]        = useState('')
  const [qaQuestion,       setQaQuestion]       = useState('')
  const [qaAnswer,         setQaAnswer]         = useState('')
  const [rcMsg,            setRcMsg]            = useState({ text:'', ok:true })
  const [rcChanging,       setRcChanging]       = useState(false)
  const [recoveryQuestion, setRecoveryQuestion] = useState('')
  const [loadingQuestion,  setLoadingQuestion]  = useState(false)

  // ── Notification settings tab ────
  const DEFAULT_NOTIF_SETTINGS = {
    LINE_新規予約:      { enabled: true,  target: 'B' },
    LINE_変更:         { enabled: true,  target: 'A' },
    LINE_キャンセル:    { enabled: true,  target: 'A' },
    LINE_管理者追加:    { enabled: true,  target: 'B' },
    LINE_管理者変更:    { enabled: true,  target: 'B' },
    LINE_管理者削除:    { enabled: true,  target: 'B' },
    食べログ_新規:      { enabled: true,  target: 'B' },
    食べログ_変更:      { enabled: true,  target: 'B' },
    食べログ_キャンセル: { enabled: true,  target: 'B' },
    椎名_同期:         { enabled: true,  target: 'B' },
    椎名_変更:         { enabled: true,  target: 'B' },
    椎名_削除:         { enabled: true,  target: 'B' },
    手動_追加:         { enabled: true,  target: 'B' },
    手動_変更:         { enabled: true,  target: 'B' },
    手動_削除:         { enabled: true,  target: 'B' },
    カレンダー連携_追加: { enabled: true,  target: 'B' },
    エラー:            { enabled: true,  target: 'B' },
  }
  const [notifSettings, setNotifSettings] = useState(DEFAULT_NOTIF_SETTINGS)
  const [notifSettingsLoading, setNotifSettingsLoading] = useState(false)
  // グループBの候補確認・確定（Botを招待したLINEグループでメッセージがあると、line-webhook.jsが
  // 無認証で「候補」として記録する。ここで内容を見て問題なければ確定させる）
  const [capturedGroupId, setCapturedGroupId] = useState('')
  const [capturedGroupIdLoading, setCapturedGroupIdLoading] = useState(false)
  const [settingGroupB, setSettingGroupB] = useState(false)
  const [notifSettingsSaving,  setNotifSettingsSaving]  = useState(false)

  // ── Data management ────
  const [custData,       setCustData]       = useState(null)
  const [custLoading,    setCustLoading]    = useState(false)
  const [allResData,     setAllResData]     = useState(null)
  const [allResLoading,  setAllResLoading]  = useState(false)
  const [allResDateFrom, setAllResDateFrom] = useState('')
  const [allResDateTo,   setAllResDateTo]   = useState('')

  function showToast(msg, type='ok') {
    setToast({ msg, type })
    setTimeout(() => setToast({ msg:'', type:'ok' }), 3000)
  }

  // ── Auth check on mount ────────────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return
    const savedPw = sessionStorage.getItem('adminPw')
    const savedName = sessionStorage.getItem('adminName') || ''
    const savedRole = sessionStorage.getItem('adminRole') || 'owner'
    if (sessionStorage.getItem('adminAuthed') === '1' && savedPw) {
      setStaffIdentity(savedName, savedPw)
      setMyName(savedName)
      setMyRole(savedRole)
      setAuthed(true)
    } else {
      // 古い形式（パスワード未保存）のセッションは無効化し、再ログインを求める
      sessionStorage.removeItem('adminAuthed')
    }
  }, [])

  async function doLogin() {
    if (!loginPw) return setLoginErr('パスワードを入力してください')
    setLoggingIn(true)
    setLoginErr('')
    try {
      // お名前が入力されていればスタッフ個人アカウント、空欄なら従来通りの共通パスワード（店長）としてログインする
      const r = loginName.trim() ? await api.staffLogin(loginName.trim(), loginPw) : await api.checkAdminPassword(loginPw)
      if (r.success) {
        const role = loginName.trim() ? (r.role || 'staff') : 'owner'
        const name = loginName.trim() ? (r.name || loginName.trim()) : ''
        sessionStorage.setItem('adminAuthed', '1')
        sessionStorage.setItem('adminPw', loginPw)
        sessionStorage.setItem('adminName', name)
        sessionStorage.setItem('adminRole', role)
        setStaffIdentity(name, loginPw)
        setMyName(name)
        setMyRole(role)
        setAuthed(true)
      } else if (r.locked) {
        setLoginErr(r.error || 'ログイン試行回数が多すぎます。しばらく時間をおいて再度お試しください。')
      } else {
        setLoginErr(r.error || 'パスワードが正しくありません')
      }
    } catch { setLoginErr('通信エラーが発生しました。もう一度お試しください') }
    setLoggingIn(false)
  }

  function doLogout() {
    // 「設定」「配信設定」タブに未保存の変更がある状態でログアウトすると、beforeunloadガードが効かず
    // 変更が無警告で失われてしまっていた（Appleデザインチーム視点レビューでの指摘）。
    if ((settingsDirty || fsetDirty) && !window.confirm('保存していない変更があります。ログアウトすると変更内容は失われます。よろしいですか？')) return
    sessionStorage.removeItem('adminAuthed')
    sessionStorage.removeItem('adminPw')
    sessionStorage.removeItem('adminName')
    sessionStorage.removeItem('adminRole')
    setAdminPassword('')
    setAuthed(false)
    setLoginPw('')
    setLoginName('')
    setMyName('')
    setMyRole('owner')
  }

  async function doRecovery() {
    if (!recoveryCode.trim()) return setRecoveryMsg({ text:'合言葉の答えを入力してください', ok:false })
    setRecovering(true)
    setRecoveryMsg({ text:'', ok:true })
    try {
      const r = await api.resetAdminPassword(recoveryCode.trim())
      if (r.success) {
        // 以前はリセット後のパスワードが常に固定文字列「MV」だったため、ここでその値をそのまま
        // 案内文に埋め込んでいた。バックエンド側をランダムな一時パスワード発行に変更したため
        // （Microsoft CEO視点レビュー・ラウンド25での指摘：固定値は未認証のログイン画面にも表示され、
        // 合言葉を知らない者にも「リセット後は必ずMV」という事実だけが伝わってしまっていた）、
        // ここでは都度サーバーが返す一時パスワードをそのまま表示する。
        setRecoveryMsg({ text:`パスワードを「${r.tempPassword}」にリセットしました。このパスワードでログインし、必ずすぐに変更してください。`, ok:true })
        setShowRecovery(false)
        setLoginPw('')
        setRecoveryCode('')
      } else {
        setRecoveryMsg({ text: r.error || '答えが正しくありません', ok:false })
      }
    } catch { setRecoveryMsg({ text:'通信エラーが発生しました。もう一度お試しください', ok:false }) }
    setRecovering(false)
  }

  // ── Auto-load on mount / auth ───────────────────────────────────
  useEffect(() => {
    if (!authed) return
    // 閲覧のみはスタッフも可能（予約カレンダー表示に使うため）
    loadBlocked()
    loadSeatBlocks()
    loadDateOverrides()
    loadSettings()
    loadSystemStatus()
    // 以下は店長専用の情報のため、スタッフでログインした場合は取得しない（無駄なエラー応答を避ける）
    if (isOwner) {
      loadNotifications()
      loadNotifSettings()
      loadCapturedGroupId()
      loadBusinessSummary()
      loadFset()
      loadStaffAccounts()
    }
    const timer = setInterval(loadSystemStatus, 5 * 60 * 1000)
    return () => clearInterval(timer)
  }, [authed, isOwner])

  // 「設定」「配信設定」タブに未保存の変更があるかどうかを検知（読込・保存直後のスナップショットとの比較）
  useEffect(() => {
    if (settingsSnapshotRef.current === null) return
    setSettingsDirty(JSON.stringify(settings) !== settingsSnapshotRef.current)
  }, [settings])

  useEffect(() => {
    if (fsetSnapshotRef.current === null) return
    setFsetDirty(JSON.stringify(fset) !== fsetSnapshotRef.current)
  }, [fset])

  // 未保存の変更がある状態でページを離れようとした場合はブラウザ標準の確認を出す
  useEffect(() => {
    if (!settingsDirty && !fsetDirty) return
    const handler = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [settingsDirty, fsetDirty])

  async function loadSystemStatus() {
    try {
      const r = await api.getSystemStatus()
      setSystemStopped(!!r.stopped)
      setSystemStopPersistent(!!r.persistent)
      setSystemStopReason(r.reason || '')
      setSystemStopRemainMin(r.remainingMs ? Math.ceil(r.remainingMs / 60000) : 0)
    } catch {}
  }

  async function resetSystemStop() {
    const msg = systemStopPersistent
      ? 'これは短時間に繰り返し発生した「恒久的な問題の可能性がある」停止です。この表示を消しても、原因を解決しない限りカレンダー同期システム側は停止したままです（自動復旧しません）。よろしいですか？'
      : 'この表示だけを非表示にします。カレンダー同期システム側の自動処理は、原因が解消していなければ約15分後まで停止したままです（そちら側は自動的に復旧します）。よろしいですか？'
    if (!window.confirm(msg)) return
    setResettingStop(true)
    try {
      const r = await api.adminResetSystemStop()
      if (r.success) { showToast('表示を消しました'); setSystemStopped(false) }
      else showToast(r.error||'解除に失敗しました','error')
    } catch { showToast('通信エラーが発生しました。もう一度お試しください','error') }
    setResettingStop(false)
  }

  useEffect(() => {
    if (!authed) return
    setSelectedDate(null)
    setShowSeatForm(false)
    loadReservations()
  }, [authed, calYear, calMonth])

  useEffect(() => {
    const block = selectedDate ? seatBlocks.find(sb => sb.date === selectedDate) || null : null
    if (block) setSeatInput({ seats: block.blockedSeats, reason: block.reason || '' })
    else { setSeatInput({ seats:4, reason:'' }); setShowSeatForm(false) }
  }, [selectedDate, seatBlocks])

  useEffect(() => {
    const ov = selectedDate ? dateOverrides.find(o => o.date === selectedDate) || null : null
    if (ov) setHoursInput({ lunchEnabled: !!ov.lunchEnabled, lunchStart: ov.lunchStart||'11:30', lunchEnd: ov.lunchEnd||'14:00', dinnerEnabled: !!ov.dinnerEnabled, dinnerStart: ov.dinnerStart||'17:00', dinnerEnd: ov.dinnerEnd||'21:00' })
    else { setHoursInput({ lunchEnabled:false, lunchStart:'11:30', lunchEnd:'14:00', dinnerEnabled:true, dinnerStart:'17:00', dinnerEnd:'21:00' }); setShowHoursForm(false) }
  }, [selectedDate, dateOverrides])

  // ── Data loaders ────────────────────────────────────────────────
  async function loadReservations() {
    const y = calYear, m = calMonth
    const cacheKey = `${y}-${m}`
    const pad = n => String(n).padStart(2,'0')
    const lastD = new Date(y, m+1, 0).getDate()
    const filter = {
      dateFrom: `${y}/${pad(m+1)}/01`,
      dateTo:   `${y}/${pad(m+1)}/${pad(lastD)}`,
    }
    if (resCacheRef.current[cacheKey]) {
      setReservations(resCacheRef.current[cacheKey])
      return
    }
    setResLoading(true)
    try {
      const r = await api.adminGetReservations(filter)
      const list = r.list || []
      resCacheRef.current[cacheKey] = list
      setReservations(list)
      // Silently preload adjacent months
      ;[-3, -2, -1, 1, 2, 3].forEach(delta => {
        let pm = m + delta, py = y
        if (pm < 0) { pm = 11; py-- }
        if (pm > 11) { pm = 0; py++ }
        const key = `${py}-${pm}`
        if (resCacheRef.current[key] !== undefined) return
        const ld = new Date(py, pm+1, 0).getDate()
        api.adminGetReservations({ dateFrom:`${py}/${pad(pm+1)}/01`, dateTo:`${py}/${pad(pm+1)}/${pad(ld)}` })
          .then(rr => { if (resCacheRef.current[key] === undefined) resCacheRef.current[key] = rr.list || [] })
          .catch(() => {})
      })
    } catch { setReservations([]) }
    setResLoading(false)
  }

  function refreshRes() {
    delete resCacheRef.current[`${calYear}-${calMonth}`]
    loadReservations()
  }

  async function doRefreshAll() {
    resCacheRef.current = {}
    loadReservations()
    loadBlocked()
    loadSeatBlocks()
    loadNotifications()
  }

  async function loadBlocked() {
    setBlockLoading(true)
    try {
      const r = await api.adminGetBlockedDates()
      setBlocked(r.list || [])
    } catch { setBlocked([]) }
    setBlockLoading(false)
  }

  async function loadSeatBlocks() {
    try {
      const r = await api.adminGetSeatBlocks()
      setSeatBlocks(r.list || [])
    } catch { setSeatBlocks([]) }
  }

  async function loadDateOverrides() {
    try {
      const r = await api.adminGetDateOverrides()
      setDateOverrides(r.list || [])
    } catch { setDateOverrides([]) }
  }

  async function loadNotifications() {
    setNotifLoading(true)
    try {
      const r = await api.adminGetNotifications()
      setNotifs(r.list || [])
    } catch { setNotifs([]) }
    setNotifLoading(false)
  }

  async function loadStaffAccounts() {
    try {
      const r = await api.adminGetStaffAccounts()
      setStaffAccounts(r.list || [])
    } catch { setStaffAccounts([]) }
  }

  async function saveStaffAccount() {
    if (!newAccountName.trim()) return showToast('お名前を入力してください', 'error')
    if (!editingAccountId && !newAccountPassword) return showToast('新規アカウントにはパスワードが必要です', 'error')
    setSavingAccount(true)
    try {
      const r = await api.adminSaveStaffAccount(editingAccountId || '', newAccountName.trim(), newAccountPassword, newAccountRole)
      if (r.success) {
        showToast(editingAccountId ? 'アカウントを更新しました' : 'アカウントを追加しました')
        setNewAccountName(''); setNewAccountPassword(''); setNewAccountRole('staff'); setEditingAccountId(null); setShowAddAccount(false)
        loadStaffAccounts()
      } else {
        showToast(r.error || '保存に失敗しました', 'error')
      }
    } catch { showToast('通信エラーが発生しました。もう一度お試しください', 'error') }
    setSavingAccount(false)
  }

  async function removeStaffAccount(account) {
    if (!window.confirm(`「${account.name}」のアカウントを削除します。このアカウントでのログインができなくなります。よろしいですか？`)) return
    try {
      const r = await api.adminRemoveStaffAccount(account.id)
      if (r.success) { showToast('アカウントを削除しました'); loadStaffAccounts() }
      else showToast(r.error || '削除に失敗しました', 'error')
    } catch { showToast('通信エラーが発生しました。もう一度お試しください', 'error') }
  }

  async function loadAuditLog() {
    setAuditLoading(true)
    try {
      const r = await api.adminGetAuditLog()
      setAuditLog(r.list || [])
    } catch { setAuditLog([]) }
    setAuditLoading(false)
  }

  async function loadWaitlist() {
    setWaitlistLoading(true)
    try {
      const r = await api.adminGetWaitlist()
      setWaitlist(r.list || [])
    } catch { setWaitlist([]) }
    setWaitlistLoading(false)
  }

  async function loadBusinessSummary() {
    try {
      const r = await api.adminGetBusinessSummary()
      if (r.success) setBizSummary(r)
    } catch {}
  }

  async function loadFset() {
    setFsetLoading(true)
    try {
      const r = await api.getFeatureSettings()
      if (r.success) {
        setFset(r.settings)
        fsetSnapshotRef.current = JSON.stringify(r.settings)
        setFsetDirty(false)
      }
    } catch {}
    setFsetLoading(false)
  }

  async function saveFset() {
    setFsetSaving(true)
    try {
      const r = await api.saveFeatureSettings(fset)
      if (r.success) {
        setFset(r.settings)
        fsetSnapshotRef.current = JSON.stringify(r.settings)
        setFsetDirty(false)
        showToast('配信設定を保存しました')
      }
      else showToast(r.error || '保存に失敗しました', 'error')
    } catch { showToast('通信エラーが発生しました。もう一度お試しください', 'error') }
    setFsetSaving(false)
  }

  // 設定内の1つのキーを更新するヘルパー（例: updateFset('reminders', 'dayBeforeEnabled', true)）
  function updateFset(section, key, value) {
    setFset(prev => ({ ...prev, [section]: { ...prev[section], [key]: value } }))
  }

  function applyVerticalPreset() {
    const preset = VERTICAL_PRESETS.find(p => p.key === presetChoice)
    if (!preset) return
    const needsStaff = preset.settings.capacityModel === 'perStaff'
    const staffLabelForPreset = preset.settings.staffLabel || '担当者'
    const countUnitForPreset = preset.settings.countUnit || '名'
    const ok = window.confirm(
      `「${preset.label}」向けの設定を一括で適用します。\n\n` +
      `コース選択・容量の数え方・${staffLabelForPreset}指名・貸切機能・1名相席ルール等、複数の項目がまとめて変更されます（コース一覧・営業時間・料金等は変更されません）。\n` +
      `適用後もまだ保存されていません。「設定」タブと「配信設定」タブ、両方の保存ボタンを押すまで反映されない点にご注意ください。\n` +
      (needsStaff ? `\n⚠️ このプリセットは「${staffLabelForPreset}単位」の容量管理です。適用後、下の「${staffLabelForPreset}一覧」に最低1${countUnitForPreset}登録しないと、お客様の予約が全て「対応不可」になります。\n` : '') +
      `\nよろしいですか？`
    )
    if (!ok) return
    setSettings(s => ({ ...s, ...preset.settings }))
    // preset.fsetの全セクションを反映する（以前はkasshiki/singleDinerRequiresCompanyの2つだけ固定で
    // 見ており、他のセクション（noShowDetection等）を追加しても無視されていた）
    setFset(f => {
      const next = { ...f }
      Object.keys(preset.fset || {}).forEach(section => { next[section] = { ...next[section], ...preset.fset[section] } })
      return next
    })
    showToast(needsStaff
      ? `「${preset.label}」の設定を適用しました。${staffLabelForPreset}一覧に最低1${countUnitForPreset}登録した上で、「設定」タブと「配信設定」タブそれぞれの保存ボタンを押してください。`
      : `「${preset.label}」の設定を適用しました。内容を確認し、「設定」タブと「配信設定」タブそれぞれの保存ボタンを押してください。`)
  }

  // 導入ウィザード（SetupWizard）が組み立てた設定を反映する。settingsPatchはそのままマージ、
  // fsetPatchはkasshiki/singleDinerRequiresCompany等のセクション単位でマージする
  // （fset全体を上書きすると、ウィザードが触れていない他のセクションの既存設定が消えてしまうため）。
  function applyWizardResult(settingsPatch, fsetPatch, presetLabel, needsStaff) {
    setSettings(s => ({ ...s, ...settingsPatch }))
    setFset(f => {
      const next = { ...f }
      Object.keys(fsetPatch).forEach(section => { next[section] = { ...next[section], ...fsetPatch[section] } })
      return next
    })
    setShowWizard(false)
    showToast(needsStaff
      ? `「${presetLabel}」の設定を適用しました。${settingsPatch.staffLabel || '担当者'}一覧に最低1${settingsPatch.countUnit || '名'}登録した上で、「設定」タブと「配信設定」タブそれぞれの保存ボタンを押してください。`
      : `「${presetLabel}」の設定を適用しました。内容を確認し、「設定」タブと「配信設定」タブそれぞれの保存ボタンを押してください。`)
  }

  // 複数店舗展開向け：この店舗の業態・運用ルールをJSONファイルとして書き出す（店名・電話番号・
  // 担当者一覧の実名等の店舗固有情報は含めない）。新しい店舗のデプロイでこのファイルを読み込めば、
  // ゼロから設定し直さずに近い状態から始められる。
  function exportSettingsTemplate() {
    const exported = {}
    TEMPLATE_SETTINGS_KEYS.forEach(k => { exported[k] = settings[k] })
    // fsetのmessageTemplates（お礼・口コミ依頼文言の自由記述）は店舗の言葉遣い・ブランドが残るため、
    // settingsのTEMPLATE_SETTINGS_KEYSと同じ「許可リスト」方式で除外する（Microsoft CEO視点レビューでの指摘：
    // storeSpecificNotifSectionsと同種のクロスストア情報漏洩だった）。
    const { messageTemplates, ...exportedFset } = fset
    const payload = { _templateType: 'kaiya-reservation-settings-template', _exportedAt: new Date().toISOString(), settings: exported, fset: exportedFset }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `reservation-settings-template-${(settings.itemLabel || 'store').replace(/[^\w一-龠ぁ-んァ-ヶ]/g, '')}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    showToast('設定テンプレートを書き出しました。新しい店舗の管理画面で「テンプレートを読み込む」から使えます。')
  }

  function importSettingsTemplate(file) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = (e) => {
      let payload
      try { payload = JSON.parse(e.target.result) } catch { showToast('ファイルの読み込みに失敗しました（JSON形式が正しくない可能性があります）', 'error'); return }
      // TEMPLATE_SETTINGS_KEYSの許可リストで絞り込む。書き出し側（exportSettingsTemplate）は
      // 既にこの許可リストで絞っているが、手で編集された・古い形式のテンプレートファイルには
      // それ以外のキー（店名等）が残っている可能性があるため、読み込み側でも同じ絞り込みを
      // 行う（ITコンサル視点レビューでの指摘：読み込み側に絞り込みが無く、書き出し側の許可リストの
      // 意味が読み込み時に素通しで失われていた）。
      const rawIncoming = payload.settings || payload
      const incoming = {}
      TEMPLATE_SETTINGS_KEYS.forEach(k => { if (rawIncoming[k] !== undefined) incoming[k] = rawIncoming[k] })
      const ok = window.confirm('設定テンプレートを読み込みます。コース・営業時間・Q1・Q2の選択肢等がこのファイルの内容で上書きされます（店名・電話番号・担当者一覧は上書きされません）。保存ボタンを押すまでは反映されません。よろしいですか？')
      if (!ok) return
      setSettings(s => ({ ...s, ...incoming }))
      // messageTemplatesは（旧バージョンで書き出された古いテンプレートファイルに残っている場合に備えて）
      // 読み込み側でも除外する
      if (payload.fset) { const { messageTemplates, ...incomingFset } = payload.fset; setFset(f => ({ ...f, ...incomingFset })) }
      showToast('設定テンプレートを読み込みました。内容を確認し、「設定」タブと「配信設定」タブそれぞれの保存ボタンを押してください。')
    }
    reader.readAsText(file)
  }

  async function removeWaitlistEntry(id) {
    // 他の削除系操作（予約削除・受付停止枠解除・スタッフアカウント削除等）は全て確認ダイアログを
    // 挟むのに、キャンセル待ちの削除だけ確認無しで即時実行されていた（スタッフ視点レビューでの指摘：
    // スマホの小さいボタンでの誤操作1回で、お客様のキャンセル待ち登録が復元不可能に消える）。
    if (!window.confirm('このキャンセル待ち登録を削除します。よろしいですか？\n（削除すると、空きが出た際にこのお客様へは通知されなくなります）')) return
    try {
      const r = await api.adminRemoveWaitlist(id)
      if (r.success) { showToast('削除しました'); loadWaitlist() }
      else showToast(r.error || '削除に失敗しました', 'error')
    } catch { showToast('通信エラーが発生しました', 'error') }
  }

  async function loadNotifSettings() {
    setNotifSettingsLoading(true)
    try {
      const r = await api.getNotificationSettings()
      if (r.success && r.settings) setNotifSettings({ ...DEFAULT_NOTIF_SETTINGS, ...r.settings })
      else if (r.error) showToast('通知設定の読み込みに失敗しました', 'error')
    } catch { showToast('通知設定の読み込みに失敗しました', 'error') }
    setNotifSettingsLoading(false)
  }

  async function loadCapturedGroupId() {
    setCapturedGroupIdLoading(true)
    try {
      const r = await api.adminGetCapturedGroupId()
      if (r.groupId !== undefined) setCapturedGroupId(r.groupId)
    } catch {}
    setCapturedGroupIdLoading(false)
  }

  async function confirmGroupB() {
    if (!capturedGroupId) return
    if (!window.confirm('このグループIDを「グループB」（新規予約・スタッフ操作の通知先）として設定します。よろしいですか？')) return
    setSettingGroupB(true)
    try {
      const r = await api.adminSetGroupBId(capturedGroupId)
      if (r.ok) { showToast('グループBを設定しました'); setSettings(s => ({ ...s, hasGroupB: true })) }
      else showToast(r.error || '設定に失敗しました', 'error')
    } catch { showToast('通信エラーが発生しました。もう一度お試しください', 'error') }
    setSettingGroupB(false)
  }

  async function saveNotifSettings() {
    setNotifSettingsSaving(true)
    try {
      const r = await api.saveNotificationSettings(notifSettings)
      if (r.success) showToast('通知設定を保存しました')
      else showToast(r.error || '保存に失敗しました', 'error')
    } catch { showToast('通信エラーが発生しました。もう一度お試しください', 'error') }
    setNotifSettingsSaving(false)
  }

  async function loadSettings() {
    setSettingsLoading(true)
    try {
      const [r, notifyR] = await Promise.all([api.getSettings(), api.getAdminNotifySettings()])
      if (r.success) {
        const tr = (r.timeRanges && r.timeRanges.length > 0) ? r.timeRanges : defTimeRanges
        const loaded = {
          maxSeats: r.maxSeats||8,
          courses: r.courses||[],
          timeRanges: tr,
          dailyHours: r.dailyHours || defDailyHours,
          cutoffRules: r.cutoffRules||defCutoffRules,
          bookingNotes: r.bookingNotes||'',
          seatsByWeekday: r.seatsByWeekday || null,
          capacityBoosts: r.capacityBoosts || [],
          capacityModel: r.capacityModel || 'daily',
          q1Options: (r.q1Options && r.q1Options.length) ? r.q1Options : ['誕生日・記念日', '接待・会食', '友人・仲間と', '家族で', 'デート', 'その他'],
          q3Options: (r.q3Options && r.q3Options.length) ? r.q3Options : ['グーグルマップ', 'インターネット検索', '食べログ', 'SNS', '知人の紹介', 'その他'],
          restaurantName: r.restaurantName || '貝屋和光',
          restaurantShort: r.restaurantShort || '和光',
          restaurantTagline: r.restaurantTagline || '',
          restaurantAddress: r.restaurantAddress || '',
          contactPhone: r.contactPhone || '',
          systemAdminContact: r.systemAdminContact || '管理者',
          webBaseUrl: r.webBaseUrl || '',
          groupADescription: r.groupADescription || '少人数の管理者グループ',
          groupBDescription: r.groupBDescription || 'スタッフ全員グループ',
          hasGroupB: !!r.hasGroupB,
          bookingMode: r.bookingMode || 'course',
          itemLabel: r.itemLabel || 'コース',
          itemIcon: r.itemIcon || '🍽',
          staffAssignmentEnabled: !!r.staffAssignmentEnabled,
          staffLabel: r.staffLabel || '担当者',
          countUnit: r.countUnit || '名',
          storeSpecificNotifSections: Array.isArray(r.storeSpecificNotifSections) ? r.storeSpecificNotifSections : [],
          bookingSources: Array.isArray(r.bookingSources) && r.bookingSources.length > 0 ? r.bookingSources : ['電話','LINE','ウォークイン','その他'],
          guestCountEnabled: r.guestCountEnabled === undefined ? true : !!r.guestCountEnabled,
          fixedGuestCount: r.fixedGuestCount || '1',
          companionInfoEnabled: r.companionInfoEnabled === undefined ? true : !!r.companionInfoEnabled,
          defaultStayMin: r.defaultStayMin || 150,
          defaultCourseName: r.defaultCourseName || 'コース名',
          unparseableGuestFallback: r.unparseableGuestFallback || 8,
          emailCollectionEnabled: !!r.emailCollectionEnabled,
          enabledLanguages: (r.enabledLanguages && r.enabledLanguages.length) ? r.enabledLanguages : ['ja'],
          staffRoster: r.staffRoster || [],
          adBannerEnabled: !!r.adBannerEnabled,
          adBannerImageUrl: r.adBannerImageUrl || '',
          adBannerText: r.adBannerText || '',
          adBannerLinkUrl: r.adBannerLinkUrl || '',
          adBannerPlacements: (r.adBannerPlacements && r.adBannerPlacements.length) ? r.adBannerPlacements : ['done'],
          storeImageUrl: r.storeImageUrl || '',
          // adminNotifyChannel/adminAlertEmailは認証必須の別アクション（getAdminNotifySettings）から取得する
          // （以前はgetSettings経由で無認証公開されていた実害あるPII漏洩——ITコンサル視点レビュー・ラウンド26）。
          adminNotifyChannel: (notifyR && notifyR.success && notifyR.adminNotifyChannel) || 'line',
          adminAlertEmail: (notifyR && notifyR.success && notifyR.adminAlertEmail) || '',
        }
        setSettings(loaded)
        settingsSnapshotRef.current = JSON.stringify(loaded)
        setSettingsDirty(false)
        setBizName(r.restaurantName || '貝屋和光')
        setSysAdminContact(r.systemAdminContact || '管理者')
      }
    } catch {}
    setSettingsLoading(false)
  }

  // ── Reservation actions ──────────────────────────────────────────
  async function cancelRes(res) {
    const label = `${res.name || ''}様　${res.date || ''} ${res.time || ''}〜`
    if (!window.confirm(`${label}\nの予約をキャンセル扱いにします（削除ではなく、記録は残ります）。よろしいですか？`)) return
    setCancelingResId(res.id)
    try {
      const r = await api.adminUpdateReservation({ id: res.id, status: 'キャンセル' })
      if (r.success) { showToast('キャンセルにしました'); refreshRes() }
      else showToast(r.error||'キャンセルに失敗しました','error')
    } catch { showToast('通信エラーが発生しました。もう一度お試しください','error') }
    setCancelingResId(null)
  }

  async function deleteRes(res) {
    const label = `${res.name || ''}様　${res.date || ''} ${res.time || ''}〜`
    if (!window.confirm(`${label}\nの予約を削除します。よろしいですか？\n（この操作は取り消せません）`)) return
    const notify = window.confirm('この削除をLINEでスタッフに通知しますか？\n「OK」で通知する／「キャンセル」で通知しない\n（どちらでも削除の記録は操作ログに残ります）')
    setCancelingResId(res.id)
    try {
      const r = await api.adminDeleteReservation(res.id, notify ? '' : 'none')
      if (r.success) { showToast('削除しました'); refreshRes() }
      else showToast(r.error||'削除に失敗しました','error')
    } catch { showToast('通信エラーが発生しました。もう一度お試しください','error') }
    setCancelingResId(null)
  }

  // ── Seat block for selected day ──────────────────────────────────
  async function saveSeatBlockForDay() {
    if (!selectedDate) return
    if (!window.confirm(`${fmtDate(selectedDate)} の受付停止枠を${seatInput.seats}${settings.countUnit || '名'}に設定します。この日の新規予約が受けにくくなります。よろしいですか？`)) return
    setSeatSaving(true)
    try {
      const r = await api.adminSetSeatBlock(selectedDate.replace(/\//g,'-'), seatInput.seats, seatInput.reason)
      if (r.success) { showToast('受付停止枠を設定しました'); setShowSeatForm(false); loadSeatBlocks() }
      else showToast(r.error||'設定に失敗しました','error')
    } catch { showToast('通信エラーが発生しました。もう一度お試しください','error') }
    setSeatSaving(false)
  }

  async function removeSeatBlockForDay() {
    if (!selectedDate) return
    if (!window.confirm(`${fmtDate(selectedDate)} の受付停止枠を解除します。よろしいですか？`)) return
    setSeatSaving(true)
    try {
      const r = await api.adminRemoveSeatBlock(selectedDate.replace(/\//g,'-'))
      if (r.success) { showToast('受付停止枠を解除しました'); setShowSeatForm(false); loadSeatBlocks() }
      else showToast(r.error||'エラーが発生しました。もう一度お試しください','error')
    } catch { showToast('通信エラーが発生しました。もう一度お試しください','error') }
    setSeatSaving(false)
  }

  async function saveDateOverrideForDay() {
    if (!selectedDate) return
    // 同じ日付詳細パネルの兄弟操作（受付停止枠の設定・休業日設定・この操作自体の「解除する」）は
    // 全て確認ダイアログがあるのに、この「設定する／更新する」だけ確認無しで即時実行されていた
    // （スタッフ目線レビューでの指摘：フォームを開いて入力する操作とはいえ、誤った時間帯のまま
    // 送信すると通常の営業時間とズレた特別営業時間がその場で反映されてしまう）。
    const rangeDesc = [
      hoursInput.lunchEnabled ? `ランチ ${hoursInput.lunchStart}〜${hoursInput.lunchEnd}` : null,
      hoursInput.dinnerEnabled ? `ディナー ${hoursInput.dinnerStart}〜${hoursInput.dinnerEnd}` : null,
    ].filter(Boolean).join('、') || '営業時間なし（終日休業扱い）'
    if (!window.confirm(`${fmtDate(selectedDate)} の営業時間を「${rangeDesc}」に変更します。通常の営業時間とは別の特別な設定になります。よろしいですか？`)) return
    setHoursSaving(true)
    try {
      const r = await api.adminSetDateOverride(selectedDate.replace(/\//g,'-'), hoursInput)
      if (r.success) { showToast('この日の営業時間を変更しました'); setShowHoursForm(false); loadDateOverrides() }
      else showToast(r.error||'設定に失敗しました','error')
    } catch { showToast('通信エラーが発生しました。もう一度お試しください','error') }
    setHoursSaving(false)
  }

  async function removeDateOverrideForDay() {
    if (!selectedDate) return
    // 兄弟操作の受付停止枠解除（removeSeatBlockForDay）は確認ダイアログがあるのに、この「解除する」
    // （見た目も警告色の赤ボタン）だけ確認無しで即時実行されていた（スタッフ視点レビューでの指摘：
    // 保存ボタンの近くにあり誤タップしやすく、元の営業時間設定は手動で再入力するまで復元できない）。
    if (!window.confirm(`${fmtDate(selectedDate)} の特別営業時間設定を解除し、通常の営業時間に戻します。よろしいですか？`)) return
    setHoursSaving(true)
    try {
      const r = await api.adminRemoveDateOverride(selectedDate.replace(/\//g,'-'))
      if (r.success) { showToast('営業時間の変更を解除しました'); setShowHoursForm(false); loadDateOverrides() }
      else showToast(r.error||'エラー','error')
    } catch { showToast('通信エラーが発生しました。もう一度お試しください','error') }
    setHoursSaving(false)
  }

  async function removeClosedDay(date) {
    // 同じ日付詳細パネルの兄弟操作（受付停止枠解除・特別営業時間解除）は既に確認ダイアログがあるのに、
    // 休業日の解除だけ無かった（スタッフ視点レビューでの指摘：兄弟2つの穴を塞いだラウンドでも
    // 3つ目のこの穴だけ見落とされていた）。誤タップ1回で、意図的に閉めた休業日がすぐ再オープンされる。
    if (!window.confirm(`${fmtDate(date)} の休業日設定を解除し、この日の新規予約受付を再開します。よろしいですか？`)) return
    try {
      const r = await api.adminRemoveBlockedDate(date)
      if (r.success) { showToast('解除しました'); loadBlocked() }
      else showToast(r.error||'エラー','error')
    } catch { showToast('通信エラーが発生しました。もう一度お試しください','error') }
  }

  // ── Notification actions ─────────────────────────────────────────
  async function markRead(id) {
    setNotifs(ns => ns.filter(n => n.id !== id))
    setSelectedNotifIds(prev => { const s = new Set(prev); s.delete(id); return s })
    try {
      const r = await api.adminMarkNotificationRead(id)
      if (!r.success) { showToast(r.error||'エラー','error'); loadNotifications() }
    } catch { showToast('通信エラーが発生しました。もう一度お試しください','error'); loadNotifications() }
  }

  async function markAllSelected() {
    const ids = [...selectedNotifIds]
    if (ids.length === 0) return
    setNotifs(ns => ns.filter(n => !selectedNotifIds.has(n.id)))
    setSelectedNotifIds(new Set())
    try {
      await Promise.all(ids.map(id => api.adminMarkNotificationRead(id)))
    } catch { showToast('通信エラーが発生しました。もう一度お試しください','error'); loadNotifications() }
  }

  // ── Settings ─────────────────────────────────────────────────────
  async function doSaveSettings() {
    setSettingsSaving(true)
    try {
      const r = await api.saveSettings(settings)
      if (r.success) {
        settingsSnapshotRef.current = JSON.stringify(settings)
        setSettingsDirty(false)
        showToast('設定を保存しました')
      }
      else showToast(r.error||'保存に失敗しました','error')
    } catch { showToast('通信エラーが発生しました。もう一度お試しください','error') }
    setSettingsSaving(false)
  }

  function addClosedDay2(date) {
    if (!window.confirm(`${fmtDate(date)} を休業日に設定します。この日の新規予約が受けられなくなります。よろしいですか？`)) return
    setClosedDayAdding(true)
    api.adminSetBlockedDate(date.replace(/\//g,'-'), '')
      .then(r => {
        if (r.success) { showToast('休業日に設定しました'); loadBlocked() }
        else showToast(r.error||'設定に失敗しました','error')
      })
      .catch(() => showToast('通信エラーが発生しました。もう一度お試しください','error'))
      .finally(() => setClosedDayAdding(false))
  }

  // ── Computed ─────────────────────────────────────────────────────
  const adminTimeSlots = useMemo(() => {
    const all = []
    ;(settings.timeRanges || defTimeRanges).forEach(tr =>
      generateSlots(tr).forEach(s => { if (!all.includes(s)) all.push(s) })
    )
    return all.length ? all.sort() : TIME_SLOTS
  }, [settings.timeRanges])

  const seatBlockMap = useMemo(() => {
    const m = {}
    seatBlocks.forEach(sb => { m[sb.date] = sb })
    return m
  }, [seatBlocks])

  const blockedSet = useMemo(() => new Set(blocked.map(b => b.date)), [blocked])

  const dateOverrideMap = useMemo(() => {
    const m = {}
    dateOverrides.forEach(o => { m[o.date] = o })
    return m
  }, [dateOverrides])
  // AddModal/EditModalのdata.dateは'YYYY-MM-DD'形式なので、キーをそちらに合わせたマップも用意
  const dateOverrideMapDash = useMemo(() => {
    const m = {}
    dateOverrides.forEach(o => { m[o.date.replace(/\//g,'-')] = o })
    return m
  }, [dateOverrides])

  // dayData for calendar: keyed by 'yyyy/MM/dd'
  const resCalData = useMemo(() => {
    const m = {}
    reservations.filter(r => r.status==='確定' || r.status==='要確認').forEach(r => {
      if (!m[r.date]) m[r.date] = { count:0, guests:0 }
      m[r.date].count++
      m[r.date].guests += parseInt(r.guests)||0
    })
    blocked.forEach(b => {
      if (!m[b.date]) m[b.date] = { count:0, guests:0 }
      m[b.date].isBlocked = true
    })
    seatBlocks.forEach(sb => {
      if (!m[sb.date]) m[sb.date] = { count:0, guests:0 }
      m[sb.date].seatBlock = sb.blockedSeats
    })
    return m
  }, [reservations, blocked, seatBlocks])

  const blockCalData = useMemo(() => {
    const m = {}
    blocked.forEach(b => { m[b.date] = { ...(m[b.date]||{}), isBlocked:true } })
    seatBlocks.forEach(sb => { m[sb.date] = { ...(m[sb.date]||{}), seatBlock: sb.blockedSeats } })
    return m
  }, [blocked, seatBlocks])

  const dayRes = useMemo(() =>
    reservations
      .filter(r => r.date === selectedDate && (r.status === '確定' || r.status === '要確認'))
      .sort((a,b) => (formatTime(a.time) < formatTime(b.time) ? -1 : 1)),
    [reservations, selectedDate]
  )
  const dayConfirmedGuests = dayRes.reduce((s,r)=>s+(parseInt(r.guests)||0),0)
  const daySeatBlock       = selectedDate ? seatBlockMap[selectedDate] : null
  const dayIsBlocked       = selectedDate ? blockedSet.has(selectedDate) : false
  const dayOverride        = selectedDate ? dateOverrideMap[selectedDate] : null
  const dayMaxSeats        = (() => {
    if (!settings.seatsByWeekday || !selectedDate) return settings.maxSeats
    const dow = new Date(selectedDate.replace(/\//g,'-')+'T00:00:00').getDay()
    const v = settings.seatsByWeekday[String(dow)]
    return v !== undefined ? v : settings.maxSeats
  })()
  const dayRemaining       = Math.max(0, dayMaxSeats - (daySeatBlock?.blockedSeats||0) - dayConfirmedGuests)

  function prevMonth(y, m, setY, setM) { if (m===0) { setY(y-1); setM(11) } else setM(m-1) }
  function nextMonth(y, m, setY, setM) { if (m===11) { setY(y+1); setM(0)  } else setM(m+1) }

  // ── Main ──────────────────────────────────────────────────────
  return (
    <>
      <Head>
        <title>{`管理画面 | ${bizName}`}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <Script src="https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js" strategy="lazyOnload" />

      {/* Login screen */}
      {!authed && (
        <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#f5f5f5', padding:20 }}>
          <div style={{ background:'#fff', borderRadius:16, padding:32, width:'100%', maxWidth:380, boxShadow:'0 2px 12px rgba(0,0,0,.1)' }}>
            <div style={{ textAlign:'center', marginBottom:24 }}>
              <h1 style={{ fontSize:18, fontWeight:'bold', color:'#06c755', marginBottom:4 }}>{bizName}</h1>
              <p style={{ fontSize:13, color:'#888' }}>管理画面ログイン</p>
            </div>
            <div style={{ marginBottom:8 }}>
              <input type="text" value={loginName} placeholder="お名前（スタッフ個人ログインの場合のみ・任意）"
                style={{ ...iStyle, fontSize:14 }}
                onChange={e => { setLoginName(e.target.value); setLoginErr('') }}
                onKeyDown={e => e.key==='Enter' && doLogin()} />
              <div style={{ fontSize:11, color:'#aaa', marginTop:4 }}>店舗共通のパスワードでログインする場合は空欄のままで構いません。</div>
            </div>
            <div style={{ marginBottom:12 }}>
              <input type="password" value={loginPw} placeholder="パスワード"
                style={{ ...iStyle, fontSize:16 }}
                onChange={e => { setLoginPw(e.target.value); setLoginErr('') }}
                onKeyDown={e => e.key==='Enter' && doLogin()} />
            </div>
            {loginErr && (
              <div style={{ marginBottom:12, background:'#fff0f0', border:'1px solid #ffcccc', borderRadius:8, padding:'10px 14px', fontSize:13, color:'#e53935' }}>
                {loginErr}
              </div>
            )}
            <button disabled={loggingIn} onClick={doLogin}
              style={{ width:'100%', padding:15, background:'#06c755', color:'#fff', border:'none', borderRadius:10, fontSize:15, fontWeight:'bold', cursor:'pointer', opacity:loggingIn?0.7:1 }}>
              {loggingIn ? 'ログイン中...' : 'ログイン'}
            </button>
            <button onClick={async () => {
              const next = !showRecovery
              setShowRecovery(next)
              setRecoveryMsg({text:'',ok:true})
              setRecoveryCode('')
              if (next && !recoveryQuestion) {
                setLoadingQuestion(true)
                try {
                  const r = await api.getRecoveryQuestion()
                  setRecoveryQuestion(r.question || '合言葉の答えを入力してください')
                } catch { setRecoveryQuestion('合言葉の答えを入力してください') }
                setLoadingQuestion(false)
              }
            }} style={{ marginTop:12, background:'none', border:'none', color:'#aaa', fontSize:12, cursor:'pointer', textDecoration:'underline', width:'100%' }}>
              パスワードを忘れた方はこちら
            </button>
            {showRecovery && (
              <div style={{ marginTop:12, padding:14, background:'#f5f5f5', borderRadius:10 }}>
                <p style={{ fontSize:12, color:'#555', marginBottom:10, lineHeight:1.6 }}>
                  {/* 以前はここに「パスワードを「MV」にリセットします」と、リセット後の固定パスワードを
                      未認証のまま表示していた。合言葉自体を知らない訪問者にも「リセット後は必ずMV」という
                      事実だけは伝わってしまい、店舗が独自の合言葉を設定していてもリセット直後に変更を
                      忘れるだけで乗っ取られ得る危険な案内文だった（Microsoft CEO視点レビュー・ラウンド25の
                      指摘）。パスワードはランダムな一時パスワードに変わったため、値そのものは正解した後
                      にだけ表示し、この案内文には仕組みの説明のみを残す。 */}
                  合言葉が正しい場合のみ、新しいランダムな一時パスワードを発行します。<br />
                  合言葉は管理画面の設定 → パスワード変更から変更できます。
                </p>
                {loadingQuestion ? (
                  <div style={{ fontSize:12, color:'#aaa', marginBottom:8 }}>読み込み中...</div>
                ) : recoveryQuestion ? (
                  <div style={{ fontSize:13, fontWeight:'bold', color:'#333', marginBottom:8, padding:'8px 12px', background:'#fff', borderRadius:8, border:'1px solid #e0e0e0' }}>
                    Q: {recoveryQuestion}
                  </div>
                ) : null}
                <input type="text" value={recoveryCode} placeholder="答えを入力"
                  style={{ ...iStyle, marginBottom:8 }}
                  onChange={e => { setRecoveryCode(e.target.value); setRecoveryMsg({text:'',ok:true}) }}
                  onKeyDown={e => e.key==='Enter' && doRecovery()} />
                {recoveryMsg.text && (
                  <div style={{ marginBottom:8, padding:'8px 12px', borderRadius:8, fontSize:12,
                    background: recoveryMsg.ok ? '#e8f5e9' : '#fff0f0',
                    color: recoveryMsg.ok ? '#2e7d32' : '#e53935' }}>
                    {recoveryMsg.text}
                  </div>
                )}
                <button disabled={recovering} onClick={doRecovery}
                  style={{ width:'100%', padding:12, background:'#555', color:'#fff', border:'none', borderRadius:8, fontSize:13, fontWeight:'bold', cursor:'pointer', opacity:recovering?0.7:1 }}>
                  {recovering ? 'リセット中...' : 'パスワードをリセットする'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main admin (only shown when authed) */}
      {authed && <>

      {/* Sticky header + tabs */}
      <div style={{ position:'sticky', top:0, zIndex:1 }}>

      {/* Header */}
      <div style={{ background:'#06c755', padding:'14px 20px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <h1 style={{ fontSize:16, fontWeight:'bold', color:'#fff' }}>{bizName} 管理画面</h1>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={doLogout}
            style={{ background:'rgba(255,255,255,.15)', border:'1px solid rgba(255,255,255,.4)', color:'#fff', padding:'6px 14px', borderRadius:6, fontSize:12, cursor:'pointer' }}>
            ログアウト
          </button>
        </div>
      </div>

      {/* システム自動停止バナー */}
      {systemStopped && (
        <div style={{ background:'#c62828', color:'#fff', padding:'12px 20px', display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:8 }}>
          <div style={{ fontSize:13, fontWeight:'bold', lineHeight:1.6 }}>
            {systemStopPersistent ? (
              <>
                🚨 カレンダー同期システムが繰り返し停止しています{systemStopReason ? `（理由：${systemStopReason}）` : ''}<br/>
                <span style={{ fontWeight:'normal' }}>
                  短時間に何度も発生したため、自動復旧を止めています。恒久的な問題（LINEトークンの期限切れ等）の可能性が高いため、{sysAdminContact}に今すぐご確認をお願いしてください。
                </span>
              </>
            ) : (
              <>
                ⚠️ カレンダー同期システムが一時停止中です{systemStopReason ? `（理由：${systemStopReason}）` : '（短時間に通知が集中したため）'}<br/>
                <span style={{ fontWeight:'normal' }}>
                  カレンダー連携の同期・手動予約の変更検知などが止まっています。
                  {systemStopRemainMin > 0 ? `あと約${systemStopRemainMin}分で` : 'まもなく'}いったん自動的に再開されますが、原因が直っていない場合は再度停止します。繰り返す場合は{sysAdminContact}にご連絡ください。
                </span>
              </>
            )}
          </div>
          <button disabled={resettingStop} onClick={resetSystemStop}
            style={{ background:'#fff', color:'#c62828', border:'none', padding:'7px 16px', borderRadius:6, fontSize:13, fontWeight:'bold', cursor:'pointer', opacity:resettingStop?0.7:1 }}>
            {resettingStop ? '処理中...' : 'この表示を消す'}
          </button>
        </div>
      )}

      {/* Tabs：スタッフ（role:staff）は予約の登録・確認・変更のみのため「予約一覧」タブしか表示しない */}
      <div style={{ background:'#fff', borderBottom:'1px solid #e0e0e0', display:'flex' }}>
        {[['reservations','予約一覧'], ['notifications','通知'], ['settings','設定'], ['notif-settings','通知設定'], ['feature-settings','配信設定'], ['store-specific','店舗固有機能']].filter(([id]) => isOwner || id === 'reservations').map(([id,label]) => (
          <button key={id} onClick={() => setTab(id)}
            style={{
              flex:1, padding:'13px 4px', border:'none', background:'transparent',
              fontSize:13, fontWeight:'bold', cursor:'pointer',
              borderBottom: tab===id ? '3px solid #06c755' : '3px solid transparent',
              color: tab===id ? '#06c755' : '#666',
              position:'relative',
            }}>
            {label}
            {id==='notifications' && notifs.length > 0 && (
              <span style={{ position:'absolute', top:8, right:'50%', transform:'translateX(80%)',
                background:'#e53935', color:'#fff', borderRadius:10, fontSize:9, padding:'1px 5px', fontWeight:'bold', lineHeight:1.5 }}>
                {notifs.length}
              </span>
            )}
            {((id==='settings' && settingsDirty) || (id==='feature-settings' && fsetDirty)) && (
              // 「未保存」の3文字だと狭い画面で隣タブと衝突しうる／背景色がWCAGコントラスト不足だったため、
              // 一目で分かる●1文字＋濃い色に変更（Appleデザインチーム視点レビューでの指摘）。
              // #e65100は白背景とのコントラスト比が約3.8:1でテキストとしては4.5:1に届かないため、
              // さらに濃い#a03d00に変更（ラウンド13の同視点レビューでの再指摘）。
              <span title="未保存の変更があります" style={{ position:'absolute', top:6, right:'50%', transform:'translateX(150%)',
                color:'#a03d00', fontSize:14, fontWeight:'bold', lineHeight:1 }}>
                ●
              </span>
            )}
          </button>
        ))}
      </div>

      </div>{/* end sticky wrapper */}

      <div style={{ paddingTop:12, paddingLeft:16, paddingRight:16, paddingBottom:16, maxWidth:960, margin:'0 auto' }}>

        {/* ─── TAB: 予約一覧 ──────────────────────────────────────── */}
        {tab==='reservations' && (
          <>
            {/* 今月の経営指標サマリー */}
            {bizSummary && (
              <div style={{ background:'#fff', border:'1px solid #eee', borderRadius:10, padding:'14px 16px', marginBottom:12, boxShadow:'0 1px 3px rgba(0,0,0,.06)' }}>
                <div style={{ fontSize:11, color:'#888', marginBottom:8 }}>今月（{bizSummary.month}）のサマリー</div>
                <div style={{ display:'flex', gap:20, flexWrap:'wrap' }}>
                  <div>
                    <div style={{ fontSize:11, color:'#888' }}>予約数</div>
                    <div style={{ fontSize:18, fontWeight:'bold' }}>{bizSummary.monthlyReservations}組 / {bizSummary.monthlyGuests}名</div>
                  </div>
                  <div>
                    <div style={{ fontSize:11, color:'#888' }}>平均人数</div>
                    <div style={{ fontSize:18, fontWeight:'bold' }}>{bizSummary.avgPartySize}名</div>
                  </div>
                  <div>
                    <div style={{ fontSize:11, color:'#888' }}>リピート率</div>
                    <div style={{ fontSize:18, fontWeight:'bold' }}>{bizSummary.repeatRate}%<span style={{ fontSize:11, color:'#aaa', fontWeight:'normal' }}>（顧客{bizSummary.totalCustomers}人中）</span></div>
                  </div>
                  {bizSummary.rejectedThisMonth > 0 && (
                    <div>
                      <div style={{ fontSize:11, color:'#888' }}>今月お断りした予約希望</div>
                      <div style={{ fontSize:18, fontWeight:'bold', color:'#e65100' }}>{bizSummary.rejectedThisMonth}件</div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Today's summary */}
            {!resLoading && calYear === new Date().getFullYear() && calMonth === new Date().getMonth() && (() => {
              const now = new Date()
              const todayYMD = `${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')}`
              const todayList = reservations.filter(r => r.date === todayYMD && (r.status === '確定' || r.status === '要確認'))
              if (todayList.length === 0) return null
              const todayG = todayList.reduce((s,r) => s + (parseInt(r.guests)||0), 0)
              return (
                <div style={{ background:'#e8f5e9', border:'1px solid #c8e6c9', borderRadius:10, padding:'12px 16px', marginBottom:12, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <div>
                    <div style={{ fontSize:11, color:'#555' }}>本日の確定予約</div>
                    <div style={{ fontSize:16, fontWeight:'bold', color:'#2e7d32', marginTop:2 }}>{todayList.length}組 / {todayG}名</div>
                  </div>
                  <button onClick={() => { setSelectedDate(todayYMD); setShowSeatForm(false) }} style={{ ...btnGreen, fontSize:12, padding:'7px 14px' }}>
                    詳細
                  </button>
                </div>
              )
            })()}

            {/* Calendar */}
            <div style={{ background:'#fff', borderRadius:12, padding:16, marginBottom:12, boxShadow:'0 1px 3px rgba(0,0,0,.08)' }}>
              <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:6 }}>
                <button onClick={doRefreshAll} disabled={resLoading}
                  style={{ ...btnGray, fontSize:12, padding:'6px 12px', opacity:resLoading?0.6:1 }}>
                  🔄 最新の予約に更新
                </button>
              </div>
              <CalNav year={calYear} month={calMonth}
                onPrev={() => prevMonth(calYear,calMonth,setCalYear,setCalMonth)}
                onNext={() => nextMonth(calYear,calMonth,setCalYear,setCalMonth)} />
              {resLoading ? (
                <div style={{ textAlign:'center', padding:20, color:'#aaa', fontSize:13 }}>読み込み中...</div>
              ) : (
                <AdminCalendar year={calYear} month={calMonth} dayData={resCalData}
                  selected={selectedDate} onSelect={d => { setSelectedDate(d); setShowSeatForm(false) }} />
              )}
              <div style={{ display:'flex', gap:12, marginTop:10, fontSize:11, color:'#888', flexWrap:'wrap' }}>
                <span><span style={{ display:'inline-block', width:10, height:10, background:'#e8f5e9', borderRadius:2, marginRight:3 }}></span>確定あり</span>
                <span><span style={{ display:'inline-block', width:10, height:10, background:'#fff3e0', borderRadius:2, marginRight:3 }}></span>停止枠あり</span>
                <span><span style={{ display:'inline-block', width:10, height:10, background:'#ffebee', borderRadius:2, marginRight:3 }}></span>休業日</span>
              </div>
              {!resLoading && reservations.length > 0 && (() => {
                const confirmed = reservations.filter(r => r.status === '確定')
                const cancelled = reservations.filter(r => r.status === 'キャンセル')
                const totalGuests = confirmed.reduce((s,r) => s + (parseInt(r.guests)||0), 0)
                return (
                  <div style={{ display:'flex', gap:8, marginTop:10, flexWrap:'wrap' }}>
                    <div style={{ background:'#e8f5e9', borderRadius:8, padding:'7px 14px', fontSize:12, display:'flex', gap:6, alignItems:'center' }}>
                      <span style={{ color:'#888' }}>今月確定</span>
                      <span style={{ fontWeight:'bold', color:'#2e7d32' }}>{confirmed.length}件 / {totalGuests}名</span>
                    </div>
                    {cancelled.length > 0 && (
                      <div style={{ background:'#ffebee', borderRadius:8, padding:'7px 14px', fontSize:12, display:'flex', gap:6, alignItems:'center' }}>
                        <span style={{ color:'#888' }}>キャンセル</span>
                        <span style={{ fontWeight:'bold', color:'#c62828' }}>{cancelled.length}件</span>
                      </div>
                    )}
                  </div>
                )
              })()}
            </div>

            {/* Day detail */}
            {selectedDate && (
              <div style={{ background:'#fff', borderRadius:12, padding:16, marginBottom:12, boxShadow:'0 1px 3px rgba(0,0,0,.08)' }}>
                {/* Day header */}
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
                  <h2 style={{ fontSize:15, fontWeight:'bold' }}>{fmtDate(selectedDate)} の予約</h2>
                  <div style={{ display:'flex', gap:10, alignItems:'center' }}>
                    <button onClick={doRefreshAll} disabled={resLoading}
                      aria-label="最新の予約に更新"
                      style={{ background:'none', border:'none', fontSize:16, cursor:'pointer', color:'#888', opacity:resLoading?0.5:1 }}
                      title="最新の予約に更新">🔄</button>
                    <button onClick={() => setSelectedDate(null)} aria-label="閉じる"
                      style={{ background:'none', border:'none', fontSize:22, cursor:'pointer', color:'#888', padding:4, lineHeight:1 }}>✕</button>
                  </div>
                </div>

                {/* Status badges */}
                <div style={{ display:'flex', gap:10, marginBottom:12, flexWrap:'wrap' }}>
                  {dayIsBlocked && (
                    <span style={{ background:'#ffebee', color:'#c62828', padding:'4px 12px', borderRadius:20, fontSize:12, fontWeight:'bold' }}>
                      休業日
                    </span>
                  )}
                  {daySeatBlock && (
                    <span style={{ background:'#fff3e0', color:'#e65100', padding:'4px 12px', borderRadius:20, fontSize:12, fontWeight:'bold' }}>
                      予約停止枠: {daySeatBlock.blockedSeats}{settings.countUnit || '名'}
                      {daySeatBlock.reason && <span style={{ fontWeight:'normal' }}>（{daySeatBlock.reason}）</span>}
                    </span>
                  )}
                  {dayOverride && (
                    <span style={{ background:'#eef6ff', color:'#1565c0', padding:'4px 12px', borderRadius:20, fontSize:12, fontWeight:'bold' }}>
                      営業時間変更あり
                    </span>
                  )}
                  {/* 「残り◯名」バッジはmaxSeats（席数モデル専用の値）から計算されており、perStaff業態
                      （美容院・車修理等）では実際の担当者の空き状況と無関係な、むしろ誤解を招く数字になる
                      （業種経営者陣視点レビューでの指摘：既にこの下の受付停止枠セクションで使われている
                      同じガードをここにも適用する）。 */}
                  {settings.capacityModel !== 'perStaff' && (
                    <span style={{ background: dayRemaining>0 ? '#e8f5e9' : '#ffebee',
                      color: dayRemaining>0 ? '#2e7d32' : '#c62828',
                      padding:'4px 12px', borderRadius:20, fontSize:12, fontWeight:'bold' }}>
                      残り {dayRemaining}{settings.countUnit || '名'}
                    </span>
                  )}
                </div>

                {/* Reservations for day */}
                {dayRes.length === 0 ? (
                  <div style={{ textAlign:'center', padding:'16px 0', color:'#bbb', fontSize:13 }}>予約なし</div>
                ) : (
                  <div style={{ marginBottom:12 }}>
                    {dayRes.map(r => (
                      <div key={r.id} style={{
                        padding:'12px 14px', borderRadius:8, marginBottom:8,
                        background: r.status==='確定' ? '#f8fffe' : '#fafafa',
                        border: '1px solid ' + (r.status==='確定' ? '#c8e6c9' : '#e0e0e0'),
                      }}>
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8 }}>
                          <div>
                            <div style={{ fontWeight:'bold', fontSize:14 }}>
                              {formatTime(r.time)}〜{formatTime(r.endTime)}
                              <span style={{ marginLeft:10, fontSize:13, color:'#444', fontWeight:'normal' }}>{r.name} 様</span>
                              <span style={{ marginLeft:6, fontSize:13, color:'#444' }}>{r.guests}名</span>
                              {/* 常連バッジ（オレンジ）と同じ配色だと並んだ時に見分けにくいため、
                                  黄系の別配色にする（Appleデザインチーム視点レビューでの指摘） */}
                              {r.status === '要確認' && (
                                <span style={{ marginLeft:8, fontSize:11, fontWeight:'bold', color:'#8d6e00', background:'#fff8e1', padding:'2px 8px', borderRadius:12 }}>
                                  ⏳要確認（承認待ち）
                                </span>
                              )}
                              {r.visitCount >= 2 && (
                                <span style={{ marginLeft:8, fontSize:11, fontWeight:'bold', color:'#e65100', background:'#fff3e0', padding:'2px 8px', borderRadius:12 }}>
                                  常連・来店{r.visitCount}回目
                                </span>
                              )}
                              {r.visitCount === 1 && (
                                <span style={{ marginLeft:8, fontSize:11, fontWeight:'bold', color:'#1565c0', background:'#e3f2fd', padding:'2px 8px', borderRadius:12 }}>
                                  初めてのご来店
                                </span>
                              )}
                              {r.noShowCount >= 1 && (
                                <span style={{ marginLeft:8, fontSize:11, fontWeight:'bold', color:'#c62828', background:'#ffebee', padding:'2px 8px', borderRadius:12 }}>
                                  ⚠️過去に無断キャンセル{r.noShowCount}回
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize:12, color:'#888', marginTop:3 }}>
                              {r.course}
                              {r.source && <span style={{ marginLeft:8, color:'#aaa' }}>{r.source}</span>}
                              {r.phone  && <span style={{ marginLeft:8 }}>{r.phone}</span>}
                              {r.lastVisit && <span style={{ marginLeft:8, color:'#aaa' }}>前回来店: {r.lastVisit}</span>}
                            </div>
                            {r.notes && <div style={{ fontSize:12, color:'#888', marginTop:2, whiteSpace:'pre-wrap' }}>メモ: {r.notes}</div>}
                            {r.q1 && <div style={{ fontSize:12, color:'#888', marginTop:2 }}>Q1.ご利用目的: {r.q1}</div>}
                            {r.q3 && <div style={{ fontSize:12, color:'#888', marginTop:2 }}>Q2.どのように当店を知ったか: {r.q3}</div>}
                            {r.requestedStaff && <div style={{ fontSize:12, color:'#888', marginTop:2 }}>🙋 ご指名: {r.requestedStaff}</div>}
                            {r.email && <div style={{ fontSize:12, color:'#888', marginTop:2 }}>✉️ {r.email}</div>}
                          </div>
                          <div style={{ display:'flex', gap:6, flexShrink:0, alignItems:'center', flexWrap:'wrap' }}>
                            <button onClick={() => setEditRes(r)} style={btnBlue}>編集</button>
                            {r.status !== 'キャンセル' && (
                              <button
                                disabled={cancelingResId===r.id}
                                onClick={() => cancelRes(r)}
                                style={{ ...btnGray, color:'#c62828', border:'1px solid #ffcccc', opacity: cancelingResId===r.id ? 0.6 : 1 }}>
                                {cancelingResId===r.id ? '処理中...' : 'キャンセルにする'}
                              </button>
                            )}
                            <button
                              disabled={cancelingResId===r.id}
                              onClick={() => deleteRes(r)}
                              style={{ ...btnRed, opacity: cancelingResId===r.id ? 0.6 : 1 }}>
                              {cancelingResId===r.id ? '処理中...' : '削除'}
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* ＋新規登録 */}
                <button onClick={() => { setAddInitDate(selectedDate); setShowAddModal(true) }}
                  style={{ ...btnGreen, fontSize:13, marginBottom:10 }}>
                  ＋ 新規登録
                </button>

                {/* 受付停止席（担当者ベース容量モデルでは「席数」という概念がないため非表示。担当者ごとのシフト設定で調整する） */}
                {settings.capacityModel === 'perStaff' ? null : daySeatBlock ? (
                  <div style={{ marginTop:4, padding:14, background:'#fff8f0', border:'1px solid #ffe0b2', borderRadius:8 }}>
                    <div style={{ fontSize:12, fontWeight:'bold', color:'#e65100', marginBottom:8 }}>受付停止枠</div>
                    <div style={{ display:'flex', gap:10, alignItems:'flex-end', flexWrap:'wrap' }}>
                      <Field label="停止数">
                        <CustomSelect value={seatInput.seats}
                          onChange={e => setSeatInput(s=>({...s, seats:parseInt(e.target.value)||1}))}
                          style={{ ...sStyle, width:90 }}>
                          {[1,2,3,4,5,6,7,8,9,10,11,12].map(n=><option key={n} value={n}>{n}{settings.countUnit || '名'}</option>)}
                        </CustomSelect>
                      </Field>
                      <Field label="理由（任意）">
                        <input type="text" value={seatInput.reason} placeholder="個室使用など"
                          onChange={e => setSeatInput(s=>({...s, reason:e.target.value}))}
                          style={{ ...iStyle, minWidth:160 }} />
                      </Field>
                      <button disabled={seatSaving} onClick={saveSeatBlockForDay}
                        style={{ ...btnGreen, alignSelf:'flex-end' }}>
                        {seatSaving?'処理中...':'更新する'}
                      </button>
                      <button disabled={seatSaving} onClick={removeSeatBlockForDay}
                        style={{ ...btnRed, alignSelf:'flex-end', padding:'9px 16px' }}>
                        {seatSaving?'処理中...':'解除する'}
                      </button>
                    </div>
                  </div>
                ) : showSeatForm ? (
                  <div style={{ marginTop:4, padding:14, background:'#fff8f0', border:'1px solid #ffe0b2', borderRadius:8 }}>
                    <div style={{ fontSize:12, fontWeight:'bold', color:'#e65100', marginBottom:8 }}>受付停止枠を設定</div>
                    <div style={{ display:'flex', gap:10, alignItems:'flex-end', flexWrap:'wrap' }}>
                      <Field label="停止数">
                        <CustomSelect value={seatInput.seats}
                          onChange={e => setSeatInput(s=>({...s, seats:parseInt(e.target.value)||1}))}
                          style={{ ...sStyle, width:90 }}>
                          {[1,2,3,4,5,6,7,8,9,10,11,12].map(n=><option key={n} value={n}>{n}{settings.countUnit || '名'}</option>)}
                        </CustomSelect>
                      </Field>
                      <Field label="理由（任意）">
                        <input type="text" value={seatInput.reason} placeholder="個室使用など"
                          onChange={e => setSeatInput(s=>({...s, reason:e.target.value}))}
                          style={{ ...iStyle, minWidth:160 }} />
                      </Field>
                      <button disabled={seatSaving} onClick={saveSeatBlockForDay}
                        style={{ ...btnGreen, alignSelf:'flex-end' }}>
                        {seatSaving?'処理中...':'設定する'}
                      </button>
                      <button onClick={() => setShowSeatForm(false)} style={{ ...btnGray, alignSelf:'flex-end' }}>キャンセル</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => { setSeatInput({ seats:4, reason:'' }); setShowSeatForm(true) }}
                    style={{ ...btnGray, fontSize:13, marginTop:4, color:'#e65100', border:'1px solid #ffe0b2' }}>
                    受付停止枠を設定
                  </button>
                )}

                {/* 休業日 */}
                {dayIsBlocked ? (
                  <div style={{ marginTop:8, padding:14, background:'#ffebee', border:'1px solid #ffcccc', borderRadius:8, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <span style={{ fontSize:13, fontWeight:'bold', color:'#c62828' }}>休業日設定中</span>
                    <button onClick={() => removeClosedDay(selectedDate)} style={{ ...btnRed }}>解除</button>
                  </div>
                ) : (
                  <button onClick={() => addClosedDay2(selectedDate)}
                    disabled={closedDayAdding}
                    style={{ ...btnGray, fontSize:13, marginTop:8, color:'#c62828', border:'1px solid #ffcccc', opacity: closedDayAdding ? 0.6 : 1 }}>
                    {closedDayAdding ? '設定中...' : '休業日に設定'}
                  </button>
                )}

                {/* 営業時間変更（この日だけ） */}
                {dayOverride || showHoursForm ? (
                  <div style={{ marginTop:8, padding:14, background:'#eef6ff', border:'1px solid #bcdcff', borderRadius:8 }}>
                    <div style={{ fontSize:12, fontWeight:'bold', color:'#1565c0', marginBottom:8 }}>
                      この日だけの営業時間変更{dayOverride ? '（設定中）' : ''}
                    </div>
                    <div style={{ display:'flex', gap:14, flexWrap:'wrap', marginBottom:10 }}>
                      <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:13 }}>
                        <input type="checkbox" checked={hoursInput.lunchEnabled}
                          onChange={e => setHoursInput(h => ({...h, lunchEnabled: e.target.checked}))} />
                        ランチ
                      </label>
                      {hoursInput.lunchEnabled && (
                        <>
                          <input type="time" value={hoursInput.lunchStart} style={{ ...iStyle, width:110 }}
                            onChange={e => setHoursInput(h => ({...h, lunchStart: e.target.value}))} />
                          〜
                          <input type="time" value={hoursInput.lunchEnd} style={{ ...iStyle, width:110 }}
                            onChange={e => setHoursInput(h => ({...h, lunchEnd: e.target.value}))} />
                        </>
                      )}
                    </div>
                    <div style={{ display:'flex', gap:14, flexWrap:'wrap', marginBottom:12 }}>
                      <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:13 }}>
                        <input type="checkbox" checked={hoursInput.dinnerEnabled}
                          onChange={e => setHoursInput(h => ({...h, dinnerEnabled: e.target.checked}))} />
                        ディナー
                      </label>
                      {hoursInput.dinnerEnabled && (
                        <>
                          <input type="time" value={hoursInput.dinnerStart} style={{ ...iStyle, width:110 }}
                            onChange={e => setHoursInput(h => ({...h, dinnerStart: e.target.value}))} />
                          〜
                          <input type="time" value={hoursInput.dinnerEnd} style={{ ...iStyle, width:110 }}
                            onChange={e => setHoursInput(h => ({...h, dinnerEnd: e.target.value}))} />
                        </>
                      )}
                    </div>
                    <div style={{ display:'flex', gap:10 }}>
                      <button disabled={hoursSaving} onClick={saveDateOverrideForDay} style={{ ...btnBlue }}>
                        {hoursSaving ? '処理中...' : (dayOverride ? '更新する' : '設定する')}
                      </button>
                      {dayOverride ? (
                        <button disabled={hoursSaving} onClick={removeDateOverrideForDay} style={{ ...btnRed }}>解除する</button>
                      ) : (
                        <button onClick={() => setShowHoursForm(false)} style={{ ...btnGray }}>キャンセル</button>
                      )}
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setShowHoursForm(true)}
                    style={{ ...btnGray, fontSize:13, marginTop:8, color:'#1565c0', border:'1px solid #bcdcff' }}>
                    営業時間変更（この日だけ）
                  </button>
                )}
              </div>
            )}

            {!selectedDate && !resLoading && (
              <div style={{ textAlign:'center', padding:'16px 0', color:'#bbb', fontSize:13 }}>
                日付をタップすると予約一覧が表示されます
              </div>
            )}
          </>
        )}

        {/* ─── TAB: 通知一覧 ──────────────────────────────────────── */}
        {tab==='notifications' && (
          <>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12, flexWrap:'wrap', gap:8 }}>
              <h2 style={{ fontSize:15, fontWeight:'bold' }}>通知一覧 {notifs.length>0 && <span style={{ fontSize:13, color:'#888', fontWeight:'normal' }}>（{notifs.length}件）</span>}</h2>
              <div style={{ display:'flex', gap:8 }}>
                {selectedNotifIds.size > 0 && (
                  <button onClick={markAllSelected}
                    style={{ ...btnGreen, fontSize:13, padding:'8px 16px' }}>
                    選択済み{selectedNotifIds.size}件を確認済みに
                  </button>
                )}
                <button onClick={loadNotifications} style={btnGray}>更新</button>
              </div>
            </div>

            {notifLoading ? (
              <div style={{ textAlign:'center', padding:40, color:'#aaa' }}>読み込み中...</div>
            ) : notifs.length === 0 ? (
              <div style={{ textAlign:'center', padding:40, color:'#bbb', fontSize:13 }}>
                未確認の通知はありません
              </div>
            ) : (
              <>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8, fontSize:12, color:'#888' }}>
                  <label style={{ display:'flex', alignItems:'center', gap:4, cursor:'pointer' }}>
                    <input type="checkbox"
                      checked={notifs.length > 0 && selectedNotifIds.size === notifs.length}
                      onChange={e => setSelectedNotifIds(e.target.checked ? new Set(notifs.map(n=>n.id)) : new Set())} />
                    すべて選択
                  </label>
                </div>
                {notifs.map(n => {
                  const lbl = notifLabel(n.type)
                  const checked = selectedNotifIds.has(n.id)
                  return (
                    <div key={n.id} style={{ background: checked ? '#f0fff4' : '#fff', borderRadius:12, marginBottom:8, boxShadow:'0 1px 3px rgba(0,0,0,.08)', padding:'14px 16px', display:'flex', alignItems:'flex-start', gap:10, border: checked ? '1.5px solid #06c755' : '1.5px solid transparent' }}>
                      <input type="checkbox" checked={checked} style={{ marginTop:4, flexShrink:0 }}
                        onChange={e => setSelectedNotifIds(prev => { const s=new Set(prev); e.target.checked ? s.add(n.id) : s.delete(n.id); return s })} />
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:5, flexWrap:'wrap' }}>
                          <span style={{ background:lbl.bg, color:lbl.color, padding:'2px 10px', borderRadius:12, fontSize:12, fontWeight:'bold', whiteSpace:'nowrap' }}>{lbl.text}</span>
                          <span style={{ fontSize:14, fontWeight:'bold' }}>{n.name} 様</span>
                          <span style={{ fontSize:12, color:'#aaa' }}>{fmtNotifDateTime(n.datetime)}</span>
                        </div>
                        <div style={{ fontSize:13, color:'#444', marginBottom:2 }}>
                          {n.date && fmtDate(n.date)}
                          {n.time && <span style={{ marginLeft:8 }}>{formatTime(n.time)}〜{formatTime(n.endTime)}</span>}
                          {n.guests && <span style={{ marginLeft:8 }}>{n.guests}名</span>}
                          {n.phone && <span style={{ marginLeft:8, color:'#888' }}>{n.phone}</span>}
                        </div>
                        {n.type==='change' && n.oldDate && (
                          <div style={{ fontSize:12, color:'#888' }}>変更前: {fmtDate(n.oldDate)} {formatTime(n.oldTime)}〜</div>
                        )}
                        {n.notes && <div style={{ fontSize:12, color:'#888' }}>メモ: {n.notes}</div>}
                      </div>
                      <button onClick={() => markRead(n.id)}
                        style={{ ...btnGray, fontSize:12, background:'#e8f5e9', color:'#2e7d32', flexShrink:0, alignSelf:'center', padding:'8px 14px' }}>
                        確認
                      </button>
                    </div>
                  )
                })}
              </>
            )}

            {/* 操作ログ（削除不可・参照専用） */}
            <div style={{ marginTop:24, paddingTop:16, borderTop:'1px solid #eee' }}>
              <button onClick={() => { const next = !showAuditLog; setShowAuditLog(next); if (next && auditLog.length === 0) loadAuditLog() }}
                style={{ ...btnGray, fontSize:13, width:'100%', textAlign:'left' }}>
                {showAuditLog ? '▼' : '▶'} 操作ログを表示（管理者の追加・変更・削除の記録。削除できません）
              </button>
              {showAuditLog && (
                <div style={{ marginTop:10 }}>
                  <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:8 }}>
                    <button onClick={loadAuditLog} disabled={auditLoading} style={{ ...btnGray, fontSize:12 }}>
                      {auditLoading ? '更新中...' : '更新'}
                    </button>
                  </div>
                  {auditLoading ? (
                    <div style={{ textAlign:'center', padding:20, color:'#aaa', fontSize:13 }}>読み込み中...</div>
                  ) : auditLog.length === 0 ? (
                    <div style={{ textAlign:'center', padding:20, color:'#bbb', fontSize:13 }}>記録はまだありません</div>
                  ) : (
                    auditLog.map(a => (
                      <div key={a.id} style={{ background:'#fafafa', border:'1px solid #eee', borderRadius:8, padding:'10px 14px', marginBottom:6, fontSize:12 }}>
                        <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
                          <span style={{ fontWeight:'bold' }}>{a.type}</span>
                          <span style={{ color:'#aaa' }}>{a.datetime}</span>
                          <span>{a.name} 様</span>
                          {a.date && <span>{fmtDate(a.date)} {formatTime(a.time)}〜</span>}
                          {a.guests && <span>{a.guests}名</span>}
                          <span style={{ color:'#888' }}>通知先: {a.notifyTarget}</span>
                        </div>
                        {a.notes && <div style={{ color:'#888', marginTop:2 }}>{a.notes}</div>}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* キャンセル待ち */}
            <div style={{ marginTop:16, paddingTop:16, borderTop:'1px solid #eee' }}>
              <button onClick={() => { const next = !showWaitlist; setShowWaitlist(next); if (next) loadWaitlist() }}
                style={{ ...btnGray, fontSize:13, width:'100%', textAlign:'left' }}>
                {showWaitlist ? '▼' : '▶'} キャンセル待ちを表示 {waitlist.length > 0 && `（${waitlist.length}件）`}
              </button>
              {showWaitlist && (
                <div style={{ marginTop:10 }}>
                  <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:8 }}>
                    <button onClick={loadWaitlist} disabled={waitlistLoading} style={{ ...btnGray, fontSize:12 }}>
                      {waitlistLoading ? '更新中...' : '更新'}
                    </button>
                  </div>
                  {waitlistLoading ? (
                    <div style={{ textAlign:'center', padding:20, color:'#aaa', fontSize:13 }}>読み込み中...</div>
                  ) : waitlist.length === 0 ? (
                    <div style={{ textAlign:'center', padding:20, color:'#bbb', fontSize:13 }}>キャンセル待ちはありません</div>
                  ) : (
                    waitlist.map(w => (
                      <div key={w.id} style={{ background:'#fafafa', border:'1px solid #eee', borderRadius:8, padding:'10px 14px', marginBottom:6, fontSize:12, display:'flex', justifyContent:'space-between', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                        <div>
                          <span style={{ fontWeight:'bold' }}>{fmtDate(w.date)}</span>
                          <span style={{ marginLeft:8 }}>{w.name} 様</span>
                          {w.guests && <span style={{ marginLeft:8 }}>{w.guests}名希望</span>}
                          <span style={{ marginLeft:8, color:'#888' }}>{w.phone}</span>
                          {w.notified && <span style={{ marginLeft:8, color:'#2e7d32' }}>通知済み</span>}
                        </div>
                        <button onClick={() => removeWaitlistEntry(w.id)} style={{ ...btnGray, fontSize:11, padding:'4px 10px' }}>削除</button>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </>
        )}

        {/* ─── TAB: その他 ──────────────────────────────────────── */}
        {tab==='settings' && (
          // 保存処理中（settingsSaving）は入力を丸ごと無効化する。保存中に追加編集すると、保存完了時に
          // 「保存済み」のスナップショットへ古いclosureの値で上書きされ、未保存バッジが誤って消えたり、
          // 編集内容が握り消されたりする（Appleデザインチーム／PMO視点レビューでの指摘）。
          <div style={{ opacity: settingsSaving ? 0.6 : 1, pointerEvents: settingsSaving ? 'none' : 'auto' }}>
            {settingsLoading ? (
              <div style={{ textAlign:'center', padding:40, color:'#aaa' }}>読み込み中...</div>
            ) : (
              <>
                {/* 業態プリセット：関連設定が複数箇所に分散していて見落としやすいため、代表的な業態を選ぶだけで一括適用できるようにした。
                    導入ウィザードを主要な導線にし、業種ごとの追加質問（呼び方等）で自由度を持たせる。質問なしで即適用したい
                    場合向けに、従来の「業態を選んで直接適用」も残す（好みが分かれるため両方用意）。 */}
                <div style={{ background:'#fff', borderRadius:12, padding:20, marginBottom:12, boxShadow:'0 1px 3px rgba(0,0,0,.08)', border:'1px solid #e3f2fd' }}>
                  <h2 style={{ fontSize:15, fontWeight:'bold', marginBottom:6 }}>業態プリセット（新規導入・業態変更時に使う）</h2>
                  <div style={{ fontSize:12, color:'#888', marginBottom:14 }}>この店舗の業態に近いものを選ぶと、コース選択・容量の数え方・呼び方・貸切機能・1名相席ルール・Q1・Q2の選択肢等の関連設定がまとめて変更されます。適用後も内容は自由に調整でき、コース一覧・営業時間・料金は変更されません。</div>
                  <button onClick={() => setShowWizard(true)} style={{ ...btnGreen, marginBottom:10 }}>
                    業種を選んで設定する
                  </button>
                  <button type="button" onClick={() => setShowQuickApply(v => !v)}
                    aria-expanded={showQuickApply}
                    style={{ display:'flex', alignItems:'center', gap:6, background:'none', border:'none', padding:0, fontSize:12, color:'#888', cursor:'pointer' }}>
                    <span style={{ display:'inline-block', transition:'transform 0.15s', transform: showQuickApply ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
                    質問なしで直接適用する（詳しい方向け）
                  </button>
                  {showQuickApply && (
                    <div style={{ marginTop:10 }}>
                      <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'flex-end' }}>
                        <div style={{ flex:'1 1 320px' }}>
                          <CustomSelect value={presetChoice} onChange={e => setPresetChoice(e.target.value)} style={{ width:'100%' }}>
                            <option value="">業態を選択してください</option>
                            {VERTICAL_PRESETS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
                          </CustomSelect>
                        </div>
                        <button onClick={applyVerticalPreset} disabled={!presetChoice}
                          style={{ ...btnGray, opacity: presetChoice ? 1 : 0.5 }}>
                          適用する
                        </button>
                      </div>
                      {presetChoice && (
                        <div style={{ fontSize:11, color:'#888', marginTop:8 }}>
                          {VERTICAL_PRESETS.find(p => p.key === presetChoice)?.hint}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {showWizard && <SetupWizard onClose={() => setShowWizard(false)} onApply={applyWizardResult} />}

                {/* 複数店舗展開向け：業態・運用ルールをファイルとして書き出し／別の店舗のデプロイに読み込む */}
                <div style={{ background:'#fff', borderRadius:12, padding:20, marginBottom:12, boxShadow:'0 1px 3px rgba(0,0,0,.08)' }}>
                  <h2 style={{ fontSize:15, fontWeight:'bold', marginBottom:6 }}>設定テンプレートの書き出し・読み込み（複数店舗展開向け）</h2>
                  <div style={{ fontSize:12, color:'#888', marginBottom:14 }}>この店舗のコース・営業時間・容量の数え方等の設定をファイルに書き出し、新しく別の店舗を立ち上げる際にその管理画面へ読み込むことで、ゼロから設定し直さずに近い状態から始められます（店名・電話番号・担当者一覧は含まれません。各店舗は今まで通り別々のシステムです）。</div>
                  <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
                    <button onClick={exportSettingsTemplate} style={btnGray}>この店舗の設定を書き出す</button>
                    <button onClick={() => templateFileInputRef.current?.click()} style={btnGray}>テンプレートを読み込む</button>
                    <input ref={templateFileInputRef} type="file" accept="application/json" style={{ display:'none' }}
                      onChange={e => { importSettingsTemplate(e.target.files?.[0]); e.target.value = '' }} />
                  </div>
                </div>

                {/* スタッフ個人ログイン・権限管理（店長のみ）：店舗共通パスワードに加え、個人名＋パスワードでログインできるアカウントを作れる */}
                <div style={{ background:'#fff', borderRadius:12, padding:20, marginBottom:12, boxShadow:'0 1px 3px rgba(0,0,0,.08)' }}>
                  <h2 style={{ fontSize:15, fontWeight:'bold', marginBottom:6 }}>スタッフ個人ログイン</h2>
                  <div style={{ fontSize:12, color:'#888', marginBottom:14 }}>店舗共通のパスワードに加えて、スタッフ個人の名前＋パスワードでログインできるアカウントを作成できます。「店長」は全操作可、「スタッフ」は予約の登録・確認・変更のみ可能です（設定変更・価格変更・顧客データダウンロード等はできません）。操作ログにも個人の名前が記録されます。作らなくても、これまで通り共通パスワードでのログイン（店長として扱われます）は使えます。</div>
                  {staffAccounts.length === 0 ? (
                    <div style={{ textAlign:'center', padding:'12px 0', color:'#aaa', fontSize:13 }}>個人アカウントは登録されていません</div>
                  ) : (
                    staffAccounts.map(acc => (
                      <div key={acc.id} style={{ display:'flex', alignItems:'center', gap:10, borderBottom:'1px solid #f0f0f0', padding:'8px 0', flexWrap:'wrap' }}>
                        <div style={{ flex:'1 1 140px', fontWeight:'bold', fontSize:13 }}>{acc.name}</div>
                        <div style={{ fontSize:12, color: acc.role === 'owner' ? '#06c755' : '#888' }}>{acc.role === 'owner' ? '店長' : 'スタッフ'}</div>
                        <button onClick={() => { setEditingAccountId(acc.id); setNewAccountName(acc.name); setNewAccountPassword(''); setNewAccountRole(acc.role); setShowAddAccount(true) }} style={btnGray}>編集</button>
                        <button onClick={() => removeStaffAccount(acc)} style={btnRed}>削除</button>
                      </div>
                    ))
                  )}
                  {showAddAccount ? (
                    <div style={{ marginTop:12, padding:14, background:'#f0fff4', border:'1px solid #b2ecc8', borderRadius:8 }}>
                      <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginBottom:10 }}>
                        <input value={newAccountName} onChange={e => setNewAccountName(e.target.value)} placeholder="お名前"
                          style={{ flex:'1 1 140px', padding:'8px 10px', border:'1px solid #ddd', borderRadius:6, fontSize:13 }} />
                        <input type="password" value={newAccountPassword} onChange={e => setNewAccountPassword(e.target.value)}
                          placeholder={editingAccountId ? 'パスワード（変更する場合のみ入力）' : 'パスワード'}
                          style={{ flex:'1 1 180px', padding:'8px 10px', border:'1px solid #ddd', borderRadius:6, fontSize:13 }} />
                        <CustomSelect value={newAccountRole} onChange={e => setNewAccountRole(e.target.value)} style={{ width:120 }}>
                          <option value="staff">スタッフ</option>
                          <option value="owner">店長</option>
                        </CustomSelect>
                      </div>
                      <div style={{ display:'flex', gap:8 }}>
                        <button disabled={savingAccount} onClick={saveStaffAccount} style={btnGreen}>{savingAccount ? '保存中...' : '保存する'}</button>
                        <button onClick={() => { setShowAddAccount(false); setEditingAccountId(null); setNewAccountName(''); setNewAccountPassword(''); setNewAccountRole('staff') }} style={btnGray}>キャンセル</button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => { setEditingAccountId(null); setNewAccountName(''); setNewAccountPassword(''); setNewAccountRole('staff'); setShowAddAccount(true) }}
                      style={{ ...btnGray, marginTop:8 }}>
                      ＋ アカウントを追加
                    </button>
                  )}
                </div>

                {/* 管理者・スタッフ向け通知の配信方法：LINE公式アカウントを使わない店舗にも対応できるようにする */}
                <div style={{ background:'#fff', borderRadius:12, padding:20, marginBottom:12, boxShadow:'0 1px 3px rgba(0,0,0,.08)' }}>
                  <h2 style={{ fontSize:15, fontWeight:'bold', marginBottom:6 }}>管理者・スタッフへの通知方法</h2>
                  <div style={{ fontSize:12, color:'#888', marginBottom:14 }}>新規予約・エラー・深夜の自己診断結果等、店側への通知（お客様への確認LINE等とは別）をどの手段で受け取るかを選べます。LINE公式アカウントを使わない店舗は「メールのみ」を選んでください。</div>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(220px, 1fr))', gap:14 }}>
                    <div>
                      <label style={{ fontSize:12, color:'#555', display:'block', marginBottom:4 }}>配信方法</label>
                      <CustomSelect value={settings.adminNotifyChannel || 'line'} onChange={e => setSettings(s => ({ ...s, adminNotifyChannel: e.target.value }))} style={{ width:'100%' }}>
                        <option value="line">LINEのみ</option>
                        <option value="email">メールのみ</option>
                        <option value="both">LINE＋メール両方</option>
                      </CustomSelect>
                    </div>
                    {(settings.adminNotifyChannel === 'email' || settings.adminNotifyChannel === 'both') && (
                      <div>
                        <label style={{ fontSize:12, color:'#555', display:'block', marginBottom:4 }}>通知先メールアドレス</label>
                        <input value={settings.adminAlertEmail} onChange={e => setSettings(s => ({ ...s, adminAlertEmail: e.target.value }))}
                          placeholder="owner@example.com"
                          style={{ width:'100%', boxSizing:'border-box', padding:'8px 10px', border:'1px solid #ddd', borderRadius:6, fontSize:13 }} />
                      </div>
                    )}
                  </div>
                </div>

                {/* 広告枠（任意・将来の収益化向け）：設定しない限りお客様画面には何も表示されない */}
                <div style={{ background:'#fff', borderRadius:12, padding:20, marginBottom:12, boxShadow:'0 1px 3px rgba(0,0,0,.08)' }}>
                  <h2 style={{ fontSize:15, fontWeight:'bold', marginBottom:6 }}>広告枠（任意）</h2>
                  <div style={{ fontSize:12, color:'#888', marginBottom:14 }}>お客様の予約完了画面に、画像またはテキストの広告バナーを1つ表示できます。使わない場合は何も設定しなくて構いません（表示されません）。</div>
                  <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom: settings.adBannerEnabled ? 14 : 0 }}>
                    <label style={{ fontSize:12, color:'#555' }}>広告枠を有効にする</label>
                    <Pill on={settings.adBannerEnabled} onClick={() => setSettings(s => ({ ...s, adBannerEnabled: !s.adBannerEnabled }))} />
                  </div>
                  {settings.adBannerEnabled && (
                    <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(220px, 1fr))', gap:14 }}>
                      <div>
                        <label style={{ fontSize:12, color:'#555', display:'block', marginBottom:4 }}>画像URL（任意・無ければテキストのみ表示）</label>
                        <input value={settings.adBannerImageUrl} onChange={e => setSettings(s => ({ ...s, adBannerImageUrl: e.target.value }))}
                          placeholder="https://example.com/banner.jpg"
                          style={{ width:'100%', boxSizing:'border-box', padding:'8px 10px', border:'1px solid #ddd', borderRadius:6, fontSize:13 }} />
                      </div>
                      <div>
                        <label style={{ fontSize:12, color:'#555', display:'block', marginBottom:4 }}>テキスト（任意）</label>
                        <input value={settings.adBannerText} onChange={e => setSettings(s => ({ ...s, adBannerText: e.target.value }))}
                          placeholder="広告文言"
                          style={{ width:'100%', boxSizing:'border-box', padding:'8px 10px', border:'1px solid #ddd', borderRadius:6, fontSize:13 }} />
                      </div>
                      <div>
                        <label style={{ fontSize:12, color:'#555', display:'block', marginBottom:4 }}>リンク先URL（任意・タップ時に開くページ）</label>
                        <input value={settings.adBannerLinkUrl} onChange={e => setSettings(s => ({ ...s, adBannerLinkUrl: e.target.value }))}
                          placeholder="https://example.com"
                          style={{ width:'100%', boxSizing:'border-box', padding:'8px 10px', border:'1px solid #ddd', borderRadius:6, fontSize:13 }} />
                      </div>
                      <div style={{ gridColumn:'1/-1' }}>
                        <label style={{ fontSize:12, color:'#555', display:'block', marginBottom:6 }}>表示する場所（複数選択可）</label>
                        {/* 「予約画面の見出し部分」は選択肢から除外している：見出しはpositon:stickyで予約フロー中
                            常時画面上部に固定表示され続けるため、店名・写真という「信頼される領域」に第三者の
                            広告が常時混在してしまう（アップルデザインチームのレビューで明確に指摘され、除外を決定）。 */}
                        <div style={{ display:'flex', gap:16, flexWrap:'wrap' }}>
                          {[['done','予約完了画面（既定・最も控えめ）'],['myres','マイ予約画面']].map(([key,label]) => (
                            <label key={key} style={{ fontSize:12, display:'flex', alignItems:'center', gap:6, cursor:'pointer' }}>
                              <input type="checkbox" checked={(settings.adBannerPlacements||['done']).includes(key)}
                                onChange={e => setSettings(s => {
                                  const cur = s.adBannerPlacements || ['done']
                                  const next = e.target.checked ? [...cur, key] : cur.filter(k => k !== key)
                                  return { ...s, adBannerPlacements: next.length ? next : ['done'] }
                                })} />
                              {label}
                            </label>
                          ))}
                        </div>
                        <div style={{ fontSize:11, color:'#aaa', marginTop:6 }}>複数の場所に表示すると、お客様の見た目・体験を損なうリスクが上がります。控えめな箇所（予約完了画面）から始めることを推奨します。</div>
                      </div>
                    </div>
                  )}
                </div>

                {/* 店舗基本情報：他業態・他店舗へ転用する場合もコード修正なしでここだけ変えればよい */}
                <div style={{ background:'#fff', borderRadius:12, padding:20, marginBottom:12, boxShadow:'0 1px 3px rgba(0,0,0,.08)' }}>
                  <h2 style={{ fontSize:15, fontWeight:'bold', marginBottom:6 }}>店舗基本情報</h2>
                  <div style={{ fontSize:12, color:'#888', marginBottom:14 }}>お客様画面・管理画面の見出しやLINE文面に使われる店名・電話番号等です。別の店舗・業態でこのシステムを使う場合も、ここを変えるだけでコード修正は不要です。</div>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(220px, 1fr))', gap:14 }}>
                    <div>
                      <label style={{ fontSize:12, color:'#555', display:'block', marginBottom:4 }}>店名</label>
                      <input value={settings.restaurantName} onChange={e => setSettings(s => ({ ...s, restaurantName: e.target.value }))}
                        style={{ width:'100%', boxSizing:'border-box', padding:'8px 10px', border:'1px solid #ddd', borderRadius:6, fontSize:13 }} />
                    </div>
                    <div>
                      <label style={{ fontSize:12, color:'#555', display:'block', marginBottom:4 }}>キャッチコピー・業態（画面上部に表示）</label>
                      <input value={settings.restaurantTagline} onChange={e => setSettings(s => ({ ...s, restaurantTagline: e.target.value }))}
                        style={{ width:'100%', boxSizing:'border-box', padding:'8px 10px', border:'1px solid #ddd', borderRadius:6, fontSize:13 }} />
                    </div>
                    <div>
                      <label style={{ fontSize:12, color:'#555', display:'block', marginBottom:4 }}>住所（任意・検索結果でのお店の見え方に関わります）</label>
                      <input value={settings.restaurantAddress} onChange={e => setSettings(s => ({ ...s, restaurantAddress: e.target.value }))}
                        placeholder="例：埼玉県和光市○○1-2-3"
                        style={{ width:'100%', boxSizing:'border-box', padding:'8px 10px', border:'1px solid #ddd', borderRadius:6, fontSize:13 }} />
                    </div>
                    <div>
                      <label style={{ fontSize:12, color:'#555', display:'block', marginBottom:4 }}>店舗紹介写真URL（任意・予約画面の見出し部分に表示）</label>
                      <input value={settings.storeImageUrl} onChange={e => setSettings(s => ({ ...s, storeImageUrl: e.target.value }))}
                        placeholder="https://example.com/store.jpg"
                        style={{ width:'100%', boxSizing:'border-box', padding:'8px 10px', border:'1px solid #ddd', borderRadius:6, fontSize:13 }} />
                      <div style={{ fontSize:11, color:'#aaa', marginTop:4 }}>お客様画面の最初に表示される場所のため、なるべく軽い画像（横1200px程度・数百KB以内を推奨）にしてください。大きすぎる画像は読み込みが遅く感じられる原因になります。</div>
                    </div>
                    <div>
                      <label style={{ fontSize:12, color:'#555', display:'block', marginBottom:4 }}>お客様案内用の電話番号</label>
                      <input value={settings.contactPhone} onChange={e => setSettings(s => ({ ...s, contactPhone: e.target.value }))}
                        placeholder="080-0000-0000"
                        style={{ width:'100%', boxSizing:'border-box', padding:'8px 10px', border:'1px solid #ddd', borderRadius:6, fontSize:13 }} />
                    </div>
                    <div>
                      <label style={{ fontSize:12, color:'#555', display:'block', marginBottom:4 }}>システム異常時の連絡先表記</label>
                      <input value={settings.systemAdminContact} onChange={e => setSettings(s => ({ ...s, systemAdminContact: e.target.value }))}
                        placeholder="管理者"
                        style={{ width:'100%', boxSizing:'border-box', padding:'8px 10px', border:'1px solid #ddd', borderRadius:6, fontSize:13 }} />
                    </div>
                    <div>
                      <label style={{ fontSize:12, color:'#555', display:'block', marginBottom:4 }}>通知グループAの説明</label>
                      <input value={settings.groupADescription} onChange={e => setSettings(s => ({ ...s, groupADescription: e.target.value }))}
                        style={{ width:'100%', boxSizing:'border-box', padding:'8px 10px', border:'1px solid #ddd', borderRadius:6, fontSize:13 }} />
                    </div>
                    <div>
                      <label style={{ fontSize:12, color:'#555', display:'block', marginBottom:4 }}>通知グループBの説明</label>
                      <input value={settings.groupBDescription} onChange={e => setSettings(s => ({ ...s, groupBDescription: e.target.value }))}
                        style={{ width:'100%', boxSizing:'border-box', padding:'8px 10px', border:'1px solid #ddd', borderRadius:6, fontSize:13 }} />
                    </div>
                    <div>
                      <label style={{ fontSize:12, color:'#555', display:'block', marginBottom:4 }}>お客様予約サイトのURL（メール案内文で使用・任意）</label>
                      <input value={settings.webBaseUrl} onChange={e => setSettings(s => ({ ...s, webBaseUrl: e.target.value }))}
                        placeholder="https://xxxxx.vercel.app"
                        style={{ width:'100%', boxSizing:'border-box', padding:'8px 10px', border:'1px solid #ddd', borderRadius:6, fontSize:13 }} />
                    </div>
                  </div>

                  <div style={{ marginTop:16, paddingTop:14, borderTop:'1px solid #eee', display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(220px, 1fr))', gap:14 }}>
                    <div>
                      <label style={{ fontSize:12, color:'#555', display:'block', marginBottom:4 }}>Q1「ご利用目的」の選択肢（1行に1つ、業態に合わせて変更できます）</label>
                      <textarea rows={6} value={settings.q1Options.join('\n')}
                        onChange={e => setSettings(s => ({ ...s, q1Options: e.target.value.split('\n') }))}
                        onBlur={e => setSettings(s => ({ ...s, q1Options: e.target.value.split('\n').map(v=>v.trim()).filter(Boolean) }))}
                        style={{ width:'100%', boxSizing:'border-box', padding:'8px 10px', border:'1px solid #ddd', borderRadius:6, fontSize:13, fontFamily:'inherit' }} />
                    </div>
                    <div>
                      <label style={{ fontSize:12, color:'#555', display:'block', marginBottom:4 }}>Q2「どのように当店を知りましたか」の選択肢（1行に1つ）</label>
                      <textarea rows={6} value={settings.q3Options.join('\n')}
                        onChange={e => setSettings(s => ({ ...s, q3Options: e.target.value.split('\n') }))}
                        onBlur={e => setSettings(s => ({ ...s, q3Options: e.target.value.split('\n').map(v=>v.trim()).filter(Boolean) }))}
                        style={{ width:'100%', boxSizing:'border-box', padding:'8px 10px', border:'1px solid #ddd', borderRadius:6, fontSize:13, fontFamily:'inherit' }} />
                    </div>
                  </div>
                  <div style={{ fontSize:11, color:'#aaa', marginTop:6 }}>「その他」を選択肢に含めておくと、お客様が自由記述で回答できるようになります。</div>
                </div>

                {/* 業態設定：コースの有無・呼び方、担当者指名の可否を切り替える（うなぎ屋・定食屋等、コース料理をやらない業態にも対応） */}
                <div style={{ background:'#fff', borderRadius:12, padding:20, marginBottom:12, boxShadow:'0 1px 3px rgba(0,0,0,.08)' }}>
                  <h2 style={{ fontSize:15, fontWeight:'bold', marginBottom:6 }}>業態設定</h2>
                  <div style={{ fontSize:12, color:'#888', marginBottom:14 }}>コース料理をやらない業態（うなぎ屋・定食屋・中華料理店など）や、担当者を指名できる業態向けの設定です。</div>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(220px, 1fr))', gap:14 }}>
                    <div>
                      <label style={{ fontSize:12, color:'#555', display:'block', marginBottom:4 }}>コース選択の有無</label>
                      <CustomSelect
                        value={settings.bookingMode}
                        onChange={e => setSettings(s => ({ ...s, bookingMode: e.target.value }))}>
                        <option value="course">コースあり（お客様がコースを選ぶ）</option>
                        <option value="simple">コース無し（コース選択UIを表示しない）</option>
                      </CustomSelect>
                    </div>
                    <div>
                      <label style={{ fontSize:12, color:'#555', display:'block', marginBottom:4 }}>「コース」の呼び方（メニュー・サービス等に変更可）</label>
                      <input value={settings.itemLabel} onChange={e => setSettings(s => ({ ...s, itemLabel: e.target.value }))}
                        placeholder="コース"
                        style={{ width:'100%', boxSizing:'border-box', padding:'8px 10px', border:'1px solid #ddd', borderRadius:6, fontSize:13 }} />
                    </div>
                    <div>
                      <label style={{ fontSize:12, color:'#555', display:'block', marginBottom:4 }}>アイコン（絵文字1〜2文字。予約画面・LINE通知に表示）</label>
                      <input value={settings.itemIcon} onChange={e => setSettings(s => ({ ...s, itemIcon: e.target.value }))}
                        placeholder="🍽"
                        style={{ width:'100%', boxSizing:'border-box', padding:'8px 10px', border:'1px solid #ddd', borderRadius:6, fontSize:13 }} />
                    </div>
                    {settings.bookingMode === 'simple' && (
                      <>
                        <div>
                          <label style={{ fontSize:12, color:'#555', display:'block', marginBottom:4 }}>既定の滞在時間（分）<strong style={{ color:'#e65100' }}>※コース無しの場合、残数計算はこの値を使います</strong>
                            {/* 終了時刻の計算・表示（addMinutes）は日付をまたぐ計算に対応していないため、1439分
                                （23時間59分）を超えると終了時刻が「89:00」のような壊れた表示になる
                                （業種経営者陣視点レビューでの指摘：複数日レンタル等を想定する業態向けに明示）。 */}
                            <span style={{ display:'block', color:'#888', fontWeight:'normal' }}>※日をまたぐ長さ（1440分・24時間以上）は終了時刻の表示が崩れるため未対応です</span>
                          </label>
                          <input type="number" min="1" max="1439" value={settings.defaultStayMin}
                            onChange={e => setSettings(s => ({ ...s, defaultStayMin: e.target.value }))}
                            style={{ width:'100%', boxSizing:'border-box', padding:'8px 10px', border:'1px solid #ddd', borderRadius:6, fontSize:13 }} />
                        </div>
                        <div>
                          <label style={{ fontSize:12, color:'#555', display:'block', marginBottom:4 }}>台帳・カレンダーに記録する既定の「コース」名（お客様には表示されません）</label>
                          <input value={settings.defaultCourseName} onChange={e => setSettings(s => ({ ...s, defaultCourseName: e.target.value }))}
                            placeholder="ご予約"
                            style={{ width:'100%', boxSizing:'border-box', padding:'8px 10px', border:'1px solid #ddd', borderRadius:6, fontSize:13 }} />
                        </div>
                      </>
                    )}
                  </div>

                  <div style={{ marginTop:16, paddingTop:14, borderTop:'1px solid #eee' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10 }}>
                      <label style={{ fontSize:12, color:'#555' }}>お客様に人数を選ばせる</label>
                      <Pill on={settings.guestCountEnabled} onClick={() => setSettings(s => ({ ...s, guestCountEnabled: !s.guestCountEnabled }))} />
                    </div>
                    <div style={{ fontSize:11, color:'#aaa', marginBottom:10 }}>OFFにすると予約画面から人数選択カードが消え、下記の人数で固定されます（面接予約・カウンセリング等、常に1名で予約する業態や、二人乗りボート等、常に決まった人数になる業態向け）。</div>
                    {!settings.guestCountEnabled && (
                      <div>
                        <label style={{ fontSize:12, color:'#555', display:'block', marginBottom:4 }}>固定人数（この人数として予約・容量計算されます）</label>
                        <input type="number" min="1" value={settings.fixedGuestCount || '1'}
                          onChange={e => setSettings(s => ({ ...s, fixedGuestCount: e.target.value }))}
                          style={{ width:120, boxSizing:'border-box', padding:'8px 10px', border:'1px solid #ddd', borderRadius:6, fontSize:13 }} />
                      </div>
                    )}
                  </div>

                  <div style={{ marginTop:16, paddingTop:14, borderTop:'1px solid #eee' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10 }}>
                      <label style={{ fontSize:12, color: settings.guestCountEnabled ? '#555' : '#bbb' }}>同伴者のお名前・アレルギー入力欄を表示する</label>
                      <Pill on={settings.companionInfoEnabled} disabled={!settings.guestCountEnabled}
                        onClick={() => setSettings(s => ({ ...s, companionInfoEnabled: !s.companionInfoEnabled }))} />
                    </div>
                    {settings.guestCountEnabled ? (
                      <div style={{ fontSize:11, color:'#aaa' }}>2名以上のご予約時に表示される「ご一緒される方のお名前・アレルギー等」の入力欄です。飲食店以外（レンタル・面談等、アレルギーの概念がない業態）ではOFFにすることを推奨します。</div>
                    ) : (
                      <div style={{ fontSize:11, color:'#aaa' }}>上の「お客様に人数を選ばせる」がOFF（人数固定）のため、この項目は設定できません（人数が常に1名扱いのため、2名以上向けのこの入力欄は表示される機会がありません）。</div>
                    )}
                  </div>

                  <div style={{ marginTop:16, paddingTop:14, borderTop:'1px solid #eee' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10 }}>
                      <label style={{ fontSize:12, color:'#555' }}>メールアドレスの登録を受け付ける</label>
                      <Pill on={settings.emailCollectionEnabled} onClick={() => setSettings(s => ({ ...s, emailCollectionEnabled: !s.emailCollectionEnabled }))} />
                    </div>
                    <div style={{ fontSize:11, color:'#aaa' }}>
                      ONにすると予約画面にメールアドレス入力欄が表示されます。LINEを使わない・使えないお客様（海外のお客様、LINE未利用の日本のお客様等）は、ここで登録したメールアドレスに確認・変更・キャンセルの通知が届きます（LINEご利用のお客様は任意）。「予約の確認・変更はこちら」からは電話番号でも検索できます。
                    </div>
                  </div>

                  <div style={{ marginTop:16, paddingTop:14, borderTop:'1px solid #eee' }}>
                    <label style={{ fontSize:12, color:'#555', display:'block', marginBottom:8 }}>お客様画面の対応言語</label>
                    <div style={{ display:'flex', gap:16 }}>
                      {[['ja','日本語'],['en','English']].map(([code, label]) => (
                        <label key={code} style={{ display:'flex', alignItems:'center', gap:6, fontSize:13, cursor:'pointer' }}>
                          <input type="checkbox" checked={settings.enabledLanguages.includes(code)}
                            onChange={e => setSettings(s => {
                              const next = e.target.checked
                                ? [...s.enabledLanguages, code]
                                : s.enabledLanguages.filter(c => c !== code)
                              return { ...s, enabledLanguages: next.length > 0 ? next : ['ja'] }
                            })} />
                          {label}
                        </label>
                      ))}
                    </div>
                    <div style={{ fontSize:11, color:'#aaa', marginTop:6 }}>
                      2つ以上ONにすると、お客様画面に言語切り替えボタンが表示されます。英語訳は予約の基本フロー（日付・時間・人数・連絡先・確認・完了・マイ予約・変更）のみに対応しており、コース名・Q1/Q2の選択肢・お知らせ文など店舗が入力する内容は翻訳されません（入力した言語のまま表示されます）。
                    </div>
                  </div>

                  <div style={{ marginTop:16, paddingTop:14, borderTop:'1px solid #eee' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10 }}>
                      <label style={{ fontSize:12, color:'#555' }}>{settings.staffLabel || '担当者'}の指名機能</label>
                      <Pill on={settings.staffAssignmentEnabled} onClick={() => setSettings(s => ({ ...s, staffAssignmentEnabled: !s.staffAssignmentEnabled }))} />
                    </div>
                    {settings.staffAssignmentEnabled && (
                      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10 }}>
                        <label style={{ fontSize:12, color:'#555', whiteSpace:'nowrap' }}>呼び方</label>
                        <input value={settings.staffLabel || ''} placeholder="担当者"
                          onChange={e => setSettings(s => ({ ...s, staffLabel: e.target.value }))}
                          style={{ maxWidth:160 }} />
                        <span style={{ fontSize:11, color:'#aaa' }}>スタイリスト・整備士・ガイド・車両等、業態に合わせて変更できます（お客様・スタッフ双方の画面表示に使われます）</span>
                      </div>
                    )}
                    <div style={{ fontSize:11, color:'#aaa', marginBottom: settings.staffAssignmentEnabled ? 8 : 0 }}>
                      ONにすると、お客様の予約画面に「ご指名（任意）」の選択欄が表示されます（料理人・スタイリスト等、{settings.staffLabel || '担当者'}を指名できる業態向け）。
                      「残数の数え方」が「1日単位／時間帯単位」の場合、指名は情報として記録されるだけで空き状況には影響しません。「担当者単位」を選んだ場合のみ、実際にその{settings.staffLabel || '担当者'}の空き時間として管理されます（下記参照）。
                    </div>
                    {settings.staffAssignmentEnabled && (
                      <div>
                        <label style={{ fontSize:12, color:'#555', display:'block', marginBottom:8 }}>指名できる{settings.staffLabel || '担当者'}一覧</label>
                        {settings.staffRoster.map((st, idx) => (
                          <div key={idx} style={{ border:'1px solid #eee', borderRadius:8, padding:12, marginBottom:8 }}>
                            <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', marginBottom:8 }}>
                              <input value={st.name} placeholder={`${settings.staffLabel || '担当者'}名`}
                                onChange={e => setSettings(s => { const r=[...s.staffRoster]; r[idx]={...r[idx], name:e.target.value}; return {...s, staffRoster:r} })}
                                style={{ flex:'1 1 140px', boxSizing:'border-box', padding:'8px 10px', border:'1px solid #ddd', borderRadius:6, fontSize:13 }} />
                              <span style={{ fontSize:12, color:'#555' }}>同時対応数</span>
                              <CustomSelect value={st.concurrentCapacity || 1}
                                onChange={e => setSettings(s => { const r=[...s.staffRoster]; r[idx]={...r[idx], concurrentCapacity:parseInt(e.target.value,10)||1}; return {...s, staffRoster:r} })}
                                style={{ width:70 }}>
                                {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}</option>)}
                              </CustomSelect>
                              <button onClick={() => { if (window.confirm(`「${st.name || '担当者'}」を削除します。シフト・臨時休みの設定も含めて消えます。よろしいですか？`)) setSettings(s => ({ ...s, staffRoster: s.staffRoster.filter((_,i)=>i!==idx) })) }} style={btnGray}>削除</button>
                            </div>
                            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                              <label style={{ fontSize:12, color:'#555' }}>シフト（曜日別の勤務時間）を設定する</label>
                              <Pill on={!!st.shifts} onClick={() => setSettings(s => {
                                const r=[...s.staffRoster]
                                r[idx] = { ...r[idx], shifts: r[idx].shifts ? null : {} }
                                return {...s, staffRoster:r}
                              })} />
                            </div>
                            <div style={{ fontSize:11, color:'#aaa', marginTop:4, marginBottom: st.shifts ? 8 : 0 }}>OFFの場合、この{settings.staffLabel || '担当者'}は店の営業時間内であれば常に対応可能として扱われます。ONにすると、曜日ごとに出勤の有無・時間帯を個別に設定できます（設定していない曜日は休みになります）。</div>
                            {st.shifts && (
                              <div style={{ display:'grid', gap:6 }}>
                                {WEEK.map((w, dow) => {
                                  const shift = st.shifts[String(dow)]
                                  return (
                                    <div key={dow} style={{ display:'flex', alignItems:'center', gap:10 }}>
                                      <span style={{ width:20, fontSize:12, color:'#555' }}>{w}</span>
                                      <Pill on={!!shift} onClick={() => setSettings(s => {
                                        const r=[...s.staffRoster]
                                        const shifts = { ...(r[idx].shifts||{}) }
                                        shifts[String(dow)] = shifts[String(dow)] ? null : { start:'10:00', end:'18:00' }
                                        r[idx] = { ...r[idx], shifts }
                                        return {...s, staffRoster:r}
                                      })} />
                                      {shift ? (
                                        <>
                                          <TimeSelect value={shift.start} onChange={e => setSettings(s => {
                                            const r=[...s.staffRoster]
                                            const shifts = { ...(r[idx].shifts||{}) }
                                            shifts[String(dow)] = { ...shifts[String(dow)], start: e.target.value }
                                            r[idx] = { ...r[idx], shifts }
                                            return {...s, staffRoster:r}
                                          })} />
                                          <span style={{ fontSize:13, color:'#888' }}>〜</span>
                                          <TimeSelect value={shift.end} onChange={e => setSettings(s => {
                                            const r=[...s.staffRoster]
                                            const shifts = { ...(r[idx].shifts||{}) }
                                            shifts[String(dow)] = { ...shifts[String(dow)], end: e.target.value }
                                            r[idx] = { ...r[idx], shifts }
                                            return {...s, staffRoster:r}
                                          })} />
                                        </>
                                      ) : <span style={{ fontSize:12, color:'#bbb' }}>休み</span>}
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                            <div style={{ marginTop:8, paddingTop:8, borderTop:'1px solid #f5f5f5' }}>
                              <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                                <label style={{ fontSize:11, color:'#888' }}>臨時休み（この{settings.staffLabel || '担当者'}だけの日付指定の休み）</label>
                                {(st.blackoutDates || []).map((d, di) => (
                                  <span key={d} style={{ display:'inline-flex', alignItems:'center', gap:4, background:'#fdf0f0', color:'#c62828', borderRadius:12, padding:'2px 8px', fontSize:11 }}>
                                    {d}
                                    <button onClick={() => { if (window.confirm(`${d} の臨時休みを削除します。よろしいですか？`)) setSettings(s => { const r=[...s.staffRoster]; r[idx]={...r[idx], blackoutDates:(r[idx].blackoutDates||[]).filter((_,j)=>j!==di)}; return {...s, staffRoster:r} }) }}
                                      style={{ border:'none', background:'none', color:'#c62828', cursor:'pointer', padding:0, fontSize:12, lineHeight:1 }}>✕</button>
                                  </span>
                                ))}
                                <input type="date" style={{ padding:'4px 8px', border:'1px solid #ddd', borderRadius:6, fontSize:12 }}
                                  onChange={e => {
                                    const val = e.target.value.replace(/-/g,'/')
                                    if (!val) return
                                    setSettings(s => {
                                      const r=[...s.staffRoster]
                                      const cur = r[idx].blackoutDates || []
                                      if (cur.indexOf(val) === -1) r[idx] = { ...r[idx], blackoutDates: [...cur, val] }
                                      return {...s, staffRoster:r}
                                    })
                                    e.target.value = ''
                                  }} />
                              </div>
                            </div>
                          </div>
                        ))}
                        <button onClick={() => setSettings(s => ({ ...s, staffRoster: [...s.staffRoster, { name:'', concurrentCapacity:1, shifts:null }] }))}
                          style={{ padding:'8px 16px', background:'#f0f0f0', color:'#555', border:'none', borderRadius:8, fontSize:13, cursor:'pointer' }}>
                          + {settings.staffLabel || '担当者'}を追加
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* 案内：休業日・受付停止枠・日付別の営業時間変更の場所 */}
                <div style={{ background:'#eef6ff', border:'1px solid #bcdcff', borderRadius:10, padding:'12px 16px', marginBottom:12, fontSize:13, color:'#1565c0' }}>
                  💡「休業日にする」「一部だけ受付停止」「特定の日だけ営業時間を変える」は、ここではなく<strong>「予約一覧」タブでカレンダーの日付をタップ</strong>すると設定できます。
                </div>
                {/* 受付設定 */}
                <div style={{ background:'#fff', borderRadius:12, padding:20, marginBottom:12, boxShadow:'0 1px 3px rgba(0,0,0,.08)' }}>
                  <h2 style={{ fontSize:15, fontWeight:'bold', marginBottom:16 }}>予約受付設定</h2>
                  {/* 最大受付数・曜日別・増枠は「担当者単位」モデルでは一切参照されない（空き状況判定は
                      getStaffAvailability側で担当者ごとのシフト・同時対応数だけを見るため）。同じカード内の
                      unparseableGuestFallbackだけ先にゲートされていて、この3項目が漏れていた（業種経営者陣
                      レビューで発覚）。 */}
                  {settings.capacityModel !== 'perStaff' && (
                    <>
                      <div style={{ display:'flex', flexWrap:'wrap', gap:20, alignItems:'center' }}>
                        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                          <label style={{ fontSize:13, color:'#555', whiteSpace:'nowrap' }}>最大受付数（基本）</label>
                          <CustomSelect value={settings.maxSeats}
                            onChange={e => setSettings(s=>({...s, maxSeats:parseInt(e.target.value)||8}))}
                            style={{ ...sStyle, width:90 }}>
                            {[1,2,3,4,5,6,7,8,9,10,11,12,16,20,24,30].map(n=><option key={n} value={n}>{n}{settings.countUnit || '名'}</option>)}
                          </CustomSelect>
                        </div>
                        <label style={{ fontSize:12, display:'flex', alignItems:'center', gap:6, cursor:'pointer' }}>
                          <input type="checkbox" checked={!!settings.seatsByWeekday}
                            onChange={e => setSettings(s => ({ ...s, seatsByWeekday: e.target.checked ? (s.seatsByWeekday || Object.fromEntries(WEEK.map((_,i)=>[String(i), s.maxSeats]))) : null }))} />
                          曜日ごとに受付数を変える（イールドマネジメント）
                        </label>
                      </div>
                      {settings.seatsByWeekday && (
                        <div style={{ marginTop:14, display:'flex', gap:10, flexWrap:'wrap' }}>
                          {WEEK.map((w, i) => (
                            <div key={i} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:4 }}>
                              <span style={{ fontSize:12, color:'#888' }}>{w}</span>
                              <CustomSelect value={settings.seatsByWeekday[String(i)] ?? settings.maxSeats}
                                onChange={e => setSettings(s => ({ ...s, seatsByWeekday: { ...s.seatsByWeekday, [String(i)]: parseInt(e.target.value)||0 } }))}
                                style={{ ...sStyle, width:70 }}>
                                {[0,1,2,3,4,5,6,7,8,9,10,11,12,16,20,24,30].map(n=><option key={n} value={n}>{n}{settings.countUnit || '名'}</option>)}
                              </CustomSelect>
                            </div>
                          ))}
                          <div style={{ fontSize:11, color:'#aaa', width:'100%', marginTop:4 }}>例：閑散期の平日は少なめ、金土・祝日は多めに設定できます。</div>
                        </div>
                      )}

                      <div style={{ marginTop:16, paddingTop:14, borderTop:'1px solid #eee' }}>
                        <label style={{ fontSize:13, color:'#555', display:'block', marginBottom:4 }}>期間限定の増枠（繁忙期向け・多くの店舗では不要）</label>
                        <div style={{ fontSize:11, color:'#aaa', marginBottom:8 }}>年末年始・お盆等、特定の期間だけ上限を増やしたい場合にのみ使います。</div>
                        {(settings.capacityBoosts || []).map((b, idx) => (
                          <div key={idx} style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', marginBottom:8 }}>
                            <input type="date" value={(b.dateFrom || '').replace(/\//g,'-')}
                              onChange={e => setSettings(s => { const list=[...s.capacityBoosts]; list[idx]={...list[idx], dateFrom:e.target.value}; return {...s, capacityBoosts:list} })}
                              style={{ padding:'8px 10px', border:'1px solid #ddd', borderRadius:6, fontSize:13 }} />
                            <span style={{ fontSize:12, color:'#888' }}>〜</span>
                            <input type="date" value={(b.dateTo || '').replace(/\//g,'-')}
                              onChange={e => setSettings(s => { const list=[...s.capacityBoosts]; list[idx]={...list[idx], dateTo:e.target.value}; return {...s, capacityBoosts:list} })}
                              style={{ padding:'8px 10px', border:'1px solid #ddd', borderRadius:6, fontSize:13 }} />
                            <input type="number" min="1" value={b.extraSeats} placeholder={`+数（${settings.countUnit || '名'}）`}
                              onChange={e => setSettings(s => { const list=[...s.capacityBoosts]; list[idx]={...list[idx], extraSeats:parseInt(e.target.value,10)||0}; return {...s, capacityBoosts:list} })}
                              style={{ width:80, padding:'8px 10px', border:'1px solid #ddd', borderRadius:6, fontSize:13 }} />
                            <input type="text" value={b.reason || ''} placeholder="理由（任意）"
                              onChange={e => setSettings(s => { const list=[...s.capacityBoosts]; list[idx]={...list[idx], reason:e.target.value}; return {...s, capacityBoosts:list} })}
                              style={{ flex:'1 1 140px', padding:'8px 10px', border:'1px solid #ddd', borderRadius:6, fontSize:13 }} />
                            <button onClick={() => { if (window.confirm('この増席枠を削除します。よろしいですか？')) setSettings(s => ({ ...s, capacityBoosts: s.capacityBoosts.filter((_,i)=>i!==idx) })) }} style={btnGray}>削除</button>
                          </div>
                        ))}
                        <button onClick={() => setSettings(s => ({ ...s, capacityBoosts: [...(s.capacityBoosts || []), { dateFrom:'', dateTo:'', extraSeats:1, reason:'' }] }))}
                          style={{ ...btnGray, fontSize:13 }}>
                          ＋ 増枠を追加
                        </button>
                      </div>
                    </>
                  )}

                  <div style={{ marginTop:16, paddingTop:14, borderTop:'1px solid #eee' }}>
                    <label style={{ fontSize:13, color:'#555', display:'block', marginBottom:6 }}>残数の数え方</label>
                    <CustomSelect value={settings.capacityModel || 'daily'}
                      onChange={e => {
                        const next = e.target.value
                        const cur = settings.capacityModel || 'daily'
                        if (next === cur) return
                        const ok = window.confirm(`残数の数え方を変更します。すでに入っている予約は変更前のルールで登録されているため、切り替え直後は残数の数え方と実際の予約内容がズレる場合があります（特に「${settings.staffLabel || '担当者'}単位」への切り替えは、既存予約に${settings.staffLabel || '担当者'}の指定が無いと空き状況の判定に影響します）。よろしいですか？`)
                        if (!ok) return
                        setSettings(s => ({ ...s, capacityModel: next }))
                      }}
                      style={{ ...sStyle, width:260 }}>
                      <option value="daily">1日単位（来店時間を問わず合計人数で管理）</option>
                      <option value="timeSlot">時間帯単位（滞在時間が重なる予約だけを集計）</option>
                      <option value="perStaff">担当者単位（席数ではなく担当者ごとの空き時間で管理）</option>
                    </CustomSelect>
                    <div style={{ fontSize:11, color:'#aaa', marginTop:6 }}>
                      「1日単位」は少人数・長時間滞在の店（貝屋和光の既定）向けです。回転寿司・カジュアルチェーンのように1日に何度も席が入れ替わる業態は「時間帯単位」を選ぶと、実際には空いている時間帯まで満席と表示されるのを防げます。
                      「担当者単位」は美容室（スタイリスト）・整備工場（整備士・リフト）・病院（医師）・面接（面接官）等、店全体の席数ではなく「担当者1人（または1リフト等）が同時に何件対応できるか」で予約可否が決まる業態向けです。この場合、上の「{settings.staffLabel || '担当者'}の指名機能」を必ずONにし、{settings.staffLabel || '担当者'}一覧に登録した名前・同時対応可能数が実際の予約可否の判定に使われます（お客様が「指名なし」を選んだ場合は、空いている{settings.staffLabel || '担当者'}に自動で割り当てます）。
                    </div>
                    {settings.capacityModel === 'perStaff' && settings.staffRoster.length === 0 && (
                      <div style={{ marginTop:10, padding:'10px 14px', background:'#ffebee', border:'1px solid #ffcdd2', borderRadius:8, fontSize:12, color:'#c62828', fontWeight:'bold' }}>
                        ⚠️ {settings.staffLabel || '担当者'}一覧が空です。このままではお客様の予約が全て「対応不可」になります。上の「{settings.staffLabel || '担当者'}の指名機能」をONにして、{settings.staffLabel || '担当者'}一覧に最低1{settings.countUnit || '名'}登録してください。
                      </div>
                    )}
                  </div>

                  {settings.capacityModel !== 'perStaff' && (
                    <div style={{ marginTop:16, paddingTop:14, borderTop:'1px solid #eee' }}>
                      <label style={{ fontSize:13, color:'#555', display:'block', marginBottom:6 }}>カレンダーの数量表記が読み取れなかった時の数</label>
                      <CustomSelect value={settings.unparseableGuestFallback || 8}
                        onChange={e => setSettings(s => ({ ...s, unparseableGuestFallback: parseInt(e.target.value,10)||8 }))}
                        style={{ ...sStyle, width:120 }}>
                        {[1,2,3,4,5,6,8,10,12,16,20,24,30].map(n => <option key={n} value={n}>{n}{settings.countUnit || '名'}</option>)}
                      </CustomSelect>
                      <div style={{ fontSize:11, color:'#aaa', marginTop:6 }}>
                        スタッフが手動でカレンダーに予定を入れた際、数量の書き方が想定と違って読み取れなかった場合、安全側に倒すため一旦この数として集計します（実際の数とズレる可能性があるため、その日の詳細画面に警告が出ます）。最大受付数と同じか、それより少し多い数値にしておくのが安全です。
                      </div>
                    </div>
                  )}
                </div>

                {/* 受付可能時間帯 */}
                <div style={{ background:'#fff', borderRadius:12, padding:20, marginBottom:12, boxShadow:'0 1px 3px rgba(0,0,0,.08)' }}>
                  <h2 style={{ fontSize:15, fontWeight:'bold', marginBottom:6 }}>受付可能時間帯（デフォルト）</h2>
                  <div style={{ fontSize:12, color:'#888', marginBottom:14 }}>
                    営業時間の優先順位：①予約一覧の日付詳細から設定する「営業時間変更（この日だけ）」（最優先）＞②下の「曜日別営業時間」＞③この「デフォルト」（最も優先度が低い基本設定）
                  </div>
                  {defTimeRanges.map((def, i) => {
                    const tr = (settings.timeRanges||[])[i] || def
                    return (
                      <div key={def.type} style={{ display:'flex', gap:10, alignItems:'center', marginBottom:10, flexWrap:'wrap' }}>
                        <span style={{ fontSize:13, fontWeight:'bold', color:'#555', width:52, flexShrink:0 }}>{def.label}</span>
                        <TimeSelect value={tr.start} onChange={e=>setSettings(s=>{ const a=[...(s.timeRanges||defTimeRanges)]; a[i]={...a[i],start:e.target.value}; return {...s,timeRanges:a} })} />
                        <span style={{ fontSize:13, color:'#888' }}>〜</span>
                        <TimeSelect value={tr.end} onChange={e=>setSettings(s=>{ const a=[...(s.timeRanges||defTimeRanges)]; a[i]={...a[i],end:e.target.value}; return {...s,timeRanges:a} })} />
                      </div>
                    )
                  })}
                </div>

                {/* 曜日別営業時間 */}
                <div style={{ background:'#fff', borderRadius:12, padding:20, marginBottom:12, boxShadow:'0 1px 3px rgba(0,0,0,.08)' }}>
                  <h2 style={{ fontSize:15, fontWeight:'bold', marginBottom:6 }}>曜日別営業時間</h2>
                  <div style={{ fontSize:12, color:'#888', marginBottom:14 }}>設定した曜日は上の「デフォルト」より優先されます（ただし予約一覧から個別に設定した「営業時間変更（この日だけ）」がある日は、それが最優先されます）</div>
                  <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
                    <thead>
                      <tr style={{ borderBottom:'2px solid #f0f0f0' }}>
                        <th style={{ textAlign:'left', padding:'6px 8px', color:'#888', fontWeight:'normal', width:40 }}>曜</th>
                        <th style={{ padding:'6px 8px', color:'#888', fontWeight:'normal' }}>ランチ</th>
                        <th style={{ padding:'6px 8px', color:'#888', fontWeight:'normal' }}>ディナー</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[['0','日'],['1','月'],['2','火'],['3','水'],['4','木'],['5','金'],['6','土']].map(([key,label]) => {
                        const dh = (settings.dailyHours||defDailyHours)[key] || defDailyHours[key]
                        const setDH = (patch) => setSettings(s => ({ ...s, dailyHours: { ...(s.dailyHours||defDailyHours), [key]: { ...dh, ...patch } } }))
                        const isDow0or6 = key==='0'||key==='6'
                        return (
                          <tr key={key} style={{ borderBottom:'1px solid #f0f0f0' }}>
                            <td style={{ padding:'8px', fontWeight:'bold', color: key==='0'||key==='6' ? '#e53935' : '#333' }}>{label}</td>
                            <td style={{ padding:'6px 4px' }}>
                              <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
                                <label style={{ display:'flex', alignItems:'center', gap:4, fontSize:12 }}>
                                  <input type="checkbox" checked={dh.lunchEnabled} onChange={e=>setDH({lunchEnabled:e.target.checked})} />
                                  営業
                                </label>
                                {dh.lunchEnabled && <>
                                  <TimeSelect value={dh.lunchStart} onChange={e=>setDH({lunchStart:e.target.value})} />
                                  <span style={{ fontSize:11, color:'#888' }}>〜</span>
                                  <TimeSelect value={dh.lunchEnd} onChange={e=>setDH({lunchEnd:e.target.value})} />
                                </>}
                              </div>
                            </td>
                            <td style={{ padding:'6px 4px' }}>
                              <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
                                <label style={{ display:'flex', alignItems:'center', gap:4, fontSize:12 }}>
                                  <input type="checkbox" checked={dh.dinnerEnabled} onChange={e=>setDH({dinnerEnabled:e.target.checked})} />
                                  営業
                                </label>
                                {dh.dinnerEnabled && <>
                                  <TimeSelect value={dh.dinnerStart} onChange={e=>setDH({dinnerStart:e.target.value})} />
                                  <span style={{ fontSize:11, color:'#888' }}>〜</span>
                                  <TimeSelect value={dh.dinnerEnd} onChange={e=>setDH({dinnerEnd:e.target.value})} />
                                </>}
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {/* 受付締め切りルール */}
                <div style={{ background:'#fff', borderRadius:12, padding:20, marginBottom:12, boxShadow:'0 1px 3px rgba(0,0,0,.08)' }}>
                  <h2 style={{ fontSize:15, fontWeight:'bold', marginBottom:14 }}>受付締め切りルール（曜日別）</h2>
                  <div style={{ fontSize:12, color:'#888', marginBottom:12 }}>来店日の何日前の何時まで受付するかを曜日ごとに設定します</div>
                  <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
                    <thead>
                      <tr style={{ borderBottom:'2px solid #f0f0f0' }}>
                        <th style={{ textAlign:'left', padding:'6px 8px', color:'#888', fontWeight:'normal', width:60 }}>曜日</th>
                        <th style={{ textAlign:'left', padding:'6px 8px', color:'#888', fontWeight:'normal' }}>何日前まで</th>
                        <th style={{ textAlign:'left', padding:'6px 8px', color:'#888', fontWeight:'normal' }}>締め切り時刻</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[['0','日'],['1','月'],['2','火'],['3','水'],['4','木'],['5','金'],['6','土'],['holiday','祝']].map(([key,label]) => {
                        const rule = (settings.cutoffRules||{})[key] || { daysBefore:2, time:'22:00' }
                        return (
                          <tr key={key} style={{ borderBottom:'1px solid #f5f5f5' }}>
                            <td style={{ padding:'8px 8px', fontWeight:'bold', color: key==='0'||key==='6'||key==='holiday' ? '#e53935' : '#333' }}>{label}</td>
                            <td style={{ padding:'6px 8px' }}>
                              <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                                <CustomSelect value={rule.daysBefore} style={{ ...sStyle, width:65, padding:'5px 6px', fontSize:12 }}
                                  onChange={e=>setSettings(s=>({...s, cutoffRules:{...s.cutoffRules, [key]:{...rule, daysBefore:parseInt(e.target.value)||1}}}))} >
                                  {[1,2,3,4,5,6,7].map(n=><option key={n} value={n}>{n}日前</option>)}
                                </CustomSelect>
                              </div>
                            </td>
                            <td style={{ padding:'6px 8px' }}>
                              <TimeSelect value={rule.time} onChange={e=>setSettings(s=>({...s, cutoffRules:{...s.cutoffRules, [key]:{...rule, time:e.target.value}}}))} />
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {/* コースメニュー */}
                <div style={{ background:'#fff', borderRadius:12, padding:20, marginBottom:12, boxShadow:'0 1px 3px rgba(0,0,0,.08)' }}>
                  <h2 style={{ fontSize:15, fontWeight:'bold', marginBottom:6 }}>{settings.itemLabel || 'コース'}メニュー</h2>
                  {settings.bookingMode === 'simple' && (
                    <div style={{ fontSize:11, color:'#aaa', marginBottom:12 }}>
                      「コース選択の有無」が「コース無し」のため、ここで登録しても<strong>お客様の予約画面には表示されません</strong>。スタッフが予約一覧から手動でご予約を登録する際に選択肢として使う場合のみ登録してください（不要なら空のままで構いません）。
                    </div>
                  )}
                  {settings.courses.length === 0 ? (
                    <div style={{ textAlign:'center', padding:'16px 0', color:'#aaa', fontSize:13 }}>{settings.itemLabel || 'コース'}が登録されていません</div>
                  ) : (
                    settings.courses.map((c,idx) => (
                      <div key={idx} style={{ borderBottom: idx<settings.courses.length-1 ? '1px solid #f0f0f0':'none', paddingBottom:12, marginBottom:12 }}>
                        {editCourseIdx===idx ? (
                          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                            <Field label={`${settings.itemLabel || 'コース'}名`}><input type="text" value={editCourse.name} style={iStyle} onChange={e=>setEditCourse(c=>({...c,name:e.target.value}))} /></Field>
                            <Field label="価格（税込・円）"><input type="number" value={editCourse.price} style={iStyle} onChange={e=>setEditCourse(c=>({...c,price:parseInt(e.target.value)||0}))} /></Field>
                            <Field label="説明文" span><input type="text" value={editCourse.description} style={iStyle} onChange={e=>setEditCourse(c=>({...c,description:e.target.value}))} /></Field>
                            <Field label="所要時間（分）※1439分（24時間)未満のみ対応"><input type="number" max="1439" value={editCourse.duration} style={iStyle} onChange={e=>setEditCourse(c=>({...c,duration:parseInt(e.target.value)||0}))} /></Field>
                            <Field label="食事タイプ">
                              <CustomSelect value={editCourse.mealType||'dinner'} style={sStyle} onChange={e=>setEditCourse(c=>({...c,mealType:e.target.value}))}>
                                <option value="lunch">ランチ</option>
                                <option value="dinner">ディナー</option>
                                <option value="both">共通</option>
                              </CustomSelect>
                            </Field>
                            <Field label="写真URL（任意）" span><input type="text" value={editCourse.imageUrl||''} placeholder="https://example.com/photo.jpg" style={iStyle} onChange={e=>setEditCourse(c=>({...c,imageUrl:e.target.value}))} /></Field>
                            <div style={{ gridColumn:'1/-1', display:'flex', gap:8, marginTop:4 }}>
                              <button onClick={() => { const cs=[...settings.courses]; cs[idx]={...editCourse}; setSettings(s=>({...s,courses:cs})); setEditCourseIdx(-1) }}
                                style={{ padding:'8px 18px', background:'#06c755', color:'#fff', border:'none', borderRadius:8, fontSize:13, cursor:'pointer' }}>保存</button>
                              <button onClick={() => setEditCourseIdx(-1)} style={btnGray}>キャンセル</button>
                            </div>
                          </div>
                        ) : (
                          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12, opacity: c.discontinued ? 0.5 : 1 }}>
                            <div style={{ display:'flex', gap:10 }}>
                              {c.imageUrl && (
                                <img src={c.imageUrl} alt={c.name} style={{ width:48, height:48, borderRadius:8, objectFit:'cover', flexShrink:0 }}
                                  onError={e => { e.target.style.display = 'none' }} />
                              )}
                              <div>
                              <div style={{ fontSize:14, fontWeight:'bold' }}>{c.name}
                                <span style={{ marginLeft:8, fontSize:11, padding:'1px 8px', borderRadius:10, fontWeight:'normal',
                                  background: c.mealType==='lunch'?'#fff3e0':c.mealType==='both'?'#f3e5f5':'#e3f2fd',
                                  color: c.mealType==='lunch'?'#e65100':c.mealType==='both'?'#6a1b9a':'#1565c0' }}>
                                  {c.mealType==='lunch'?'ランチ':c.mealType==='both'?'共通':'ディナー'}
                                </span>
                                {c.discontinued && (
                                  <span style={{ marginLeft:6, fontSize:11, padding:'1px 8px', borderRadius:10, background:'#f5f5f5', color:'#999', fontWeight:'normal' }}>廃止中</span>
                                )}
                              </div>
                              <div style={{ fontSize:13, color:'#06c755', marginTop:2 }}>¥{Number(c.price).toLocaleString()}（税込）</div>
                              {c.description && <div style={{ fontSize:12, color:'#888', marginTop:2 }}>{c.description}</div>}
                              <div style={{ fontSize:12, color:'#aaa', marginTop:2 }}>約{c.duration}分</div>
                              </div>
                            </div>
                            <div style={{ display:'flex', gap:6, flexShrink:0 }}>
                              {!c.discontinued && (
                                <button onClick={() => { setEditCourse({...c}); setEditCourseIdx(idx) }} style={btnBlue}>編集</button>
                              )}
                              <button
                                onClick={() => setSettings(s=>({...s, courses:s.courses.map((x,i)=>i===idx?{...x,discontinued:!x.discontinued}:x)}))}
                                style={c.discontinued ? {...btnGreen, padding:'6px 14px', fontSize:12} : {...btnRed}}>
                                {c.discontinued ? '復活' : '廃止'}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))
                  )}

                  {showAddCourse ? (
                    <div style={{ marginTop:12, padding:14, background:'#f0fff4', border:'1px solid #b2ecc8', borderRadius:8 }}>
                      <h3 style={{ fontSize:13, fontWeight:'bold', marginBottom:10 }}>{settings.itemLabel || 'コース'}を追加</h3>
                      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                        <Field label={`${settings.itemLabel || 'コース'}名`}><input type="text" value={newCourse.name} placeholder="例：季節の貝フルコース" style={iStyle} onChange={e=>setNewCourse(c=>({...c,name:e.target.value}))} /></Field>
                        <Field label="価格（税込・円）"><input type="number" value={newCourse.price} placeholder="11000" style={iStyle} onChange={e=>setNewCourse(c=>({...c,price:e.target.value}))} /></Field>
                        <Field label="説明文" span><input type="text" value={newCourse.description} placeholder="旬の貝と野菜をふんだんに使ったコースメニュー" style={iStyle} onChange={e=>setNewCourse(c=>({...c,description:e.target.value}))} /></Field>
                        <Field label="所要時間（分）※1439分（24時間)未満のみ対応"><input type="number" max="1439" value={newCourse.duration} placeholder="150" style={iStyle} onChange={e=>setNewCourse(c=>({...c,duration:e.target.value}))} /></Field>
                        <Field label="食事タイプ">
                          <CustomSelect value={newCourse.mealType||'dinner'} style={sStyle} onChange={e=>setNewCourse(c=>({...c,mealType:e.target.value}))}>
                            <option value="lunch">ランチ</option>
                            <option value="dinner">ディナー</option>
                            <option value="both">共通</option>
                          </CustomSelect>
                        </Field>
                        <Field label="写真URL（任意）" span><input type="text" value={newCourse.imageUrl} placeholder="https://example.com/photo.jpg" style={iStyle} onChange={e=>setNewCourse(c=>({...c,imageUrl:e.target.value}))} /></Field>
                        <div style={{ gridColumn:'1/-1', display:'flex', gap:8, marginTop:4 }}>
                          <button onClick={() => {
                            if (!newCourse.name) return
                            setSettings(s=>({...s, courses:[...s.courses,{name:newCourse.name,price:parseInt(newCourse.price)||0,description:newCourse.description,duration:parseInt(newCourse.duration)||150,mealType:newCourse.mealType||'dinner',imageUrl:newCourse.imageUrl||''}]}))
                            setNewCourse({name:'',price:'',description:'',duration:150,mealType:'dinner',imageUrl:''})
                            setShowAddCourse(false)
                          }} style={{ padding:'8px 18px', background:'#06c755', color:'#fff', border:'none', borderRadius:8, fontSize:13, cursor:'pointer' }}>追加する</button>
                          <button onClick={() => setShowAddCourse(false)} style={btnGray}>キャンセル</button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => setShowAddCourse(true)}
                      style={{ marginTop:12, width:'100%', padding:12, background:'#f0fff4', color:'#06c755', border:'1.5px dashed #06c755', borderRadius:8, fontSize:13, fontWeight:'bold', cursor:'pointer' }}>
                      ＋ {settings.itemLabel || 'コース'}を追加
                    </button>
                  )}
                </div>

                {/* 予約注意事項 */}
                <div style={{ background:'#fff', borderRadius:12, padding:20, marginBottom:12, boxShadow:'0 1px 3px rgba(0,0,0,.08)' }}>
                  <h2 style={{ fontSize:15, fontWeight:'bold', marginBottom:6 }}>予約確認時の注意事項・キャンセルポリシー</h2>
                  <p style={{ fontSize:12, color:'#888', marginBottom:12, lineHeight:1.6 }}>
                    予約確認画面でポップアップ表示されます。予約確認通知（LINE）にも送信されます。
                  </p>
                  <textarea
                    value={settings.bookingNotes||''}
                    onChange={e => setSettings(s=>({...s, bookingNotes:e.target.value}))}
                    placeholder={'例：\n⚠️ キャンセルポリシー\n\n当店は完全予約式です。\n\n来店2日前22:00まで：キャンセル料0%\n前日22:00まで：50%\n当日以降：100%\n\nご不明な点はお電話ください。'}
                    rows={10}
                    style={{ ...iStyle, resize:'vertical', lineHeight:1.7 }} />
                </div>

                <button disabled={settingsSaving} onClick={doSaveSettings}
                  style={{ width:'100%', padding:15, background:'#06c755', color:'#fff', border:'none', borderRadius:12, fontSize:15, fontWeight:'bold', cursor:'pointer', opacity:settingsSaving?0.7:1 }}>
                  {settingsSaving?'保存中...':'設定を保存する'}
                </button>

                {/* パスワード変更 */}
                <div style={{ background:'#fff', borderRadius:12, padding:20, marginTop:12, boxShadow:'0 1px 3px rgba(0,0,0,.08)' }}>
                  <h2 style={{ fontSize:15, fontWeight:'bold', marginBottom:14 }}>管理パスワード変更</h2>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:12 }}>
                    <Field label="現在のパスワード">
                      <input type="password" value={pwCurrent} style={iStyle} onChange={e=>{ setPwCurrent(e.target.value); setPwMsg({text:'',ok:true}) }} />
                    </Field>
                    <Field label="新しいパスワード">
                      <input type="password" value={pwNew} placeholder="8文字以上" style={iStyle} onChange={e=>{ setPwNew(e.target.value); setPwMsg({text:'',ok:true}) }} />
                    </Field>
                  </div>
                  {pwMsg.text && (
                    <div style={{ marginBottom:10, padding:'8px 12px', borderRadius:8, fontSize:13,
                      background: pwMsg.ok ? '#e8f5e9' : '#fff0f0',
                      color: pwMsg.ok ? '#2e7d32' : '#e53935' }}>
                      {pwMsg.text}
                    </div>
                  )}
                  <button disabled={pwChanging} onClick={async () => {
                    setPwChanging(true); setPwMsg({text:'',ok:true})
                    try {
                      const r = await api.changeAdminPassword(pwCurrent, pwNew)
                      if (r.success) {
                        setPwMsg({text:'パスワードを変更しました',ok:true})
                        sessionStorage.setItem('adminPw', pwNew)
                        setAdminPassword(pwNew)
                        setPwCurrent(''); setPwNew('')
                      }
                      else setPwMsg({text:r.error||'変更に失敗しました',ok:false})
                    } catch { setPwMsg({text:'通信エラーが発生しました。もう一度お試しください',ok:false}) }
                    setPwChanging(false)
                  }} style={{ ...btnGreen, opacity:pwChanging?0.7:1 }}>
                    {pwChanging?'変更中...':'パスワードを変更する'}
                  </button>
                  <div style={{ marginTop:20, paddingTop:16, borderTop:'1px solid #f0f0f0' }}>
                    <div style={{ fontSize:13, fontWeight:'bold', marginBottom:10, color:'#555' }}>秘密の合言葉の変更</div>
                    <p style={{ fontSize:12, color:'#888', marginBottom:10, lineHeight:1.6 }}>
                      {/* 以前はここに旧初期値（質問「カイヤ貝屋の合言葉は？」／答え「KAIYA」）をそのまま
                          表示していた。この文字列はログイン不要のフロントエンドJSバンドルに平文で含まれるため
                          未認証の誰でも読める上、Code.gs側の対応する既定値はラウンド25で「推測不可能な
                          ランダム値にfail-close」する実装に変更済みで、この案内文は既に事実と異なる
                          （Microsoft CEO視点レビュー・ラウンド25の指摘）。実在しない既定値を案内し続ける
                          代わりに、未設定時の安全な挙動を説明する文言に差し替える。 */}
                      パスワードを忘れた際のリセットに使う「秘密の質問と答え」です。<br />
                      未設定の間はこの機能自体が無効（誰の答えでもリセットできません）。使うには質問・答えを設定してください。
                    </p>
                    <div style={{ display:'grid', gap:10, marginBottom:10 }}>
                      <Field label="現在のパスワード（確認）">
                        <input type="password" value={rcCurrent} style={iStyle} onChange={e=>{ setRcCurrent(e.target.value); setRcMsg({text:'',ok:true}) }} />
                      </Field>
                      <Field label="新しい質問文">
                        <input type="text" value={qaQuestion} placeholder="例：好きな食べ物は？" style={iStyle} onChange={e=>{ setQaQuestion(e.target.value); setRcMsg({text:'',ok:true}) }} />
                      </Field>
                      <Field label="新しい答え">
                        <input type="text" value={qaAnswer} placeholder="例：貝" style={iStyle} onChange={e=>{ setQaAnswer(e.target.value); setRcMsg({text:'',ok:true}) }} />
                      </Field>
                    </div>
                    {rcMsg.text && (
                      <div style={{ marginBottom:10, padding:'8px 12px', borderRadius:8, fontSize:13,
                        background: rcMsg.ok ? '#e8f5e9' : '#fff0f0',
                        color: rcMsg.ok ? '#2e7d32' : '#e53935' }}>
                        {rcMsg.text}
                      </div>
                    )}
                    <button disabled={rcChanging} onClick={async () => {
                      setRcChanging(true); setRcMsg({text:'',ok:true})
                      try {
                        const r = await api.changeRecoveryQA(rcCurrent, qaQuestion, qaAnswer)
                        if (r.success) { setRcMsg({text:'秘密の合言葉を変更しました',ok:true}); setRcCurrent(''); setQaQuestion(''); setQaAnswer('') }
                        else setRcMsg({text:r.error||'変更に失敗しました',ok:false})
                      } catch { setRcMsg({text:'通信エラーが発生しました。もう一度お試しください',ok:false}) }
                      setRcChanging(false)
                    }} style={{ ...btnGray, fontSize:13 }}>
                      {rcChanging?'変更中...':'合言葉を変更する'}
                    </button>
                  </div>
                </div>

                {/* データ管理 */}
                <div style={{ background:'#fff', borderRadius:12, padding:20, marginTop:12, boxShadow:'0 1px 3px rgba(0,0,0,.08)' }}>
                  <h2 style={{ fontSize:15, fontWeight:'bold', marginBottom:6 }}>データ管理</h2>
                  <p style={{ fontSize:12, color:'#888', marginBottom:16, lineHeight:1.6 }}>
                    ダウンロードしたファイルはExcel・Numbersで開けます。データが多い場合は少し時間がかかります。
                  </p>

                  {/* 顧客データ */}
                  <div style={{ padding:16, background:'#f8fffe', border:'1px solid #c8e6c9', borderRadius:10, marginBottom:12 }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:10 }}>
                      <div>
                        <div style={{ fontWeight:'bold', fontSize:13, marginBottom:3 }}>顧客データ</div>
                        <div style={{ fontSize:12, color:'#888' }}>氏名・電話・来店回数・LINEプロフィールなど</div>
                      </div>
                      <button disabled={custLoading} onClick={async () => {
                        setCustLoading(true)
                        try {
                          const r = await api.adminGetCustomerData()
                          const list = r.list || []
                          if (!list.length) { showToast('顧客データが0件です','error'); setCustLoading(false); return }
                          const rows = list.map(c => ({
                            '表示名（LINE）': c.displayName||'',
                            '登録名': c.name||'',
                            '電話番号': c.phone||'',
                            '来店回数': c.visitCount||0,
                            '無断キャンセル回数': c.noShowCount||0,
                            '初回来店日': c.firstVisit||'',
                            '最終来店日': c.lastVisit||'',
                            '登録日時': c.registeredAt||'',
                            'LINE UserID': c.lineUserId||'',
                            'プロフィール画像URL': c.pictureUrl||'',
                          }))
                          dlXlsx(rows, '顧客データ', 'customers.xlsx')
                          showToast('顧客データをダウンロードしました（'+list.length+'件）')
                        } catch { showToast('通信エラーが発生しました。もう一度お試しください','error') }
                        setCustLoading(false)
                      }} style={{ ...btnGreen, whiteSpace:'nowrap' }}>
                        {custLoading ? '取得中...' : '📥 Excelダウンロード'}
                      </button>
                    </div>
                  </div>

                  {/* 予約データ */}
                  <div style={{ padding:16, background:'#f3f8ff', border:'1px solid #bbdefb', borderRadius:10 }}>
                    <div style={{ fontWeight:'bold', fontSize:13, marginBottom:3 }}>予約データ（アーカイブ含む）</div>
                    <div style={{ fontSize:12, color:'#888', marginBottom:12 }}>期間を選択してダウンロード（空欄=全期間）</div>
                    <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', marginBottom:10 }}>
                      <input type="date" value={allResDateFrom} onChange={e=>setAllResDateFrom(e.target.value)}
                        style={{ ...iStyle, width:150, fontSize:13 }} />
                      <span style={{ fontSize:13, color:'#888' }}>〜</span>
                      <input type="date" value={allResDateTo} onChange={e=>setAllResDateTo(e.target.value)}
                        style={{ ...iStyle, width:150, fontSize:13 }} />
                    </div>
                    <button disabled={allResLoading} onClick={async () => {
                      setAllResLoading(true)
                      const filter = {}
                      if (allResDateFrom) filter.dateFrom = allResDateFrom.replace(/-/g,'/')
                      if (allResDateTo)   filter.dateTo   = allResDateTo.replace(/-/g,'/')
                      try {
                        const r = await api.adminGetAllReservations(filter)
                        const list = r.list || []
                        if (!list.length) { showToast('該当期間の予約データが0件です','error'); setAllResLoading(false); return }
                        const rows = list.map(res => ({
                          '予約日': res.date||'',
                          '時間': formatTime(res.time)||'',
                          '終了時間': formatTime(res.endTime)||'',
                          'お名前': res.name||'',
                          '電話番号': res.phone||'',
                          '人数': res.guests||'',
                          [settings.itemLabel || 'コース']: res.course||'',
                          'ステータス': res.status||'',
                          '経路': res.source||'',
                          'メモ': res.notes||'',
                          '登録日時': res.createdAt||'',
                          '予約ID': res.id||'',
                        }))
                        const label = (allResDateFrom||'') + (allResDateFrom&&allResDateTo?'〜':'') + (allResDateTo||'') || '全期間'
                        dlXlsx(rows, '予約データ', 'reservations_'+label+'.xlsx')
                        showToast('予約データをダウンロードしました（'+list.length+'件）')
                      } catch { showToast('通信エラーが発生しました。もう一度お試しください','error') }
                      setAllResLoading(false)
                    }} style={{ ...btnGreen, whiteSpace:'nowrap' }}>
                      {allResLoading ? '取得中...' : '📥 Excelダウンロード'}
                    </button>
                  </div>
                </div>

              </>
            )}
          </div>
        )}

        {/* ─── TAB: 通知設定 ────────────────────────────────────────── */}
        {tab==='notif-settings' && (
          <div>
            {notifSettingsLoading ? (
              <div style={{ textAlign:'center', padding:40, color:'#aaa' }}>読み込み中...</div>
            ) : (
              <>
                {/* グループ説明 */}
                <div style={{ background:'#fff', borderRadius:12, padding:20, marginBottom:12, boxShadow:'0 1px 3px rgba(0,0,0,.08)' }}>
                  <h2 style={{ fontSize:15, fontWeight:'bold', marginBottom:14 }}>通知グループ</h2>
                  <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
                    <div style={{ flex:1, minWidth:200, padding:14, background:'#f3f8ff', border:'1px solid #bbdefb', borderRadius:10 }}>
                      <div style={{ fontWeight:'bold', fontSize:13, marginBottom:4 }}>グループ A</div>
                      <div style={{ fontSize:12, color:'#555' }}>{settings.groupADescription || '少人数の管理者グループ'}</div>
                    </div>
                    <div style={{ flex:1, minWidth:200, padding:14, background:'#f8fffe', border:'1px solid #c8e6c9', borderRadius:10 }}>
                      <div style={{ fontWeight:'bold', fontSize:13, marginBottom:4 }}>
                        グループ B
                        {/* 常連バッジ（オレンジ）と同じ色だと、同じ「オレンジ＝要注意」の意味が2つの
                            無関係な文脈（来店履歴／設定状態）で衝突するため、ニュートラルな青系にする
                            （Appleデザインチーム視点レビューでの指摘） */}
                        {!settings.hasGroupB && (
                          <span style={{ marginLeft:8, fontSize:10, fontWeight:'bold', color:'#1565c0', background:'#e3f2fd', padding:'2px 8px', borderRadius:10 }}>未設定</span>
                        )}
                      </div>
                      <div style={{ fontSize:12, color:'#555' }}>{settings.groupBDescription || 'スタッフ全員グループ'}</div>
                      {!settings.hasGroupB && (
                        <div style={{ fontSize:11, color:'#1565c0', marginTop:4 }}>未設定のため、新規予約等の通知は現在すべてグループAに届いています。下の「グループBの設定」から設定できます。</div>
                      )}
                    </div>
                  </div>
                  {/* グループBを未設定のままだとグループAに通知が全部届く（後方互換の既定動作）。
                      Botを新しいLINEグループに招待して何かメッセージを送ると、そのグループIDが
                      「候補」として自動的に記録される（パスワード不要・無害）。ここで内容を確認し、
                      問題なければグループBとして確定できる（以前はGASエディタを直接操作しないと
                      できず、非技術者には事実上使えなかった＝Meta/Microsoft CEO視点レビューでの指摘）。 */}
                  <div style={{ marginTop:14, padding:14, background:'#fafafa', border:'1px solid #eee', borderRadius:10 }}>
                    <div style={{ fontWeight:'bold', fontSize:13, marginBottom:6 }}>グループBの設定</div>
                    <div style={{ fontSize:12, color:'#777', marginBottom:10 }}>
                      グループBにしたいLINEグループにBotを招待し、そのグループで何かメッセージを送信してください。しばらくすると下に候補が表示されます。
                    </div>
                    {capturedGroupIdLoading ? (
                      <div style={{ fontSize:12, color:'#aaa' }}>確認中...</div>
                    ) : capturedGroupId ? (
                      <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
                        <span style={{ fontSize:12, color:'#555' }}>候補のグループID：<code style={{ background:'#eee', padding:'2px 6px', borderRadius:4 }}>{capturedGroupId}</code></span>
                        <button onClick={confirmGroupB} disabled={settingGroupB} style={{ ...btnGreen, fontSize:12, padding:'6px 14px' }}>
                          {settingGroupB ? '設定中...' : 'この候補をグループBに設定'}
                        </button>
                      </div>
                    ) : (
                      <div style={{ fontSize:12, color:'#aaa' }}>候補はまだありません（Botを招待したグループでメッセージを送ってから、このタブを開き直してください）</div>
                    )}
                  </div>
                </div>

                {/* 一括操作 */}
                <div style={{ background:'#fff', borderRadius:12, padding:16, marginBottom:12, boxShadow:'0 1px 3px rgba(0,0,0,.08)' }}>
                  <div style={{ fontSize:13, fontWeight:'bold', marginBottom:10, color:'#555' }}>一括操作</div>
                  <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                    <button onClick={() => {
                      const next = {}
                      Object.keys(notifSettings).forEach(k => { next[k] = { ...notifSettings[k], enabled: true } })
                      setNotifSettings(next)
                    }} style={{ ...btnGray, fontSize:12 }}>全てON</button>
                    <button onClick={() => {
                      const next = {}
                      Object.keys(notifSettings).forEach(k => { next[k] = { ...notifSettings[k], enabled: false } })
                      setNotifSettings(next)
                    }} style={{ ...btnGray, fontSize:12 }}>全てOFF</button>
                    {(settings.storeSpecificNotifSections || []).length > 0 && (
                      <button onClick={() => {
                        // 「デフォルトに戻す」と同じ一括操作エリアに並ぶボタンだが確認ダイアログが無く、
                        // 誤って押すと新規予約通知等の基本通知が全て無音でOFFになる（Meta CEO視点レビュー・
                        // ラウンド26、審判団6人中4人が最優先で指摘）。他の破壊的な一括操作と同じ確認を追加する。
                        if (!window.confirm('【テスト用】店舗固有セクション以外の通知（新規予約・変更・キャンセル等の基本通知を含む）を全てOFFにします。本番運用中は誤って保存しないよう注意してください。よろしいですか？')) return
                        const specificKeys = (settings.storeSpecificNotifSections || []).flatMap(s => s.rows.map(r => r.key))
                        const next = {}
                        Object.keys(DEFAULT_NOTIF_SETTINGS).forEach(k => {
                          next[k] = { enabled: specificKeys.includes(k), target: notifSettings[k]?.target || 'B' }
                        })
                        setNotifSettings(next)
                      }} style={{ ...btnGray, fontSize:12, color:'#e65100', borderColor:'#ffe0b2', background:'#fff8f0' }}>
                        テスト用（店舗固有セクションのみON）
                      </button>
                    )}
                    <button onClick={() => { if (window.confirm('通知先の設定を全て初期状態に戻します（保存するまでは反映されません）。よろしいですか？')) setNotifSettings(DEFAULT_NOTIF_SETTINGS) }}
                      style={{ ...btnGray, fontSize:12 }}>デフォルトに戻す</button>
                  </div>
                  <div style={{ fontSize:11, color:'#aaa', marginTop:8 }}>※ 変更後は「通知設定を保存」を押してください</div>
                </div>

                {/* 通知設定テーブル：全業態共通の基本セクション＋店舗固有セクション（storeSpecificNotifSections）。
                    食べログ・椎名さんカレンダー同期は貝屋和光専用の連携のため、業態を問わず全店舗に表示される
                    ハードコードのセクションからは外し、settings.storeSpecificNotifSections（業態プリセットで
                    空配列にできる）側に移した——テスト全部隊レビューで「他業態の管理画面に貝屋和光の実名・
                    外部サービス名が無条件表示される」という指摘を受けての対応。 */}
                {[
                  { section: 'LINE予約システム', rows: [
                    { key: 'LINE_新規予約',   label: '新規予約' },
                    { key: 'LINE_変更',       label: '予約変更' },
                    { key: 'LINE_キャンセル', label: 'キャンセル' },
                    { key: 'LINE_管理者追加', label: '管理者追加' },
                    { key: 'LINE_管理者変更', label: '管理者変更' },
                    { key: 'LINE_管理者削除', label: '管理者削除' },
                  ]},
                  ...(settings.storeSpecificNotifSections || []),
                  { section: '手動予約', rows: [
                    { key: '手動_追加', label: '追加' },
                    { key: '手動_変更', label: '変更' },
                    { key: '手動_削除', label: '削除' },
                  ]},
                  { section: 'カレンダー連携', rows: [
                    { key: 'カレンダー連携_追加', label: '自動登録' },
                  ]},
                  { section: 'エラー通知', rows: [
                    { key: 'エラー', label: 'システムエラー' },
                  ]},
                ].map(({ section, rows }) => (
                  <div key={section} style={{ background:'#fff', borderRadius:12, padding:20, marginBottom:12, boxShadow:'0 1px 3px rgba(0,0,0,.08)' }}>
                    <h2 style={{ fontSize:15, fontWeight:'bold', marginBottom:14 }}>{section}</h2>
                    <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
                      <thead>
                        <tr style={{ borderBottom:'2px solid #f0f0f0' }}>
                          <th style={{ textAlign:'left', padding:'6px 8px', color:'#888', fontWeight:'normal', width:'40%' }}>通知種別</th>
                          <th style={{ textAlign:'center', padding:'6px 8px', color:'#888', fontWeight:'normal', width:'20%' }}>ON / OFF</th>
                          <th style={{ textAlign:'center', padding:'6px 8px', color:'#888', fontWeight:'normal', width:'20%' }}>グループA</th>
                          <th style={{ textAlign:'center', padding:'6px 8px', color:'#888', fontWeight:'normal', width:'20%' }}>グループB</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map(({ key, label }) => {
                          const s = notifSettings[key] || { enabled: true, target: 'B' }
                          return (
                            <tr key={key} style={{ borderBottom:'1px solid #f5f5f5' }}>
                              <td style={{ padding:'10px 8px', color:'#333' }}>{label}</td>
                              <td style={{ padding:'10px 8px', textAlign:'center' }}>
                                <Pill on={s.enabled}
                                  onClick={() => setNotifSettings(prev => ({ ...prev, [key]: { ...s, enabled: !s.enabled } }))} />
                              </td>
                              <td style={{ padding:'10px 8px', textAlign:'center' }}>
                                <input type="radio"
                                  checked={s.target === 'A'}
                                  disabled={!s.enabled}
                                  onChange={() => setNotifSettings(prev => ({ ...prev, [key]: { ...s, target: 'A' } }))}
                                  style={{ cursor: s.enabled ? 'pointer' : 'default', accentColor:'#1976d2', width:16, height:16 }} />
                              </td>
                              <td style={{ padding:'10px 8px', textAlign:'center' }}>
                                <input type="radio"
                                  checked={s.target === 'B'}
                                  disabled={!s.enabled}
                                  onChange={() => setNotifSettings(prev => ({ ...prev, [key]: { ...s, target: 'B' } }))}
                                  style={{ cursor: s.enabled ? 'pointer' : 'default', accentColor:'#2e7d32', width:16, height:16 }} />
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                ))}

                {/* 保存ボタン */}
                <div style={{ display:'flex', justifyContent:'flex-end', padding:'8px 0 16px' }}>
                  <button disabled={notifSettingsSaving} onClick={saveNotifSettings}
                    style={{ ...btnGreen, fontSize:14, padding:'12px 32px', borderRadius:10 }}>
                    {notifSettingsSaving ? '保存中...' : '通知設定を保存'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* ─── TAB: 配信設定 ────────────────────────────────────────── */}
        {tab==='feature-settings' && (
          <div style={{ opacity: fsetSaving ? 0.6 : 1, pointerEvents: fsetSaving ? 'none' : 'auto' }}>
            {fsetLoading ? (
              <div style={{ textAlign:'center', padding:40, color:'#aaa' }}>読み込み中...</div>
            ) : (
              <>
                <div style={{ background:'#eef6ff', border:'1px solid #bcdcff', borderRadius:10, padding:'12px 16px', marginBottom:12, fontSize:13, color:'#1565c0' }}>
                  💡 ここではお客様のLINEに自動で送る「リマインド・お礼・口コミ依頼」のタイミングと文章を設定します。スタッフへの社内通知は「通知設定」タブです。
                </div>

                {/* ① 来店前リマインド */}
                <div style={{ background:'#fff', borderRadius:12, padding:20, marginBottom:12, boxShadow:'0 1px 3px rgba(0,0,0,.08)' }}>
                  <h2 style={{ fontSize:15, fontWeight:'bold', marginBottom:6 }}>来店前リマインド</h2>
                  <div style={{ fontSize:12, color:'#888', marginBottom:14 }}>予約日の何日前・何時に、お客様のLINEへリマインドを送るか設定します。</div>

                  <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:10, flexWrap:'wrap' }}>
                    <span style={{ fontSize:13, width:120 }}>前日リマインド</span>
                    <Pill on={fset.reminders.dayBeforeEnabled} onClick={() => updateFset('reminders','dayBeforeEnabled', !fset.reminders.dayBeforeEnabled)} />
                    {fset.reminders.dayBeforeEnabled && (
                      <>
                        <span style={{ fontSize:12, color:'#888' }}>送信時刻</span>
                        <HourSelect value={fset.reminders.dayBeforeHour} onChange={v => updateFset('reminders','dayBeforeHour', v)} />
                      </>
                    )}
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
                    <span style={{ fontSize:13, width:120 }}>1週間前リマインド</span>
                    <Pill on={fset.reminders.weekBeforeEnabled} onClick={() => updateFset('reminders','weekBeforeEnabled', !fset.reminders.weekBeforeEnabled)} />
                    {fset.reminders.weekBeforeEnabled && (
                      <>
                        <span style={{ fontSize:12, color:'#888' }}>送信時刻</span>
                        <HourSelect value={fset.reminders.weekBeforeHour} onChange={v => updateFset('reminders','weekBeforeHour', v)} />
                      </>
                    )}
                  </div>
                </div>

                {/* ② 来店後のお礼・口コミ依頼 */}
                <div style={{ background:'#fff', borderRadius:12, padding:20, marginBottom:12, boxShadow:'0 1px 3px rgba(0,0,0,.08)' }}>
                  <h2 style={{ fontSize:15, fontWeight:'bold', marginBottom:6 }}>来店後のお礼・口コミ依頼</h2>
                  <div style={{ fontSize:12, color:'#888', marginBottom:14 }}>来店当日、設定した時刻にお客様へお礼メッセージを送ります（LINE登録者にはLINE、電話予約のみの方にはメールが登録されていればメール）。口コミ依頼は別のスイッチで、同じ方には一定期間おきに1回だけ送られます。</div>

                  <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:14, flexWrap:'wrap' }}>
                    <span style={{ fontSize:13, width:120 }}>お礼メッセージ</span>
                    <Pill on={fset.postVisitFollowUp.enabled} onClick={() => updateFset('postVisitFollowUp','enabled', !fset.postVisitFollowUp.enabled)} />
                    {fset.postVisitFollowUp.enabled && (
                      <>
                        <span style={{ fontSize:12, color:'#888' }}>送信時刻</span>
                        <HourSelect value={fset.postVisitFollowUp.hour} onChange={v => updateFset('postVisitFollowUp','hour', v)} />
                      </>
                    )}
                  </div>

                  {fset.postVisitFollowUp.enabled && (
                    <div style={{ background:'#f8fffe', border:'1px solid #c8e6c9', borderRadius:8, padding:14, marginBottom:4 }}>
                      <div style={{ marginBottom:10 }}>
                        <div style={{ fontSize:12, color:'#555', marginBottom:4 }}>お礼メッセージ本文（空欄なら既定の文章を使用）</div>
                        <textarea rows={2} value={fset.messageTemplates.postVisitThanks}
                          onChange={e => updateFset('messageTemplates','postVisitThanks', e.target.value)}
                          placeholder="本日はご来店いただき、誠にありがとうございました。またのお越しを心よりお待ちしております。"
                          style={{ width:'100%', boxSizing:'border-box', padding:'8px 10px', border:'1px solid #ddd', borderRadius:6, fontSize:13 }} />
                        {fset.messageTemplates.postVisitThanks && (
                          <button onClick={() => updateFset('messageTemplates','postVisitThanks','')} style={{ ...btnGray, fontSize:11, marginTop:6, padding:'3px 10px' }}>既定の文章に戻す</button>
                        )}
                      </div>

                      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10, flexWrap:'wrap' }}>
                        <label style={{ fontSize:13, display:'flex', alignItems:'center', gap:6, cursor:'pointer' }}>
                          <input type="checkbox" checked={fset.postVisitFollowUp.reviewRequestEnabled}
                            onChange={e => updateFset('postVisitFollowUp','reviewRequestEnabled', e.target.checked)} />
                          口コミ依頼を含める
                        </label>
                        {fset.postVisitFollowUp.reviewRequestEnabled && (
                          <>
                            <span style={{ fontSize:12, color:'#888' }}>再送間隔</span>
                            <CustomSelect value={fset.postVisitFollowUp.reviewCooldownDays}
                              onChange={e => updateFset('postVisitFollowUp','reviewCooldownDays', parseInt(e.target.value,10))}
                              style={{ width:100 }}>
                              {[7,14,30,60,90,180,365].map(d => <option key={d} value={d}>{d}日</option>)}
                            </CustomSelect>
                          </>
                        )}
                      </div>

                      {fset.postVisitFollowUp.reviewRequestEnabled && (
                        <div style={{ marginLeft:0, marginBottom:10 }}>
                          <div style={{ fontSize:12, color:'#555', marginBottom:4 }}>口コミ依頼の一言（空欄なら既定の文章を使用）</div>
                          <textarea rows={2} value={fset.messageTemplates.reviewRequestLine}
                            onChange={e => updateFset('messageTemplates','reviewRequestLine', e.target.value)}
                            placeholder="もしよろしければ、ご感想をお聞かせいただけますと幸いです。"
                            style={{ width:'100%', boxSizing:'border-box', padding:'8px 10px', border:'1px solid #ddd', borderRadius:6, fontSize:13 }} />
                          {fset.messageTemplates.reviewRequestLine && (
                            <button onClick={() => updateFset('messageTemplates','reviewRequestLine','')} style={{ ...btnGray, fontSize:11, marginTop:6, padding:'3px 10px' }}>既定の文章に戻す</button>
                          )}
                        </div>
                      )}

                      {/* 貸切機能自体がOFF（fset.kasshiki.enabled===false）の店舗では、貸切予約というものが
                          存在しないため、このチェックボックスは何を選んでも効果が無いデッドセッティングになる
                          （Code.gs側もisKasshikiResと組み合わせてのみ参照するため）。他のkasshiki関連UIと
                          同じ基準でここも表示を絞る（Appleデザインチーム視点レビューで発覚）。 */}
                      {fset.kasshiki.enabled && (
                        <label style={{ fontSize:13, display:'flex', alignItems:'center', gap:6, cursor:'pointer' }}>
                          <input type="checkbox" checked={fset.postVisitFollowUp.skipReviewForKasshiki}
                            onChange={e => updateFset('postVisitFollowUp','skipReviewForKasshiki', e.target.checked)} />
                          貸切のご予約には口コミ依頼をしない（お礼のみ送る）
                        </label>
                      )}
                    </div>
                  )}
                </div>

                {/* ③ 無断キャンセル検知 */}
                <div style={{ background:'#fff', borderRadius:12, padding:20, marginBottom:12, boxShadow:'0 1px 3px rgba(0,0,0,.08)' }}>
                  <h2 style={{ fontSize:15, fontWeight:'bold', marginBottom:6 }}>無断キャンセル検知</h2>
                  <div style={{ fontSize:12, color:'#888', marginBottom:14 }}>来店予定時刻を過ぎても「確定」のままステータスが更新されていない予約を自動でチェックし、スタッフへ通知します。</div>
                  <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
                    <Pill on={fset.noShowDetection.enabled} onClick={() => updateFset('noShowDetection','enabled', !fset.noShowDetection.enabled)} />
                    {fset.noShowDetection.enabled && (
                      <>
                        <span style={{ fontSize:12, color:'#888' }}>実行時刻</span>
                        <HourSelect value={fset.noShowDetection.hour} onChange={v => updateFset('noShowDetection','hour', v)} />
                      </>
                    )}
                  </div>
                </div>

                {/* 深夜の自己診断 */}
                <div style={{ background:'#fff', borderRadius:12, padding:20, marginBottom:12, boxShadow:'0 1px 3px rgba(0,0,0,.08)' }}>
                  <h2 style={{ fontSize:15, fontWeight:'bold', marginBottom:6 }}>深夜の自己診断</h2>
                  <div style={{ fontSize:12, color:'#888', marginBottom:14 }}>毎晩、人数データの汚損・カレンダーとの不整合等を自動でチェックし、異常があれば店側に通知します（上記「管理者・スタッフへの通知方法」の設定に従います）。自動修復は行わず、検知・報告のみです。異常が無い日は通知しません。</div>
                  <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
                    <Pill on={fset.nightlyHealthCheck?.enabled ?? true} onClick={() => updateFset('nightlyHealthCheck','enabled', !(fset.nightlyHealthCheck?.enabled ?? true))} />
                    {(fset.nightlyHealthCheck?.enabled ?? true) && (
                      <>
                        <span style={{ fontSize:12, color:'#888' }}>実行時刻</span>
                        <HourSelect value={fset.nightlyHealthCheck?.hour ?? 3} onChange={v => updateFset('nightlyHealthCheck','hour', v)} />
                      </>
                    )}
                  </div>
                </div>

                {/* ④ 表示・見せ方の設定 */}
                <div style={{ background:'#fff', borderRadius:12, padding:20, marginBottom:12, boxShadow:'0 1px 3px rgba(0,0,0,.08)' }}>
                  <h2 style={{ fontSize:15, fontWeight:'bold', marginBottom:14 }}>表示・見せ方の設定</h2>

                  <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:14, flexWrap:'wrap' }}>
                    <span style={{ fontSize:13, width:160 }}>来店回数（○回目のご来店）</span>
                    <CustomSelect value={fset.visitCountMessage.mode}
                      onChange={e => updateFset('visitCountMessage','mode', e.target.value)}
                      style={{ width:220 }}>
                      <option value="both">お客様にも見せる</option>
                      <option value="staffOnly">スタッフ通知のみ（既定）</option>
                      <option value="off">どこにも表示しない</option>
                    </CustomSelect>
                  </div>
                  <div style={{ fontSize:11, color:'#aaa', marginBottom:14 }}>
                    ※「お客様にも見せる」場合、LINEの通知プレビューが同席者に見える可能性がある点にご留意ください。
                  </div>

                  {fset.kasshiki.enabled && (
                    <label style={{ fontSize:13, display:'flex', alignItems:'center', gap:6, cursor:'pointer' }}>
                      <input type="checkbox" checked={fset.kasshikiFormalTone.enabled}
                        onChange={e => updateFset('kasshikiFormalTone','enabled', e.target.checked)} />
                      貸切のご予約は絵文字を抑えたフォーマルな文面にする
                    </label>
                  )}
                </div>

                {/* ⑤ 予約体験の機能 */}
                <div style={{ background:'#fff', borderRadius:12, padding:20, marginBottom:12, boxShadow:'0 1px 3px rgba(0,0,0,.08)' }}>
                  <h2 style={{ fontSize:15, fontWeight:'bold', marginBottom:14 }}>予約体験の機能</h2>

                  {/* 「担当者単位」モードでは、既存の貸切予約が他の予約をブロックする方向（hasKasshiki検知）は
                      機能するが、新しく貸切・大人数を申し込む方向はgetStaffAvailability側が常にcanKasshiki:false
                      を返すため必ず拒否される（業種経営者陣レビューで発覚）。VERTICAL_PRESETSは担当者単位の
                      全業態でこの機能を既定OFFにしているため今は潜在的な問題だが、店主が手動でONにした場合に
                      機能しないデッドセッティングになるため、他のperStaff専用UIと同じくここで表示自体を絞る。 */}
                  {settings.capacityModel !== 'perStaff' && (
                    <div style={{ marginBottom:14 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                        <span style={{ fontSize:13, width:160 }}>貸切・大人数のご相談</span>
                        <Pill on={fset.kasshiki.enabled} onClick={() => updateFset('kasshiki','enabled', !fset.kasshiki.enabled)} />
                      </div>
                      <div style={{ fontSize:11, color:'#aaa', marginTop:4 }}>店全体の買い切り予約に対応しない業態の場合はOFFにできます。OFFにすると予約画面から貸切・大人数相談ボタンが消えます。</div>
                    </div>
                  )}

                  {settings.capacityModel !== 'perStaff' && (
                    <div style={{ marginBottom:14 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                        <span style={{ fontSize:13, width:160 }}>1名利用は相席時のみ受付</span>
                        <Pill on={fset.singleDinerRequiresCompany.enabled} onClick={() => updateFset('singleDinerRequiresCompany','enabled', !fset.singleDinerRequiresCompany.enabled)} />
                      </div>
                      <div style={{ fontSize:11, color:'#aaa', marginTop:4 }}>ONの場合、1名様のご予約は「その日に他のお客様の予約が既にある場合」のみ受付します（貝屋和光の既定）。1人客が多い業態（ラーメン屋・定食屋のカウンター等）ではOFFにしてください。</div>
                    </div>
                  )}
                  {/* 「担当者単位」モードでは、1名利用の制約は担当者の空き状況だけで判定されるため
                      （getStaffAvailability側で完全に独立して判定、この設定は一切参照されない）、
                      設定できても実際には何も起きないデッドセッティングになる。Appleデザインチーム視点
                      レビューで発覚——同伴者情報トグルと同じクラスの見落とし。 */}

                  <div style={{ marginBottom:14 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                      <span style={{ fontSize:13, width:160 }}>キャンセル待ち機能</span>
                      <Pill on={fset.waitlist.enabled} onClick={() => updateFset('waitlist','enabled', !fset.waitlist.enabled)} />
                    </div>
                    <div style={{ fontSize:11, color:'#aaa', marginTop:4 }}>満席の日にお客様がキャンセル待ちに登録できるようになります（先着順、ご案内の確保はいたしません）。</div>
                  </div>

                  <div>
                    <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                      <span style={{ fontSize:13, width:160 }}>期限後のLINE依頼ボタン</span>
                      <Pill on={fset.lateRequestButton.enabled} onClick={() => updateFset('lateRequestButton','enabled', !fset.lateRequestButton.enabled)} />
                    </div>
                    <div style={{ fontSize:11, color:'#aaa', marginTop:4 }}>変更・キャンセルの受付期限を過ぎたお客様が、LINEから直接スタッフへ依頼できるボタンを表示します。OFFの場合は電話案内のみになります。</div>
                  </div>
                </div>

                <div style={{ display:'flex', gap:10, marginTop:4, marginBottom:24 }}>
                  <button onClick={saveFset} disabled={fsetSaving} style={{ ...btnGreen, flex:1 }}>
                    {fsetSaving ? '保存中...' : '配信設定を保存'}
                  </button>
                  <button onClick={() => { if (window.confirm('配信設定を初期状態に戻します（保存するまでは反映されません）。よろしいですか？')) setFset(defaultFset) }}
                    style={{ ...btnGray }}>
                    初期状態に戻す
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* 店舗固有機能：このタブの内容は店舗ごとに異なる（複数店舗展開の際、各店舗のデプロイ先コードで
            このタブの中身だけを書き換える想定。他のタブ「予約一覧」「設定」「配信設定」等は
            全店舗共通の汎用機能のため変更不要）。貝屋和光では、椎名さんのカレンダー同期（System2、
            別のGASプロジェクト）・食べログ予約のGmail自動取得（System3、同様に別プロジェクト）という
            この店舗だけの連携があるため、その説明・状態確認へのリンクをここに置く。
            別の店舗を導入する際、他の連携（別のカレンダー連携・POSレジ連携等）が必要になったら、
            このタブの中身をその店舗向けに差し替える。 */}
        {tab==='store-specific' && (
          <div>
            <div style={{ background:'#eef6ff', border:'1px solid #bcdcff', borderRadius:10, padding:'12px 16px', marginBottom:12, fontSize:13, color:'#1565c0' }}>
              💡 このタブは店舗ごとに内容が異なる「店舗固有機能」の置き場所です。他のタブ（設定・配信設定等）は全店舗共通の汎用機能ですが、ここには貝屋和光だけが使っている個別の連携・追加機能を表示します。別の店舗にこのシステムを導入する際は、その店舗が必要とする連携内容に応じて、このタブの中身だけを差し替えます。
            </div>

            <div style={{ background:'#fff', borderRadius:12, padding:20, marginBottom:12, boxShadow:'0 1px 3px rgba(0,0,0,.08)' }}>
              <h2 style={{ fontSize:15, fontWeight:'bold', marginBottom:6 }}>椎名さんカレンダー同期システム</h2>
              <div style={{ fontSize:13, color:'#555', lineHeight:1.8 }}>
                椎名さん個人のカレンダーに「貝屋」という予定が入ると、自動でこの予約カレンダーにも同じ予定が反映されます。手動で予約カレンダーの予定を変更・削除した場合の検知や、食べログの手動変更検知も、この仕組みと同じシステム内で行っています。
                {/* 以前はここに椎名さん個人の実メールアドレスをそのまま表示していたが、admin.jsはクライアント側の
                    JavaScriptバンドルであり、/adminのパスワード認証を通す前でもこのJSファイル自体はブラウザに
                    配信される（認証はクライアント側のstate判定のみで、バンドル自体はサーバー側で認証保護されていない）。
                    そのため個人の実メールアドレスがログイン不要で誰でも読める状態になっていた（ITコンサル視点
                    レビューでの指摘：CWE-200相当。System2_production.gsのSOURCE_CALENDAR等、GAS側コードに残る
                    同種の実データは「リポジトリ・バックアップにアクセスできる人」に限定されるのに対し、この
                    admin.js側は「/adminのURLにアクセスできる人全員」に開かれており実害の範囲がより広い）。
                    UIの説明文としてはメールアドレス自体を出す必要が無いため削除した。 */}
              </div>
              <div style={{ fontSize:12, color:'#aaa', marginTop:10 }}>
                実体は<code>System2_production.gs</code>という、この管理画面（プロジェクト1）とは完全に別のGoogle Apps Scriptプロジェクトです。椎名さんのカレンダー自体を直接変更する権限は無く、読み取り専用の連携です。コードの修正・再デプロイは、そちらのGASプロジェクトのエディタから行います。
              </div>
              {systemStopped && (
                <div style={{ marginTop:10, background:'#ffebee', border:'1px solid #ffcccc', borderRadius:8, padding:'8px 12px', fontSize:12, color:'#c62828' }}>
                  ⚠️ 現在、この同期システムから「一時停止中」の報告を受けています（画面上部の通知バナーもご確認ください）。
                </div>
              )}
            </div>

            <div style={{ background:'#fff', borderRadius:12, padding:20, marginBottom:12, boxShadow:'0 1px 3px rgba(0,0,0,.08)' }}>
              <h2 style={{ fontSize:15, fontWeight:'bold', marginBottom:6 }}>食べログ予約の自動取得システム</h2>
              <div style={{ fontSize:13, color:'#555', lineHeight:1.8 }}>
                食べログ経由の予約確認メール（Gmail）を解析し、自動でカレンダーへ登録・LINE通知を行う仕組みです。この予約システム（LINE予約）とは独立して動作しており、お互いに影響しません。
              </div>
              <div style={{ fontSize:12, color:'#aaa', marginTop:10 }}>
                実体は<code>System3_production.gs</code>という別のGoogle Apps Scriptプロジェクトです。Gmailトリガー駆動で動作し、この管理画面からは操作できません。
              </div>
            </div>

            <div style={{ background:'#fff', borderRadius:12, padding:20, marginBottom:12, boxShadow:'0 1px 3px rgba(0,0,0,.08)' }}>
              <h2 style={{ fontSize:15, fontWeight:'bold', marginBottom:6 }}>別の店舗に導入する場合</h2>
              <div style={{ fontSize:13, color:'#555', lineHeight:1.8 }}>
                このタブの内容は貝屋和光専用です。別の店舗が別のカレンダー連携・POSレジ連携・予約サイト連携等を必要とする場合は、このタブの中身だけをその店舗向けに実装し直します（他のタブ・予約システムの共通ロジックは変更不要です）。連携が不要な店舗では、このタブ自体を空欄のままにしても構いません。
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      {editRes && (
        <EditModal res={editRes}
          onClose={() => setEditRes(null)}
          onSaved={() => { setEditRes(null); refreshRes() }}
          showToast={showToast}
          timeSlots={adminTimeSlots}
          dailyHours={settings.dailyHours || defDailyHours}
          dateOverrides={dateOverrideMapDash}
          staffAssignmentEnabled={settings.staffAssignmentEnabled}
          staffRoster={settings.staffRoster || []}
          courses={settings.courses || []}
          itemLabel={settings.itemLabel || 'コース'}
          bookingSources={settings.bookingSources || SOURCES}
          guestCountEnabled={settings.guestCountEnabled}
          fixedGuestCount={settings.fixedGuestCount} />
      )}
      {showAddModal && (
        <AddModal initialDate={addInitDate}
          onClose={() => setShowAddModal(false)}
          onAdded={() => { setShowAddModal(false); refreshRes() }}
          showToast={showToast}
          timeSlots={adminTimeSlots}
          dailyHours={settings.dailyHours || defDailyHours}
          dateOverrides={dateOverrideMapDash}
          guestCountEnabled={settings.guestCountEnabled}
          fixedGuestCount={settings.fixedGuestCount}
          staffAssignmentEnabled={settings.staffAssignmentEnabled}
          staffRoster={settings.staffRoster || []}
          courses={settings.courses || []}
          itemLabel={settings.itemLabel || 'コース'}
          bookingSources={settings.bookingSources || SOURCES}
          kasshikiEnabled={!!(fset.kasshiki && fset.kasshiki.enabled)} />
      )}

      <Toast msg={toast.msg} type={toast.type} />

      </>} {/* end authed */}

      <style jsx global>{`* { box-sizing:border-box; margin:0; padding:0; } body { font-family:-apple-system,'Hiragino Sans',sans-serif; background:#f5f5f5; }`}</style>
    </>
  )
}
