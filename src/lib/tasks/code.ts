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
      "「total / len(xs) - 1」は (total / len(xs)) - 1 と解釈されます。4.0 - 1 = 3.0 が出力され、平均値になりません。「- 1」が不要なバグです。",
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
      "文字の出現回数を数えるループです。a は 3 回、キーの種類は b, a, n の 3 つなので「3 3」が出力されます。",
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
  {
    id: "code-009",
    domain: "CODE",
    difficulty: 1,
    title: "出力予測: 整数の割り算",
    passage: `x = 7
y = x // 2
print(y)`,
    prompt: "このプログラムの出力を答えてください。",
    kind: "short",
    answerKey: ["3"],
    hints: [
      "// は割り算ですが、ふつうの / と何が違うか思い出してみましょう。",
      "7 を 2 で割ると 3.5 です。// はそのあと何をしますか。",
      "小数点以下を切り捨てた結果を答えてみましょう。",
    ],
    explanation:
      "「//」は整数除算で、小数部分を切り捨てます。7 // 2 は 3.5 の小数点以下を捨てて 3 になります（/ を使うと 3.5 のままです）。",
    skillTags: ["tracing"],
  },
  {
    id: "code-010",
    domain: "CODE",
    difficulty: 3,
    title: "バグ発見: デフォルト引数のリスト",
    passage: `def add_item(item, items=[]):
    items.append(item)
    return items

print(add_item("a"))
print(add_item("b"))`,
    prompt: "2回目の print が出力する内容を答えてください。",
    kind: "short",
    answerKey: ["['a', 'b']", "[a, b]"],
    hints: [
      "関数を2回呼んだとき、items はそれぞれ新しく作られていますか。",
      "デフォルト値の [] は、関数が呼ばれるたびではなく、関数が定義されたときに1回だけ作られます。",
      "1回目の呼び出しで追加した要素が2回目にも残っていると考えて、中身を書き出してみましょう。",
    ],
    explanation:
      "デフォルト引数は関数定義時に1度だけ評価され、同じリストが呼び出し間で共有されます。そのため2回目は1回目の要素が残った状態に追加されます。回避するには items=None にして、関数の中で新しいリストを作ります。",
    skillTags: ["debugging"],
  },
  {
    id: "code-011",
    domain: "CODE",
    difficulty: 3,
    title: "出力予測: コピーしたつもりのリスト",
    passage: `a = [[0, 0], [0, 0]]
b = a[:]
b[0][0] = 9
print(a[0][0])`,
    prompt: "このプログラムの出力を答えてください。",
    kind: "short",
    answerKey: ["9"],
    hints: [
      "a[:] は何を複製しますか。外側のリストでしょうか、中の要素でしょうか。",
      "b[0] と a[0] は、同じリストを指していませんか。",
      "b[0][0] を書き換えたとき、a[0] の中身がどうなるか順に追ってみましょう。",
    ],
    explanation:
      "a[:] は浅いコピーで、新しく作られるのは外側のリストだけです。内側のリストは共有されたままなので、b[0][0] の変更が a[0][0] にも現れます。中身ごと複製するには copy.deepcopy を使います。",
    skillTags: ["tracing", "debugging"],
  },
  {
    id: "code-012",
    domain: "CODE",
    difficulty: 4,
    title: "アルゴリズム: 重複判定の計算量",
    passage: `def has_duplicate(items):
    seen = []
    for x in items:
        if x in seen:
            return True
        seen.append(x)
    return False`,
    prompt: "この関数の計算量と改善についての説明として、最も適切なものを選んでください。",
    kind: "choice",
    choices: [
      "要素数 n に対しておよそ n 回の比較で済んでおり、これ以上速くする方法はない",
      "x in seen がリストの走査になるため、最悪でおよそ n の2乗回の比較になる。seen を集合にすれば大きく減らせる",
      "リストより集合のほうが常にメモリを使わないので、集合にすべきである",
      "for ループを while ループに書き換えれば、比較の回数が減って速くなる",
    ],
    answerKey: ["1"],
    hints: [
      "x in seen は、seen の要素を何個調べる可能性がありますか。",
      "その処理がループの中で毎回行われると、全体では何回の比較になりますか。",
      "探索を速くできるデータ構造に置き換えられないか考えてみましょう。",
    ],
    explanation:
      "リストに対する in は先頭から順に探すため、最悪で seen の長さ分の比較が必要です。それがループのたびに繰り返されるので、全体はおよそ n の2乗回になります。seen を集合（set）にすると判定が平均的に一定時間になり、全体をおよそ n 回に減らせます（そのぶんメモリは使います）。",
    skillTags: ["algorithms"],
  },
  {
    id: "code-013",
    domain: "CODE",
    difficulty: 2,
    title: "出力予測: 分割と末尾の要素",
    passage: `words = "the quick brown fox".split()
print(len(words), words[-1])`,
    prompt: "このプログラムの出力を答えてください（スペース区切りで2つの値）。",
    kind: "short",
    answerKey: ["4 fox"],
    hints: [
      "split() は何を区切りに使いますか。いくつの単語に分かれるでしょう。",
      "words[-1] は末尾から数えた位置です。どの単語を指しますか。",
      "単語数と最後の単語を、スペース区切りで並べてみましょう。",
    ],
    explanation:
      "split() は空白で区切って4つの単語のリストを作ります。-1 は末尾の要素を指すので、出力は 4 fox になります。",
    skillTags: ["tracing"],
  },
  {
    id: "code-014",
    domain: "CODE",
    difficulty: 5,
    title: "設計の言語化: 1つの関数に詰め込みすぎ",
    passage: `# ある1つの関数が、次のすべてを行っています。
#   1. CSVファイルを読み込む
#   2. 数値を集計する
#   3. 結果をHTMLに整形する
#   4. メールで送信する`,
    prompt:
      "この関数を分割すべき理由と、どこで切るかを、テストのしやすさに触れながら150〜300字で説明してください。",
    kind: "free",
    rubric: {
      minLength: 100,
      maxLength: 450,
      mustInclude: ["テスト", "分け", "分割", "責務", "役割", "変更", "差し替え", "入出力", "副作用", "再利用"],
      criteria: [
        "1つの関数が複数の責務を持つことの問題を指摘しているか",
        "どこで分割するかを具体的に述べているか",
        "テストのしやすさ（入出力と計算を分ける利点）に触れているか",
      ],
    },
    hints: [
      "この関数だけを試したいとき、何が必要になりますか。ファイル、それともメールサーバーでしょうか。",
      "外部とやりとりする部分（読み込みと送信）と、計算だけの部分を分けられませんか。",
      "入力・計算・出力のどこに線を引くと、計算部分だけを単体で確かめられるか考えてみましょう。",
    ],
    explanation:
      "1つの関数が入力・計算・整形・送信という別々の責務を抱えているため、集計ロジックだけを確かめたいのに、実ファイルとメール送信まで必要になります。読み込み・集計・整形・送信に分ければ、集計は入力と期待値だけでテストできる純粋な関数になり、送信部分も差し替えやすくなります。",
    skillTags: ["design"],
  },
  {
    id: "code-015",
    domain: "CODE",
    difficulty: 3,
    title: "設計の言語化: 例外を握りつぶす",
    passage: `def load_config(path):
    try:
        with open(path) as f:
            return parse(f.read())
    except Exception:
        return {}`,
    prompt: "この書き方の問題として、最も適切なものを選んでください。",
    kind: "choice",
    choices: [
      "try を使うこと自体が誤りで、例外は使うべきではない",
      "すべての例外を握りつぶして空の設定を返すため、失敗の原因を呼び出し側が区別できない",
      "with を使うとファイルが閉じられないので危険である",
      "戻り値を辞書にしているのが誤りで、常にリストを返すべきである",
    ],
    answerKey: ["1"],
    hints: [
      "except Exception は、どこまで広い範囲の失敗を受け止めますか。",
      "ファイルが無い場合と、中身が壊れている場合とで、呼び出し側は違いに気づけますか。",
      "戻り値が空の辞書だったとき、原因を知る手段が残っているか考えてみましょう。",
    ],
    explanation:
      "広すぎる except で失敗を握りつぶすと、ファイル不在・書式エラー・権限不足がすべて同じ空の辞書になり、呼び出し側も利用者も原因を追えません。捕捉する例外を絞る、ログを残す、失敗を戻り値や例外で区別する、といった対処が必要です。",
    skillTags: ["design", "debugging"],
  },
];
