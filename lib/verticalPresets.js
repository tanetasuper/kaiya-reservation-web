// 業態プリセット：関連する設定が複数箇所（設定タブ・配信設定タブ）に分散しているため、1つでも見落とすと
// 事故る（例：飲食店以外でsingleDinerRequiresCompanyがONのまま残る等）。イーロンマスク／ITコンサル／
// アップルデザインチーム視点の導入テストで繰り返し指摘されたため、代表的な業態をまとめて一括適用できるようにした。
// settingsパート・fsetパートは、それぞれ「設定」タブ・「配信設定」タブの保存ボタンで別々に保存する必要がある。
//
// admin.js（ログイン後の業態プリセット変更・SetupWizard）とpages/setup.js（初期設定画面の業種選択）の
// 両方から同じデータを参照する必要があるため、共有モジュールとして分離している（2026-08-10、導入フロー
// 大改修。以前はadmin.js内にのみ定義されており、setup.jsを新設する際に複製すると二重管理・drift の
// リスクがあったため、単一の参照元に統一した）。
//
// 業態プリセットの土台となる共通バンドル。複数のプリセットが「itemLabel/itemIconだけ違って中身は同一」に
// なりがちなため（例：レンタカー屋とガイド制レジャーは同じperStaffバンドル）、ここで共通定義を1箇所に集約し、
// 見た目のプリセット一覧（店主が自分の業種名で選べる分かりやすさ）は保ったまま、内部の二重管理を防ぐ。
// estimateFlow（見積/承認フロー、部品代・工賃内訳付き）はCode.gs側のdefaultFeatureSettings()では
// 全店舗共通で既定ON——車修理工場向けに新設した機能（業種経営者陣視点レビュー・2026-08-13）だが、
// どのプリセットのfsetもこのキーに触れていなかったため、飲食店・美容院等でも予約編集画面に
// 部品代・工賃の入力欄が常に表示され続けていた（Apple CEO視点レビュー・ラウンド35での指摘）。
// 業態プリセットの土台では明示的にOFFにし、実際に使う'repair'（車修理工場）プリセットだけ
// 個別にONへ上書きする。
export const FSET_KASSHIKI_ON  = { kasshiki:{ enabled:true },  singleDinerRequiresCompany:{ enabled:true },  estimateFlow:{ enabled:false } }
export const FSET_KASSHIKI_OFF = { kasshiki:{ enabled:false }, singleDinerRequiresCompany:{ enabled:false }, estimateFlow:{ enabled:false } }
// 面接（候補者）・クリニック（患者）向け：飲食店の「無断キャンセル歴の表示」は業界的に一般的だが、
// この2業態にそのまま適用するのは公平性・プライバシーの観点で重みが違う（Apple CEO視点レビューでの指摘）。
// 導入時点の既定はOFFにし、必要な店舗は配信設定タブから自分でONにできるようにする（機能自体は削除しない）。
export const FSET_KASSHIKI_OFF_NOSHOW_OFF = { ...FSET_KASSHIKI_OFF, noShowDetection:{ enabled:false } }
// 変更・キャンセルの受付期限（cutoffRules）は、以前はどのプリセットにも一度も設定されておらず、コード側の
// 既定値（2〜3日前22:00締切＝会席コースの食材発注を前提にした値）がそのまま全業態に適用されていた。
// 美容院・面接・クリニック・整備工場・学習塾のような「当日キャンセルが一般的」な業態が、飲食店基準の
// 締切をそのまま引き継いでしまう実害があった（Apple CEO視点レビューでの指摘：導入時点の設定だけで
// 完結するはずの「業態プリセット」の前提が、この項目だけ崩れていた）。同伴者情報等と同じ理由で、
// 過度に厳しくする側ではなく緩める側（当日23:59まで受付＝実質的に無制限）を既定にし、必要な店舗は
// 「設定」タブの曜日別・祝日別ルールから自分でより厳しい値に変更できるようにする。
// （飲食店2業態にはCUTOFF_SAME_DAYではなくCUTOFF_DINING_DEFAULTを明示設定する。理由は下記参照）
export const CUTOFF_SAME_DAY = { '0':{daysBefore:0,time:'23:59'}, '1':{daysBefore:0,time:'23:59'}, '2':{daysBefore:0,time:'23:59'},
  '3':{daysBefore:0,time:'23:59'}, '4':{daysBefore:0,time:'23:59'}, '5':{daysBefore:0,time:'23:59'}, '6':{daysBefore:0,time:'23:59'},
  holiday:{daysBefore:0,time:'23:59'} }
// course_dining/simple_dining（飲食店2業態）だけは上記CUTOFF_SAME_DAYを設定せず、「一度も触られていない」
// という前提でコード側の既定値（2〜3日前22:00締切）に委ねていたが、他業態プリセット（CUTOFF_SAME_DAYを
// 明示設定）を一度適用・保存した店舗が後から飲食店プリセットに切り替えた場合、cutoffRulesキーが
// settingsPatchに含まれないため当日23:59という緩い締切がそのまま残ってしまう不整合があった
// （storeSpecificNotifSectionsで既に対策済みだった「一部プリセットだけ明示・残りは前の値が残る」問題と
// 同種のものが、この項目だけ見落とされていた。第25回レビュー、あらゆる業種の経営者陣視点での指摘・修正）。
// 飲食店側もコード側の既定値と同じ内容をここで明示し、プリセット切り替え時に必ず上書きされるようにする。
export const CUTOFF_DINING_DEFAULT = { '0':{daysBefore:3,time:'22:00'}, '1':{daysBefore:2,time:'22:00'}, '2':{daysBefore:2,time:'22:00'},
  '3':{daysBefore:2,time:'22:00'}, '4':{daysBefore:2,time:'22:00'}, '5':{daysBefore:2,time:'22:00'}, '6':{daysBefore:2,time:'22:00'},
  holiday:{daysBefore:3,time:'22:00'} }
// 資産（車両・器材）1つを担当者1人として登録し、同時対応数=1で個別管理する業態（レンタカー・ガイド制レジャー等）
export function assetPerStaffBundle(itemLabel, itemIcon) {
  return { bookingMode:'course', itemLabel, itemIcon, capacityModel:'perStaff', staffAssignmentEnabled:true, guestCountEnabled:true, companionInfoEnabled:false }
}
// 資産（自転車・器材）を台数だけで管理し、誰が対応するかは問わない業態（レンタサイクル・器材制レジャー等）
export function assetByCountBundle(itemLabel, itemIcon) {
  return { bookingMode:'course', itemLabel, itemIcon, capacityModel:'timeSlot', staffAssignmentEnabled:false, guestCountEnabled:true, companionInfoEnabled:false }
}

// 導入ウィザード用の追加質問。業態を選んだだけでは決まらない「呼び方」「細かい運用ルール」を
// 追加で聞き、答えに応じてsettings/fsetの該当項目を上書きする。target/fieldはドット区切りのパス
// （fset側は{section}.{key}の2階層のみ想定）。質問が無い業態（既に十分シンプル）は空配列でよい
// ——「必要ない時に設定を強制しない」という方針上、聞くことが無いなら聞かない。
export function setDeepPath(obj, path, value) {
  const parts = path.split('.')
  let cur = obj
  for (let i = 0; i < parts.length - 1; i++) { cur[parts[i]] = { ...(cur[parts[i]] || {}) }; cur = cur[parts[i]] }
  cur[parts[parts.length - 1]] = value
}
export const Q_STAFF_LABEL = (options) => ({ id:'staffLabel', question:'スタッフ・担当の呼び方は？', short:'呼び方', target:'settings', field:'staffLabel', options, allowCustom:true })
export const Q_COMPANION = { id:'companion', question:'同伴者情報（アレルギー等）の記録は必要ですか？', short:'同伴者情報', target:'settings', field:'companionInfoEnabled', options:[{value:false,label:'不要'},{value:true,label:'必要'}] }

// Q1（ご利用目的）・Q3（どのように当店を知ったか）の選択肢、通知設定タブの店舗固有セクションは、
// 「担当者」の呼び方と同じ種類の問題（業態依存の内容がハードコードされている）だったため、
// staffLabelと同じパターンでプリセットごとに既定値を持たせる。飲食店以外は「食べログ」を含めない。
export const Q3_GENERIC = ['グーグルマップ', 'インターネット検索', 'SNS', '知人の紹介', 'その他']
export const Q1_DINING  = ['誕生日・記念日', '接待・会食', '友人・仲間と', '家族で', 'デート', 'その他']
export const Q3_DINING  = ['グーグルマップ', 'インターネット検索', '食べログ', 'SNS', '知人の紹介', 'その他']
export const SOURCES_GENERIC = ['電話', 'LINE', 'ウォークイン', 'その他']
export const SOURCES_DINING  = ['電話', '食べログ', 'LINE', 'ウォークイン', 'その他']
// 貝屋和光専用の通知セクション（Code.gsのdefaultStoreSpecificNotifSections()と同じ内容）。
// course_diningだけがこれを持つ想定だが、他プリセットと同様に明示的に設定しておく
// （他業態プリセットへ切り替えてからcourse_dining に戻すと、明示していない場合は
// バックエンドの既定値には戻らず、直前のプリセットの値[]が残ってしまうため）。
export const STORE_SPECIFIC_SHIINA_TABELOG = [
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

export const VERTICAL_PRESETS = [
  { key:'course_dining', category:'飲食店', label:'飲食店（コース制・懐石・フレンチ等）', icon:'🍽', hint:'買い切り（貸切）需要があり、1名利用は相席が前提の業態向け。',
    settings:{ bookingMode:'course', itemLabel:'コース', itemIcon:'🍽', capacityModel:'daily', staffAssignmentEnabled:false, staffLabel:'担当者', countUnit:'名', guestCountEnabled:true, companionInfoEnabled:true,
      q1Options: Q1_DINING, q3Options: Q3_DINING, q1Question: 'ご利用目的（任意）', q3Question: 'どのように当店を知りましたか（任意）', bookingSources: SOURCES_DINING, storeSpecificNotifSections: STORE_SPECIFIC_SHIINA_TABELOG, cutoffRules: CUTOFF_DINING_DEFAULT },
    fset: FSET_KASSHIKI_ON,
    questions:[
      { id:'kasshiki', question:'貸切（買い切り）のご予約を受け付けますか？', short:'貸切対応', target:'fset', field:'kasshiki.enabled', options:[{value:true,label:'受け付ける'},{value:false,label:'受け付けない'}] },
      { id:'company', question:'1名でのご来店は相席が前提ですか？', short:'1名利用の相席ルール', target:'fset', field:'singleDinerRequiresCompany.enabled', options:[{value:true,label:'はい、相席が前提'},{value:false,label:'いいえ、1名でも個別対応'}] },
    ] },
  { key:'simple_dining', category:'飲食店', label:'飲食店（コース無し・定食・町中華・カフェ等）', icon:'🍜', hint:'アラカルト中心、回転が速い、1人客が主体の業態向け。',
    settings:{ bookingMode:'simple', itemLabel:'ご予約', itemIcon:'🍽', capacityModel:'timeSlot', defaultStayMin:'40', defaultCourseName:'ご予約', staffAssignmentEnabled:false, staffLabel:'担当者', countUnit:'名', guestCountEnabled:true, companionInfoEnabled:false,
      q1Options: Q1_DINING, q3Options: Q3_DINING, q1Question: 'ご利用目的（任意）', q3Question: 'どのように当店を知りましたか（任意）', storeSpecificNotifSections: [], bookingSources: SOURCES_DINING, cutoffRules: CUTOFF_DINING_DEFAULT },
    fset: FSET_KASSHIKI_OFF,
    questions:[ Q_COMPANION ] },
  { key:'salon', category:'美容・医療・面談系', label:'美容院・理容室', icon:'💇', hint:'スタイリスト（担当者）ごとの空き時間で予約可否が決まる業態向け。',
    settings:{ bookingMode:'course', itemLabel:'メニュー', itemIcon:'💇', capacityModel:'perStaff', staffAssignmentEnabled:true, guestCountEnabled:false, fixedGuestCount:'1', companionInfoEnabled:false, staffLabel:'スタイリスト', countUnit:'名',
      q1Options: ['カット・カラー等の通常メニュー', '特別な日のセット（結婚式・成人式等）', 'その他'], q3Options: Q3_GENERIC, q1Question: 'ご来店のきっかけ・ご要望（任意）', q3Question: 'どのように当店を知りましたか（任意）', storeSpecificNotifSections: [], bookingSources: SOURCES_GENERIC, cutoffRules: CUTOFF_SAME_DAY },
    fset: FSET_KASSHIKI_OFF,
    // 同伴者情報の質問は聞かない：guestCountEnabled:falseの業態は人数が常に1のため、
    // 現在の同伴者情報欄（2名以上の予約時にのみ表示）は選んでも実際には機能しない
    // （テスト全部隊レビューで発覚した既存の制約。UIの再設計をしない限り解消できない）。
    questions:[ Q_STAFF_LABEL([{value:'スタイリスト',label:'スタイリスト'},{value:'理容師',label:'理容師'},{value:'セラピスト',label:'セラピスト'}]) ] },
  { key:'interview', category:'美容・医療・面談系', label:'面接予約・カウンセリング予約', icon:'🗒️', hint:'候補者は常に1名、面接官（担当者）ごとの空き時間で管理する業態向け。',
    settings:{ bookingMode:'simple', itemLabel:'面談種別', itemIcon:'🗒️', capacityModel:'perStaff', defaultStayMin:'30', defaultCourseName:'面談', staffAssignmentEnabled:true, guestCountEnabled:false, fixedGuestCount:'1', companionInfoEnabled:false, staffLabel:'面接官', countUnit:'名', visitNoun:'来訪',
      q1Options: ['新卒採用', '中途採用', 'カウンセリング', 'その他'], q3Options: Q3_GENERIC, q1Question: '面談の種類（任意）', q3Question: 'どのように当店を知りましたか（任意）', storeSpecificNotifSections: [], bookingSources: SOURCES_GENERIC, cutoffRules: CUTOFF_SAME_DAY },
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
      q1Options: ['車検', '定期点検', '故障・修理', 'その他'], q3Options: Q3_GENERIC, q1Question: 'ご依頼内容（任意）', q3Question: 'どのように当店を知りましたか（任意）', storeSpecificNotifSections: [], bookingSources: SOURCES_GENERIC, cutoffRules: CUTOFF_SAME_DAY },
    // interview・clinicと同じ理由（法人契約・複数人が同じ電話番号/窓口を共有しがちな業態）で
    // 無断キャンセル検知はデフォルトOFFにする（業種経営者陣視点レビューでの指摘：この業態にも同じ
    // 不公平リスクがあるのに、以前はFSET_KASSHIKI_OFFのままだった）。見積/承認フロー（部品代・工賃
    // 内訳付き）はこの業態向けに新設した機能なので、この業態のプリセットに限りONへ上書きする。
    fset: { ...FSET_KASSHIKI_OFF_NOSHOW_OFF, estimateFlow: { enabled: true } },
    questions:[ Q_STAFF_LABEL([{value:'整備士',label:'整備士'},{value:'担当者',label:'担当者'}]) ] },
  { key:'clinic', category:'美容・医療・面談系', label:'病院・クリニック', icon:'🩺', hint:'医師（担当者）ごとの空き時間で管理する業態向け。',
    settings:{ bookingMode:'course', itemLabel:'診療内容', itemIcon:'🩺', capacityModel:'perStaff', staffAssignmentEnabled:true, guestCountEnabled:false, fixedGuestCount:'1', companionInfoEnabled:false, staffLabel:'医師', countUnit:'名', visitNoun:'来院',
      q1Options: ['初診', '再診', '健康診断', 'その他'], q3Options: Q3_GENERIC, q1Question: '受診の種類（任意）', q3Question: 'どのように当院を知りましたか（任意）', storeSpecificNotifSections: [], bookingSources: SOURCES_GENERIC, cutoffRules: CUTOFF_SAME_DAY },
    // 来店後フォロー自体（お礼メッセージ）は害が無いためONのままにするが、Googleレビュー等の
    // 口コミ依頼を自動送信する既定挙動（Code.gs側の全業態共通デフォルト）は、医療機関が患者に
    // 評価・レビューを自動的に依頼する行為として医療法・医療広告ガイドラインの観点でリスクがある
    // （業種経営者陣視点レビュー・ラウンド38での指摘：クリニック administrator視点）。この業態に
    // 限り既定でOFFにする（必要な店舗は配信設定タブから自分でONにできる）。
    fset: { ...FSET_KASSHIKI_OFF_NOSHOW_OFF, postVisitFollowUp: { reviewRequestEnabled: false } },
    questions:[ Q_STAFF_LABEL([{value:'医師',label:'医師'},{value:'施術者',label:'施術者'},{value:'担当者',label:'担当者'}]) ] },
  // hintの末尾の注意書き（capacityModelは店舗全体で1つしか持てないため、個別指導＋集団授業を
  // 両方運用する塾には非対応）は、ラウンド51レビューで新規発見された構造的な制約
  // （VERTICAL_PRESETS.md「現状の既知の制約」参照。フィットネスジムの個人トレーニング＋グループ
  // クラスと同種の問題）を、これから導入しようとしている店主が選ぶ前に知れるように、導入ウィザード・
  // 初期設定画面どちらのプリセット一覧にも自動で出るhint欄に追記したもの（ラウンド52で追加。実装が
  // 必要な機能拡張ではなく、既存の制約を選択前に誠実に開示するだけの最小限の対応）。
  { key:'tutoring', category:'美容・医療・面談系', label:'学習塾の面談予約', icon:'📚', hint:'講師・進路指導担当（担当者）ごとの空き時間で管理する業態向け。面談・個別指導の予約管理はこれで対応可（面談種別ごとの容量計算は不要なため）。※集団授業（教室の定員管理）も同時にこのシステムで予約管理したい場合は、現状「担当者単位」と「時間帯単位」を同じ店舗で併用できないため非対応です（面談予約専用としてご利用ください）。',
    settings:{ bookingMode:'simple', itemLabel:'面談種別', itemIcon:'📚', capacityModel:'perStaff', defaultStayMin:'30', defaultCourseName:'面談', staffAssignmentEnabled:true, guestCountEnabled:false, fixedGuestCount:'1', companionInfoEnabled:false, staffLabel:'講師', countUnit:'名', visitNoun:'来塾',
      q1Options: ['体験授業', '保護者面談', '進路相談', 'その他'], q3Options: Q3_GENERIC, q1Question: 'ご希望の内容（任意）', q3Question: 'どのように当塾を知りましたか（任意）', storeSpecificNotifSections: [], bookingSources: SOURCES_GENERIC, cutoffRules: CUTOFF_SAME_DAY },
    fset: FSET_KASSHIKI_OFF,
    questions:[ Q_STAFF_LABEL([{value:'講師',label:'講師'},{value:'担当者',label:'担当者'}]) ] },
  { key:'car_rental', category:'レンタル・レジャー系', label:'レンタカー屋', icon:'🚗', hint:'車両1台を担当者1名として登録する業態向け（日帰り・時間貸しのみ対応）。',
    settings: { ...assetPerStaffBundle('車種・プラン', '🚗'), staffLabel:'車両', countUnit:'台',
      q1Options: ['観光', 'ビジネス', '送迎', 'その他'], q3Options: Q3_GENERIC, q1Question: 'ご利用目的（任意）', q3Question: 'どのように当店を知りましたか（任意）', storeSpecificNotifSections: [], bookingSources: SOURCES_GENERIC, cutoffRules: CUTOFF_SAME_DAY },
    // repair・interview・clinicと同じ理由で無断キャンセル検知はデフォルトOFF（法人契約・複数人が
    // 同じ電話番号/窓口を共有しがちな業態のため。業種経営者陣視点レビューでの指摘）。
    fset: FSET_KASSHIKI_OFF_NOSHOW_OFF,
    questions:[
      Q_STAFF_LABEL([{value:'車両',label:'車両'},{value:'クルマ',label:'クルマ'}]),
      { id:'guestCount', question:'ご利用人数（乗車人数等）をお客様に選ばせますか？', short:'利用人数の入力', target:'settings', field:'guestCountEnabled', options:[{value:true,label:'はい'},{value:false,label:'いいえ'}] },
    ] },
  { key:'bike_rental', category:'レンタル・レジャー系', label:'レンタサイクル', icon:'🚲', hint:'台数だけで管理したい場合向け（車種違いを分けたい場合はperStaffに変更）。日帰り・時間貸しのみ対応（複数日にわたる貸出は終了時刻の表示が崩れます）。',
    settings: { ...assetByCountBundle('レンタルプラン', '🚲'), countUnit:'台',
      q1Options: ['観光', 'ビジネス', 'その他'], q3Options: Q3_GENERIC, q1Question: 'ご利用目的（任意）', q3Question: 'どのように当店を知りましたか（任意）', storeSpecificNotifSections: [], bookingSources: SOURCES_GENERIC, cutoffRules: CUTOFF_SAME_DAY },
    // car_rental・repair・interview・clinicと同じ理由（旅行代理店・ホテルコンシェルジュ・団体幹事等が
    // 1つの電話番号で複数の異なる利用者分をまとめて予約しがちな業態）で無断キャンセル検知はデフォルトOFF
    // にする（業種経営者陣視点レビュー・ラウンド29での指摘：car_rental等では既に対応済みだったのに、
    // 同じレンタル・レジャー系カテゴリ内のこの3業態だけ見落とされていた）。
    fset: FSET_KASSHIKI_OFF_NOSHOW_OFF,
    questions:[] },
  { key:'leisure_guide', category:'レンタル・レジャー系', label:'レジャー予約（ガイド制／サップ・シュノーケル・ガラス工房等）', icon:'🏄', hint:'ガイド・指導員の人数がボトルネックになる業態向け。日帰り・時間貸しのみ対応（複数日にわたるツアーは終了時刻の表示が崩れます）。',
    settings: { ...assetPerStaffBundle('体験・ツアー', '🏄'), staffLabel:'ガイド', countUnit:'名', visitNoun:'参加',
      q1Options: ['観光・レジャー', '記念日', '団体利用', 'その他'], q3Options: Q3_GENERIC, q1Question: 'ご利用目的（任意）', q3Question: 'どのように当店を知りましたか（任意）', storeSpecificNotifSections: [], bookingSources: SOURCES_GENERIC, cutoffRules: CUTOFF_SAME_DAY },
    // bike_rentalと同じ理由（業種経営者陣視点レビュー・ラウンド29での指摘）
    fset: FSET_KASSHIKI_OFF_NOSHOW_OFF,
    questions:[ Q_STAFF_LABEL([{value:'ガイド',label:'ガイド'},{value:'インストラクター',label:'インストラクター'},{value:'担当者',label:'担当者'}]) ] },
  // 以前はassetByCountBundle（timeSlotモデル、人数分だけ容量を減らす）を使っていたが、ボート等の
  // 「1台に複数人乗れる」器材だと人数分の減算が過小評価になる実バグがあった（業種経営者陣視点レビュー
  // での指摘）。assetPerStaffBundle（perStaffモデル）に変更：1台＝1つの予約枠として扱い、乗員人数は
  // 容量計算に影響しない（car_rental・leisure_guideと同じ、既に実績のある考え方）。
  { key:'leisure_equip', category:'レンタル・レジャー系', label:'レジャー予約（器材制／ボート・レンタル器材数で管理）', icon:'🚤', hint:'器材の台数がボトルネックになる業態向け（1台に複数人乗れる場合も対応）。日帰り・時間貸しのみ対応（複数日にわたる貸出は終了時刻の表示が崩れます）。',
    settings: { ...assetPerStaffBundle('体験・ツアー', '🚤'), staffLabel:'器材', countUnit:'台', visitNoun:'利用',
      q1Options: ['観光・レジャー', '記念日', '団体利用', 'その他'], q3Options: Q3_GENERIC, q1Question: 'ご利用目的（任意）', q3Question: 'どのように当店を知りましたか（任意）', storeSpecificNotifSections: [], bookingSources: SOURCES_GENERIC, cutoffRules: CUTOFF_SAME_DAY },
    // bike_rentalと同じ理由（業種経営者陣視点レビュー・ラウンド29での指摘）
    fset: FSET_KASSHIKI_OFF_NOSHOW_OFF,
    // 「二人乗りボート等、1予約が常に固定人数になる場合」（本ファイル末尾のhint文言・VERTICAL_PRESETS.md
    // プリセット⑧参照）はfixedGuestCount機能がGASハーネスで動作確認済みなのに、car_rental（乗車人数の
    // 選択要否）には同種の問いが導入ウィザードにあるのに対し、器材制レジャーだけ抜けており、ボート屋が
    // この機能の存在に気づけないまま導入する恐れがあった（業種経営者陣視点レビュー・第49回での指摘）。
    // car_rentalの質問文言を器材（乗員）向けに合わせて追加する。
    questions:[
      Q_STAFF_LABEL([{value:'器材',label:'器材'},{value:'ボート',label:'ボート'},{value:'車両',label:'車両'}]),
      { id:'guestCount', question:'ご利用人数（乗員数等）をお客様に選ばせますか？（二人乗りボート等、常に同じ人数の場合は「いいえ」を選び、保存後に設定タブの「固定人数」欄で人数を指定してください）', short:'利用人数の入力', target:'settings', field:'guestCountEnabled', options:[{value:true,label:'はい'},{value:false,label:'いいえ'}] },
    ] },
]

// プリセット＋質問への回答から、実際にsaveSettings/saveFeatureSettingsへ渡すsettingsPatch/fsetPatchを
// 組み立てる。admin.js（SetupWizard、ログイン後の業態プリセット変更）とpages/setup.js（初期設定画面）の
// 両方が全く同じ組み立てロジックを必要としており、以前は2箇所に別々に実装されていた
// （テスト部隊監査・2026-08-10での指摘：ロジックが変わった際に片方だけ直し忘れるdriftリスクがあった）。
export function buildPresetPatch(preset, answers, customText) {
  if (!preset) return { settingsPatch: {}, fsetPatch: {} }
  const settingsPatch = { ...preset.settings }
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
