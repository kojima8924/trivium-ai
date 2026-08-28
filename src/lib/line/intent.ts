// LINE に届いたテキストの意図分類（ルールベース・純粋関数）。
// ここは「短い定型コマンドの補助」で、意味での判定は LLM（handlers.ts の classifyLineIntent）が主。
// server-only を付けない（テストから直接 import できるように prisma / env に依存しない）。
import type { DomainKey } from "@/lib/domain";
import { inferTaskTypeFromRequest } from "@/lib/learn/generate.pure";
import { LINE } from "@/config/trivium.config";
import type { MaterialKind } from "@/lib/materials/types";
import type { Intent } from "./types";

const toHalfWidth = (s: string) => s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

/** 「read」「論理」などの語を domain に写す */
export function domainOf(word: string): DomainKey | null {
  const w = word.toLowerCase();
  if (/^(read|リード|読解)$/.test(w)) return "READ";
  if (/^(write|ライト|作文)$/.test(w)) return "WRITE";
  if (/^(logic|code|ロジック|論理)$/.test(w)) return "CODE";
  return null;
}

/** 「難易度8」「レベル 8」「Lv8」「code 8」から 1〜10 の難易度を取り出す（無ければ null） */
export function parseDifficulty(raw: string): number | null {
  const text = toHalfWidth(raw);
  const m =
    text.match(/(?:難易度|レベル|難度|level|lv\.?)\s*[:：=]?\s*(10|[1-9])(?![0-9分時])/i) ??
    text.match(/^(?:read|write|logic|code|リード|ライト|ロジック|読解|作文|論理)\s*(?:で|の)?\s*(10|[1-9])(?![0-9問回つ個分時])/i);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 10 ? n : null;
}

/** 文中の domain 語（read/write/logic/code/論理…）を拾う。無ければ null */
export function domainInText(raw: string): DomainKey | null {
  const lower = toHalfWidth(raw).toLowerCase();
  if (/(logic|code|ロジック|論理|コード|python|パイソン|プログラ)/.test(lower)) return "CODE";
  if (/(write|ライト|作文)/.test(lower) || /書(く|き)/.test(lower)) return "WRITE";
  if (/(read|リード|読解)/.test(lower) || /読(む|み)/.test(lower)) return "READ";
  return null;
}

/** 疑問・説明を求める文か（出題ではなく会話に回す） */
function isQuestionLike(text: string): boolean {
  return /[?？]\s*$/.test(text) || /(教えて|説明|とは|って(何|なに|どの|どんな|どう)|どのくらい|どんな|なんですか|ですか)/.test(text);
}

/** 「おすすめの本」「Python の教材を探して」「何を読めばいい？」→ materials 意図。該当しなければ null */
export function parseMaterialsIntent(text: string): Extract<Intent, { kind: "materials" }> | null {
  const lower = text.toLowerCase();
  if (/^(今日の|きょうの)?(おすすめ|オススメ)[!！。]?$/.test(text) || /^今日の/.test(text)) return null;
  const materialWord = /(教材|参考書|問題集|入門書|本を|本は|本が|本で|おすすめの本|良い本|いい本|書籍|サイト|動画|講座|読むべき|読めば|読んだら|勉強法|学び方|学習法|何で勉強|どう勉強|何を読|なにを読|教えて.*本|本.*教えて)/;
  if (!materialWord.test(text)) return null;
  // 出題・作問の依頼語と混ざるものは出題側に任せる（「読解の問題を出して」）
  if (/(出して|作って|作問|1問|一問|出題)/.test(text) && !/(本|教材|参考書|サイト|動画|講座)/.test(text)) return null;
  const domain = domainInText(text);
  const freeOnly = /(無料|タダ|ただで|フリー|お金をかけ)/.test(text);
  const kind_: MaterialKind | null = /(本|書籍|参考書|問題集|入門書)/.test(text) && !/(サイト|動画|講座)/.test(text)
    ? "book"
    : /(サイト|web|ウェブ)/i.test(lower)
      ? "web"
      : /(動画|youtube)/i.test(lower)
        ? "video"
        : /(講座|コース)/.test(text)
          ? "course"
          : null;
  return { kind: "materials", domain, text: text.slice(0, 200), freeOnly: freeOnly || undefined, kind_ };
}

/** 発話から問題タイプ（python / puzzle / summary …）を読み取る。読み取れなければ何も付けない */
function typeOf(domain: DomainKey | null, text: string): { taskType?: string } {
  if (!domain) return {};
  const t = inferTaskTypeFromRequest(domain, text);
  return t ? { taskType: t } : {};
}

export function classifyIntent(raw: string): Intent {
  const text = toHalfWidth(raw).trim();
  const lower = text.toLowerCase();
  // 短文（コマンド）か。長い自由文は部分一致で連携・ヘルプ扱いにしない（会話に回す）
  const short = text.length <= LINE.commandMaxChars;

  // 連携解除は「連携」を含む言い方に限定（「実績解除」などの文中の『解除』で発火させない）
  if (/連携\s*(を|は|の)?\s*(解除|やめ|外|切|取り消|とりけ)|^解除$|unlink/i.test(text)) return { kind: "unlink" };
  // 連携・ヘルプは短文か文頭一致だけ（「同期に勧められた本」「Pythonの辞書の使い方」は会話へ）
  if ((short && /(連携|リンク|link|同期|アカウント)/i.test(lower)) || /^(連携|リンク|link|アカウント連携)/i.test(lower)) return { kind: "link" };
  if (/^(help|ヘルプ|使い方|できること|\?|？)$/.test(lower) || (short && /使い方|ヘルプ|help/.test(lower)) || /^(使い方|ヘルプ|help)/.test(lower)) {
    return { kind: "help" };
  }
  // 出題中の課題をパス（ボタンを閉じてしまったときのテキスト版）
  if (/^(パス|ぱす|pass|スキップ|skip|飛ばして|とばして|パスして|パスで|スキップして)[!！。]?$/i.test(text)) return { kind: "pass" };
  if (/^(ヒント|ひんと|hint|ヒント(を|が)?(ちょうだい|ください|くれ|出して|ほしい|欲しい)|ヒントお願い(します)?|わからない|分からない|わかりません|分かりません|むずかしい|難しい|降参|ギブアップ)[!！。？?]?$/i.test(text)) return { kind: "hint" };
  // 教材のおすすめ（会話寄りの意図。疑問文でも拾う）。「今日のおすすめ」は従来どおり today
  const materials = parseMaterialsIntent(text);
  if (materials) return materials;

  // 難易度指定（「LOGICで難易度8」「難易度8」「logic 8」）は用意済みストックから即出題（quiz。±1 に無ければ handler 側で作問に切替）。
  // 「作って」「作問」など明示語があるときだけ LLM 作問（generate）。疑問文（「難易度8ってどのくらい？」）は会話へ
  const difficulty = parseDifficulty(text);
  if (difficulty !== null && !/(履歴|プロフィール|連携)/.test(text) && !isQuestionLike(text)) {
    const domain = domainInText(text);
    if (/(作って|つくって|作問|生成|新しい問題|新作|オリジナル)/.test(text)) {
      return { kind: "generate", request: text.slice(0, 300), domain, difficulty };
    }
    return { kind: "quiz", domain, difficulty, ...typeOf(domain, text) };
  }
  // 「writeで軽めに」「やさしいのを1問」「難しめで」→ 推薦難易度から ∓2 した出題（指定難易度の文脈はリセット）。
  // 語形は出題向けのものに限定する（「やさしい人」「軽めの昼食」「難しい話」「簡単な質問」は拾わない）
  const easy = /(軽め|やさしめ|易しめ|やさしい(の|問題|やつ|ほう|方)|易しい(の|問題|やつ)|簡単な(問題|の|やつ|ほう)|かんたんな(問題|の)|入門|初級)/;
  const hard = /(難しめ|むずかしめ|難しい(の|問題|やつ|ほう|方)|むずかしい(の|問題|やつ)|歯ごたえ|ハードな|上級|骨のある)/;
  const delta = easy.test(text) ? -2 : hard.test(text) ? 2 : null;
  if (delta !== null && !/(履歴|プロフィール|連携)/.test(text) && !isQuestionLike(text)) {
    const domain = domainInText(text);
    if (domain || /(問題|1問|一問|出題|クイズ|やりたい|お願い|ちょうだい|で$|に$|の$)/.test(text)) {
      return { kind: "quiz", domain, difficultyDelta: delta, ...typeOf(domain, text) };
    }
  }
  // LINE 上の出題（短いコマンド）。「READで1問」のように domain 付きも可
  const quizCmd = /^(出題|問題|1問|一問|クイズ|次の問題|もう1問|もう一問|次|もう一回|もう1回|今日の学習|今日の1問|今日の一問|今日の問題)(ください|して|お願い(します)?)?[!！。]?$/;
  const quizWithDomain = text.match(/^(read|write|logic|code|リード|ライト|ロジック|読解|作文|論理)\s*(で|の)?\s*(1問|一問|出題|問題|クイズ)/i);
  if (quizWithDomain) {
    const d = domainOf(quizWithDomain[1]);
    return { kind: "quiz", domain: d, ...typeOf(d, text) };
  }
  if (quizCmd.test(text)) return { kind: "quiz", domain: null };
  // 自由文の作問依頼（「論理パズルを出して」「短い読解を1問ください」）: 課題語 ＋（依頼動詞 or 文末が依頼形）の両方が要る。
  // 「仕事で問題が起きて疲れた」「昨日クイズ番組を見た」「お願いがあるんだけど」は会話へ
  const taskWord = /(問題|パズル|クイズ|読解|作文|1問|一問|課題|出題|作問|python|コード|論理)/i;
  const requestVerb = /(出して|だして|ちょうだい|お願い|作って|つくって|作問|出題して|ください|くれ|頼む|ほしい)/;
  const requestEnding = /(して|ください|お願い(します)?|ちょうだい|ほしい|くれ)[!！。]?$/;
  if (text.length >= 4 && taskWord.test(text) && (requestVerb.test(text) || requestEnding.test(text)) && !isQuestionLike(text)) {
    return { kind: "generate", request: text.slice(0, 300) };
  }

  if (/(read|リード|読(む|み|解)|読書)/i.test(lower) && !/書/.test(text)) return { kind: "domain", domain: "READ" };
  if (/(write|ライト|書(く|き)|作文|文章)/i.test(lower)) return { kind: "domain", domain: "WRITE" };
  if (/(logic|ロジック|論理|code|コード|プログラ|python|パイソン|バグ)/i.test(lower)) return { kind: "domain", domain: "CODE" };
  if (/(履歴|きろく|記録|ログ|これまで)/.test(text)) return { kind: "history" };
  if (/(プロフィール|profile|能力|実力|レベル(は|を)|レーダー|得意|苦手|分析|三角)/i.test(lower)) return { kind: "profile" };
  const min = text.match(/(\d+)\s*分/);
  if (min) return { kind: "short_time", minutes: Number(min[1]) };
  if (/(少しだけ|ちょっとだけ|軽く|さくっと|サクッと|短い|短め|すきま|隙間)/.test(text)) return { kind: "short_time", minutes: null };
  if (/(疲れ|つかれ|眠い|ねむい|だるい|しんどい|やる気)/.test(text)) return { kind: "tired" };
  if (/(今日|きょう|おすすめ|オススメ|何(か|を)(やる|やり|する|しよ)|なにか|何か|次)/.test(text)) return { kind: "today" };
  if (/^(こんにちは|こんばんは|おはよう|やあ|hi|hello|はじめまして|よろしく)/.test(lower)) return { kind: "greeting" };
  if (/(ありがとう|thanks|thank you|助かる)/.test(lower)) return { kind: "thanks" };
  return { kind: "unknown" };
}
