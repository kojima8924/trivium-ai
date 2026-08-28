// 自動生成ファイル（scripts/stock/gen_stock.mts が書き出す）。手で編集しない。
// CODE: 70 問（difficulty 1〜10・問題タイプ付き）。生成: gpt-5.5 / 検証: Python 実行 + 独立ソルバー gpt-5.5 + レビュー gpt-5.4-mini
import type { Task } from "../types";

export const CODE_STOCK: Task[] = [
  {
    "id": "code-s1-01",
    "domain": "CODE",
    "difficulty": 1,
    "title": "足し算の出力",
    "passage": "print(2 + 3)",
    "prompt": "このコードを実行すると、何が出力されますか。",
    "kind": "choice",
    "taskType": "python",
    "hints": [
      "print の中には何が書かれていますか。",
      "数字どうしの + は、文字をつなぐのではなく計算します。",
      "2 と 3 を足した結果が画面に表示されます。"
    ],
    "explanation": "print(2 + 3) は、2 と 3 を足した結果を表示します。2 + 3 は 5 なので、出力は 5 です。",
    "skillTags": [
      "tracing"
    ],
    "choices": [
      "6",
      "5",
      "23",
      "2 + 3"
    ],
    "answerKey": [
      "1"
    ]
  },
  {
    "id": "code-s1-02",
    "domain": "CODE",
    "difficulty": 1,
    "title": "足し算の出力",
    "passage": "print(2 + 3)",
    "prompt": "このコードを実行すると、何が出力されますか。",
    "kind": "choice",
    "taskType": "python",
    "hints": [
      "print の中には、何が書かれていますか。",
      "記号 + は、数字どうしでは足し算を表します。",
      "先に 2 と 3 を足して、その結果が表示されます。"
    ],
    "explanation": "2 + 3 は足し算なので 5 になります。print はその結果を表示します。",
    "skillTags": [
      "tracing"
    ],
    "choices": [
      "23",
      "5",
      "2 + 3",
      "6"
    ],
    "answerKey": [
      "1"
    ]
  },
  {
    "id": "code-s1-03",
    "domain": "CODE",
    "difficulty": 1,
    "title": "足し算の出力",
    "passage": "print(2 + 3)",
    "prompt": "このコードを実行すると、何が表示されますか。",
    "kind": "choice",
    "taskType": "python",
    "hints": [
      "print の中には何が入っていますか。",
      "数字どうしの + は、文字をつなげるのではなく計算します。",
      "まず 2 と 3 を足してから、その結果が表示されます。"
    ],
    "explanation": "2 + 3 は数の足し算なので 5 になります。print はその結果を表示します。",
    "skillTags": [
      "tracing"
    ],
    "choices": [
      "23",
      "2 + 3",
      "6",
      "5"
    ],
    "answerKey": [
      "3"
    ]
  },
  {
    "id": "code-s1-04",
    "domain": "CODE",
    "difficulty": 1,
    "title": "箱の上の積み木",
    "passage": "箱には積み木が下から順に「赤、青」と積まれています。\n手順は次のとおりです。\n1. 「緑」を一番上に置く。\n2. 一番上の積み木を1つ取る。\n3. 「黄」を一番上に置く。",
    "prompt": "最後に、一番上にある積み木の色はどれですか。",
    "kind": "choice",
    "taskType": "algorithm",
    "hints": [
      "いま一番上にある積み木は、手順ごとにどう変わりますか。",
      "「置く」は上に増え、「取る」は上の1つがなくなることに注目しましょう。",
      "最初の一番上から、1、2、3の順に上の色だけを追ってみましょう。"
    ],
    "explanation": "最初の一番上は青です。緑を置くと緑が一番上になり、それを取ると青に戻ります。最後に黄を置くので、一番上は黄です。",
    "skillTags": [
      "tracing",
      "algorithms"
    ],
    "choices": [
      "黄",
      "緑",
      "赤",
      "青"
    ],
    "answerKey": [
      "0"
    ]
  },
  {
    "id": "code-s1-05",
    "domain": "CODE",
    "difficulty": 1,
    "title": "3つでくり返す数",
    "passage": "あるカードには、1、2、3、1、2、3、……の順に、同じ規則で数が書かれています。",
    "prompt": "8枚目のカードに書かれている数はどれですか。",
    "kind": "choice",
    "taskType": "math",
    "hints": [
      "最初から順番に数えると、8枚目はどこに来ますか。",
      "1、2、3で1組になって、また1にもどります。",
      "6枚目まで数えると、次は7枚目、8枚目です。"
    ],
    "explanation": "カードは1、2、3をくり返します。1〜6枚目で2回くり返し、7枚目が1、8枚目が2です。",
    "skillTags": [
      "tracing"
    ],
    "choices": [
      "8",
      "1",
      "2",
      "3"
    ],
    "answerKey": [
      "2"
    ]
  },
  {
    "id": "code-s1-06",
    "domain": "CODE",
    "difficulty": 1,
    "title": "赤いものはどれ",
    "passage": "机の上に、りんごとバナナがあります。\n赤いものは、りんごだけです。",
    "prompt": "赤いものの集合に入るものはどれですか。",
    "kind": "choice",
    "taskType": "puzzle",
    "hints": [
      "赤いものだと書かれているのは、どちらですか。",
      "「だけ」という言葉に注目しましょう。",
      "2つのものを1つずつ見て、赤いものかどうかを確かめましょう。"
    ],
    "explanation": "「赤いものは、りんごだけです」とあるので、赤いものの集合に入るのはりんごです。",
    "skillTags": [
      "tracing"
    ],
    "choices": [
      "りんご",
      "バナナ",
      "りんごとバナナ",
      "どちらも入らない"
    ],
    "answerKey": [
      "0"
    ]
  },
  {
    "id": "code-s1-08",
    "domain": "CODE",
    "difficulty": 1,
    "title": "つなぎ語の追加",
    "passage": "print('りんご' + 'みかん')",
    "prompt": "次のコードは期待どおり動きません。期待する出力は「りんごとみかん」ですが、実際の出力は「りんごみかん」です。正しい修正を選んでください。",
    "kind": "choice",
    "taskType": "debug",
    "hints": [
      "期待する出力と実際の出力を見比べると、何が足りませんか。",
      "文字列は + で左から順につながります。",
      "入れたい文字が、2つの言葉のどこに来るべきかを考えましょう。"
    ],
    "explanation": "実際の出力には「と」がありません。'りんご' と 'みかん' の間に 'と' を足せば、期待する「りんごとみかん」になります。",
    "skillTags": [
      "debugging",
      "tracing"
    ],
    "choices": [
      "1行目を print('と' + 'りんご' + 'みかん') に直す。",
      "1行目を print('りんご' + 'みかん') のままにする。",
      "1行目を print('りんご' + 'と' + 'みかん') に直す。",
      "1行目を print('りんご' + 'みかん' + 'と') に直す。"
    ],
    "answerKey": [
      "2"
    ]
  },
  {
    "id": "code-s2-01",
    "domain": "CODE",
    "difficulty": 2,
    "title": "回文チェック",
    "passage": "word = \"level\"\nrev = word[::-1]\nprint(word == rev)",
    "prompt": "このPythonコードを実行すると、何が出力されますか。",
    "kind": "choice",
    "taskType": "python",
    "hints": [
      "print に渡されているものは、文字そのものですか、それとも比べた結果ですか。",
      "word と rev が同じになるかを考えましょう。",
      "== は、左右が等しければ真偽値を返します。"
    ],
    "explanation": "word は level、rev はそれを逆順にした level です。2つは同じなので、word == rev の結果が出力されます。",
    "skillTags": [
      "tracing"
    ],
    "choices": [
      "level",
      "levellevel",
      "True",
      "False"
    ],
    "answerKey": [
      "2"
    ]
  },
  {
    "id": "code-s2-02",
    "domain": "CODE",
    "difficulty": 2,
    "title": "代入と計算",
    "passage": "a = 4\nb = a + 3\nprint(b * 2)",
    "prompt": "このコードを実行すると、何が出力されますか。",
    "kind": "choice",
    "taskType": "python",
    "hints": [
      "a と b には、それぞれどんな値が入りますか。",
      "先に a + 3 を計算してから、print の中を計算します。",
      "最後の行では、b の値を 2 倍しています。"
    ],
    "explanation": "a は 4、b は 4 + 3 なので 7 です。最後に b * 2、つまり 7 * 2 が出力されるため、14 になります。",
    "skillTags": [
      "tracing"
    ],
    "choices": [
      "11",
      "17",
      "24",
      "14"
    ],
    "answerKey": [
      "3"
    ]
  },
  {
    "id": "code-s2-03",
    "domain": "CODE",
    "difficulty": 2,
    "title": "表の中の和",
    "passage": "grid = [[1, 2], [3, 4]]\nx = grid[0][1] + grid[1][0]\nprint(x)",
    "prompt": "このコードを実行すると、何が出力されますか。",
    "kind": "choice",
    "taskType": "python",
    "hints": [
      "どの場所の数字を取り出しているでしょうか。",
      "grid[0] は最初のリスト、grid[1] は次のリストです。",
      "取り出した2つの数字を足してから print します。"
    ],
    "explanation": "grid[0][1] は最初のリスト [1, 2] の2番目なので 2、grid[1][0] は次のリスト [3, 4] の1番目なので 3 です。2 + 3 で 5 が出力されます。",
    "skillTags": [
      "tracing"
    ],
    "choices": [
      "5",
      "3",
      "6",
      "[2, 3]"
    ],
    "answerKey": [
      "0"
    ]
  },
  {
    "id": "code-s2-04",
    "domain": "CODE",
    "difficulty": 2,
    "title": "ジュースの割合",
    "passage": "ジュースを作るとき、シロップと水を 1:4 の割合で混ぜます。シロップを 3 杯使いました。",
    "prompt": "同じ割合で作るには、水は何杯必要ですか。",
    "kind": "choice",
    "taskType": "math",
    "hints": [
      "シロップ1杯に対して、水は何杯ですか。",
      "シロップが3倍になると、水の量も同じように変わります。",
      "1:4 の「4」に、シロップの杯数に合わせた数をかけて考えましょう。"
    ],
    "explanation": "シロップと水の割合は 1:4 なので、シロップ1杯につき水4杯です。シロップが3杯なら、水は 4×3=12 杯です。",
    "skillTags": [
      "algorithms"
    ],
    "choices": [
      "15杯",
      "12杯",
      "7杯",
      "9杯"
    ],
    "answerKey": [
      "1"
    ]
  },
  {
    "id": "code-s2-05",
    "domain": "CODE",
    "difficulty": 2,
    "title": "3つの数の順番",
    "passage": "3つの数 2、4、6 を、それぞれ1回ずつ使って、左から順に並べます。\n条件は次の2つです。\n1. いちばん左の数は、いちばん右の数より4小さい。\n2. 真ん中の数は、いちばん左の数より2大きい。",
    "prompt": "条件に合う並びはどれですか。",
    "kind": "choice",
    "taskType": "puzzle",
    "hints": [
      "左、真ん中、右の3つの場所に、どの数が入るでしょうか。",
      "「左は右より4小さい」という条件から、左と右の組み合わせを考えましょう。",
      "真ん中の数が、左の数よりちょうど2大きいかを確かめましょう。"
    ],
    "explanation": "左の数が右の数より4小さいので、左は2、右は6になります。真ん中は左より2大きいので4です。したがって並びは「2、4、6」です。",
    "skillTags": [
      "tracing"
    ],
    "choices": [
      "4、2、6",
      "6、4、2",
      "2、4、6",
      "2、6、4"
    ],
    "answerKey": [
      "2"
    ]
  },
  {
    "id": "code-s2-06",
    "domain": "CODE",
    "difficulty": 2,
    "title": "おやつの選び方",
    "passage": "遠足のおやつを、クッキー・せんべい・グミの3種類から選びます。同じ種類は1個までです。\n条件1：必ず2種類を選ぶ。\n条件2：グミを選ぶなら、クッキーも選ぶ。",
    "prompt": "条件に合うおやつの選び方は何通りありますか。",
    "kind": "choice",
    "taskType": "puzzle",
    "hints": [
      "まず、2種類を選ぶ組み合わせにはどんなものがありますか。",
      "条件2は、グミが入っている組み合わせだけに注目すると確かめやすいです。",
      "2種類の組をすべて書き出し、条件に合わないものを消して数えましょう。"
    ],
    "explanation": "2種類の組み合わせは、クッキーとせんべい、クッキーとグミ、せんべいとグミの3つです。このうち、せんべいとグミは「グミを選ぶならクッキーも選ぶ」に合いません。残るのは2通りです。",
    "skillTags": [
      "tracing"
    ],
    "choices": [
      "2通り",
      "3通り",
      "4通り",
      "1通り"
    ],
    "answerKey": [
      "0"
    ]
  },
  {
    "id": "code-s2-07",
    "domain": "CODE",
    "difficulty": 2,
    "title": "カードの並べ替え",
    "passage": "机の上に、左から順に 4、1、3 のカードが並んでいます。次の手順を上から順に1回ずつ行います。手順1：左から1番目と2番目を比べ、左の数のほうが大きければ入れ替える。手順2：左から2番目と3番目を比べ、左の数のほうが大きければ入れ替える。手順3：左から1番目と2番目を比べ、左の数のほうが大きければ入れ替える。",
    "prompt": "手順3まで終わったあと、カードは左からどの順に並んでいますか。",
    "kind": "choice",
    "taskType": "algorithm",
    "hints": [
      "最初に比べるのは、どの2枚のカードですか。",
      "入れ替えたあとは、次の手順で比べる場所が変わることに注意しましょう。",
      "各手順のあとに、左からの並びをメモすると追いやすくなります。"
    ],
    "explanation": "最初は 4、1、3 です。手順1で 4 と 1 を比べ、4 のほうが大きいので入れ替えて 1、4、3。手順2で 4 と 3 を比べ、入れ替えて 1、3、4。手順3で 1 と 3 を比べると入れ替えないので、最後は 1、3、4 です。",
    "skillTags": [
      "tracing",
      "algorithms"
    ],
    "choices": [
      "1、3、4",
      "1、4、3",
      "3、1、4",
      "4、1、3"
    ],
    "answerKey": [
      "0"
    ]
  },
  {
    "id": "code-s2-08",
    "domain": "CODE",
    "difficulty": 2,
    "title": "点数の表示修正",
    "passage": "name = \"ミカ\"\nscore = 80\nprint(\"{name}さんは{score}点です\")",
    "prompt": "このコードは期待どおり動きません。\n期待する出力:\nミカさんは80点です\n\n実際の出力:\n{name}さんは{score}点です\n\n正しく表示するための修正として、最も適切なものを選んでください。",
    "kind": "choice",
    "taskType": "debug",
    "hints": [
      "出力したい文の中で、変数の中身を使うにはどうすればよいでしょうか。",
      "今の3行目では、波かっこの中身がそのまま文字として扱われています。",
      "文字列の前に付ける記号で、波かっこ内の変数を値に置きかえられます。"
    ],
    "explanation": "3行目の文字列は通常の文字列なので、{name}や{score}がそのまま表示されます。先頭にfを付けたf文字列にすると、変数nameとscoreの値に置きかえられ、期待する出力になります。",
    "skillTags": [
      "debugging",
      "tracing"
    ],
    "choices": [
      "3行目を print(\"nameさんはscore点です\") にする",
      "3行目を print(f\"{name}さんは{score}点です\") にする",
      "1行目を name = \"{ミカ}\" にする",
      "2行目を score = \"80点\" にする"
    ],
    "answerKey": [
      "1"
    ]
  },
  {
    "id": "code-s3-01",
    "domain": "CODE",
    "difficulty": 3,
    "title": "商と余りの合計",
    "passage": "total = 0\nfor n in range(1, 6):\n    total += n // 2\n    total += n % 2\nprint(total)",
    "prompt": "このコードを実行したとき、出力はどれですか。",
    "kind": "choice",
    "taskType": "python",
    "hints": [
      "range(1, 6) で、n はどの整数を順番に取りますか。",
      "各 n について、n // 2 と n % 2 を別々に計算してみましょう。",
      "total に毎回どれだけ足されるかを表にして、最後に合計を確認しましょう。"
    ],
    "explanation": "n は 1, 2, 3, 4, 5 と変化します。それぞれ n // 2 と n % 2 の合計は 1, 1, 2, 2, 3 なので、total は 9 になります。",
    "skillTags": [
      "tracing"
    ],
    "choices": [
      "8",
      "10",
      "15",
      "9"
    ],
    "answerKey": [
      "3"
    ]
  },
  {
    "id": "code-s3-02",
    "domain": "CODE",
    "difficulty": 3,
    "title": "文字を1つ進める",
    "passage": "text = \"AZ\"\nresult = \"\"\nfor ch in text:\n    result += chr(ord(ch) + 1)\nprint(result)",
    "prompt": "この Python コードを実行したとき、出力はどれですか。",
    "kind": "choice",
    "taskType": "python",
    "hints": [
      "各文字は、どの順番で result に追加されますか。",
      "ord(ch) は文字を番号に変え、chr(...) は番号を文字に戻します。",
      "アルファベットの Z の次が、必ず A になるとは限りません。"
    ],
    "explanation": "A は ord で 65、1 を足すと 66 なので B になります。Z は 90、1 を足すと 91 で、chr(91) は [ です。したがって出力は B[ です。",
    "skillTags": [
      "tracing"
    ],
    "choices": [
      "AZ",
      "A[",
      "BA",
      "B["
    ],
    "answerKey": [
      "3"
    ]
  },
  {
    "id": "code-s3-03",
    "domain": "CODE",
    "difficulty": 3,
    "title": "同点の並び順",
    "passage": "items = [('A', 2), ('B', 1), ('C', 2), ('D', 1)]\nitems.sort(key=lambda x: x[1])\nfor name, score in items:\n    print(name, score)",
    "prompt": "このコードを実行したときの出力はどれですか。",
    "kind": "choice",
    "taskType": "python",
    "hints": [
      "sort は、どの値を見て並べ替えていますか。",
      "key=lambda x: x[1] なので、各組の2番目の数に注目します。",
      "同じ数どうしは、もとの順番がどうなるかを考えましょう。"
    ],
    "explanation": "sort は各タプルの2番目の値で並べ替えます。値が1の B と D が先に来て、値が2の A と C が後に来ます。同じ値の中では元の順番が保たれるため、この出力になります。",
    "skillTags": [
      "tracing",
      "algorithms"
    ],
    "choices": [
      "A 2\nB 1\nC 2\nD 1",
      "B 1\r\nD 1\r\nA 2\r\nC 2",
      "D 1\nB 1\nC 2\nA 2",
      "B 1\nA 2\nC 2\nD 1"
    ],
    "answerKey": [
      "1"
    ]
  },
  {
    "id": "code-s3-04",
    "domain": "CODE",
    "difficulty": 3,
    "title": "文字数カウント修正",
    "passage": "word = \"banana\"\ncounts = {}\nfor ch in word:\n    counts[ch] = 1\nprint(counts)",
    "prompt": "このコードは、文字列 word に含まれる各文字の数を数えたいものです。\n期待する出力:\n{'b': 1, 'a': 3, 'n': 2}\n実際の出力:\n{'b': 1, 'a': 1, 'n': 1}\n正しい修正はどれですか。",
    "kind": "choice",
    "taskType": "debug",
    "hints": [
      "同じ文字が2回目に出てきたとき、今のコードでは何が起きていますか。",
      "文字ごとに、前の回数を取り出して1増やす必要があります。",
      "まだ登録されていない文字の回数は、最初は0として考えるとよいです。"
    ],
    "explanation": "現在のコードは、どの文字が出てきても毎回 counts[ch] に 1 を入れるため、重複した回数が増えません。counts.get(ch, 0) で今までの回数を取り出し、1を足して保存すれば正しく数えられます。",
    "skillTags": [
      "debugging",
      "tracing"
    ],
    "choices": [
      "counts[ch] = counts.get(ch, 0) + 1 に直す",
      "counts[ch] = counts.get(ch, 1) + 1 に直す",
      "counts = {} を counts = [] に直す",
      "for ch in word: を for ch in counts: に直す"
    ],
    "answerKey": [
      "0"
    ]
  },
  {
    "id": "code-s3-05",
    "domain": "CODE",
    "difficulty": 3,
    "title": "青いカップの飲み物",
    "passage": "3人の生徒、春、澪、颯太がいます。3人はそれぞれ、赤・青・緑のうち別々の色のカップを1つずつ使い、紅茶・牛乳・ジュースのうち別々の飲み物を1つずつ飲みました。\n\n条件は次の3つです。\n1. 春は紅茶を飲みました。\n2. 青いカップに入っているのはジュースです。\n3. 澪は青いカップを使っていません。",
    "prompt": "ジュースを飲んだのは誰ですか。",
    "kind": "choice",
    "taskType": "puzzle",
    "hints": [
      "青いカップを使った人は、どの飲み物を飲んだことになりますか。",
      "春の飲み物と、澪が使っていない色に注目しましょう。",
      "青いカップを使えない人を順に消していくと、残る人が決まります。"
    ],
    "explanation": "青いカップに入っているのはジュースです。春は紅茶なのでジュースではなく、澪は青いカップを使っていません。したがって、青いカップを使ってジュースを飲んだのは颯太です。",
    "skillTags": [
      "tracing"
    ],
    "choices": [
      "澪",
      "颯太",
      "この条件だけでは決められない",
      "春"
    ],
    "answerKey": [
      "1"
    ]
  },
  {
    "id": "code-s3-06",
    "domain": "CODE",
    "difficulty": 3,
    "title": "余りで求める数",
    "passage": "次の手順で、2つの数 A と B を変えていく。\n\nはじめに A=84、B=30 とする。\n1. B が 0 なら、A を結果として終了する。\n2. A を B で割った余りを R とする。\n3. A に B の値を入れ、B に R の値を入れる。\n4. 手順1に戻る。",
    "prompt": "この手順が終了したときの結果と、手順2を実行した回数の組として正しいものはどれですか。",
    "kind": "choice",
    "taskType": "algorithm",
    "hints": [
      "A と B は、1回のくり返しごとにどの値へ変わりますか。",
      "手順2で出した余り R が、次の B になることに注目しましょう。",
      "B が 0 になった直後に終了判定をします。余りを出した回数も数え忘れないようにしましょう。"
    ],
    "explanation": "84÷30の余りは24なので A=30、B=24。次に30÷24の余りは6なので A=24、B=6。次に24÷6の余りは0なので A=6、B=0。手順1でBが0となり終了し、結果は6です。手順2は3回実行されています。",
    "skillTags": [
      "tracing",
      "algorithms"
    ],
    "choices": [
      "結果は24、手順2は1回",
      "結果は0、手順2は3回",
      "結果は6、手順2は3回",
      "結果は6、手順2は2回"
    ],
    "answerKey": [
      "2"
    ]
  },
  {
    "id": "code-s3-07",
    "domain": "CODE",
    "difficulty": 3,
    "title": "花だんの手入れ",
    "passage": "ある花だんの手入れを、あきらさんだけで行うと12日、みなさんだけで行うと18日かかります。2人でいっしょに3日間作業したあと、あきらさんは別の作業に移り、残りはみなさんだけで続けました。",
    "prompt": "花だんの手入れがすべて終わるのは、作業を始めてから何日後ですか。",
    "kind": "choice",
    "taskType": "math",
    "hints": [
      "1日で、あきらさんとみなさんはそれぞれ全体のどれだけ進められますか。",
      "まず、2人で3日間作業した分を全体に対する割合で考えましょう。",
      "残りの割合を、みなさん1人の1日分で割ると、追加で必要な日数がわかります。"
    ],
    "explanation": "あきらさんは1日に全体の1/12、みなさんは1日に1/18進めます。2人では1日に1/12＋1/18＝5/36なので、3日で5/12進みます。残りは7/12です。みなさんだけだと、7/12÷1/18＝10.5日かかります。最初の3日を足して13.5日後です。",
    "skillTags": [
      "tracing",
      "algorithms"
    ],
    "choices": [
      "21日後",
      "13.5日後",
      "10.5日後",
      "15日後"
    ],
    "answerKey": [
      "1"
    ]
  },
  {
    "id": "code-s3-08",
    "domain": "CODE",
    "difficulty": 3,
    "title": "青い名札の条件",
    "passage": "ある学校で、ミナ、ソラ、カイの3人について、次のことだけが分かっています。\n\n・図書係の生徒は必ず青い名札をつけている。\n・青い名札をつけている生徒は必ず朝の集会に参加した。\n・ミナは朝の集会に参加しなかった。ソラは青い名札をつけていた。カイは朝の集会に参加した。",
    "prompt": "次のうち、条件から必ず正しいといえるものはどれですか。",
    "kind": "choice",
    "taskType": "puzzle",
    "hints": [
      "「図書係なら青い名札」「青い名札なら集会参加」は、どちら向きに使える条件でしょうか。",
      "ミナは集会に参加していません。集会に参加しない人が青い名札だったら、条件とぶつからないか考えましょう。",
      "ある条件の逆向きは、いつも正しいとは限りません。「ならば」の向きに注意しましょう。"
    ],
    "explanation": "図書係なら青い名札、青い名札なら朝の集会に参加した、というつながりがあります。ミナは集会に参加していないので、青い名札ではなく、したがって図書係でもありません。ソラやカイについては逆向きの推理になるため、必ず正しいとはいえません。",
    "skillTags": [
      "tracing"
    ],
    "choices": [
      "ミナは図書係ではない。",
      "ソラは図書係である。",
      "カイは青い名札をつけていた。",
      "図書係でない生徒は必ず朝の集会に参加しない。"
    ],
    "answerKey": [
      "0"
    ]
  },
  {
    "id": "code-s4-01",
    "domain": "CODE",
    "difficulty": 4,
    "title": "浅いコピーの更新",
    "passage": "rows = [[1], [2], [3]]\ncopy = rows[:]\nfor i in range(len(copy)):\n    if i % 2 == 0:\n        copy[i].append(i)\n    else:\n        copy[i] = copy[i] + [i]\nprint(rows)\nprint(copy)",
    "prompt": "このコードを実行したときの出力として正しいものを選びなさい。",
    "kind": "choice",
    "taskType": "python",
    "hints": [
      "copy と rows は、内側のリストまで別物になっているでしょうか。",
      "rows[:] は外側のリストだけをコピーします。内側のリストは同じものを参照します。",
      "append は同じリストを変更しますが、+ で作ったリストを代入すると、その場所の参照だけが置き換わります。"
    ],
    "explanation": "rows[:] は浅いコピーなので、copy[0] と rows[0]、copy[2] と rows[2] は同じ内側のリストを指します。そのため append は rows にも反映されます。一方、i が 1 のときは copy[1] = copy[1] + [1] により copy 側だけが新しいリストを指すため、rows[1] は [2] のままです。",
    "skillTags": [
      "tracing"
    ],
    "choices": [
      "[[1, 0], [2], [3, 2]]\r\n[[1, 0], [2, 1], [3, 2]]",
      "[[1], [2], [3]]\n[[1, 0], [2, 1], [3, 2]]",
      "[[1, 0], [2, 1], [3, 2]]\n[[1, 0], [2, 1], [3, 2]]",
      "[[1], [2], [3, 2]]\n[[1, 0], [2, 1], [3, 2]]"
    ],
    "answerKey": [
      "0"
    ]
  },
  {
    "id": "code-s4-02",
    "domain": "CODE",
    "difficulty": 4,
    "title": "偶数を足すリスト",
    "passage": "nums = [3, 8, 5, 10, 2]\ntotal = 0\npicked = []\nfor n in nums:\n    if n % 2 == 0:\n        total += n\n        picked.append(total)\nprint(picked)\nprint(total)",
    "prompt": "このPythonコードを実行したときの出力はどれですか。",
    "kind": "choice",
    "taskType": "python",
    "hints": [
      "for文で、numsの各値はどの順番でnに入りますか。",
      "if文の条件を満たすのは、リストの中のどの数ですか。",
      "pickedにはnそのものではなく、その時点のtotalが追加される点に注意しましょう。"
    ],
    "explanation": "偶数だけが条件を満たします。8でtotalは8、10で18、2で20となり、その各時点のtotalがpickedに追加されます。最後にpickedとtotalが出力されます。",
    "skillTags": [
      "tracing"
    ],
    "choices": [
      "[8, 18]\n18",
      "[8, 18, 20]\r\n20",
      "[3, 11, 16, 26, 28]\n28",
      "[8, 10, 2]\n20"
    ],
    "answerKey": [
      "1"
    ]
  },
  {
    "id": "code-s4-03",
    "domain": "CODE",
    "difficulty": 4,
    "title": "単語の大文字選び",
    "passage": "text = \"cat dog ant cow\"\nparts = text.split()\nresult = []\nfor word in parts:\n    if len(word) == 3 and word[0] < \"d\":\n        result.append(word.upper())\n    else:\n        result.append(word[1:])\nprint(\"|\".join(result))",
    "prompt": "このコードを実行したとき、print の出力はどれですか。",
    "kind": "choice",
    "taskType": "python",
    "hints": [
      "for 文で、各単語はどの順番で処理されますか。",
      "if 条件は、文字数だけでなく先頭の文字が \"d\" より前かも見ます。",
      "条件を満たす単語は大文字に、満たさない単語は2文字目以降になります。"
    ],
    "explanation": "split() で [\"cat\", \"dog\", \"ant\", \"cow\"] になります。すべて3文字ですが、先頭文字が \"d\" より前なのは cat、ant、cow です。dog は条件を満たさないので \"og\" になり、join で CAT|og|ANT|COW と出力されます。",
    "skillTags": [
      "tracing"
    ],
    "choices": [
      "CAT|og|ANT|ow",
      "cat|og|ant|COW",
      "CAT|og|ANT|COW",
      "CAT|DOG|ANT|COW"
    ],
    "answerKey": [
      "2"
    ]
  },
  {
    "id": "code-s4-04",
    "domain": "CODE",
    "difficulty": 4,
    "title": "4つの部屋割り",
    "passage": "1号室から4号室まで、左から順に4つの部屋が並んでいる。ミナ、レン、ソラ、カイの4人が、1人ずつ別の部屋に入る。\n条件は次の3つ。\n1. ミナはレンのすぐ左隣の部屋にいる。\n2. ソラは端の部屋にはいない。\n3. カイはミナより右の部屋にいる。",
    "prompt": "3号室にいるのは誰か。",
    "kind": "choice",
    "taskType": "puzzle",
    "hints": [
      "ミナとレンは、どの部屋の組み合わせなら「すぐ左隣」になるでしょうか。",
      "ミナとレンの並びを候補にして、ソラが端にいない条件を重ねてみましょう。",
      "残った人を置く前に、カイがミナより右にいるかを確かめましょう。"
    ],
    "explanation": "ミナとレンは連続して並ぶので、候補は1-2、2-3、3-4。2-3だとソラは1号室か4号室になり端なので不可。3-4だと残るカイがミナより右に置けない。よってミナ1号室、レン2号室、ソラ3号室、カイ4号室となる。",
    "skillTags": [
      "tracing"
    ],
    "choices": [
      "レン",
      "ソラ",
      "カイ",
      "ミナ"
    ],
    "answerKey": [
      "1"
    ]
  },
  {
    "id": "code-s4-05",
    "domain": "CODE",
    "difficulty": 4,
    "title": "花だんの面積と周",
    "passage": "長方形の花だんXは、長い辺が12m、短い辺が8mです。\n長方形の花だんYは、Xと比べて長い辺が25%長く、短い辺が25%短くなっています。",
    "prompt": "花だんXと花だんYの面積と周の長さについて、正しいものを1つ選びなさい。",
    "kind": "choice",
    "taskType": "math",
    "hints": [
      "花だんYの長い辺と短い辺は、それぞれ何mになりますか。",
      "25%長いは1.25倍、25%短いは0.75倍として考えます。",
      "面積はたて×横、周の長さは2つの辺の和を2倍して比べます。"
    ],
    "explanation": "Yの長い辺は12×1.25=15m、短い辺は8×0.75=6mです。Xの面積は12×8=96㎡、Yの面積は15×6=90㎡なので、Yが6㎡小さいです。周の長さはXが2×(12+8)=40m、Yが2×(15+6)=42mなので、Yが2m長いです。",
    "skillTags": [
      "tracing"
    ],
    "choices": [
      "面積はYのほうが6㎡小さく、周の長さはYのほうが2m長い。",
      "面積はYのほうが6㎡大きく、周の長さはYのほうが2m長い。",
      "面積はXとYで同じで、周の長さはYのほうが2m短い。",
      "面積はYのほうが6㎡小さく、周の長さはXとYで同じである。"
    ],
    "answerKey": [
      "0"
    ]
  },
  {
    "id": "code-s4-06",
    "domain": "CODE",
    "difficulty": 4,
    "title": "成績ラベルの分岐",
    "passage": "scores = [82, 55, 47, 60]\nlabels = []\n\nfor score in scores:\n    if score >= 60:\n        labels.append(\"合格\")\n    if score >= 50:\n        labels.append(\"再テスト\")\n    else:\n        labels.append(\"不合格\")\n\nprint(labels)",
    "prompt": "期待する出力は ['合格', '再テスト', '不合格', '合格'] です。しかし実際の出力は ['合格', '再テスト', '再テスト', '不合格', '合格', '再テスト'] になります。原因として正しい修正はどれですか。",
    "kind": "choice",
    "taskType": "debug",
    "hints": [
      "1つの点数につき、ラベルはいくつ追加されるべきでしょうか。",
      "60点以上のとき、どの条件文が実行されているかを順に追ってみましょう。",
      "「合格」の判定が真だった場合、その後の判定を続けるべきかどうかに注目しましょう。"
    ],
    "explanation": "4行目と6行目がどちらも if なので、60点以上では「合格」を追加したあと、さらに6行目の条件も真になって「再テスト」も追加されます。6行目を elif にすれば、60点以上の場合は次の判定に進まず、1つの点数に1つのラベルだけが追加されます。",
    "skillTags": [
      "tracing",
      "debugging"
    ],
    "choices": [
      "4行目を if score > 60: に変える。",
      "5行目を labels.append(\"再テスト\") に変える。",
      "6行目を elif score >= 50: に変える。",
      "8行目を elif score < 50: に変える。"
    ],
    "answerKey": [
      "2"
    ]
  },
  {
    "id": "code-s4-07",
    "domain": "CODE",
    "difficulty": 4,
    "title": "自販機の状態追跡",
    "passage": "ある自販機には「お茶」と「水」の2つのボタンがある。\n\n初期状態:\n残額は0円。\nお茶の在庫は1本、価格は120円。\n水の在庫は2本、価格は100円。\n\n手順:\n1. 次の操作を上から順に1つずつ処理する。\n2. 硬貨を入れたら、その金額を残額に加える。\n3. ボタンを押したとき、その商品の在庫が1本以上あり、かつ残額が価格以上なら、商品を1本出し、在庫を1本減らし、残額から価格を引く。\n4. ボタンを押したとき、在庫がない、または残額が足りないなら、何も変わらない。\n5. 返却レバーを押したら、その時点の残額をおつりとして出し、残額を0円にする。\n\n操作列:\n1. 100円を入れる\n2. お茶ボタンを押す\n3. 50円を入れる\n4. 水ボタンを押す\n5. 100円を入れる\n6. お茶ボタンを押す\n7. 水ボタンを押す\n8. 返却レバーを押す",
    "prompt": "最後に出るおつりと、出てきた商品の組み合わせとして正しいものはどれですか。",
    "kind": "choice",
    "taskType": "algorithm",
    "hints": [
      "各操作のあと、残額はいくらになっていますか。",
      "ボタンを押しても、残額不足なら何も起きない点に注目しましょう。",
      "在庫が減るのは、実際に商品が出たときだけです。"
    ],
    "explanation": "最初に100円を入れても、お茶は120円なので出ません。50円を追加して150円になり、水を買うと残額50円です。さらに100円を入れて150円になり、お茶を買うと残額30円です。その後の水ボタンは残額不足なので何も起きず、返却で30円が出ます。出た商品はお茶1本、水1本です。",
    "skillTags": [
      "tracing",
      "algorithms"
    ],
    "choices": [
      "おつり30円。お茶1本、水2本。",
      "おつり0円。お茶0本、水2本。",
      "おつり30円。お茶1本、水1本。",
      "おつり50円。お茶1本、水1本。"
    ],
    "answerKey": [
      "2"
    ]
  },
  {
    "id": "code-s4-08",
    "domain": "CODE",
    "difficulty": 4,
    "title": "図書当番の日程",
    "passage": "図書室の当番を、月曜から木曜までの4日間に1人ずつ割り当てる。担当者は、あおい、けん、さき、りくの4人で、同じ日に2人は入らない。\n\n条件\n1. けんは、あおいのちょうど翌日に当番をする。\n2. さきは、りくより前の日に当番をする。\n3. りくは木曜ではなく、あおいは月曜ではない。",
    "prompt": "火曜に当番をするのは誰か。",
    "kind": "choice",
    "taskType": "puzzle",
    "hints": [
      "けんとあおいは、どの2日連続の組み合わせに入れられるでしょうか。",
      "あおいが月曜ではないので、連続する2人の置き方をしぼれます。",
      "残った2日にさきとりくを入れ、さきが前、りくが後という条件と、りくが木曜でない条件を比べてみましょう。"
    ],
    "explanation": "あおいは月曜ではなく、けんはその翌日なので、候補は「あおい火曜・けん水曜」か「あおい水曜・けん木曜」です。前者だと残りは月曜と木曜で、さきがりくより前ならりくは木曜になりますが、条件3に反します。したがって、あおいは水曜、けんは木曜。残りの月曜と火曜は、さきが前、りくが後なので、火曜はりくです。",
    "skillTags": [
      "tracing"
    ],
    "choices": [
      "けん",
      "さき",
      "りく",
      "あおい"
    ],
    "answerKey": [
      "2"
    ]
  },
  {
    "id": "code-s5-01",
    "domain": "CODE",
    "difficulty": 5,
    "title": "切り出し文字数え",
    "passage": "text = \"BaNaNa bandana\"\ncounts = {}\nfor word in text.lower().split():\n    part = word[1:5]\n    for ch in part:\n        counts[ch] = counts.get(ch, 0) + 1\nresult = []\nfor key in sorted(counts):\n    if counts[key] > 1:\n        result.append(key + str(counts[key]))\nprint(\"-\".join(result))",
    "prompt": "次のPythonコードを実行すると、何が出力されますか。",
    "kind": "choice",
    "taskType": "python",
    "hints": [
      "各単語から、どの範囲の文字が取り出されているでしょうか。",
      "先に text.lower().split() の結果を確認し、それぞれに word[1:5] を適用してみましょう。",
      "counts に入る文字数を数えたあと、sorted(counts) と counts[key] > 1 の条件に注目しましょう。"
    ],
    "explanation": "text.lower().split() は ['banana', 'bandana'] です。word[1:5] により 'banana' から 'anan'、'bandana' から 'anda' が取り出され、合計で a が4回、n が3回、d が1回数えられます。出力対象は2回より多い文字だけなので、sorted(counts) の順に a4 と n3 が結合されます。",
    "skillTags": [
      "tracing",
      "algorithms"
    ],
    "choices": [
      "n3-a4",
      "a4-n3",
      "a3-n3",
      "a4-d1-n3"
    ],
    "answerKey": [
      "1"
    ]
  },
  {
    "id": "code-s5-02",
    "domain": "CODE",
    "difficulty": 5,
    "title": "タグ作成の出力",
    "passage": "def make_tag(name, code):\n    parts = code.strip().lower().split(\"-\")\n    table = {\"red\": \"R\", \"blue\": \"B\", \"green\": \"G\"}\n    head = name.strip().title()[:3]\n    tail = table.get(parts[0], \"?\") + parts[1][-2:]\n    return head + \":\" + tail\n\nitems = [(\" aki \", \"Blue-204\"), (\"mio\", \"red-17\"), (\"ren\", \"green-305\")]\nresult = []\nfor n, c in items[1:]:\n    result.append(make_tag(n, c))\nprint(\",\".join(result))",
    "prompt": "このコードを実行したとき、出力はどれですか。",
    "kind": "choice",
    "taskType": "python",
    "hints": [
      "ループで処理される items の要素は、どこからどこまででしょうか。",
      "items[1:] により、先頭の要素は処理対象から外れます。",
      "strip、title、lower、split、[-2:] がそれぞれ文字列をどう変えるかを順に追いましょう。"
    ],
    "explanation": "items[1:] なので処理されるのは mio と ren の2件です。code は小文字化して分割され、red は R、green は G に変換されます。番号部分は末尾2文字を使うので 17 と 05 になり、出力は Mio:R17,Ren:G05 です。",
    "skillTags": [
      "tracing"
    ],
    "choices": [
      "Aki:B04,Mio:R17,Ren:G05",
      "Mio:red17,Ren:green05",
      "Mio:R17,Ren:G05",
      "Mio:R7,Ren:G5"
    ],
    "answerKey": [
      "2"
    ]
  },
  {
    "id": "code-s5-03",
    "domain": "CODE",
    "difficulty": 5,
    "title": "集合と切り出し",
    "passage": "words = [\"Stone\", \"notes\", \"tones\", \"onset\", \"seton\", \"nest\"]\ngroups = {}\nfor w in words:\n    key = \"\".join(sorted(w.lower()))\n    groups.setdefault(key, []).append(w[1:4].upper())\ncommon = set(groups[\"enst\"])\nfor part in groups[\"enost\"]:\n    common |= set(part.lower()[::-1])\ntext = \"-\".join(sorted(common))\nprint(text[1:8].replace(\"-\", \":\"))\nprint(len(groups), groups[\"enost\"][::2])",
    "prompt": "このコードを実行したときの出力はどれですか。",
    "kind": "choice",
    "taskType": "python",
    "hints": [
      "groups には、どのキーにどの値が入るでしょうか。",
      "set(groups[\"enst\"]) が文字の集合ではなく、何の集合になるかに注目しましょう。",
      "sorted(common) で並べたあと、join、スライス、replace の順に処理を追いましょう。"
    ],
    "explanation": "\"Stone\" など5語はキー \"enost\" に入り、\"nest\" はキー \"enst\" に入ります。groups[\"enst\"] は ['EST'] なので set(groups[\"enst\"]) は {'EST'} です。その後、\"enost\" 側の各文字から n, o, t, e, s が加わり、並べて結合すると \"EST-e-n-o-s-t\" になります。text[1:8] は \"ST-e-n-\" なので、ハイフンをコロンに置き換えて \"ST:e:n:\" が出力されます。groups は2キーで、groups[\"enost\"][::2] は ['TON', 'ONE', 'ETO'] です。",
    "skillTags": [
      "tracing"
    ],
    "choices": [
      ":n:o:s:\n2 ['TON', 'ONE', 'ETO']",
      "ST:e:n:\n2 ['TON', 'OTE', 'ONE', 'NSE', 'ETO']",
      "ST:e:n:\n1 ['TON', 'ONE', 'ETO']",
      "ST:e:n:\r\n2 ['TON', 'ONE', 'ETO']"
    ],
    "answerKey": [
      "3"
    ]
  },
  {
    "id": "code-s5-04",
    "domain": "CODE",
    "difficulty": 5,
    "title": "品番ソート修正",
    "passage": "items = [\"BK-12\", \"FD-3\", \"BK-2\", \"EL-11\", \"FD-20\"]\npriority = {\"fd\": 0, \"bk\": 1, \"el\": 2}\n\ndef sort_key(code):\n    kind = code[:2].lower()\n    number = code[3:]\n    return (priority[kind], number)\n\nordered = sorted(items, key=sort_key)\nprint(\",\".join(ordered))",
    "prompt": "このコードは、品番を「カテゴリ優先順位 fd → bk → el、同じカテゴリ内ではハイフン後の数値が小さい順」に並べるつもりです。\n\n期待する出力:\nFD-3,FD-20,BK-2,BK-12,EL-11\n\n実際の出力:\nFD-20,FD-3,BK-12,BK-2,EL-11\n\n原因の行、または正しい修正として最も適切なのはどれですか。",
    "kind": "choice",
    "taskType": "debug",
    "hints": [
      "同じカテゴリの中で、どの値を比べたいのでしょうか。",
      "code[3:] で取り出した値の型に注目しましょう。",
      "文字列としての大小比較と、数値としての大小比較は、桁数が違うと結果が変わることがあります。"
    ],
    "explanation": "6行目の code[3:] はハイフン後を文字列として取り出しています。そのため \"20\" と \"3\" では文字列比較になり、\"20\" の方が先に並びます。数値順にしたいので int(code[3:]) に直す必要があります。",
    "skillTags": [
      "tracing",
      "debugging"
    ],
    "choices": [
      "7行目の return (priority[kind], number) が原因なので、return (number, priority[kind]) に修正する。",
      "9行目の sorted(items, key=sort_key) が原因なので、sorted(items, key=sort_key, reverse=True) に修正する。",
      "6行目の number = code[3:] が文字列のままなので、number = int(code[3:]) に修正する。",
      "5行目の kind = code[:2].lower() が原因なので、kind = code[:2].upper() に修正する。"
    ],
    "answerKey": [
      "2"
    ]
  },
  {
    "id": "code-s5-05",
    "domain": "CODE",
    "difficulty": 5,
    "title": "5枚のカード順",
    "passage": "5枚のカード A、B、C、D、E を、左から右へ1列に並べる。\n条件は次の4つである。\n1. B は D のすぐ左にある。\n2. C と D の間には、ちょうど2枚のカードがある。\n3. A は C より右にある。\n4. E は左端にも右端にもない。",
    "prompt": "条件をすべて満たす左から右への並びはどれか。",
    "kind": "choice",
    "taskType": "puzzle",
    "hints": [
      "B と D の位置関係から、まずどの組み合わせが考えられますか。",
      "B が D のすぐ左なので、D の位置が決まると B の位置も同時に決まります。",
      "C と D の距離を先に確認し、その後で A と E の条件を当てはめてみましょう。"
    ],
    "explanation": "B は D のすぐ左なので、D の候補を考える。C と D の間に2枚あるため、D が4番目なら C は1番目になる。このとき B は3番目。残る2番目と5番目に A と E が入り、E は端に置けないので E は2番目、A は5番目。したがって C, E, B, D, A が正しい。",
    "skillTags": [
      "tracing"
    ],
    "choices": [
      "C, E, D, B, A",
      "C, B, E, D, A",
      "E, C, B, D, A",
      "C, E, B, D, A"
    ],
    "answerKey": [
      "3"
    ]
  },
  {
    "id": "code-s5-06",
    "domain": "CODE",
    "difficulty": 5,
    "title": "休みをはさむ出会い",
    "passage": "まっすぐな道の両端をP地点、Q地点とし、PからQまでの距離は18 kmである。\n\nAさんは8時00分にP地点を出発し、Q地点へ向かって時速12 kmで進む。Aさんは途中で休まない。\nBさんは8時15分にQ地点を出発し、P地点へ向かって時速18 kmで進む。ただし、Bさんは出発後、25分進むごとに5分休む。休んでいる間は進まない。",
    "prompt": "AさんとBさんが出会う時刻として正しいものを選びなさい。",
    "kind": "choice",
    "taskType": "math",
    "hints": [
      "8時15分の時点で、AさんはP地点からどれだけ進んでいますか。",
      "Bさんが最初に25分進んだ時点で、2人の間の距離がどれだけ残るかを考えましょう。",
      "Bさんが休んでいる5分間にも、Aさんだけは進み続けます。"
    ],
    "explanation": "8時15分までにAさんは15分進み、12 km/hなので3 km進む。残りの間隔は18−3=15 km。8時15分からBさんが25分進む間、2人の近づく速さは12+18=30 km/hなので、25分で12.5 km縮まる。8時40分時点で残りは2.5 km。Bさんが8時40分から5分休む間にAさんは1 km進むので、8時45分時点で残りは1.5 km。そこから2人が近づく速さは30 km/h、つまり毎分0.5 kmなので、1.5 km縮まるには3分。したがって出会うのは8時48分。",
    "skillTags": [
      "tracing"
    ],
    "choices": [
      "8時43分",
      "8時45分",
      "8時48分",
      "8時50分"
    ],
    "answerKey": [
      "2"
    ]
  },
  {
    "id": "code-s5-07",
    "domain": "CODE",
    "difficulty": 5,
    "title": "カードの探索手順",
    "passage": "小さい順に並んだカードが、左から順に次のように置かれている。\n位置: 1  2  3  4  5  6  7  8  9  10 11 12 13 14 15 16\n数値: 2  5  9  12 17 23 28 31 35 39 44 50 57 63 70 82\n\n数値36のカードを探す。次の手順に従う。\n1. 左端をL=1、右端をR=16とする。確認回数は0回とする。\n2. LがR以下なら、Mを「LとRの平均を小数点以下切り捨て」にした位置とする。\n3. 位置Mの数値を確認し、確認回数を1増やす。\n4. 位置Mの数値が36なら、そこで探索を終える。\n5. 位置Mの数値が36より小さいなら、LをM+1にする。\n6. 位置Mの数値が36より大きいなら、RをM-1にする。\n7. LがRより大きくなったら探索を終え、36を入れるなら「位置Lのカードの前」に入れるとする。",
    "prompt": "この手順で数値36を探すと、最終的にどこに入れることになり、確認回数は何回になるか。",
    "kind": "choice",
    "taskType": "algorithm",
    "hints": [
      "最初に確認する位置は、L=1とR=16からどう決まりますか。",
      "確認した数値が36より小さいか大きいかで、LとRのどちらが変わるかに注目しましょう。",
      "探索が終わるのは見つかった時だけでなく、LがRを超えた時です。その時のLが挿入位置を決めます。"
    ],
    "explanation": "確認する位置は、8番目の31、12番目の50、10番目の39、9番目の35の順です。最後に35は36より小さいのでLが10になり、Rは9のままです。LがRを超えるため探索を終え、36は位置10のカードの前に入れます。確認回数は4回です。",
    "skillTags": [
      "tracing",
      "algorithms"
    ],
    "choices": [
      "位置10のカードの前に入れ、確認回数は4回",
      "位置10のカードの前に入れ、確認回数は3回",
      "位置11のカードの前に入れ、確認回数は4回",
      "位置9のカードの前に入れ、確認回数は3回"
    ],
    "answerKey": [
      "0"
    ]
  },
  {
    "id": "code-s5-08",
    "domain": "CODE",
    "difficulty": 5,
    "title": "天秤の4回判定",
    "passage": "同じ見た目のコイン A、B、C、D、E がある。本物のコインはすべて同じ重さで、この中に偽物が1枚だけある。偽物は本物より重い場合も軽い場合もある。\n天秤で量ると、次の4つの結果になった。\n\n1. A+B は C+D より軽い。\n2. B+E は A+D より軽い。\n3. C+E は A+D より軽い。\n4. A+E は B+D より軽い。",
    "prompt": "偽物のコインと、その重さについて正しいものはどれか。",
    "kind": "choice",
    "taskType": "puzzle",
    "hints": [
      "それぞれの天秤の結果で、偽物がどちら側にあると説明できるでしょうか。",
      "「左が軽い」なら、左側に軽い偽物があるか、右側に重い偽物がある場合だけです。",
      "1回目と2回目で残る候補を比べ、3回目・4回目でも同じ候補が残るか確認しましょう。"
    ],
    "explanation": "1回目「A+B が軽い」から、候補は Aが軽い、Bが軽い、Cが重い、Dが重い。2回目「B+E が軽い」から、候補は Bが軽い、Eが軽い、Aが重い、Dが重い。両方に当てはまるのは Bが軽い、Dが重い。さらに3回目「C+E が軽い」は Dが重い場合に合い、Bが軽い場合には合わない。4回目も Dが重い場合に合う。よって D が偽物で本物より重い。",
    "skillTags": [
      "tracing"
    ],
    "choices": [
      "A が偽物で、本物より重い。",
      "E が偽物で、本物より軽い。",
      "B が偽物で、本物より軽い。",
      "D が偽物で、本物より重い。"
    ],
    "answerKey": [
      "3"
    ]
  },
  {
    "id": "code-s6-01",
    "domain": "CODE",
    "difficulty": 6,
    "title": "注文数の集計",
    "passage": "def tally(items):\n    counts = {\"tea\": 1}\n    i = 0\n    while i < len(items):\n        name, n = items[i]\n        if n % 2 == 0:\n            counts[name] = counts.get(name, 0) + n\n        else:\n            counts[name] = counts.get(name, 1) * n\n        i += 1\n    return counts\n\ndata = [(\"tea\", 3), (\"cake\", 2), (\"tea\", 2), (\"cake\", 3)]\nprint(tally(data))",
    "prompt": "このコードを実行したとき、print によって出力される内容として正しいものを1つ選びなさい。",
    "kind": "choice",
    "taskType": "python",
    "hints": [
      "各ループで、どのキーの値がどう変わっているか追えていますか。",
      "偶数のときと奇数のときで、get の第2引数と計算方法が違う点に注目しましょう。",
      "最初から辞書にあるキーと、途中で初めて追加されるキーを分けて考えると整理しやすいです。"
    ],
    "explanation": "初期値は {'tea': 1} です。('tea', 3) は奇数なので 1×3 で tea は3、('cake', 2) は偶数なので 0+2 で cake は2になります。次に ('tea', 2) で tea は3+2=5、最後に ('cake', 3) で cake は2×3=6です。したがって出力は {'tea': 5, 'cake': 6} です。",
    "skillTags": [
      "tracing"
    ],
    "choices": [
      "{'tea': 5, 'cake': 5}",
      "{'tea': 3, 'cake': 6}",
      "{'tea': 5, 'cake': 6}",
      "{'tea': 6, 'cake': 5}"
    ],
    "answerKey": [
      "2"
    ]
  },
  {
    "id": "code-s6-02",
    "domain": "CODE",
    "difficulty": 6,
    "title": "再帰と偶奇分岐",
    "passage": "def fib(n):\n    if n < 2:\n        return 1\n    return fib(n - 1) + fib(n - 2)\nans = []\nk = 0\nwhile k < 5:\n    v = fib(k)\n    if (v + k) % 2 == 0:\n        ans.append(v - k)\n    else:\n        ans.append(v + k)\n    k += 1\nprint(ans)",
    "prompt": "次のPythonコードを実行したとき、出力されるものを選んでください。",
    "kind": "choice",
    "taskType": "python",
    "hints": [
      "fib(0) と fib(1) は、このコードではそれぞれどう返されるでしょうか。",
      "while の各周で、k、v、(v + k) % 2 の値を表にして追うと整理できます。",
      "標準的なフィボナッチ数列の初期値とは違う点と、ans.append の後に k が増える点に注意しましょう。"
    ],
    "explanation": "fib(0)=1、fib(1)=1で、以後は前2つの和なので、k=0から4でのvは1, 1, 2, 3, 5です。(v+k)が偶数ならv-k、奇数ならv+kを追加するため、順に1, 0, 0, 0, 9となります。したがって出力は[1, 0, 0, 0, 9]です。",
    "skillTags": [
      "tracing",
      "algorithms"
    ],
    "choices": [
      "[1, 0, 0, 0, 9]",
      "[1, 2, 4, 6, 9]",
      "[1, 0, 0, 6, 1]",
      "[0, 1, 1, 2, 3]"
    ],
    "answerKey": [
      "0"
    ]
  },
  {
    "id": "code-s6-03",
    "domain": "CODE",
    "difficulty": 6,
    "title": "生成器の途中停止",
    "passage": "def make(nums):\n    i = 0\n    total = 0\n    while i < len(nums):\n        total += nums[i]\n        if total % 2 == 0:\n            yield total - i\n        else:\n            yield total + i\n        i += 1\n\ng = make([2, 3, 1, 4])\nfirst = next(g)\nsecond = next(g)\nprint(first, second, next(g))",
    "prompt": "このコードを実行したとき、出力はどれですか。",
    "kind": "choice",
    "taskType": "python",
    "hints": [
      "next(g) を呼ぶたびに、関数のどこまで実行されるでしょうか。",
      "yield で値を返したあと、次の next ではその直後から再開します。",
      "i += 1 が実行されるタイミングと、total の更新順に注目しましょう。"
    ],
    "explanation": "最初の next では total が 2 になり、偶数なので 2 - 0 = 2 を返します。次に再開して i が 1 になり、total は 5、奇数なので 5 + 1 = 6。さらに i が 2 になり、total は 6、偶数なので 6 - 2 = 4 を返します。したがって出力は 2 6 4 です。",
    "skillTags": [
      "tracing"
    ],
    "choices": [
      "2 5 6",
      "2 6 4",
      "2 6 10",
      "2 2 6"
    ],
    "answerKey": [
      "1"
    ]
  },
  {
    "id": "code-s6-04",
    "domain": "CODE",
    "difficulty": 6,
    "title": "無効値を飛ばす合計",
    "passage": "def total_until_limit(items, limit):\n    total = 0\n    i = 0\n    while total < limit and i < len(items):\n        try:\n            total += int(items[i])\n        except ValueError:\n            break\n        i += 1\n    return total\n\ndata = [\"4\", \"x\", \"3\", \"5\"]\nprint(total_until_limit(data, 10))",
    "prompt": "このコードは、整数に変換できない要素を飛ばしながら合計し、合計が limit 以上になったら止めるつもりです。\n\n期待する出力:\n12\n\n実際の出力:\n4\n\n正しい修正はどれですか。",
    "kind": "choice",
    "taskType": "debug",
    "hints": [
      "整数に変換できない要素に出会ったとき、次にどの要素を調べるべきでしょうか。",
      "例外が起きた場合、try の後ろにある i += 1 は実行されるかを確認しましょう。",
      "止めずに次へ進むには、ループを続けるだけでなく、同じ要素を再処理しない工夫が必要です。"
    ],
    "explanation": "\"x\" で ValueError が起きると、現在のコードは break してしまうため合計 4 のまま終了します。無効な要素を飛ばすには、例外処理の中で i を 1 増やしてから continue し、次の要素へ進める必要があります。",
    "skillTags": [
      "tracing",
      "debugging"
    ],
    "choices": [
      "total += int(items[i]) を total += items[i] に変える。",
      "except ValueError: の中の break を continue に置き換える。",
      "except ValueError: の中を i += 1 のあと continue する処理に変える。",
      "while total < limit and i < len(items): を while total <= limit and i < len(items): に変える。"
    ],
    "answerKey": [
      "2"
    ]
  },
  {
    "id": "code-s6-05",
    "domain": "CODE",
    "difficulty": 6,
    "title": "準備当番の曜日",
    "passage": "文化祭の準備当番を、月曜から金曜までの5日間に1人ずつ割り当てる。担当者は青木、石田、上田、遠藤、小林の5人で、同じ人が2回担当することはない。\n\n条件は次のとおり。\n1. 青木は石田より早い曜日を担当する。\n2. 上田は水曜ではなく、遠藤の翌日を担当する。\n3. 小林は青木の2日後を担当する。\n4. 石田は金曜ではない。\n5. 月曜の担当は遠藤ではない。",
    "prompt": "木曜の担当者は誰か。",
    "kind": "choice",
    "taskType": "puzzle",
    "hints": [
      "青木と小林の曜日の組み合わせは、何通り考えられますか。",
      "小林は青木の2日後なので、青木が入れる曜日は限られます。そこに石田が青木より後で金曜ではない条件を重ねましょう。",
      "遠藤と上田は連続した2日で、上田が後になります。残った曜日でこの並びが作れるかを確認しましょう。"
    ],
    "explanation": "小林は青木の2日後なので、青木は月・火・水のいずれか。青木が火曜や水曜だと、石田の位置や遠藤・上田の連続条件が成り立たない。青木が月曜なら小林は水曜、石田は火曜、残る木曜・金曜に遠藤・上田がこの順で入る。よって木曜は遠藤。",
    "skillTags": [
      "tracing"
    ],
    "choices": [
      "上田",
      "遠藤",
      "青木",
      "石田"
    ],
    "answerKey": [
      "1"
    ]
  },
  {
    "id": "code-s6-06",
    "domain": "CODE",
    "difficulty": 6,
    "title": "3手で変わる数列",
    "passage": "数列 a_n は次の規則で作る。\na_1 = 4\n以後、次の3つの操作をこの順にくり返して次の項を作る。\n1回目: 1を足す\n2回目: 2倍する\n3回目: 3を引く\n4回目: 1を足す\n5回目: 2倍する\n6回目: 3を引く\n……",
    "prompt": "a_29 の値として正しいものを選びなさい。",
    "kind": "choice",
    "taskType": "math",
    "hints": [
      "a_1 から a_29 まで進むには、操作を何回行う必要がありますか。",
      "3回の操作をひとまとまりにすると、1つの数 x はどのような式に変わりますか。",
      "3回ひとまとまりを何回使ったあと、残りの操作がいくつあるかを分けて考えましょう。"
    ],
    "explanation": "a_1 から a_29 までは28回の操作が必要。3回の操作で x は x+1、2x+2、2x-1 となるので、ひとまとまりで 2x-1 に変わる。28回は 3回×9組 と残り1回。組ごとの値は 4→7→13→25→49→97→193→385→769→1537。残り1回は「1を足す」なので、a_29 = 1538。",
    "skillTags": [
      "tracing",
      "algorithms"
    ],
    "choices": [
      "1537",
      "1538",
      "3074",
      "1536"
    ],
    "answerKey": [
      "1"
    ]
  },
  {
    "id": "code-s6-07",
    "domain": "CODE",
    "difficulty": 6,
    "title": "処理待ちの列",
    "passage": "処理待ちの列には、先頭から順に「ア3、イ1、ウ2、エ3」と書かれた札が並んでいる。数字はその札の残り回数を表す。完了リストは最初は空である。1回の処理では、まず列の先頭の札を取り出す。取り出した札の数字が1なら、その札の名前を完了リストの末尾に記録し、その札は列に戻さない。数字が2以上なら、数字を1減らす。減らした後の数字が偶数なら、その札を列の末尾に戻す。減らした後の数字が奇数なら、その札を、現在の列の先頭のすぐ後ろに入れる。ただし、列が空なら末尾に戻すのと同じにする。",
    "prompt": "この手順を6回行った直後の状態として正しいものを選べ。待ち列は先頭から順に示す。",
    "kind": "choice",
    "taskType": "algorithm",
    "hints": [
      "1回ごとに、どの札を先頭から取り出しているかを確認できていますか。",
      "数字を減らした後に、偶数なら末尾、奇数なら先頭のすぐ後ろ、という違いに注目しましょう。",
      "完了リストに入るのは、取り出した時点で数字が1だった札だけです。数字を減らして1になった札は、まだ完了ではありません。"
    ],
    "explanation": "1回目はア3をア2にして末尾へ。2回目はイ1を完了リストへ。3回目はウ2をウ1にし、先頭のすぐ後ろへ。4回目はエ3をエ2にして末尾へ。5回目はウ1を完了リストへ。6回目はア2をア1にし、先頭のすぐ後ろへ入れるので、完了リストはイ、ウ、待ち列はエ2、ア1となる。",
    "skillTags": [
      "tracing",
      "algorithms"
    ],
    "choices": [
      "完了リスト：イ、ウ／待ち列：エ2、ア1",
      "完了リスト：イ、ウ／待ち列：ア1、エ2",
      "完了リスト：イ／待ち列：エ2、ウ1、ア1",
      "完了リスト：イ、エ／待ち列：ウ1、ア1"
    ],
    "answerKey": [
      "0"
    ]
  },
  {
    "id": "code-s6-08",
    "domain": "CODE",
    "difficulty": 6,
    "title": "格子の施設地図",
    "passage": "ある町の地図は、北・中・南の3段と、西・中央・東の3列からなる9区画の格子で表される。5つの施設（カフェ、駅、図書館、博物館、パン屋）は、それぞれ異なる区画に1つずつ置かれている。\n\n条件は次の通り。\n1. パン屋はカフェの真南にあり、カフェとの間にはちょうど1区画ある。\n2. 駅はカフェのすぐ東隣にある。\n3. 図書館は博物館のすぐ西隣にある。\n4. 博物館は駅より南にあり、かつ駅より西にある。\n5. パン屋は図書館より東にある。",
    "prompt": "次のうち、条件をすべて満たす地図はどれか。各選択肢は「北段 / 中段 / 南段」の順で、西から東へ並べている。空は施設がない区画を表す。",
    "kind": "choice",
    "taskType": "puzzle",
    "hints": [
      "カフェの位置が決まると、パン屋と駅はどの区画に置かれますか。",
      "駅はカフェのすぐ東隣なので、カフェは東列には置けません。さらにパン屋が真南に2区画離れることから、カフェは北段に限られます。",
      "カフェが西列か中央列かを分けて考え、博物館が駅の南西に置けるか、図書館がその西隣に置けるかを確かめましょう。"
    ],
    "explanation": "パン屋はカフェの真南に2区画離れているので、カフェは北段、パン屋は南段にある。駅がカフェのすぐ東隣なので、カフェは西列か中央列に限られる。もしカフェが西列なら駅は中央列だが、博物館は駅より西で、さらに図書館が博物館のすぐ西隣になるため置けない。したがってカフェは中央列、駅は東列、パン屋は南段中央。博物館は駅の南西で、図書館をその西隣に置ける中段中央となり、図書館は中段西列になる。",
    "skillTags": [
      "tracing"
    ],
    "choices": [
      "北段: 空・カフェ・駅 / 中段: 空・博物館・図書館 / 南段: 空・パン屋・空",
      "北段: 空・カフェ・駅 / 中段: 空・図書館・博物館 / 南段: 空・パン屋・空",
      "北段: カフェ・駅・空 / 中段: 図書館・博物館・空 / 南段: パン屋・空・空",
      "北段: 空・カフェ・駅 / 中段: 図書館・博物館・空 / 南段: 空・パン屋・空"
    ],
    "answerKey": [
      "3"
    ]
  },
  {
    "id": "code-s7-01",
    "domain": "CODE",
    "difficulty": 7,
    "title": "状態つき並べ替え",
    "passage": "records = [\n    (\"A\", 3, \"xy\"),\n    (\"B\", 2, \"zz\"),\n    (\"A\", 1, \"yz\"),\n    (\"C\", 2, \"xx\"),\n    (\"B\", 4, \"xy\"),\n]\nstate = {\"x\": 1, \"y\": 2, \"z\": 0}\nout = []\nfor name, n, tags in sorted(records, key=lambda r: (sum(state[c] for c in r[2]), -r[1], r[0])):\n    gains = [state[c] + i for i, c in enumerate(tags)]\n    score = sum(gains) + n\n    state[tags[-1]] = (state[tags[-1]] + score) % 5\n    out.append((name, score, tuple(gains)) if score % 2 else (name.lower(), state[tags[-1]], tuple(reversed(gains))))\nprint(out)",
    "prompt": "このコードを実行したとき、print によって表示される出力として正しいものを選んでください。",
    "kind": "choice",
    "taskType": "python",
    "hints": [
      "sorted の並び順は、state が更新される前と後のどちらの値で決まるでしょうか。",
      "key は、タグ文字の state の合計、n の降順、name の順で比べます。",
      "ループ内では gains を作って score を出したあと、最後のタグに対応する state だけが更新されます。"
    ],
    "explanation": "sorted の key はループ開始前の state で評価されます。初期状態での並びは、('B',2,'zz'), ('C',2,'xx'), ('A',1,'yz'), ('B',4,'xy'), ('A',3,'xy') です。その順に state を更新しながら処理すると、out は [('B', 3, (0, 1)), ('C', 5, (1, 2)), ('A', 7, (2, 4)), ('b', 0, (3, 1)), ('A', 5, (1, 1))] になります。",
    "skillTags": [
      "tracing",
      "algorithms"
    ],
    "choices": [
      "[('B', 3, (0, 1)), ('C', 5, (1, 2)), ('A', 7, (2, 4)), ('b', 0, (3, 1)), ('A', 5, (1, 1))]",
      "[('B', 3, (0, 1)), ('C', 5, (1, 2)), ('A', 7, (2, 4)), ('B', 8, (1, 3)), ('A', 5, (1, 1))]",
      "[('B', 3, (0, 1)), ('C', 5, (1, 2)), ('A', 7, (2, 4)), ('b', 0, (3, 1)), ('A', 8, (1, 4))]",
      "[('B', 3, (0, 1)), ('A', 7, (2, 4)), ('C', 5, (1, 2)), ('b', 0, (3, 1)), ('A', 5, (1, 1))]"
    ],
    "answerKey": [
      "0"
    ]
  },
  {
    "id": "code-s7-02",
    "domain": "CODE",
    "difficulty": 7,
    "title": "待ち行列の並び替え",
    "passage": "tasks = [(\"A\", 2, []), (\"B\", 1, [\"A\"]), (\"C\", 3, []), (\"D\", 2, [\"B\", \"C\"]), (\"E\", 1, [\"A\"])]\nqueue = tasks[:]\nstack = []\ndone = []\ntick = 0\nwhile queue:\n    name, need, deps = queue.pop(0)\n    ready = all(d in done for d in deps)\n    if ready and need <= tick + 1:\n        stack.append((name, tick)); done.append(name)\n    else:\n        queue.append((name, need - int(ready), deps))\n    tick += 1\n    if tick == 4: queue = sorted(queue, key=lambda t: (len(t[2]), t[1], t[0]))\npicked = [n for n, t in stack[::-1] if (t + len(n)) % 2 == 1]\nprint(done, picked)",
    "prompt": "このコードを実行したときの出力として正しいものを選びなさい。",
    "kind": "choice",
    "taskType": "python",
    "hints": [
      "各tickで、queueの先頭から取り出されるタスクはどれですか。",
      "readyが真でも、need <= tick + 1 を満たさないとdoneには入りません。elseではneedがどう変わるかに注意しましょう。",
      "tickが4になった直後のsortedでは、keyの3要素が順番に比較されます。最後の内包表記はstackを逆順に見ています。"
    ],
    "explanation": "tick 0でAは未完了のままneedが1に減り、tick 2でCが先に完了します。tick 4になった時点でqueueはkey=(依存数, need, 名前)で並び替えられ、A, B, E, Dの順に処理されます。したがってdoneは['C', 'A', 'B', 'E', 'D']です。stackを逆順に見て、t+len(n)が奇数になるものを拾うのでpickedは['E', 'A', 'C']になります。",
    "skillTags": [
      "tracing",
      "algorithms"
    ],
    "choices": [
      "['C', 'A', 'B', 'E', 'D'] ['C', 'A', 'E']",
      "['C', 'A', 'E', 'B', 'D'] ['E', 'A', 'C']",
      "['A', 'C', 'B', 'E', 'D'] ['E', 'A', 'C']",
      "['C', 'A', 'B', 'E', 'D'] ['E', 'A', 'C']"
    ],
    "answerKey": [
      "3"
    ]
  },
  {
    "id": "code-s7-03",
    "domain": "CODE",
    "difficulty": 7,
    "title": "語順キーの集計",
    "passage": "from collections import Counter\nwords = [\"tea\", \"eat\", \"tan\", \"ate\", \"nat\", \"bat\", \"tab\", \"tea\"]\ncounts = Counter(w[0] for w in words)\ngroups = {}\nfor w in words:\n    key = \"\".join(sorted(w))\n    groups.setdefault(key, []).append(w)\nscore = {k: sum(counts[ch] for ch in set(k)) for k in groups}\norder = sorted(groups, key=lambda k: (-len(groups[k]), score[k], k))\npicked = []\nseen = Counter()\nfor k in order:\n    item = sorted(groups[k], key=lambda w: (seen[w], -words.index(w), w))[0]\n    picked.append(item.upper() if score[k] % 2 else item)\n    seen.update(item[0])\nprint(order)\nprint(picked)\nprint(seen)",
    "prompt": "このコードを実行したとき、出力として正しいものを1つ選びなさい。",
    "kind": "choice",
    "taskType": "python",
    "hints": [
      "同じ文字を並べ替えると同じキーになる単語は、どの順で groups に入るでしょうか。",
      "order は、グループの長さ、score、キー文字列の順に並びます。score が同点のときの比較にも注意しましょう。",
      "item を選ぶ sorted の key は seen[w] を見ていますが、seen.update(item[0]) が増やすのは単語全体ではなく先頭1文字です。"
    ],
    "explanation": "groups は aet が4個、abt と ant が2個です。score はどのキーも 6 なので、order は長さ優先で ['aet', 'abt', 'ant'] になります。各グループ内では seen[w] は単語全体を参照するため常に0のままで、次に -words.index(w) が小さいものが選ばれ、ate、tab、nat になります。score は偶数なので大文字化されず、seen には先頭文字 a、t、n が1回ずつ入ります。",
    "skillTags": [
      "tracing",
      "algorithms"
    ],
    "choices": [
      "['aet', 'abt', 'ant']\n['ATE', 'TAB', 'NAT']\nCounter({'a': 1, 't': 1, 'n': 1})",
      "['aet', 'abt', 'ant']\r\n['ate', 'tab', 'nat']\r\nCounter({'a': 1, 't': 1, 'n': 1})",
      "['aet', 'ant', 'abt']\n['ate', 'nat', 'tab']\nCounter({'a': 1, 'n': 1, 't': 1})",
      "['aet', 'abt', 'ant']\n['tea', 'bat', 'tan']\nCounter({'t': 2, 'b': 1})"
    ],
    "answerKey": [
      "1"
    ]
  },
  {
    "id": "code-s7-04",
    "domain": "CODE",
    "difficulty": 7,
    "title": "4枚の順序条件",
    "passage": "1から10までの番号が1つずつ書かれた10枚のカードがある。この中から、カードを戻さずに4枚を順に引く。すべての引き方の順序つき結果は同様に確からしい。\n次の3条件をすべて満たす確率を考える。\n\n・引いた4枚の番号を小さい順に並べると、2番目に小さい番号が4である。\n・引いた4枚のうち、奇数はちょうど2枚である。\n・最初に引いたカードは、引いた4枚の中で最小の番号ではない。",
    "prompt": "この確率として正しいものを1つ選びなさい。",
    "kind": "choice",
    "taskType": "math",
    "hints": [
      "4が「2番目に小さい」とは、4より小さいカードと大きいカードがそれぞれ何枚必要でしょうか。",
      "まず順序を無視して、条件を満たす4枚の組み合わせを数えると整理しやすいです。奇数の枚数で場合分けしましょう。",
      "条件を満たす4枚が決まったあと、最初のカードが最小でない並び方の割合を考えます。"
    ],
    "explanation": "4が2番目に小さいので、4を必ず含み、4より小さい1,2,3から1枚、4より大きい5〜10から2枚を選ぶ。\n4は偶数なので、残り3枚のうち奇数がちょうど2枚必要。\n4より小さいカードが奇数なら2通りで、5〜10から奇数1枚・偶数1枚を選ぶので 2×3×3=18通り。\n4より小さいカードが偶数なら1通りで、5〜10から奇数2枚を選ぶので 1×3=3通り。\nよって条件を満たす4枚の組み合わせは21通り。全体の4枚組は C(10,4)=210 通りなので、ここまでの確率は21/210=1/10。\nその4枚の並び方のうち、最初が最小でない割合は3/4。したがって確率は 1/10×3/4=3/40。",
    "skillTags": [
      "tracing"
    ],
    "choices": [
      "1/10",
      "3/40",
      "1/14",
      "9/80"
    ],
    "answerKey": [
      "1"
    ]
  },
  {
    "id": "code-s7-05",
    "domain": "CODE",
    "difficulty": 7,
    "title": "戻り札の手順",
    "passage": "ある箱L（左から順に取り出す）と箱R、得点pがある。\n初期状態\nL: 5, 6, 4, 3, 9, 2\nR: 空\np: 0\n\n次の「1回の処理」を繰り返す。\n1. Lの左端の数nを取り出す。\n2. nが3の倍数なら、pに n÷3 を足し、n−1をRの右端に置く。\n3. nが3の倍数でなく偶数なら、pに1を足し、n÷2をLの右端に置く。\n4. nが3の倍数でなく奇数なら、pから1を引き、n+4をLの右端に置く。\n5. その後、Rに2個以上あり、Rの右端の数がその左隣の数より小さい場合、右端の左隣の数だけをRから取り除き、Lの左端に置く。この判定と移動は、条件を満たさなくなるまで繰り返す。\n6. ここまで終えた時点で、pが8以上、またはLが空なら停止する。そうでなければ次の処理に進む。",
    "prompt": "停止時の状態として正しいものはどれか。LとRは左から右の順に示す。",
    "kind": "choice",
    "taskType": "algorithm",
    "hints": [
      "停止判定は、各処理の途中ではなく、どこまで終えた時点で行うでしょうか。",
      "3の倍数は偶数判定より先に扱います。また、Rから移すのは右端そのものではなく、その左隣です。",
      "Lの左端から取り出した数を順にメモし、4回目の処理後にLの左端へ戻る数に注意しましょう。"
    ],
    "explanation": "取り出す数は順に5, 6, 4, 3, 5, 9, 2, 9となる。4回目でRが5, 2となり、右端2が左隣5より小さいため、5をLの左端へ移してRは2だけになる。その後、8回目に9を処理してpは6+3=9、Rは2, 8, 8、Lは2, 9, 1となる。処理後にpが8以上なのでここで停止する。",
    "skillTags": [
      "tracing",
      "algorithms"
    ],
    "choices": [
      "p=8、L: 2, 9, 1、R: 2, 8",
      "p=9、L: 2, 9, 1、R: 2, 8, 8",
      "p=9、L: 9, 2, 1、R: 2, 8, 8",
      "p=10、L: 2, 1、R: 5, 2, 8, 8"
    ],
    "answerKey": [
      "1"
    ]
  },
  {
    "id": "code-s7-06",
    "domain": "CODE",
    "difficulty": 7,
    "title": "島の二重発言",
    "passage": "ある島には、騎士と悪党だけが住んでいる。騎士は自分の発言をすべて本当のこととして話し、悪党は自分の発言をすべて嘘として話す。次の二つの文は、それぞれ別々に真偽を判定する。\n\nA「Bは悪党だ。CとEは同じ種類だ。」\nB「Dは騎士だ。AとCは異なる種類だ。」\nC「5人のうち騎士はちょうど3人だ。Dは悪党だ。」\nD「Bは騎士だ。Eは悪党だ。」\nE「Aは騎士だ。BとDは同じ種類だ。」",
    "prompt": "A〜Eのうち、騎士と悪党の組み合わせとして正しいものはどれか。",
    "kind": "choice",
    "taskType": "puzzle",
    "hints": [
      "まず、Bの1文目とDの1文目は互いにどんな関係を作っているでしょうか。",
      "「同じ種類」「異なる種類」は、どちらか一方だけでなく両者の真偽がそろうかを確認すると整理しやすいです。",
      "BとDが同じ種類の場合・異なる種類の場合に分け、Eの2文目とCの人数条件まで同時に満たせるか調べましょう。"
    ],
    "explanation": "Bの1文目「Dは騎士」とDの1文目「Bは騎士」から、BとDは同じ種類でなければならない。するとEの2文目「BとDは同じ種類」は真なので、Eは騎士。Eの1文目よりAも騎士。Dの2文目「Eは悪党」は偽なので、Dは悪党。よってBも悪党。Aの1文目「Bは悪党」は真で、Aの2文目よりCとEは同じ種類だからCも騎士。Cの発言も、騎士がA・C・Eの3人でDが悪党なので真になる。したがって正しい組み合わせは、騎士がA・C・E、悪党がB・D。",
    "skillTags": [
      "tracing"
    ],
    "choices": [
      "騎士：B・D　悪党：A・C・E",
      "騎士：A・B・C　悪党：D・E",
      "騎士：A・C・E　悪党：B・D",
      "騎士：A・D・E　悪党：B・C"
    ],
    "answerKey": [
      "2"
    ]
  },
  {
    "id": "code-s7-07",
    "domain": "CODE",
    "difficulty": 7,
    "title": "研修候補の連鎖",
    "passage": "6人の候補者、青木・馬場・千田・土井・江藤・藤原から、ちょうど3人を研修に選ぶ。\n選考には次の条件がある。\n\n1. 青木が選ばれるなら、馬場は選ばれない。\n2. 馬場が選ばれないなら、千田は選ばれる。\n3. 千田が選ばれないなら、土井は選ばれる。\n4. 土井が選ばれるなら、江藤は選ばれない。\n5. 江藤が選ばれないなら、藤原は選ばれる。\n6. 藤原が選ばれるなら、青木は選ばれる。\n7. 青木が選ばれるなら、藤原は選ばれる。\n8. 馬場と土井は、選ばれる・選ばれないが同じである。",
    "prompt": "選ばれる3人として正しいものはどれか。",
    "kind": "choice",
    "taskType": "puzzle",
    "hints": [
      "馬場が選ばれる場合と選ばれない場合で、条件8は土井に何を強制しますか。",
      "土井が選ばれると、江藤、藤原、青木、馬場へと条件が連鎖します。矛盾が出ないか確認しましょう。",
      "馬場が選ばれない場合、千田は必ず選ばれます。その後、江藤が選ばれるかどうかで人数がちょうど3人になるかを比べましょう。"
    ],
    "explanation": "馬場が選ばれると、条件8より土井も選ばれる。すると江藤は選ばれず、藤原、青木も選ばれるが、青木が選ばれるなら馬場は選ばれないので矛盾する。よって馬場と土井は選ばれない。条件2より千田は選ばれる。残り2人は青木・江藤・藤原から選ぶが、青木と藤原は条件6・7により同じ結果になる。江藤を選ぶと人数が2人または4人になり、ちょうど3人にならない。したがって江藤は選ばれず、条件5より藤原、条件6より青木が選ばれる。正解は青木・千田・藤原。",
    "skillTags": [
      "tracing"
    ],
    "choices": [
      "千田・江藤・藤原",
      "青木・千田・藤原",
      "青木・千田・江藤",
      "馬場・千田・土井"
    ],
    "answerKey": [
      "1"
    ]
  },
  {
    "id": "code-s8-01",
    "domain": "CODE",
    "difficulty": 8,
    "title": "再帰フォーマット",
    "passage": "def weave(s, depth=0, seen=None):\n    seen = [] if seen is None else seen\n    if len(s) <= 1:\n        seen.append(f\"{depth}:{s or '_'}\")\n        return s.upper(), seen\n    mid = len(s) // 2\n    left, seen = weave(s[:mid], depth + 1, seen)\n    if s[mid] in \"aeiou\":\n        seen.append(f\"{depth}:{s[mid]}!\")\n        right, seen = weave(s[mid + 1:], depth + 2, seen)\n        return f\"{right}-{s[mid]}-{left}\", seen\n    right, seen = weave(s[mid + 1:], depth + 1, seen)\n    seen.append(f\"{depth}:{s[mid]}\")\n    return f\"{left}{s[mid]}{right}\", seen\nword, log = weave(\"format\")\nprint(word)\nprint(\"|\".join(log[1::2]))",
    "prompt": "このコードを実行すると、何が出力されますか。",
    "kind": "choice",
    "taskType": "python",
    "hints": [
      "再帰呼び出しは、各部分文字列に対してどの順番で実行されていますか。",
      "中央の文字が母音のときだけ、返す文字列の左右が入れ替わり、深さの増え方も変わります。",
      "log は追加された全要素ではなく、添字 1, 3, 5, ... の要素だけが結合されます。"
    ],
    "explanation": "weave(\"format\") は中央の m を境に、左側 \"for\" と右側 \"at\" を処理します。\"for\" では中央の o が母音なので \"R-o-F\" になり、\"at\" は \"At\" になります。最後に m を挟むため word は R-o-FmAt です。log は追加順に 2:f, 1:o!, 3:r, 2:a, 2:_, 1:t, 0:m となり、log[1::2] は 1:o!, 2:a, 1:t です。",
    "skillTags": [
      "tracing",
      "algorithms"
    ],
    "choices": [
      "R-o-FmAt\r\n1:o!|2:a|1:t",
      "F-o-RmAt\n1:o!|2:a|1:t",
      "R-o-FmAt\n2:f|3:r|2:_|0:m",
      "R-o-FmA-t\n1:o!|2:_|0:m"
    ],
    "answerKey": [
      "0"
    ]
  },
  {
    "id": "code-s8-02",
    "domain": "CODE",
    "difficulty": 8,
    "title": "再帰選択の出力",
    "passage": "from itertools import product\ndef score(bits, i=0, carry=0, seen=None):\n    seen = [] if seen is None else seen\n    if i == len(bits):\n        return carry, tuple(seen[-2:])\n    x = bits[i]\n    if x != carry:\n        return score(bits, i + 1, carry, seen)\n    seen.append(i)\n    take = score(bits, i + 1, 1 - carry, seen)\n    seen.pop()\n    skip = score(bits, i + 1, carry, seen)\n    return max((take, skip), key=lambda r: (r[0] + len(r[1]), r[1]))\nans = []\nfor bits in product([0, 1], repeat=3):\n    got = score(bits)\n    if got[0]:\n        ans.append((\"\".join(map(str, bits)), got[1]))\nprint(ans)",
    "prompt": "次のコードを実行したときの出力はどれですか。",
    "kind": "choice",
    "taskType": "python",
    "hints": [
      "score は、各 bits についてどのような条件のときだけ分岐しているでしょうか。",
      "seen.append(i) した後に再帰し、戻ってから pop するので、同じリストが深さ優先で使い回されます。",
      "max の比較キーは、carry だけではなく r[0] + len(r[1]) と r[1] の組です。最後に ans に入るには got[0] が真である必要があります。"
    ],
    "explanation": "各3桁の bits について、現在の carry と要素が一致した位置だけ take/skip に分岐します。max は carry 単独でなく、r[0] + len(r[1])、次に r[1] で選びます。その結果 got[0] が 1 になるのは 000, 010, 100, 110 の4つで、それぞれの tuple は (2,), (1, 2), (2,), (2,) になります。",
    "skillTags": [
      "tracing",
      "algorithms"
    ],
    "choices": [
      "[('000', (0,)), ('010', (1, 2)), ('100', (1,)), ('110', (2,))]",
      "[('000', (2,)), ('010', (1, 2)), ('100', (2,)), ('110', (2,))]",
      "[('000', (2,)), ('001', (1, 2)), ('010', (1, 2)), ('100', (2,)), ('110', (2,))]",
      "[('000', (2,)), ('010', (1, 2)), ('100', (2,))]"
    ],
    "answerKey": [
      "1"
    ]
  },
  {
    "id": "code-s8-03",
    "domain": "CODE",
    "difficulty": 8,
    "title": "分岐再帰の蓄積",
    "passage": "def f(xs, i=0, acc=None):\n    acc = [] if acc is None else acc\n    if i >= len(xs):\n        return acc, sum(v for _, v in acc)\n    tag, n = xs[i]\n    if n % 2 == 0:\n        acc.append((tag, n // 2))\n        return f(xs, i + 1, acc)\n    elif acc and acc[-1][1] < n:\n        old = acc.pop()\n        acc.append((tag + old[0], n - old[1]))\n        return f(xs, i + 2, acc)\n    else:\n        acc.append((tag.upper(), n + i))\n        return f(xs, i + 1, acc)\ndata = [('a', 3), ('b', 4), ('c', 5), ('d', 2), ('e', 1)]\none = f(data)\ntwo = f(data[1:4], acc=one[0][:1])\nprint(one)\nprint(two)",
    "prompt": "このコードを実行したとき、表示される出力はどれですか。",
    "kind": "choice",
    "taskType": "python",
    "hints": [
      "再帰呼び出しのたびに、i と acc はどう変わっていますか。",
      "奇数のときは、直前の acc の値によって elif と else のどちらに入るかが変わります。",
      "data[1:4] と one[0][:1] は、元のリスト全体をそのまま渡しているわけではありません。"
    ],
    "explanation": "1回目は a が else、b が偶数分岐、c が elif で b を取り除いて cb を追加し、i が2つ進むため d は飛ばされます。最後に e が else で追加され、合計は11です。2回目は one[0][:1] により先頭要素だけの新しいリストから始まり、b を追加後、c の elif で b を cb に置き換えて終了するため、合計は6です。",
    "skillTags": [
      "tracing",
      "algorithms"
    ],
    "choices": [
      "([('A', 3), ('cb', 3), ('E', 5), ('cb', 3)], 14)\n([('A', 3), ('cb', 3)], 6)",
      "([('A', 3), ('b', 2), ('CB', 6), ('d', 1), ('E', 5)], 17)\n([('A', 3), ('b', 2), ('CB', 6)], 11)",
      "([('A', 3), ('cb', 3), ('E', 5)], 11)\n([('A', 3), ('cb', 3), ('d', 1)], 7)",
      "([('A', 3), ('cb', 3), ('E', 5)], 11)\r\n([('A', 3), ('cb', 3)], 6)"
    ],
    "answerKey": [
      "3"
    ]
  },
  {
    "id": "code-s8-05",
    "domain": "CODE",
    "difficulty": 8,
    "title": "分岐探索の共有状態",
    "passage": "graph = {\"A\": {\"B\", \"C\"}, \"B\": {\"A\", \"D\"}, \"C\": {\"A\", \"D\"}, \"D\": set()}\n\ndef routes(node, goal, blocked, seen=None, path=None):\n    if seen is None:\n        seen = set()\n    if path is None:\n        path = []\n    seen.add(node)\n    path.append(node)\n    if node == goal:\n        return [\"\".join(path)]\n    ans = []\n    for nxt in sorted(graph[node] - blocked - seen):\n        ans += routes(nxt, goal, blocked, seen, path)\n    return ans\n\nprint(sorted(routes(\"A\", \"D\", {\"B\"})))\nprint(sorted(routes(\"A\", \"D\", set())))",
    "prompt": "このコードは、blocked に含まれる点を避けて A から D へ行く単純経路を列挙するつもりです。\n期待する出力は次のとおりです。\n['ACD']\n['ABD', 'ACD']\n\nしかし実際の出力は次のようになります。\n['ACD']\n['ABD']\n\n原因を取り除く修正として最も適切なものを選んでください。",
    "kind": "choice",
    "taskType": "debug",
    "hints": [
      "最初の分岐を調べ終えたあと、次の分岐に何が残っているでしょうか。",
      "seen と path は、再帰呼び出しの親子で同じオブジェクトを共有していないかに注目しましょう。",
      "各分岐を独立に探索するには、分岐ごとの状態を分けるか、戻るときに両方の状態を完全に復元する必要があります。"
    ],
    "explanation": "14行目で同じ seen と path を子の再帰呼び出しに渡しているため、B 側の探索で追加された D や経路情報が、C 側の探索にも残ります。各分岐に seen.copy() と path.copy() を渡せば、分岐ごとの訪問済み集合と経路が独立し、期待どおり ['ABD', 'ACD'] が得られます。",
    "skillTags": [
      "tracing",
      "debugging"
    ],
    "choices": [
      "14行目を ans += routes(nxt, goal, blocked, seen.copy(), path.copy()) にする",
      "13行目を for nxt in sorted((graph[node] - blocked) | seen): にする",
      "3行目を def routes(node, goal, blocked, seen=set(), path=[]): にする",
      "11行目の return の直前だけに path.pop() と seen.remove(node) を追加する"
    ],
    "answerKey": [
      "0"
    ]
  },
  {
    "id": "code-s8-06",
    "domain": "CODE",
    "difficulty": 8,
    "title": "三つの体験ブース",
    "passage": "ある研修会に42人が参加した。A、B、Cの3つの体験ブースについて、各参加者は0個から3個のブースを訪れた。調査結果は次の通り。Aを訪れた人は23人、Bを訪れた人は22人、Cを訪れた人は22人。AとBの両方を訪れた人は11人、BとCの両方を訪れた人は9人、CとAの両方を訪れた人は12人。ここで「両方を訪れた人」には、3つすべてを訪れた人も含む。さらに、どれも訪れなかった人は、Aだけを訪れた人より少ない。また、Cだけを訪れた人と、どれも訪れなかった人の人数差は2人以下だった。",
    "prompt": "3つすべてを訪れた人と、どれも訪れなかった人の組み合わせとして正しいものはどれか。",
    "kind": "choice",
    "taskType": "puzzle",
    "hints": [
      "「AとBの両方」には、A・B・Cの3つすべてを訪れた人も入る点を、どう扱えばよいでしょうか。",
      "まず、3つすべてを訪れた人数を1つの文字で置き、ベン図の各領域をその文字で表してみましょう。",
      "最後に、どれも訪れなかった人数と、Aだけ・Cだけの人数に関する2つの追加条件を同時に満たす整数だけを残します。"
    ],
    "explanation": "3つすべてを訪れた人数をtとする。すると、AとBだけは11−t、BとCだけは9−t、CとAだけは12−t。Aだけは23−(11−t)−(12−t)−t=t、Bだけはt+2、Cだけはt+1となる。少なくとも1つ訪れた人数は35+tなので、どれも訪れなかった人数は42−(35+t)=7−t。条件「どれも訪れなかった人はAだけより少ない」より7−t<t。また「Cだけと未訪問者の差は2人以下」より、t+1と7−tの差が2以下。これらを満たす整数はt=4だけなので、未訪問者は7−4=3人。",
    "skillTags": [
      "tracing"
    ],
    "choices": [
      "3つすべて：2人、どれも訪れなかった：5人",
      "3つすべて：4人、どれも訪れなかった：3人",
      "3つすべて：3人、どれも訪れなかった：4人",
      "3つすべて：5人、どれも訪れなかった：2人"
    ],
    "answerKey": [
      "1"
    ]
  },
  {
    "id": "code-s8-07",
    "domain": "CODE",
    "difficulty": 8,
    "title": "鍵付き通路の最短手",
    "passage": "6列×5行のマス目がある。上から順に、各行は次のとおり。\n\n行1：# # # # . G\n行2：# # # # . #\n行3：. . K # T .\n行4：# . # . # .\n行5：S . . . . .\n\n記号の意味は次のとおり。\nS：開始マス\nG：ゴール\nK：鍵のマス\nT：扉のマス\n.：通行可能\n#：通行不可\n\nロボットは最初、Sにいて東を向いている。1手でできる操作は、左に90度回転、右に90度回転、または現在向いている方向へ1マス進む、のいずれかである。通行不可のマスや盤外へ進む操作はできない。\nKに入ると鍵を得る。鍵を得るための追加の手数はかからない。Tには、鍵を得た後でなければ入れない。Gに入った時点で終了し、その後に向きを変える必要はない。",
    "prompt": "SからGまで行くための最短手数として正しいものを選べ。",
    "kind": "choice",
    "taskType": "algorithm",
    "hints": [
      "Gへ行くには、どのマスを必ず通る必要があるだろうか。",
      "位置だけでなく、ロボットがどの向きを向いているかも手数に影響する。SからK、KからGに分けて考えるとよい。",
      "進む回数だけでなく、曲がり角ごとに必要な回転回数を足し忘れないようにしよう。"
    ],
    "explanation": "Gへ到達するにはTを通る必要があり、Tに入るには先にKへ行く必要がある。SからKまでは、東へ1、北へ2、東へ1と進む経路で、移動4回と回転2回の計6手。K到着時は東向きなので、Kから戻って下側を回り、Tを通ってGへ進むには、移動13回と回転8回の計21手かかる。合計は6+21=27手。",
    "skillTags": [
      "algorithms",
      "tracing"
    ],
    "choices": [
      "27手",
      "28手",
      "25手",
      "26手"
    ],
    "answerKey": [
      "0"
    ]
  },
  {
    "id": "code-s9-01",
    "domain": "CODE",
    "difficulty": 9,
    "title": "共有箱の生成器",
    "passage": "def factory(seed):\n    box = [seed]\n    def bump(step):\n        box[0] += step; return box[0]\n    def gen(name, limit):\n        i, total = 0, box[0]\n        while i < limit:\n            total += bump(i - limit)\n            yield (name, i, total, box[0])\n            i += 1\n        box[0] += total; return (name, box[0])\n    return bump, gen, box\nbump, make, shared = factory(4)\na = make(\"A\", 3)\nprint(next(a)); print(bump(5), shared)\nb = make(\"B\", 2)\nprint(next(b)); print(next(a))\nwrap = lambda x: (bump(x), shared[0])\nprint(wrap(-4)); print(list(a))\nprint(next(b)); print(shared)",
    "prompt": "このコードを実行したとき、print によって表示される出力として正しいものを選びなさい。",
    "kind": "choice",
    "taskType": "python",
    "hints": [
      "a と b は、どの時点で gen の本体を実行し始めるでしょうか。",
      "gen の total は各生成器ごとのローカル変数ですが、box は bump・a・b で共有されています。",
      "yield で止まった直後は、次に再開されるまで i += 1 やループ終了後の box[0] += total はまだ実行されません。"
    ],
    "explanation": "a の最初の next で box は 4 から 1 になり、('A', 0, 5, 1) を返します。その後 bump(5) で box は 6。b は開始時に total=6 を持ち、最初の yield で box は 4、total は 10 です。a の次の yield 後、wrap(-4) で box は -2。list(a) は a の残り1要素を取り出したあと、a を最後まで進めるため box は 1 になります。最後の next(b) はまだ b のループ終了後処理までは進まず、box を 0 にして ('B', 1, 10, 0) を返すので、最後の shared は [0] です。",
    "skillTags": [
      "tracing",
      "debugging"
    ],
    "choices": [
      "('A', 0, 5, 1)\n6 [6]\n('B', 0, 10, 4)\n('A', 1, 7, 2)\n(-2, -2)\n[('A', 2, 4, -3)]\n('B', 1, 10, 0)\n[1]",
      "('A', 0, 5, 1)\n6 [6]\n('B', 0, 10, 4)\n('A', 1, 7, 2)\n(-2, -2)\n[('A', 2, 4, -3)]\n('B', 1, 10, 0)\n[10]",
      "('A', 0, 5, 1)\r\n6 [6]\r\n('B', 0, 10, 4)\r\n('A', 1, 7, 2)\r\n(-2, -2)\r\n[('A', 2, 4, -3)]\r\n('B', 1, 10, 0)\r\n[0]",
      "('A', 0, 5, 1)\n6 [6]\n('B', 0, 8, 4)\n('A', 1, 7, 2)\n(-2, -2)\n[('A', 2, 4, -3)]\n('B', 1, 10, 0)\n[0]"
    ],
    "answerKey": [
      "2"
    ]
  },
  {
    "id": "code-s9-02",
    "domain": "CODE",
    "difficulty": 9,
    "title": "反転語の遅延評価",
    "passage": "def maker(words):\n    seen = []\n    def add(w):\n        seen.append(w)\n        return w[::-1]\n    for w in words:\n        if w == w[::-1]:\n            yield lambda w=w: (w, len(seen))\n        else:\n            yield lambda r=add(w): (r, ''.join(seen)[-2:])\n    yield lambda: ('|'.join(seen), len(seen))\n\nitems = ['level', 'ab', 'noon', 'abc']\ng = maker(items)\na, b = next(g), next(g)\nitems[2] = 'xyx'\nc = next(g)\nitems.append('deed')\nd, e, f = next(g), next(g), next(g)\nprint(a(), b(), c())\nprint(d(), e(), f())\nprint(b(), a())",
    "prompt": "このコードを実行したとき、print によって表示される出力として正しいものを選びなさい。",
    "kind": "choice",
    "taskType": "python",
    "hints": [
      "各 lambda が作られた時点で保存される値と、呼び出し時に参照される値はそれぞれ何でしょうか。",
      "リスト items の要素変更と append が、まだ進行中の for ループにどう見えるかを追いましょう。",
      "seen に追加されるのは回文でない語だけです。len(seen) や ''.join(seen)[-2:] は lambda を呼んだ時点で評価される部分があります。"
    ],
    "explanation": "a は 'level' を保存しますが、len(seen) は呼び出し時に 2 です。b と d はそれぞれ add により 'ab'、'abc' を seen に追加し、反転文字列を保存します。items[2] は next される前に 'xyx' へ変更されるため c は 'xyx' になり、append された 'deed' も未終了のリスト反復で処理されます。ただし 'deed' は回文なので seen には追加されません。最終的に seen は ['ab', 'abc'] です。",
    "skillTags": [
      "tracing",
      "debugging"
    ],
    "choices": [
      "('level', 2) ('ba', 'bc') ('xyx', 2)\r\n('cba', 'bc') ('deed', 2) ('ab|abc', 2)\r\n('ba', 'bc') ('level', 2)",
      "('level', 0) ('ba', 'ab') ('xyx', 1)\n('cba', 'bc') ('deed', 2) ('ab|abc', 2)\n('ba', 'bc') ('level', 2)",
      "('level', 2) ('ba', 'bc') ('noon', 2)\n('cba', 'bc') ('deed', 2) ('ab|abc', 2)\n('ba', 'bc') ('level', 2)",
      "('level', 3) ('ba', 'de') ('xyx', 3)\n('cba', 'de') ('deed', 3) ('ab|abc|deed', 3)\n('ba', 'de') ('level', 3)"
    ],
    "answerKey": [
      "0"
    ]
  },
  {
    "id": "code-s9-03",
    "domain": "CODE",
    "difficulty": 9,
    "title": "共有キーの整列",
    "passage": "def make_key(seed):\n    box = {\"n\": seed, \"seen\": []}\n    def gen(label):\n        for ch in label:\n            box[\"n\"] += (ord(ch) % 5) - 2\n            box[\"seen\"].append((label, ch, box[\"n\"]))\n            yield box[\"n\"]\n    def key(item):\n        label, nums = item\n        g = gen(label)\n        a = sum(next(g) * v for v in nums[:2])\n        b = sum(x * (i + 1) for i, x in enumerate(g))\n        return (a + b, -box[\"n\"], len(box[\"seen\"]))\n    return key, box\nitems = [(\"cab\", [1, -2, 4]), (\"ad\", [3, 1, -1]), (\"bbca\", [-1, 2, 2]), (\"dac\", [2, -3, 1])]\nkey, box = make_key(0)\norder = sorted(items, key=key)\nprint([name for name, _ in order])\nprint(box[\"n\"], box[\"seen\"][2::3])",
    "prompt": "このコードを実行したときの出力として正しいものを 1 つ選びなさい。",
    "kind": "choice",
    "taskType": "python",
    "hints": [
      "sorted の key 関数は、各要素についていつ、何回呼ばれるでしょうか。",
      "box は key 呼び出しごとに作り直されず、make_key が返した同じ辞書を共有しています。",
      "各ラベルの文字ごとの増減量を先に整理し、items の元の順番で key の返すタプルを追いましょう。"
    ],
    "explanation": "sorted は元の items の順に key を各要素へ 1 回ずつ適用します。box は共有されるため、n と seen は呼び出しをまたいで更新されます。各 key は順に cab=(1, -3, 3)、ad=(10, -1, 5)、bbca=(19, -5, 9)、dac=(2, -5, 12) となるので、整列順は cab, dac, ad, bbca です。最後の n は 5、seen[2::3] は表示された 4 つのタプルになります。",
    "skillTags": [
      "tracing",
      "debugging"
    ],
    "choices": [
      "['cab', 'dac', 'ad', 'bbca']\n5 [('cab', 'b', 3), ('ad', 'd', 1), ('bbca', 'a', 5), ('dac', 'c', 5)]",
      "['dac', 'cab', 'ad', 'bbca']\n5 [('cab', 'b', 3), ('bbca', 'b', 2), ('bbca', 'a', 5), ('dac', 'c', 5)]",
      "['cab', 'ad', 'dac', 'bbca']\n0 [('cab', 'b', 3), ('bbca', 'b', 2), ('bbca', 'a', 5), ('dac', 'c', 5)]",
      "['cab', 'dac', 'ad', 'bbca']\r\n5 [('cab', 'b', 3), ('bbca', 'b', 2), ('bbca', 'a', 5), ('dac', 'c', 5)]"
    ],
    "answerKey": [
      "3"
    ]
  },
  {
    "id": "code-s9-04",
    "domain": "CODE",
    "difficulty": 9,
    "title": "遅れる経路生成",
    "passage": "def make_routes(grid):\n    makers = []\n    route = []\n    for r, row in enumerate(grid):\n        for c, value in enumerate(row):\n            route[:] = []\n            for dr, dc in ((0, 0), (0, 1), (1, 0)):\n                nr, nc = r + dr, c + dc\n                if nr < len(grid) and nc < len(grid[nr]):\n                    route.append((nr, nc))\n            def walk():\n                total = sum(grid[rr][cc] for rr, cc in route)\n                yield (r, c, value, total, tuple(route))\n            makers.append(walk)\n    return makers\ngrid = [[1, 2, 3], [4, 5], [6, 7, 8]]\nout = [item for make in make_routes(grid) for item in make()]\nprint(out[:4])\nprint(out[-1])",
    "prompt": "このコードは、各マスから「自分・右・下」に存在する座標を集め、その値の合計を作成順に出力する意図です。\n\n期待する出力:\n[(0, 0, 1, 7, ((0, 0), (0, 1), (1, 0))), (0, 1, 2, 10, ((0, 1), (0, 2), (1, 1))), (0, 2, 3, 3, ((0, 2),)), (1, 0, 4, 15, ((1, 0), (1, 1), (2, 0)))]\n(2, 2, 8, 8, ((2, 2),))\n\n実際の出力:\n[(2, 2, 8, 8, ((2, 2),)), (2, 2, 8, 8, ((2, 2),)), (2, 2, 8, 8, ((2, 2),)), (2, 2, 8, 8, ((2, 2),))]\n(2, 2, 8, 8, ((2, 2),))\n\n期待どおりにするための原因行と修正として、最も適切なものを選んでください。行番号は passage の先頭から数えます。",
    "kind": "choice",
    "taskType": "debug",
    "hints": [
      "各 walk が作られた時点と、その中身が実行される時点は同じでしょうか。",
      "内側の関数が参照しているループ変数とリストが、make_routes の終了時にどの値・状態になっているかを追ってください。",
      "合計式そのものより、後から呼ばれる関数に何を固定して渡すべきかを確認しましょう。"
    ],
    "explanation": "walk はクロージャで r、c、value、route を参照しています。さらに generator 関数なので、本体は作成時ではなく後で反復された時に実行されます。その時点ではループ変数は最後の値、route も最後に残ったリスト状態になっているため、すべて同じ結果になります。11行目で現在の値と route のコピーをデフォルト引数に束縛すれば、各 walk が作成時の情報を保持できます。",
    "skillTags": [
      "tracing",
      "debugging"
    ],
    "choices": [
      "12行目の sum に渡す generator expression が遅延評価されるのが原因。total = sum([grid[rr][cc] for rr, cc in route]) に変更する。",
      "17行目で make() を直接反復しているのが原因。out = [item for make in make_routes(grid) for item in list(make())] に変更する。",
      "11行目の def walk(): が、r・c・value と同じ route リストを後から参照している。def walk(r=r, c=c, value=value, route=tuple(route)): に変更する。",
      "6行目の route[:] = [] が同じリストを再利用している。route = [] に変更すれば、各 walk はそれぞれ別の経路を参照できる。"
    ],
    "answerKey": [
      "2"
    ]
  },
  {
    "id": "code-s9-05",
    "domain": "CODE",
    "difficulty": 9,
    "title": "締切貪欲の比較",
    "passage": "各仕事は1日で終わり、締切日 d までに実行できれば報酬 p が得られる。1日に実行できる仕事は1つだけである。\n\n仕事一覧\nA: d=1, p=42\nB: d=1, p=36\nC: d=2, p=55\nD: d=2, p=42\nE: d=3, p=48\nF: d=3, p=33\nG: d=3, p=36\nH: d=4, p=63\nI: d=4, p=28\nJ: d=5, p=58\nK: d=5, p=55\nL: d=5, p=31\nM: d=6, p=67\nN: d=6, p=33\nO: d=7, p=48\nP: d=7, p=42\nQ: d=8, p=60\nR: d=8, p=36\n\n手順G\n1. 仕事を d の昇順に並べる。同じ d なら p の降順、さらに同じなら名前の辞書順に並べる。\n2. その順に1つずつ「袋」に入れる。\n3. 仕事 X を入れた直後、袋の中の仕事数が X の締切 d(X) を超えていたら、袋から p が最小の仕事を1つ捨てる。p が最小の仕事が複数あるときは、名前が辞書順で最も後ろのものを捨てる。\n4. 最後に袋に残った仕事を、d の昇順、同じ d なら p の降順、さらに同じなら名前の辞書順に並べ、その順に1日目から実行する。\n\n手順H\n1. 仕事を p の降順に並べる。同じ p なら d の昇順、さらに同じなら名前の辞書順に並べる。\n2. その順に、各仕事を「その仕事の締切日以下で、まだ空いている最も遅い日」に入れる。そのような日がなければ捨てる。\n\n計算量については、仕事数を n、最大締切を m とする。手順Gの袋は、最小報酬の仕事を対数時間で取り出せる構造で管理する。手順Hの空き日は、指定日以下の最大の空き日を対数時間で取り出せる構造で管理する。",
    "prompt": "手順Gの最終実行順、手順Hの各日の割当、合計報酬、一般の計算量について、すべて正しいものを1つ選べ。",
    "kind": "choice",
    "taskType": "algorithm",
    "hints": [
      "手順Gでは、ある時点で袋の仕事数が締切を超えたとき、どの仕事が捨てられるだろうか。",
      "手順Gは締切順で袋を更新する。手順Hは報酬順で、空いている最も遅い日に置く。最終的な仕事集合と日付の割当は分けて確認するとよい。",
      "計算量は、並べ替えのコストと、各仕事ごとのデータ構造操作のコストを別々に見積もる。"
    ],
    "explanation": "手順Gでは、B, D, G, F, I, A, L, N, P, R が順に捨てられ、袋には C, E, H, J, K, M, O, Q が残る。これを締切順に並べるので実行順は C, E, H, J, K, M, O, Q。手順Hでは報酬順に置くため、M→6日目、H→4日目、Q→8日目、J→5日目、C→2日目、K→3日目、E→1日目、O→7日目となる。合計は 55+48+63+58+55+67+48+60=454。計算量は、手順Gが整列と袋操作で O(n log n)、手順Hが整列 O(n log n) と空き日操作 O(n log m) なので O(n log n + n log m)。",
    "skillTags": [
      "algorithms",
      "tracing"
    ],
    "choices": [
      "手順Gの実行順は 1日目:C, 2日目:E, 3日目:H, 4日目:J, 5日目:K, 6日目:M, 7日目:O, 8日目:Q。手順Hの割当も 1日目:C, 2日目:E, 3日目:H, 4日目:J, 5日目:K, 6日目:M, 7日目:O, 8日目:Q。合計報酬は454。手順Hは、指定された構造を使っても必ず O(n^2) になる。",
      "手順Gの実行順は 1日目:C, 2日目:E, 3日目:H, 4日目:J, 5日目:K, 6日目:M, 7日目:O, 8日目:Q。手順Hの割当は 1日目:E, 2日目:C, 3日目:K, 4日目:H, 5日目:J, 6日目:M, 7日目:O, 8日目:Q。合計報酬は454。手順Gは O(n log n)、手順Hは O(n log n + n log m)。",
      "手順Gの実行順は 1日目:A, 2日目:C, 3日目:H, 4日目:J, 5日目:K, 6日目:M, 7日目:O, 8日目:Q。手順Hの割当も同じである。合計報酬は448。手順Gは O(n log n)、手順Hは O(nm)。",
      "手順Gの実行順は 1日目:C, 2日目:E, 3日目:H, 4日目:J, 5日目:K, 6日目:M, 7日目:P, 8日目:Q。手順Hの割当は 1日目:E, 2日目:C, 3日目:K, 4日目:H, 5日目:J, 6日目:M, 7日目:P, 8日目:Q。合計報酬は448。手順Gは O(n log n + n log m)、手順Hは O(n log n)。"
    ],
    "answerKey": [
      "1"
    ]
  },
  {
    "id": "code-s9-06",
    "domain": "CODE",
    "difficulty": 9,
    "title": "割引袋の組合せ",
    "passage": "ある店では、同じ定価の袋を A・B・C・D の4種類の割引率で売った。A は定価の80%、B は75%、C は60%、D は50%で売った。4種類はいずれも少なくとも1袋売れ、合計は240袋だった。また、全体の売上は、240袋すべてを定価で売った場合の65%に等しかった。さらに、A の袋数は B の袋数の半分以上、3分の2以下であり、C の袋数は D の袋数の1.5倍以上、2倍以下だった。",
    "prompt": "条件をすべて満たす A・B・C・D の袋数の組は何通りあるか。",
    "kind": "choice",
    "taskType": "math",
    "hints": [
      "4種類の袋数を文字で置くと、合計条件と売上条件からどんな一次方程式が作れますか。",
      "売上条件から D を消すと、B の偶奇に制限が出ます。B を偶数として置き直すと数えやすくなります。",
      "A と B の比、C と D の比を、置き直した変数で A の上下限に変換して、下限が上限以下になる範囲だけを数えます。"
    ],
    "explanation": "A,B,C,D の袋数を a,b,c,d とする。合計より a+b+c+d=240。売上条件は 80a+75b+60c+50d=65×240 なので、5で割って 16a+15b+12c+10d=3120。合計式の10倍を引くと 6a+5b+2c=720。よって b は偶数なので b=2k とおける。すると c=(720-6a-10k)/2、d=(4a+6k-240)/2。比の条件から k≤a≤⌊4k/3⌋、また 3d/2≤c≤2d を整理して ceil((600-11k)/7)≤a≤floor((1080-19k)/12)。したがって a の範囲は、下限 max(k,ceil((600-11k)/7))、上限 min(⌊4k/3⌋,floor((1080-19k)/12))。これが成り立つのは k=30,31,32,33,34 で、それぞれの個数は 2,4,4,4,3。合計は 17 通り。",
    "skillTags": [
      "algorithms"
    ],
    "choices": [
      "14通り",
      "17通り",
      "20通り",
      "23通り"
    ],
    "answerKey": [
      "1"
    ]
  },
  {
    "id": "code-s10-01",
    "domain": "CODE",
    "difficulty": 10,
    "title": "循環リストの追跡",
    "passage": "data = [[2, 1], [3], [1, 4, 1]]\npool = [0]\n\ndef weave(rows):\n    for i, (left, right) in enumerate(zip(rows, rows[1:] + rows[:1])):\n        left.append(i)\n        pool[0] += sum(left[:2]) - len(right)\n        yield (i, left, right, pool[0])\n\ng = weave(data)\nseen = []\nfor i, left, right, score in g:\n    seen.append((i, list(left), list(right), score))\n    if score % 2 == 0:\n        right[:] = right[-1:] + right[:-1]\n    else:\n        left[0] += score\n    if i == 1:\n        data.append([score])\n        pool.append(len(data))\npairs = []\nfor j, row in enumerate(data):\n    for k, value in enumerate(row[:2]):\n        pairs.append((j, k, value + pool[k % len(pool)]))\nmix = list(zip([p[2] for p in pairs], [len(r) for r in data]))\nprint(seen)\nprint(data)\nprint(mix[-5:])",
    "prompt": "次のPythonコードを実行したとき、printによって表示される出力として正しいものを選びなさい。",
    "kind": "choice",
    "taskType": "python",
    "hints": [
      "weaveのfor文で使われるzipの組み合わせは、data.append後にも増えるでしょうか。",
      "seenに入れているのはlist(left)とlist(right)なので、その時点のコピーか、後から変わる参照かに注目しましょう。",
      "最後のzipは2つのリストの長さが違います。短いほうに合わせてどこまで残るかを確認しましょう。"
    ],
    "explanation": "weave内のzip(rows, rows[1:] + rows[:1])は反復開始時の3組だけを処理するため、途中でappendされた[3]はweaveの反復対象にはなりません。seenには各yield直後のコピーが入り、その後のleft[0]変更はseenには反映されません。最終的にdataは[[2, 1, 0], [6, 1], [6, 4, 1, 2], [3]]、poolは[5, 4]となり、最後のzipはdataの長さ4に合わせて4組だけ出力されます。",
    "skillTags": [
      "tracing"
    ],
    "choices": [
      "[(0, [2, 1, 0], [3], 2), (1, [6, 1], [1, 4, 1], 3), (2, [6, 4, 1, 2], [2, 1, 0], 5)]\n[[2, 1, 0], [6, 1], [6, 4, 1, 2], [3]]\n[(7, 3), (5, 2), (11, 4), (5, 1)]",
      "[(0, [2, 1, 0], [3], 2), (1, [3, 1], [1, 4, 1], 3), (2, [1, 4, 1, 2], [2, 1, 0], 5), (3, [3, 3], [2, 1, 0], 6)]\n[[2, 1, 0], [6, 1], [6, 4, 1, 2], [6, 3]]\n[(7, 3), (5, 2), (11, 4), (5, 4)]",
      "[(0, [2, 1, 0], [3], 2), (1, [3, 1], [1, 4, 1], 3), (2, [1, 4, 1, 2], [2, 1, 0], 5)]\n[[2, 1, 0], [6, 1], [6, 4, 1, 2], [3]]\n[(7, 3), (5, 2), (11, 4), (5, 1), (11, 4), (8, 1), (8, 1)]",
      "[(0, [2, 1, 0], [3], 2), (1, [3, 1], [1, 4, 1], 3), (2, [1, 4, 1, 2], [2, 1, 0], 5)]\r\n[[2, 1, 0], [6, 1], [6, 4, 1, 2], [3]]\r\n[(7, 3), (5, 2), (11, 4), (5, 1)]"
    ],
    "answerKey": [
      "3"
    ]
  },
  {
    "id": "code-s10-02",
    "domain": "CODE",
    "difficulty": 10,
    "title": "浅い複製の記録",
    "passage": "data = [[1, 2], [3], [], [4, 5]]\nalias = data[:2] + data[2:]\ndef step(seq, box=[]):\n    box.append([len(seq), sum(map(sum, seq))])\n    seq = [row[:] for row in seq if row or box[-1][0] % 2]\n    for i, row in enumerate(seq):\n        row += [i]\n        if i % 2 == 0:\n            row[:1] = row[-1:]\n        else:\n            row.pop(0)\n    return seq, box\ng = (step(data[:k])[0] for k in range(1, 5))\na = next(g)\ndata[0].append(9)\nb = next(g)\nc, log = step(alias[1:4])\nd = [x for part in (a, b, c) for x in part if sum(x) % 2]\nalias[1].extend([0])\ne = next(g)\nprint(a, b, c, log[-3:], d, e, sep=chr(10))",
    "prompt": "次のコードを実行したときの出力を選んでください。",
    "kind": "choice",
    "taskType": "python",
    "hints": [
      "各next(g)の時点で、dataの中身はどう変わっていますか。",
      "data[:k]やaliasは外側のリストだけを複製し、中のリストは同じ参照のままです。一方、step内のrow[:]は各行をコピーします。",
      "stepの既定引数boxは呼び出し間で共有されます。log[-3:]は、logを受け取った時点ではなく、最後のstep呼び出し後の状態で評価されます。"
    ],
    "explanation": "最初のnext(g)ではdataの先頭1行だけを処理してaが作られます。その後data[0]に9が追加されるため、2回目以降のstepの合計や行コピーに反映されます。step内ではrow[:]で行をコピーするので、返されたa・b・c自体は後のalias[1].extend([0])では変わりません。ただしbox=[]は既定引数として共有され、logもその同じリストを参照するため、最後のeを作った後の記録まで含めてlog[-3:]が出力されます。",
    "skillTags": [
      "tracing",
      "debugging"
    ],
    "choices": [
      "[[0, 2, 0]]\n[[0, 2, 9, 0], [1]]\n[[0, 0], [], [2, 5, 2]]\n[[2, 15], [3, 12], [3, 15]]\n[[0, 2, 9, 0], [1], [2, 5, 2]]\n[[0, 2, 9, 0], [0, 1]]",
      "[[0, 2, 0]]\n[[0, 2, 9, 0], [1]]\n[[0, 0], [], [2, 5, 2]]\n[[2, 15], [3, 12], [3, 18]]\n[[0, 2, 9, 0], [1], [2, 5, 2]]\n[[0, 2, 9, 0], [0, 1], [2]]",
      "[[0, 2, 0]]\r\n[[0, 2, 9, 0], [1]]\r\n[[0, 0], [], [2, 5, 2]]\r\n[[2, 15], [3, 12], [3, 15]]\r\n[[0, 2, 9, 0], [1], [2, 5, 2]]\r\n[[0, 2, 9, 0], [0, 1], [2]]",
      "[[0, 2, 0]]\n[[0, 2, 9, 0], [1]]\n[[0, 0], [2, 5, 2]]\n[[1, 3], [2, 15], [3, 12]]\n[[0, 2, 9, 0], [1], [2, 5, 2]]\n[[0, 2, 9, 0], [2]]"
    ],
    "answerKey": [
      "2"
    ]
  },
  {
    "id": "code-s10-03",
    "domain": "CODE",
    "difficulty": 10,
    "title": "安定整列と別名",
    "passage": "rows = [[\"a\", 2, [1], 0], [\"b\", 1, [2], 1], [\"c\", 2, [1], 2], [\"d\", 1, [2], 3], [\"e\", 2, [0], 4]]\nrows[3][2] = rows[1][2]\nlog = []\ndef key1(r):\n    r[2].append(r[3] - r[1])\n    log.append(r[0] + \":\" + str(sum(r[2])))\n    return (sum(r[2]) % 2, r[1])\nrows.sort(key=lambda r: (r[1], -r[3]))\nrows = sorted(rows, key=key1)\nrows[0][2].append(len(rows[0][0]))\nrows[-1][1] -= rows[0][1]; pivot = rows[2][0]\ndef key2(r):\n    return (len(r[2]), sum(r[2]) // 2, r[0] < pivot)\nrows.sort(key=key2, reverse=True)\npairs = []\nfor i, r in enumerate(rows):\n    if i % 2:\n        r[2][0] += i\n    pairs.append((r[0], r[1], tuple(r[2])))\nprint(log)\nprint(pairs)\nprint([r[0] for r in sorted(rows, key=lambda r: (sum(r[2]) % 4, r[1]))])",
    "prompt": "このコードを実行したときの出力として正しいものを選びなさい。",
    "kind": "choice",
    "taskType": "python",
    "hints": [
      "最初の sort のあと、rows はどの名前の順番になっていますか。",
      "rows[1][2] と rows[3][2] は同じリストを指します。key 関数が呼ばれる順番と、その場で起きる append に注目しましょう。",
      "sort は安定です。reverse=True の場合も、キーが等しい要素どうしの元の順序は保たれます。"
    ],
    "explanation": "最初の整列で順序は d, b, e, c, a になります。d と b は同じリストを共有しているため、key1 の append が互いに影響し、log は d:4, b:4, e:2, c:1, a:-1 です。以後も d と b のリストは共有されたままで、ループ中に b 側で先頭要素を増やすと実体は更新されますが、すでに pairs に入れた d の tuple はスナップショットなので変わりません。最後の整列では現在の合計の 4 での剰余と第2要素で並び、c, d, b, e, a となります。",
    "skillTags": [
      "tracing",
      "algorithms"
    ],
    "choices": [
      "['d:4', 'b:4', 'e:2', 'c:1', 'a:-1']\n[('d', 1, (2, 2, 0, 1)), ('b', 1, (3, 2, 0, 1)), ('e', 2, (0, 2)), ('c', 2, (4, 0)), ('a', 1, (1, -2))]\n['a', 'c', 'd', 'b', 'e']",
      "['d:4', 'b:4', 'e:2', 'c:1', 'a:-1']\r\n[('d', 1, (2, 2, 0, 1)), ('b', 1, (3, 2, 0, 1)), ('e', 2, (0, 2)), ('c', 2, (4, 0)), ('a', 1, (1, -2))]\r\n['c', 'd', 'b', 'e', 'a']",
      "['d:4', 'b:4', 'e:2', 'c:1', 'a:-1']\n[('d', 1, (3, 2, 0, 1)), ('b', 1, (3, 2, 0, 1)), ('e', 2, (0, 2)), ('c', 2, (4, 0)), ('a', 1, (1, -2))]\n['c', 'd', 'b', 'e', 'a']",
      "['b:2', 'd:4', 'e:2', 'c:1', 'a:-1']\n[('b', 1, (2, 0, 2, 1)), ('d', 1, (3, 0, 2, 1)), ('e', 2, (0, 2)), ('c', 2, (4, 0)), ('a', 1, (1, -2))]\n['c', 'b', 'd', 'e', 'a']"
    ],
    "answerKey": [
      "1"
    ]
  },
  {
    "id": "code-s10-04",
    "domain": "CODE",
    "difficulty": 10,
    "title": "二順序の待ち列比較",
    "passage": "2本のFIFOキュー、高キューHと通常キューNで仕事を処理する。各分で必ず1単位だけ処理し、時刻tからt+1までの1分を1回の処理とする。選択規則は、Hが空でなければHの先頭、空ならNの先頭を取り出す。取り出した仕事の残り処理量を1減らし、0になれば完了し、完了時刻はt+1である。0でなければ再投入する。Hから取り出した未完了仕事はNの末尾へ入れる。Nから取り出した未完了仕事は、減らした後の残り処理量が偶数ならHの末尾へ、奇数ならNの末尾へ入れる。仕事データは次の通り。P: 到着0、初期H、処理量3。Q: 到着0、初期N、処理量4。R: 到着1、初期H、処理量2。S: 到着2、初期N、処理量3。T: 到着3、初期H、処理量4。V: 到着4、初期N、処理量2。W: 到着5、初期H、処理量3。X: 到着6、初期N、処理量1。時刻0では、到着0の仕事を上のデータ順に初期キューへ入れてから処理を始める。時刻t+1の境界で、その時刻に到着する仕事の投入と、直前に処理した未完了仕事の再投入が両方ある場合だけ、次の2手順で順序が異なる。手順甲では、到着仕事を先に初期キューの末尾へ入れ、その後に未完了仕事を再投入する。手順乙では、未完了仕事を先に再投入し、その後に到着仕事を初期キューの末尾へ入れる。",
    "prompt": "手順甲と手順乙をそれぞれ最後まで適用したとき、完了順と、全仕事の完了時刻の合計について正しいものを選べ。",
    "kind": "choice",
    "taskType": "algorithm",
    "hints": [
      "時刻の境界で、到着仕事と未完了仕事の再投入のどちらを先に並べたかを、甲と乙で分けて記録していますか。",
      "常にHがNより優先されます。Nから出た仕事だけは、処理後の残量が偶数か奇数かで戻る先が変わります。",
      "完了した仕事は再投入されません。差が出るのは、同じ境界で到着と再投入が重なり、さらに同じキューの末尾順が後の先頭順に影響する場面です。"
    ],
    "explanation": "手順甲では、境界で到着を再投入より先に入れるため、通常キュー内の順が一部でVよりTを後に回す形になり、完了時刻はR=9、P=15、X=16、S=18、Q=19、V=20、T=21、W=22で合計140。手順乙では再投入が先なので、Rが早く完了し、後半ではTとVの順が入れ替わる。完了時刻はR=7、P=15、X=17、S=18、Q=19、T=20、V=21、W=22で合計139。",
    "skillTags": [
      "tracing",
      "algorithms"
    ],
    "choices": [
      "甲: 完了順 R→P→X→S→Q→V→T→W、合計140。乙: 完了順 R→P→X→S→Q→T→V→W、合計139。したがって合計が小さいのは乙。",
      "甲: 完了順 R→P→X→S→Q→T→V→W、合計139。乙: 完了順 R→P→X→S→Q→V→T→W、合計140。したがって合計が小さいのは甲。",
      "甲: 完了順 R→P→S→X→Q→V→T→W、合計140。乙: 完了順 R→P→S→X→Q→T→V→W、合計139。したがって合計が小さいのは乙。",
      "甲: 完了順 R→P→X→S→Q→V→T→W、合計140。乙も同じ完了順 R→P→X→S→Q→V→T→W、合計140。したがって差はない。"
    ],
    "answerKey": [
      "0"
    ]
  }
];
