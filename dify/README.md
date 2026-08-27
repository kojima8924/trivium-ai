# dify/ — Dify Workflow DSL

Trivium の AI レイヤーを Dify で動かすための Workflow アプリ定義（DSL）。
Dify Cloud / self-hosted の **Studio → Import DSL file** でそのまま取り込めます。

| ファイル | アプリ名 | 役割 | 対応する環境変数 |
|---|---|---|---|
| `trivium-domain.yml` | `trivium-domain` | `workflow=domain`: 回答評価＋一段ヒント / `workflow=interpret`: domain 寸評（IF/ELSE で分岐） | `DIFY_DOMAIN_API_KEY` |
| `trivium-leader.yml` | `trivium-leader` | 3 domain の要約から総合寸評・次のおすすめ（LEADER） | `DIFY_LEADER_API_KEY` |

どちらも **End ノードの出力変数は `result`**（LLM が返す JSON 文字列）。アプリ側の `src/lib/ai/dify.ts` が `result` を JSON として解釈し、zod schema で検証します。

## 生成と検証

DSL は手で編集せず、`build_dsl.py` から生成します（プロンプト・変数・レイアウトを 1 か所に集約するため）。

```bash
python dify/build_dsl.py     # trivium-domain.yml / trivium-leader.yml を再生成
python dify/validate.py      # src/lib/ai/dify.ts との契約を検査（CI では実行しない。手動）
```

`validate.py` が検査すること:

1. YAML としてパースできる
2. Start ノードの変数名が `dify.ts` の `run()` に渡す `inputs` のキーと**完全一致**（不足・余剰を検出）
3. End の出力変数が `result` で、実在する LLM ノードの `text` を指している
4. edges の source / target が実在ノードで、IF/ELSE の `sourceHandle` が cases の id か `false`
5. プロンプト内の `{{#start.xxx#}}` 参照が Start の変数に存在する
6. System プロンプトに出力 JSON のキー（zod schema と同じ）がすべて書かれている

`dify.ts` の inputs や schema を変えたら、`build_dsl.py` を直して再生成し、`validate.py` を通してください。

## インポート後に必ず手で行うこと

1. **モデルの差し替え** — DSL の既定は `langgenius/anthropic/anthropic` の `claude-sonnet-4-5`。ワークスペースで有効なモデルプロバイダ／モデル名に合わせて、各 LLM ノード（domain は 2 つ、leader は 1 つ）のモデルを選び直す。Anthropic プラグインが未インストールならインポート時に警告が出るので、Marketplace から追加するか OpenAI 等に変更する
2. **公開と API key 発行** — 各アプリを Publish → API Access → API Key。`DIFY_DOMAIN_API_KEY` / `DIFY_LEADER_API_KEY` として Coolify（本番）や `.env`（ローカル）に設定し、`AI_PROVIDER=dify` にする
3. **動作確認** — Dify の「実行」で `workflow=domain` と `workflow=interpret` の両方を試し、`result` にコードフェンス無しの JSON が入ることを見る。アプリ側は `/api/health` の `ai.lastUsed` が `dify` なら成功

## 設計メモ

- Dify の End ノードは 1 出力変数につき 1 つの `value_selector` しか持てないため、domain 側は分岐ごとに End ノードを置いています（出力変数名はどちらも `result`）
- `hint_level` と `total_events` は数値で送られるので Start の型は `number`。それ以外は文字列（長文は `paragraph`）
- システムポリシー 7 箇条（`src/lib/ai/types.ts` の `AI_SYSTEM_POLICY`）は毎回 `policy` 変数として渡し、LLM の System 先頭に展開します。DSL 側にコピーを持たないので、コードを直せば Dify 側も追随します
- 決定論採点（choice / short）が確定しているときは、LLM が何を返してもアプリ側で `status` を上書きします（LLM の気分で正誤が変わらない安全弁）
