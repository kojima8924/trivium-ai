// 人格の呼びかけ判定に使う純粋関数（server-only を付けない。LINE webhook とテストの両方から使う）。
import { PERSONA_DEFAULTS } from "@/config/trivium.config";

type AddressableAgent = "READ" | "WRITE" | "CODE" | "LEADER";
const ADDRESSABLE_AGENTS = ["READ", "WRITE", "CODE", "LEADER"] as const;

/**
 * 「ケイ、〜」「アオイに聞きたい」「LOGIC の人」などから宛先を決める。
 * ユーザーが名前を変えていればその名前も拾う。判定できなければ null（呼び出し側が案内役に回す）。
 */
export function detectAddressedAgent(text: string, personas: Record<AddressableAgent, { name: string }>): AddressableAgent | null {
  const t = text.trim().toLowerCase();
  const head = t.slice(0, 12);
  // 優先順: 人格の名前（先頭）→ 別名（先頭）→ 名前（全文）→ 別名（全文）。
  // 名前を別名より先に見るのは、READ の別名「リード」と LEADER の名前「リード」のような衝突で名前を勝たせるため
  const names = ADDRESSABLE_AGENTS.map((a) => ({ agent: a, keys: [personas[a].name.toLowerCase()].filter(Boolean) }));
  const aliases = ADDRESSABLE_AGENTS.map((a) => ({ agent: a, keys: PERSONA_DEFAULTS[a].aliases.map((n) => n.toLowerCase()).filter(Boolean) }));
  for (const c of names) if (c.keys.some((n) => head.includes(n))) return c.agent;
  for (const c of aliases) if (c.keys.some((n) => head.includes(n))) return c.agent;
  for (const c of names) if (c.keys.some((n) => t.includes(n))) return c.agent;
  for (const c of aliases) if (c.keys.some((n) => t.includes(n))) return c.agent;
  return null;
}
