// 出題計画。どの系統にどの問題タイプを何問作るか（PLAN）、題材のばらつき（THEMES ほか）、
// 難易度 1〜10 の言語化（levelScale / difficultyGuide）、スロットの ID・タグ・題材の決め方をまとめる。
import { SUBSKILLS } from "../../src/lib/domain";
import type { Domain, Slot, TypeSpec } from "./config.mjs";

export const PLAN: Record<Domain, TypeSpec[]> = {
  READ: [
    { key: "summary", kind: "choice", count: 2, label: "要旨把握（本文の主張・要点を選ぶ）", axes: ["READ"], primary: "READ" },
    { key: "inference", kind: "choice", count: 2, label: "推論（書かれていないことを根拠から推し量る）", axes: ["READ"], primary: "READ" },
    { key: "critique", kind: "choice", count: 1, label: "批判的読解（前提・反例・論理の飛躍を見抜く）", axes: ["READ"], primary: "READ" },
    { key: "vocabulary", kind: "choice", count: 1, label: "語彙・表現（文脈での語の意味・言い換え）", axes: ["READ"], primary: "READ" },
    { key: "data", kind: "choice", count: 1, label: "図表・データ読解（文章で示された表や数値を読む。表は行ごとに『項目: 値』で書く）", axes: ["READ"], primary: "READ" },
  ],
  WRITE: [
    { key: "revision", kind: "choice", count: 2, label: "推敲（冗長・曖昧・ねじれを直した最も明確な文を選ぶ）", axes: ["WRITE"], primary: "WRITE" },
    { key: "structure", kind: "choice", count: 2, label: "構成（文や段落の順序・接続詞・主張と根拠の対応を選ぶ）", axes: ["WRITE"], primary: "WRITE" },
    { key: "argument", kind: "free", count: 1, label: "意見文（お題に意見と理由を書く）", axes: ["WRITE"], primary: "WRITE" },
    { key: "summary", kind: "free", count: 1, label: "要約（passage の文章を指定字数で要約する）", axes: ["WRITE"], primary: "WRITE" },
    { key: "rewrite", kind: "free", count: 1, label: "書き換え（指定の条件で文を書き直す: 敬語に／短く／読み手を変えて／結論を先に 等）", axes: ["WRITE"], primary: "WRITE" },
  ],
  CODE: [
    { key: "python", kind: "choice", count: 3, label: "Python 読解（短いコードの出力を予測。passage はコードのみ）", axes: ["CODE"], primary: "CODE" },
    { key: "debug", kind: "choice", count: 1, label: "Python バグ発見（passage は期待どおり動かないコードのみ。prompt に『期待する出力』を明記し、原因の行または正しい修正を選ばせる）", axes: ["CODE"], primary: "CODE" },
    { key: "puzzle", kind: "choice", count: 2, label: "論理パズル（条件から一意に決まる答えを推理。コード不可）", axes: ["CODE"], primary: "CODE" },
    { key: "math", kind: "choice", count: 1, label: "数的推理（数列・場合の数・比率・速さなど。計算は暗算〜筆算で済む範囲）", axes: ["CODE"], primary: "CODE" },
    { key: "algorithm", kind: "choice", count: 1, label: "手順・アルゴリズム（日本語の手順や擬似コードを追って結果や最短手順を答える。Python は使わない）", axes: ["CODE"], primary: "CODE" },
  ],
  MIX: [
    { key: "read_code", kind: "choice", count: 1, label: "複合 READ+LOGIC（文章で示されたルール・条件・データを読み取り、論理的に結論を選ぶ）", axes: ["READ", "CODE"], primary: "CODE" },
    { key: "read_write", kind: "free", count: 1, label: "複合 READ+WRITE（passage の文章を読んで、要約または意見を書く）", axes: ["READ", "WRITE"], primary: "WRITE" },
    { key: "write_code", kind: "free", count: 1, label: "複合 WRITE+LOGIC（手順や条件・簡単なコードの動きを、読み手に分かるよう文章で説明する）", axes: ["WRITE", "CODE"], primary: "WRITE" },
  ],
};

// 題材のばらつき用（index で回す）
export const THEMES = [
  "市立図書館の利用", "商店街の活性化", "天気予報の精度", "部活動の練習方法", "スマートフォンの使い方", "宇宙開発の費用", "発酵食品の歴史",
  "地方鉄道の存続", "睡眠の研究", "リサイクルの仕組み", "音楽の配信サービス", "農業とドローン", "機械翻訳", "在宅勤務", "地図の歴史",
  "都市の緑化", "昆虫食", "博物館の展示", "手紙と電子メール", "自転車通勤", "学校の制服", "災害への備え", "コンビニの24時間営業",
  "観光地の混雑", "水道の老朽化", "紙の辞書と電子辞書", "ボードゲームの流行", "祭りの担い手不足", "電気自動車", "子どもの読書時間",
  "ペットと暮らす", "給食のメニュー", "公園の遊具", "朝のラジオ体操", "図工の時間", "駅前の駐輪場", "校庭の芝生化", "文化祭の出し物",
];
export const PY_TOPICS = [
  "変数と算術・文字列連結", "for とリストの合計", "if/elif の分岐", "リストのスライス", "文字列メソッド（split/join/upper）", "辞書のカウント",
  "while と累積", "ネストしたループ", "関数と戻り値", "sorted と key", "リスト内包表記", "set の演算", "再帰（階乗・フィボナッチ）",
  "enumerate と zip", "文字列の反転・回文", "辞書の更新と get", "例外処理（try/except）", "クロージャ・デフォルト引数", "ジェネレータと next",
  "スタック/キューの操作", "2 次元リスト", "整数の割り算・剰余", "タプルのアンパック", "range のステップ", "文字コード ord/chr", "collections.Counter",
  "itertools（product/combinations）", "ソートの安定性", "浅いコピーと参照", "文字列のフォーマット",
];
export const LOGIC_TOPICS = [
  "並び順の推理", "座席の割り当て", "騎士と悪党（正直者と嘘つき）", "表を使った対応づけ（人・色・飲み物）", "日程の制約からの特定",
  "対偶・逆・裏の判定", "必要条件と十分条件", "手順の最短化（川渡り・移し替え）", "重さ比べ・天秤", "カレンダーと曜日の推理",
  "部屋割りの制約", "スケジュールの矛盾探し", "集合とベン図", "順位と得点の整合", "トーナメントの勝敗推理", "真偽の発言からの犯人特定",
  "条件付きの数え上げ", "偽物のコインを見つける", "地図・方角の推理", "ルールに従う数列",
];
export const MATH_TOPICS = ["数列の規則", "場合の数", "比と割合", "速さ・時間・距離", "平均と合計", "余りの周期", "面積・周の比較", "確率（同様に確からしい）", "年齢算", "仕事算"];
export const ALGO_TOPICS = ["並べ替えの手順（バブルソート風）", "探索の手順（二分探索を日本語で）", "最短経路の手数", "スタックの積み下ろし", "状態遷移（信号・自販機）", "手順の繰り返しと停止条件", "エラトステネスの篩", "ユークリッドの互除法", "キューの処理順", "貪欲法の手順"];
export const WRITE_TOPICS = [
  "接続詞の選択", "文の順序の並べ替え", "主張と根拠の対応", "冗長な語の削除", "一文一義への分割", "指示語の明確化", "段落の要約文",
  "反論への応答", "定義を先に置く構成", "具体例の選び方", "結論を先に述べる書き換え", "曖昧な表現の修正", "比較の対象をそろえる",
  "因果関係の書き方", "読み手に合わせた語の選択", "主語と述語のねじれ", "敬語への書き換え", "箇条書きへの整理",
];

/** 難易度の一般スケール（全系統共通の目安） */
export function levelScale(d: number): string {
  return [
    "",
    "誰でも解ける。小学校中学年でも迷わない。1 つの事実・1 つの手順だけ。",
    "小学校高学年。要素は少なく、注意すれば必ず解ける。",
    "中学生。基本的な読み取り・推論・計算。",
    "高校入門。少し長い本文や 2 段階の推論。",
    "高校標準。複数の条件・観点を同時に扱う。",
    "大学入試基礎。抽象的な語や対比・因果を扱う。",
    "大学入試応用・社会人の実務。見落としやすい条件を含む。",
    "大学上級・専門職。前提や例外を吟味しないと誤る。",
    "専門家・競技レベル。多段の推論と厳密な検証が必要。",
    "非常に難しい。上級者でも数分〜十数分の集中が要り、慎重に検証しないと間違える。",
  ][d];
}

export function difficultyGuide(domain: Domain, key: string, d: number): string {
  const base = `難易度 ${d}/10 — ${levelScale(d)}`;
  if (domain === "READ" || key === "read_code" || key === "read_write") {
    const len = d <= 1 ? "40〜80 字" : d <= 2 ? "60〜110 字" : d <= 3 ? "100〜160 字" : d <= 4 ? "140〜220 字" : d <= 5 ? "180〜280 字" : d <= 6 ? "220〜330 字" : d <= 7 ? "280〜400 字" : d <= 8 ? "350〜480 字" : d <= 9 ? "420〜560 字" : "500〜650 字";
    const q = d <= 2 ? "本文に書いてあることをそのまま確認する設問。" : d <= 4 ? "1 段階の推論や主張と理由の区別。" : d <= 6 ? "譲歩・対比・因果・列挙・具体から抽象などの論理構造を 1 つ以上含み、筆者の立場を読み取る。" : d <= 8 ? "論説調。暗黙の前提・反例・論理の飛躍を見抜く。" : "複数の立場が交錯し、根拠の強さや前提の妥当性を比較して判断する。";
    return `${base} 本文 ${len}。${q}`;
  }
  if (domain === "WRITE" || key === "write_code") {
    if (["argument", "summary", "rewrite", "read_write", "write_code"].includes(key)) {
      const len = d <= 2 ? "40〜70 字" : d <= 4 ? "60〜100 字" : d <= 6 ? "100〜160 字" : d <= 8 ? "150〜220 字" : "200〜280 字";
      const req = d <= 2 ? "一文か二文で意見（または言い換え）を書けばよい。" : d <= 4 ? "意見＋理由 1 つ。" : d <= 6 ? "主張・理由・具体例の 3 要素。" : d <= 8 ? "反対意見への応答を含める。" : "条件付きの結論や複数の観点の整理を含める。";
      return `${base} 模範解答は ${len}（prompt の字数指定もこれに合わせる）。${req}`;
    }
    const q = d <= 2 ? "一文の明らかな誤り（主語述語のねじれ・重複）を直した文を選ぶ。" : d <= 4 ? "2〜3 文の短い段落で、最も自然な順序や接続詞を選ぶ。" : d <= 6 ? "3〜5 文の段落で、主張と根拠の対応・冗長さを判断する。" : d <= 8 ? "段落全体の構成や論理の欠陥（根拠の飛躍・二重基準）を見抜く。" : "微妙な差の選択肢の中から、読み手・目的に最も適した書き方を選ぶ。";
    return `${base} ${q}`;
  }
  if (key === "python" || key === "debug") {
    const lines = d <= 1 ? "1〜3 行（print と足し算・文字列連結だけ）" : d <= 2 ? "2〜5 行（変数の代入と print）" : d <= 3 ? "4〜7 行（for か if を 1 つ）" : d <= 4 ? "6〜10 行（for と if、リストの基本）" : d <= 5 ? "8〜12 行（辞書・スライス・文字列メソッド）" : d <= 6 ? "10〜14 行（関数・while・ネスト 1 段）" : d <= 7 ? "12〜16 行（sorted の key・内包表記・状態更新）" : d <= 8 ? "14〜18 行（再帰・複数の状態の追跡）" : d <= 9 ? "15〜20 行（クロージャ／ジェネレータ／参照の共有）" : "18〜22 行（複合的な状態変化とエッジケース）";
    return `${base} コードは ${lines}。`;
  }
  if (key === "math") return `${base} ${d <= 2 ? "一桁〜二桁の足し引き・簡単な規則。" : d <= 4 ? "基本の割合・平均・簡単な場合の数。" : d <= 6 ? "2 段階の計算や周期性。" : d <= 8 ? "条件の組み合わせ・見落としやすい場合分け。" : "複数条件の厳密な数え上げ。"}`;
  if (key === "algorithm") return `${base} ${d <= 2 ? "2〜3 ステップの手順をそのまま追う。" : d <= 4 ? "5〜8 ステップ、繰り返し 1 つ。" : d <= 6 ? "条件分岐を含む手順の結果。" : d <= 8 ? "最短手順や停止条件の判断。" : "複数の手順の比較・計算量の見積もり。"}`;
  const p = d <= 1 ? "要素 2 つ・条件 1 つ。" : d <= 2 ? "要素 3 つ・条件 2 つ。" : d <= 3 ? "要素 3〜4 つ・条件 2〜3 つ。" : d <= 4 ? "要素 4 つ・条件 3 つ。" : d <= 5 ? "要素 4〜5 つ・条件 4 つ。" : d <= 6 ? "真偽者や表の整理が必要。条件 4〜5 つ。" : d <= 7 ? "複数の制約の同時充足。場合分け 2 通り。" : d <= 8 ? "場合分け 2〜3 通り。見落としやすい条件を 1 つ。" : d <= 9 ? "多段の推論と排反なケース分析。条件 6〜7 個、要素 5〜6 個。" : "条件 7〜8 個、要素 6 個。上級者でも数分かかる密度。";
  return `${base} ${p}`;
}

export function slotKey(s: Slot): string {
  return `${s.domain}:${s.spec.key}:${s.difficulty}:${s.n}`;
}
export function slotId(s: Slot, seq: number): string {
  return `${s.domain.toLowerCase()}-s${s.difficulty}-${String(seq).padStart(2, "0")}`;
}
export function allowedTags(s: Slot): string[] {
  return s.spec.axes.flatMap((a) => SUBSKILLS[a]);
}
export function themeFor(s: Slot, attempt: number): string {
  const i = (s.difficulty * 7 + s.n * 3 + attempt * 11 + s.spec.key.length * 5) % 1000;
  const k = s.spec.key;
  if (k === "python" || k === "debug") return PY_TOPICS[i % PY_TOPICS.length];
  if (k === "puzzle" || k === "read_code") return LOGIC_TOPICS[i % LOGIC_TOPICS.length];
  if (k === "math") return MATH_TOPICS[i % MATH_TOPICS.length];
  if (k === "algorithm" || k === "write_code") return ALGO_TOPICS[i % ALGO_TOPICS.length];
  if (k === "revision" || k === "structure") return WRITE_TOPICS[i % WRITE_TOPICS.length];
  return THEMES[i % THEMES.length];
}

/** 本文の論理構造をスロットごとに回す（同じ難易度帯が同じ型に偏らないように） */
export const STRUCTURES = ["譲歩（一見もっともな反対意見を認めてから主張）", "対比（二つの立場や事例を比べる）", "因果（原因と結果の連鎖）", "列挙と統合（複数の根拠をまとめる）", "具体から抽象（事例から一般則へ）", "問題提起と解決（問いを立てて答える）"];
