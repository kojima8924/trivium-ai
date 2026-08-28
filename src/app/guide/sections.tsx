// 使い方ガイドの各セクション。page.tsx はこれらを並べるだけにする。
// 数値（しきい値・XP・ランク）は設定ファイルから引いて、文章と実装がずれないようにする。
import { PERSONA_DEFAULTS, SCORING, TONE_PRESETS, XP } from "@/config/trivium.config";
import { AI_SYSTEM_POLICY } from "@/lib/ai/types";
import { DOMAINS, DOMAIN_META, SUBSKILLS, SUBSKILL_LABELS, type DomainKey } from "@/lib/domain";
import { CharacterAvatar } from "@/components/CharacterAvatar";
import { AGENT_OF, DIFFICULTY, SECTIONS, catchphrases } from "./content";

const advisor = PERSONA_DEFAULTS.LEADER;

export function SectionTitle({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-20 text-base font-bold">
      {children}
    </h2>
  );
}

export function GuideHeader() {
  return (
    <header className="flex flex-col gap-2">
      <h1 className="text-lg font-bold">Trivium の使い方</h1>
      <p className="text-sm leading-relaxed text-muted">
        「読み・書き・そろばん」を、いまの言葉で <span className="font-semibold text-fg">READ / WRITE / LOGIC</span> に。AI は答えを教えず、次の一歩だけを示します。このページでは仕組み・難易度の目安・グラフの読み方・LINE の使い方をまとめています。
      </p>
      <nav aria-label="目次" className="card p-4">
        <div className="mb-2 text-[11px] font-semibold text-muted">目次</div>
        <ol className="grid gap-1 text-sm sm:grid-cols-2">
          {SECTIONS.map((s, i) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="inline-flex min-h-8 items-center gap-2 hover:underline">
                <span className="w-5 text-right text-xs text-muted">{i + 1}.</span>
                {s.label}
              </a>
            </li>
          ))}
        </ol>
      </nav>
    </header>
  );
}

export function AboutSection() {
  return (
    <section className="card flex flex-col gap-3 p-5 text-sm leading-relaxed">
      <SectionTitle id="about">1. Trivium とは</SectionTitle>
      <p>
        Trivium（トリウィウム）は、中世の基礎教養「三学」から名前を借りた学習サービスです。高校生から社会人までを対象に、<span className="font-semibold">読む（READ）・書く（WRITE）・論理を追う（LOGIC）</span>の 3 系統を、短い課題で少しずつ鍛えます。
      </p>
      <p className="font-semibold">AI does not do the work for you. It helps you take the next step.</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>誤答しても AI は答えを渡しません。<span className="font-semibold">一段だけのヒント</span>（問い返し → 着眼点 → 手がかり。3 回まで）で、自分で辿り着くのを待ちます。</li>
        <li>正誤・ヒント回数・所要時間は<span className="font-semibold">数値の証拠</span>として記録され、能力プロフィール（到達レベル）は決定論で更新されます。AI が担当するのは講評・寸評・観察といった<span className="font-semibold">解釈</span>だけです。</li>
        <li>Web と LINE の両方から使えます。じっくり書く課題は Web で、スキマ時間の 1 問は LINE で。</li>
      </ul>
    </section>
  );
}

export function DomainsSection() {
  return (
    <section className="flex flex-col gap-3">
      <SectionTitle id="domains">2. 3 つの系統とキャラ</SectionTitle>
      <p className="text-sm leading-relaxed text-muted">系統ごとに担当キャラがいて、講評やヒントはその口調で届きます（名前・口調は「設定」で変えられます）。</p>
      <div className="grid gap-3">
        {DOMAINS.map((d) => {
          const m = DOMAIN_META[d];
          const p = PERSONA_DEFAULTS[AGENT_OF[d]];
          const phrases = catchphrases(p.extra);
          return (
            <div key={d} className="card flex gap-4 p-4" style={{ borderTopColor: m.color, borderTopWidth: 3 }}>
              <CharacterAvatar agent={AGENT_OF[d]} size={72} variant="full" mood="wave" />
              <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="wordmark" style={{ color: m.color }}>
                    {m.label}
                  </span>
                  <span className="text-xs text-muted">{m.ja}</span>
                  <span className="ml-auto text-xs text-muted">
                    担当: <span className="font-semibold text-fg">{p.name}</span>（{TONE_PRESETS[p.tone].label}・一人称「{p.firstPerson}」）
                  </span>
                </div>
                <p className="leading-relaxed text-muted">{m.tagline}</p>
                <div className="flex flex-wrap gap-1 pt-1">
                  {SUBSKILLS[d].map((s) => (
                    <span key={s} className="rounded-full border border-line px-2 py-0.5 text-[11px] text-muted">
                      {SUBSKILL_LABELS[s] ?? s}
                    </span>
                  ))}
                </div>
                {phrases.length > 0 && (
                  <p className="text-xs text-muted">
                    口癖: {phrases.map((s) => `「${s}」`).join(" ")}
                  </p>
                )}
              </div>
            </div>
          );
        })}
        <div className="card flex gap-4 p-4" style={{ borderTopColor: "#8b5cf6", borderTopWidth: 3 }}>
          <CharacterAvatar agent="LEADER" size={72} variant="full" mood="wave" />
          <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="wordmark" style={{ color: "#8b5cf6" }}>
                ADVISOR
              </span>
              <span className="text-xs text-muted">案内役</span>
              <span className="ml-auto text-xs text-muted">
                担当: <span className="font-semibold text-fg">{advisor.name}</span>（{TONE_PRESETS[advisor.tone].label}・一人称「{advisor.firstPerson}」）
              </span>
            </div>
            <p className="leading-relaxed text-muted">
              3 つの系統を横断して見る案内役。Dashboard の総合寸評と「次の一歩」、LINE での相談相手です。数字は集計値だけを使い、最後は必ず次の一歩を 1 つ示します。
            </p>
            {catchphrases(advisor.extra).length > 0 && (
              <p className="text-xs text-muted">口癖: {catchphrases(advisor.extra).map((s) => `「${s}」`).join(" ")}</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

export function DifficultySection() {
  return (
    <section className="flex flex-col gap-3">
      <SectionTitle id="difficulty">3. 難易度の目安（1〜10）</SectionTitle>
      <p className="text-sm leading-relaxed text-muted">
        難易度は系統ごとに 1〜10（1 は誰でも解ける、10 は上級者でも数分かかる）。出題は難易度 2 から始まり、正解するごとに上がります。回答が少ないうちは推薦値の周りを広めに探索し、増えるほど適正難易度に収束します（失敗しても直近の成功難易度より下には急に落ちません）。LINE で「難易度 8」「軽めに」のように指定もできます。
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {DIFFICULTY.map((t) => (
          <div key={t.key} className="card overflow-hidden">
            <div className="border-b border-line px-4 py-2 text-sm font-semibold" style={{ color: t.color }}>
              {t.title}
            </div>
            <table className="w-full text-sm">
              <tbody>
                {t.rows.map((r) => (
                  <tr key={r.range} className="border-b border-line last:border-b-0">
                    <th scope="row" className="w-16 whitespace-nowrap px-4 py-2 text-left font-mono text-xs text-muted">
                      {r.range}
                    </th>
                    <td className="px-2 py-2 pr-4 leading-relaxed">{r.what}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </section>
  );
}

export function ScoringSection() {
  return (
    <section className="card flex flex-col gap-3 p-5 text-sm leading-relaxed">
      <SectionTitle id="scoring">4. 到達レベルと採点の考え方</SectionTitle>
      <p>
        <span className="font-semibold">数値 = 証拠、文章 = AI の解釈。</span> 正誤・ヒント回数・所要時間だけが能力の数値を動かし、AI は講評・寸評・観察メモを書くだけで採点には関与しません。
      </p>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <span className="font-semibold">到達レベル L</span> = 「難易度 d 以上の問題の正答率が {Math.round(SCORING.masteryThreshold * 100)}% 以上」を満たす最大の d。ただし、その難易度帯の記録が {SCORING.minEvidence} 問分以上（新しさで重み付け）あるときだけ判定します。記録が無い系統は「未計測」です。
        </li>
        <li>
          <span className="font-semibold">表示スコア</span>（0〜100）= L × 10 + 次のレベルへの進捗 × 10。Dashboard の三角形はこの値で描かれます。
        </li>
        <li>
          <span className="font-semibold">新しさの重み</span>: 古い記録ほど効きが弱くなります（半減期 {SCORING.recencyHalfLifeDays} 日）。少し前の失敗はいつまでも足を引っ張りません。
        </li>
        <li>
          <span className="font-semibold">ヒントの扱い</span>: 成功時の基礎点はヒント 0 回で {SCORING.successBase[0]}、1 回 {SCORING.successBase[1]}、2 回 {SCORING.successBase[2]}、3 回 {SCORING.successBase[3]}。失敗は {SCORING.failureBase}。観点別（要旨把握・推論 など）の証拠バーはこの基礎点 × 難易度の重み付き平均です。
        </li>
        <li>
          <span className="font-semibold">複合課題の失敗は「ボトルネック」だけに</span>: 2〜3 系統にまたがる課題（例: read 3 / write 2 / logic 8）を落としても、下がるのは相対的に最も難しかった系統（この例では LOGIC）だけ。成功すれば関わった全系統に「その難易度以下は解ける」証拠が入ります。
        </li>
      </ul>
    </section>
  );
}

/** 三角グラフのサンプル（静的 SVG）。Dashboard の Radar と同じ並び: READ 上・WRITE 右下・LOGIC 左下 */
export function TriangleSample({ scores }: { scores: Record<DomainKey, number> }) {
  const cx = 150;
  const cy = 160;
  const R = 110;
  const angles: Record<DomainKey, number> = { READ: -90, WRITE: 30, CODE: 150 };
  const pt = (d: DomainKey, ratio: number) => {
    const a = (angles[d] * Math.PI) / 180;
    return [cx + R * ratio * Math.cos(a), cy + R * ratio * Math.sin(a)] as const;
  };
  const poly = (ratio: number) => DOMAINS.map((d) => pt(d, ratio).join(",")).join(" ");
  const value = DOMAINS.map((d) => pt(d, scores[d] / 100).join(",")).join(" ");
  const labelPos: Record<DomainKey, { dx: number; dy: number; anchor: "middle" | "start" | "end" }> = {
    READ: { dx: 0, dy: -14, anchor: "middle" },
    WRITE: { dx: 10, dy: 16, anchor: "start" },
    CODE: { dx: -10, dy: 16, anchor: "end" },
  };
  return (
    <svg viewBox="0 0 300 300" className="mx-auto h-64 w-64" role="img" aria-label={`三角グラフのサンプル: READ ${scores.READ}、WRITE ${scores.WRITE}、LOGIC ${scores.CODE}`}>
      {[0.25, 0.5, 0.75, 1].map((r) => (
        <polygon key={r} points={poly(r)} fill="none" stroke="var(--line)" strokeWidth={r === 1 ? 1.5 : 1} />
      ))}
      {DOMAINS.map((d) => {
        const [x, y] = pt(d, 1);
        return <line key={d} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--line)" />;
      })}
      <polygon points={value} fill="var(--fg)" fillOpacity={0.14} stroke="var(--fg)" strokeWidth={2} />
      {DOMAINS.map((d) => {
        const [x, y] = pt(d, scores[d] / 100);
        const [lx, ly] = pt(d, 1);
        const lp = labelPos[d];
        return (
          <g key={d}>
            <circle cx={x} cy={y} r={4} fill={DOMAIN_META[d].color} stroke="var(--bg-elev)" strokeWidth={1.5} />
            <text x={lx + lp.dx} y={ly + lp.dy} textAnchor={lp.anchor} fontSize={12} fontWeight={700}>
              <tspan fill={DOMAIN_META[d].color} letterSpacing="0.12em">
                {DOMAIN_META[d].label}
              </tspan>
              <tspan fill="var(--fg)"> Lv.{scores[d] / 10}</tspan>
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function TriangleSection() {
  return (
    <section className="card flex flex-col gap-3 p-5 text-sm leading-relaxed">
      <SectionTitle id="triangle">5. 三角グラフ（能力プロフィール）の読み方</SectionTitle>
      <div className="grid items-center gap-4 sm:grid-cols-[auto_1fr]">
        <TriangleSample scores={{ READ: 60, WRITE: 30, CODE: 80 }} />
        <ul className="list-disc space-y-1 pl-5">
          <li>3 つの頂点が READ / WRITE / LOGIC。中心から遠いほど到達レベルが高い（外周が Lv.10、リングは 2.5 レベル刻み）。</li>
          <li>
            <span className="font-semibold">三角形の大きさ</span>が総合力、<span className="font-semibold">歪み</span>が伸ばしどころ。左の例なら LOGIC Lv.8・READ Lv.6 に対して WRITE Lv.3 が凹んでいるので、ADVISOR は WRITE を次の一歩に挙げます。
          </li>
          <li>「未計測」はその系統の記録がまだ足りない状態（能力が低いという意味ではありません）。1〜2 問解くとレベルが出ます。</li>
          <li>Dashboard では前回のスナップショットを薄い点線で重ね、どの頂点がどれだけ動いたかが見えます。</li>
        </ul>
      </div>
    </section>
  );
}

export function XpSection() {
  const ranks = [...XP.ranks].sort((a, b) => a.min - b.min);
  return (
    <section className="card flex flex-col gap-3 p-5 text-sm leading-relaxed">
      <SectionTitle id="xp">6. XP・デイリーミッション・ランク</SectionTitle>
      <p>XP は「取り組んだ行動」の積み上げで、能力の三角形とは別の指標です。すべて決定論で計算されます。</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <span className="font-semibold">課題 XP</span> = {XP.perDifficultyPoint} × 難易度（複合課題は各系統の難易度の合計）。ヒントを使うと倍率 {XP.hintMultiplier.slice(1).join(" / ")}（1〜3 回）。失敗しても {Math.round(XP.failureMultiplier * 100)}% は入ります（例: 難易度 8 を落とすと {Math.round(XP.perDifficultyPoint * 8 * XP.failureMultiplier)} XP）。AI が作った課題は ×{XP.generatedTaskMultiplier}。
        </li>
        <li>
          <span className="font-semibold">デイリーミッション</span>: 1 日に READ / WRITE / LOGIC を 1 問ずつ（JST）。達成で +{XP.dailyMissionBonus} XP。
        </li>
        <li>
          <span className="font-semibold">連続記録（streak）</span>: ミッションを連日達成すると 1 日あたり +{XP.streakBonusPerDay} XP（上限 {XP.streakBonusMax}）。
        </li>
        <li>
          <span className="font-semibold">ランク</span>: {ranks.map((r) => `${r.title}（${r.min.toLocaleString()} XP〜）`).join(" → ")}
        </li>
      </ul>
    </section>
  );
}

export function LineSection() {
  return (
    <section className="card flex flex-col gap-3 p-5 text-sm leading-relaxed">
      <SectionTitle id="line">7. LINE での使い方</SectionTitle>
      <p>
        公式アカウントを友だち追加し、「連携」と送って届く URL から Google ログインすると、LINE と Web の記録がつながります（「連携解除」でいつでも外せます）。
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg border border-line p-3">
          <div className="mb-1 text-[11px] font-semibold text-muted">リッチメニュー</div>
          <ul className="list-disc space-y-1 pl-5">
            <li>READ / WRITE / LOGIC → LINE 上でその系統を 1 問（選択式）</li>
            <li>使い方 → この案内</li>
            <li>Dashboard → メインサイトへ</li>
            <li>PROFILE → 能力プロフィールのカード</li>
          </ul>
        </div>
        <div className="rounded-lg border border-line p-3">
          <div className="mb-1 text-[11px] font-semibold text-muted">メッセージで</div>
          <ul className="list-disc space-y-1 pl-5">
            <li>「難易度8」「LOGICで難易度8」→ 用意済みの問題から即出題（無ければ作問）。以後の「次」も同じ難易度</li>
            <li>「難易度8で作って」「論理パズルを出して」→ AI がその場で作問</li>
            <li>「パス」→ 記録に残さず次の問題へ。「ヒント」「わからない」→ 担当キャラが一段だけヒント（出題中の質問もその担当が答えます）</li>
            <li>「writeで軽めに」「難しめで」→ 推薦より 2 段やさしく／難しく</li>
            <li>「おすすめの本ある？」「LOGIC の教材」→ 到達レベルと弱い小分類に合う教材を 3 件（実在の定番書・公式サイトのカタログから）</li>
            <li>「{advisor.name}、今日は何をやればいい？」のように名前で呼ぶと、その人格と会話</li>
            <li>「今日のおすすめ」「10分だけ」→ 次の一歩を提案。「僕の能力は？」→ 能力プロフィールのカード</li>
          </ul>
        </div>
      </div>
      <ul className="list-disc space-y-1 pl-5">
        <li>1 問ごとの通知は Lv の変化と XP だけ。5 問ごとに担当キャラと ADVISOR がひとこと寸評を届けます。</li>
        <li>じっくり書く課題（記述式）は Web で。LINE では軽く 1 問ずつ進めましょう。</li>
        <li>今日の 3 問を解き終えると、総評と「今日の 1 冊」（教材カタログから能力に合わせて選ぶ）が届きます。</li>
        <li>4 人格は、他の担当との直近のやり取りと直近に決着した課題を共有しています。人格をまたいで「さっきの問題」と言っても通じます。</li>
      </ul>
    </section>
  );
}

export function PolicySection() {
  return (
    <section className="card flex flex-col gap-3 p-5 text-sm leading-relaxed">
      <SectionTitle id="policy">8. AI の方針（7 か条）</SectionTitle>
      <p>すべての AI 呼び出しに共通して入っているルールです。人格の設定よりも優先されます。</p>
      <ol className="list-decimal space-y-1 pl-5">
        <li>学習者の課題を代わりに完成させない（答え合わせの段階に入るまで）。</li>
        <li>ヒントは一度に 1 つだけ。</li>
        <li>答えより問いを優先する。</li>
        <li>学習者の直前の反応に合わせる。</li>
        <li>学習記録に裏づけのない特性を推測しない。</li>
        <li>性格ではなく学習行動についてコメントする。</li>
        <li>証拠が足りないときは、足りないと明言する。</li>
      </ol>
      <details className="text-xs text-muted">
        <summary className="cursor-pointer">原文（英語）</summary>
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          {AI_SYSTEM_POLICY.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </details>
      <p className="text-xs text-muted">誤答の講評では「どこが違うか」の場所も特定しません。値・根拠・条件を自分で確かめるための問いだけを返します。</p>
    </section>
  );
}
