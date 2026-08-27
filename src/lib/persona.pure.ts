// 人格の呼びかけ判定に使う純粋関数（server-only を付けない。LINE webhook とテストの両方から使う）。
//
// 方針: 呼びかけとみなすのは「人格の名前」だけ。領域語（READ / LOGIC / 論理 / 読む …）は呼びかけに使わない。
// 「READで1問」「論理パズルを出して」のような出題・作問の依頼が会話に横取りされないようにするため。
// 判定は部分一致ではなく、文頭（「ケイ、〜」「アオイさん これ」）か、「〜に聞きたい」「〜へ相談」の形に限定する。
import { PERSONA_DEFAULTS } from "@/config/trivium.config";

type AddressableAgent = "READ" | "WRITE" | "CODE" | "LEADER";
const ADDRESSABLE_AGENTS = ["READ", "WRITE", "CODE", "LEADER"] as const;

/** 領域語・役割語。aliases に含まれていても呼びかけには使わない */
const DOMAIN_WORDS = new Set(
  ["read", "write", "logic", "code", "leader", "advisor", "リード", "ライト", "ロジック", "論理", "読む", "書く", "案内役", "リーダー", "アドバイザー"].map((w) =>
    w.toLowerCase(),
  ),
);

const HONORIFIC = "(?:さん|くん|ちゃん|先生|せんせい)?";
const HEAD_DELIM = "(?:[、,。．.！!？?：:・…\\s]|$)";
const ASK_VERB = "(?:聞|きき|きい|話|はな|お願|おねが|教え|おしえ|相談|質問|たずね|尋ね|頼|たの)";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 判定に使う名前。primary = 人格の名前（ユーザー設定名と既定名。ユーザーが選んだ名前なので領域語でも尊重する）、
 * secondary = 名前系の別名（あおい/aoi など。領域語は除く）。小文字化して返す。
 */
export function addressNamesFor(agent: AddressableAgent, personaName: string): { primary: string[]; secondary: string[] } {
  const norm = (n: string) => n.trim().toLowerCase();
  const primary = new Set<string>();
  for (const n of [personaName, PERSONA_DEFAULTS[agent].name]) if (norm(n)) primary.add(norm(n));
  const secondary = new Set<string>();
  for (const n of PERSONA_DEFAULTS[agent].aliases) {
    const k = norm(n);
    if (k && !DOMAIN_WORDS.has(k) && !primary.has(k)) secondary.add(k);
  }
  return { primary: [...primary], secondary: [...secondary] };
}

function matchHead(t: string, n: string): boolean {
  return new RegExp(`^${escapeRegExp(n)}${HONORIFIC}\\s*${HEAD_DELIM}`).test(t);
}

function matchAsk(t: string, n: string): boolean {
  return new RegExp(`${escapeRegExp(n)}${HONORIFIC}\\s*(?:に|へ)\\s*${ASK_VERB}`).test(t);
}

/**
 * 「ケイ、〜」「アオイに聞きたい」から宛先を決める。ユーザーが名前を変えていればその名前も拾う。
 * 判定できなければ null（呼び出し側が意図分類へ回す）。
 * 部分一致はしない: 「とけいがほしい」「already」「読むのが好き」は呼びかけではない。
 */
export function detectAddressedAgent(text: string, personas: Record<AddressableAgent, { name: string }>): AddressableAgent | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  const candidates = ADDRESSABLE_AGENTS.map((agent) => ({ agent, ...addressNamesFor(agent, personas[agent].name) }));
  // 優先順: 名前（文頭）→ 名前（〜に聞く）→ 別名（文頭）→ 別名（〜に聞く）。
  // 名前を別名より先に見るのは、READ の別名「リード」とユーザーが付けた名前「リード」のような衝突で名前を勝たせるため
  for (const c of candidates) if (c.primary.some((n) => matchHead(t, n))) return c.agent;
  for (const c of candidates) if (c.primary.some((n) => matchAsk(t, n))) return c.agent;
  for (const c of candidates) if (c.secondary.some((n) => matchHead(t, n))) return c.agent;
  for (const c of candidates) if (c.secondary.some((n) => matchAsk(t, n))) return c.agent;
  return null;
}
