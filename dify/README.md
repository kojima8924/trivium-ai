# dify/ — Dify Workflow DSL（OpenAI 版・3 本）

Trivium の AI レイヤーを Dify で動かすための Workflow アプリ定義（DSL）。
Dify Cloud / self-hosted の **Studio → Import DSL file** でそのまま取り込めます。LLM はすべて **OpenAI**（`langgenius/openai/openai`、既定モデル `gpt-5.4-mini`。アプリ側の直接呼び出し `OPENAI_MODEL` と同じ）。

| ファイル | アプリ名 | 役割 | 対応する環境変数 |
|---|---|---|---|
| `trivium-domain.yml` | `trivium-domain` | `workflow=domain`: 回答評価＋一段ヒント / `workflow=interpret`: domain 寸評（IF/ELSE で分岐） | `DIFY_DOMAIN_API_KEY` |
| `trivium-leader.yml` | `trivium-leader` | 現在日時（組み込み `time` ツール、Asia/Tokyo）→ 3 domain の要約から総合寸評・次のおすすめ（LEADER） | `DIFY_LEADER_API_KEY` |
| `trivium-generate.yml` | `trivium-generate` | 依頼文から課題を 1 問作る。`use_search=true` のときだけ **Web 検索**（OpenAI Responses API の `web_search` を HTTP ノードから呼ぶ）で題材を集めてから作問 | `DIFY_GENERATE_API_KEY` |

3 本とも **End ノードの出力変数は `result`**（LLM が返す JSON 文字列）。アプリ側の `src/lib/ai/dify.ts` が `result` を JSON として解釈し、zod schema で検証します（choice なのに 4 択でない等は例外 → Mock にフォールバック）。

## 生成と検証

DSL は手で編集せず、`build_dsl.py` から生成します（プロンプト・変数・ノード構成を 1 か所に集約するため）。

```bash
python dify/build_dsl.py     # 3 本を再生成
python dify/validate.py      # src/lib/ai/dify.ts との契約を検査（CI では実行しない。手動）
```

`validate.py` が検査すること:

1. YAML としてパースできる
2. Start ノードの変数名が `dify.ts` の `run()` に渡す `inputs` のキーと**完全一致**（不足・余剰を検出）
3. End の出力変数が `result` で、実在する LLM ノードの `text` を指している
4. edges の source / target が実在ノードで、IF/ELSE の `sourceHandle` が cases の id か `false`。全ノードに入るエッジがある。edge の sourceType/targetType が実ノード種別と一致
5. プロンプト・HTTP・IF/ELSE・code ノードの `{{#node.var#}}` 参照が、Start の変数か実在ノードの出力に存在する
6. System プロンプトに出力 JSON のキー（zod schema と同じ）がすべて書かれている
7. LLM ノードのプロバイダが OpenAI で統一されている
8. HTTP ノードが `{{#env.XXX#}}` を参照するなら、その環境変数が `environment_variables` に宣言されている
9. code ノードの `main` 引数が `variables` と一致し、`outputs` が定義されている。`time` ツールのタイムゾーンが Asia/Tokyo

`dify.ts` の inputs や schema を変えたら、`build_dsl.py` を直して再生成し、`validate.py` を通してください。

## インポート後に必ず手で行うこと

1. **OpenAI プラグインとモデル** — ワークスペースに OpenAI プロバイダ（Marketplace の `langgenius/openai`）を入れて API キーを設定。各 LLM ノード（domain 2・leader 1・generate 2）のモデルが選べる状態になっていることを確認（`gpt-5.4-mini` が無ければ使えるモデルに差し替え）
2. **`trivium-generate` の環境変数** — アプリの環境変数 `OPENAI_API_KEY`（secret）を実際のキーに差し替える。Web 検索の HTTP ノードがこれを `Authorization: Bearer` に使う（LLM ノードのキーとは別管理）
3. **`trivium-leader` の time ツール** — 組み込みツール（`time` / `current_time`）なので認証は不要。インポート時に警告が出たらノードを一度開いて保存する
4. **公開と API key 発行** — 各アプリを Publish → API Access → API Key。`DIFY_DOMAIN_API_KEY` / `DIFY_LEADER_API_KEY` / `DIFY_GENERATE_API_KEY` として Coolify（本番）や `.env`（ローカル）に設定し、`AI_PROVIDER=dify` にする
5. **動作確認** — Dify の「実行」で `workflow=domain` / `interpret` / `leader` / `generate`（`use_search=false` と `true` の両方）を試し、`result` にコードフェンス無しの JSON が入ることを見る。アプリ側は `/api/health` の `ai.lastUsed` が `dify` なら成功

## 設計メモ

- Dify の End ノードは 1 出力変数につき 1 つの `value_selector` しか持てないため、分岐がある domain / generate は分岐ごとに End ノードを置いています（出力変数名はどれも `result`）
- `hint_level` / `total_events` / `difficulty` は数値で送られるので Start の型は `number`。それ以外は文字列（長文は `paragraph`）
- システムポリシー 7 箇条（`src/lib/ai/types.ts` の `AI_SYSTEM_POLICY`）は毎回 `policy` 変数として渡し、LLM の System 先頭に展開します。DSL 側にコピーを持たないので、コードを直せば Dify 側も追随します
- **人格**（`persona`）は JSON 文字列で渡し、空なら既定の口調。名前・一人称・口調・補足を文体に反映させる（名乗りはしない）
- 決定論採点（choice / short）が確定しているときは、LLM が何を返してもアプリ側で `status` を上書きします（LLM の気分で正誤が変わらない安全弁）
- Web 検索は **依頼文に「ニュース / 時事 / 最近の / 今日の / 話題 / 最新」等が含まれるときだけ**（`dify.ts` の `wantsSearch`）`use_search=true` になります。検索は遅く（＋5〜10 秒）費用もかかるので既定は使いません。検索が失敗しても `research` が空になるだけで作問は続きます
- 検索の要約に医療・法律・宗教・個人の話題を避ける指示を code ノードの依頼文に入れています。作問 LLM 側でも同じ制約を System に書いています
