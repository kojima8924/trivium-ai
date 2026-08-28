// 使い方ガイド（ログイン不要）。サービスの考え方・3 系統・難易度の目安・採点と三角グラフの読み方・XP・LINE の使い方。
// 中身は guide/sections.tsx（各セクション）と guide/content.ts（目次・難易度表などの定数）に置き、
// ここはメタデータとログイン状態に応じた導線（CTA）だけを持つ。
import Link from "next/link";
import { auth } from "@/auth";
import {
  AboutSection,
  DifficultySection,
  DomainsSection,
  GuideHeader,
  LineSection,
  PolicySection,
  ScoringSection,
  TriangleSection,
  XpSection,
} from "./sections";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "使い方",
  description: "Trivium の考え方、READ / WRITE / LOGIC の 3 系統、難易度 1〜10 の目安、到達レベルと三角グラフの読み方、XP、LINE での使い方。",
};

export default async function GuidePage() {
  const session = await auth();
  const loggedIn = Boolean(session?.user);

  return (
    <div className="flex flex-col gap-6 py-4">
      <GuideHeader />

      {/* 1. Trivium とは */}
      <AboutSection />

      {/* 2. 3 つの系統とキャラ */}
      <DomainsSection />

      {/* 3. 難易度の目安 */}
      <DifficultySection />

      {/* 4. 到達レベルと採点 */}
      <ScoringSection />

      {/* 5. 三角グラフ */}
      <TriangleSection />

      {/* 6. XP */}
      <XpSection />

      {/* 7. LINE */}
      <LineSection />

      {/* 8. AI の方針 */}
      <PolicySection />

      <section className="flex flex-wrap items-center gap-3">
        {loggedIn ? (
          <Link href="/dashboard" className="btn btn-primary">
            Dashboard を開く
          </Link>
        ) : (
          <Link href="/login?next=/dashboard" className="btn btn-primary">
            Google でログインして始める
          </Link>
        )}
        <Link href="/" className="btn">
          トップへ
        </Link>
      </section>
    </div>
  );
}
