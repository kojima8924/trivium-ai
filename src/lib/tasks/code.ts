import type { Task } from "./types";

// CODE: 短いPythonを読む。出力予測・バグ発見・説明。
// ヒントは「一段だけ」。完成コードは含めない。
export const CODE_TASKS: Task[] = [
  {
    id: "code-001",
    domain: "CODE",
    difficulty: 2,
    title: "出力予測: リストのスライス",
    passage: `nums = [3, 1, 4, 1, 5, 9, 2, 6]
print(nums[2:5])`,
    prompt: "このプログラムの出力を答えてください。",
    kind: "short",
    answerKey: ["[4, 1, 5]", "[4,1,5]"],
    hints: [
      "スライス a[i:j] は「i番目から j番目の直前まで」です。終端は含まれません。",
      "nums[2] は 4 です。そこから何個取り出しますか？ j - i 個です。",
      "取り出される要素は index 2, 3, 4 の3つです。それぞれの値を並べてみましょう。",
    ],
    explanation:
      "スライスは半開区間 [i, j) です。index 2,3,4 の要素 4, 1, 5 が取り出されます。",
    skillTags: ["tracing"],
  },
  {
    id: "code-002",
    domain: "CODE",
    difficulty: 3,
    title: "出力予測: ループと累積",
    passage: `total = 0
for i in range(1, 6):
    if i % 2 == 0:
        continue
    total += i
print(total)`,
    prompt: "このプログラムの出力を答えてください。",
    kind: "short",
    answerKey: ["9"],
    hints: [
      "range(1, 6) が生成する数を、まず全部書き出してみましょう。",
      "continue に当たる i はどれですか？ その回は total に足されません。",
      "足されるのは奇数だけです。1, 3, 5 を足すといくつになりますか？",
    ],
    explanation:
      "range(1, 6) は 1〜5。偶数は continue で飛ばされるので、1 + 3 + 5 = 9 です。",
    skillTags: ["tracing"],
  },
  {
    id: "code-003",
    domain: "CODE",
    difficulty: 3,
    title: "バグ発見: 平均値の計算",
    passage: `def average(xs):
    total = 0
    for x in xs:
        total += x
    return total / len(xs) - 1

print(average([2, 4, 6]))`,
    prompt:
      "この関数は「平均値」を返すはずですが、期待通りに動きません。出力される値を答えてください（期待値ではなく、実際の出力です）。",
    kind: "short",
    answerKey: ["3.0", "3"],
    hints: [
      "return の式をよく見てください。演算子の優先順位はどうなっていますか？",
      "total / len(xs) が先に計算され、その後に何が起きますか？",
      "12 / 3 = 4.0 です。そこから 1 を引くといくつですか？",
    ],
    explanation:
      "`total / len(xs) - 1` は (total / len(xs)) - 1 と解釈されます。4.0 - 1 = 3.0 が出力され、平均値になりません。「- 1」が不要なバグです。",
    skillTags: ["debugging", "tracing"],
  },
  {
    id: "code-004",
    domain: "CODE",
    difficulty: 3,
    title: "バグ発見: 最大値を探す",
    passage: `def find_max(xs):
    best = 0
    for x in xs:
        if x > best:
            best = x
    return best

print(find_max([-5, -2, -9]))`,
    prompt: "この関数にはバグがあります。どの入力で問題が起きますか？ 最も適切なものを選んでください。",
    kind: "choice",
    choices: [
      "空のリストを渡したとき",
      "全ての要素が負の数のとき",
      "要素が1つだけのとき",
      "重複した値があるとき",
    ],
    answerKey: ["1"],
    hints: [
      "best の初期値に注目してください。0 から始めるのは常に安全でしょうか？",
      "実際に print の結果を追ってみましょう。-5 > 0 は True ですか？",
      "リストの要素がどれも best の初期値より小さいと、best は一度も更新されません。",
    ],
    explanation:
      "初期値 0 より大きい要素が無いと best が更新されず、0 が返ります。初期値は xs[0] などにするのが定石です。",
    skillTags: ["debugging"],
  },
  {
    id: "code-005",
    domain: "CODE",
    difficulty: 4,
    title: "出力予測: 辞書と文字列",
    passage: `text = "banana"
count = {}
for ch in text:
    count[ch] = count.get(ch, 0) + 1
print(count["a"], len(count))`,
    prompt: "このプログラムの出力を答えてください（スペース区切りで2つの値）。",
    kind: "short",
    answerKey: ["3 3", "3, 3", "3 3"],
    hints: [
      "count.get(ch, 0) は「ch が無ければ 0」を返します。つまり何をしているループですか？",
      "banana に含まれる文字の種類は何種類ですか？ a はいくつありますか？",
      "count は {'b': 1, 'a': 3, 'n': 2} になります。求められている2つの値を並べてみましょう。",
    ],
    explanation:
      "文字の出現回数を数えるループです。a は 3 回、キーの種類は b, a, n の 3 つなので `3 3` が出力されます。",
    skillTags: ["tracing", "algorithms"],
  },
  {
    id: "code-006",
    domain: "CODE",
    difficulty: 4,
    title: "アルゴリズム: 二分探索の終了条件",
    passage: `def search(xs, target):
    lo, hi = 0, len(xs) - 1
    while lo < hi:
        mid = (lo + hi) // 2
        if xs[mid] == target:
            return mid
        elif xs[mid] < target:
            lo = mid + 1
        else:
            hi = mid - 1
    return -1

print(search([1, 3, 5, 7], 7))`,
    prompt: "このプログラムの出力を答えてください。",
    kind: "short",
    answerKey: ["-1"],
    hints: [
      "while の条件は lo < hi です。lo == hi のとき、ループは実行されますか？",
      "lo と hi の値を1周ごとに書き出してみましょう。最後にどうなりますか？",
      "lo=3, hi=3 になった瞬間にループが終わります。xs[3] は調べられましたか？",
    ],
    explanation:
      "lo < hi だと lo == hi の要素（ここでは 7）を調べずに終了するため -1 が返ります。正しくは lo <= hi です。",
    skillTags: ["algorithms", "debugging"],
  },
  {
    id: "code-007",
    domain: "CODE",
    difficulty: 3,
    title: "設計の言語化: なぜ関数に分けるのか",
    passage: `# 同じ計算が3か所にコピーされているプログラムがあります。
# あなたはそれを1つの関数にまとめることを提案します。`,
    prompt:
      "このリファクタリングの利点を、初心者に伝わるように100〜200字で説明してください（「短くなる」以外の理由を最低1つ含めること）。",
    kind: "free",
    rubric: {
      minLength: 60,
      maxLength: 400,
      mustInclude: ["修正", "変更", "バグ", "テスト", "一か所", "一箇所", "1か所", "1箇所", "再利用", "名前"],
      criteria: [
        "修正が一か所で済む（変更に強い）ことに触れているか",
        "名前が付くことで意図が読みやすくなることに触れているか",
        "初心者に伝わる平易な言葉か",
      ],
    },
    hints: [
      "「もし計算式に間違いが見つかったら、3か所を直す必要がある」という状況を想像してみてください。",
      "関数には名前が付きます。名前があると、読む人にとって何が変わりますか？",
      "「直す場所が1つになる」「名前で意図が伝わる」の2点を、自分の言葉で書いてみましょう。",
    ],
    explanation:
      "主な利点は (1) 修正が一か所で済み、変更に強くなる (2) 名前が付いて意図が伝わる (3) 単体でテストしやすくなる、です。",
    skillTags: ["design"],
  },
  {
    id: "code-008",
    domain: "CODE",
    difficulty: 2,
    title: "出力予測: 文字列の反転",
    passage: `s = "trivium"
print(s[::-1][:3])`,
    prompt: "このプログラムの出力を答えてください。",
    kind: "short",
    answerKey: ["mui"],
    hints: [
      "s[::-1] はステップ -1 のスライスです。文字列がどうなるか書き出してみましょう。",
      "反転すると 'muivirt' です。そこから [:3] は何文字取りますか？",
      "'muivirt' の先頭3文字を答えてください。",
    ],
    explanation: "s[::-1] で 'muivirt' に反転し、先頭3文字 'mui' が出力されます。",
    skillTags: ["tracing"],
  },
];
