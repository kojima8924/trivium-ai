"use client";

// 能力プロフィール（三角グラフ）を画像にして SNS に共有する。
// サーバー側には CJK フォントが無いので、画像は必ずブラウザの <canvas> で描く（OG 画像サイズ 1200×630）。
//   - Web Share API（navigator.share + files）が使えるスマホでは LINE / X / Instagram 等へ直接共有
//   - 使えない環境（PC ブラウザ等）では画像を保存しつつ、X / LINE の共有 URL を開くボタンを出す
import { useCallback, useEffect, useRef, useState } from "react";
import { DOMAIN_META, type DomainKey } from "@/lib/domain";
import { characterImagePath } from "@/lib/characters";
import type { AgentKey } from "@/lib/persona";

type DomainStat = { domain: DomainKey; level: number; score: number };

type Props = {
  name: string;
  domains: DomainStat[];
  xp: { total: number; rank: string };
  streak?: number;
  appUrl: string;
};

const W = 1200;
const H = 630;
const BG = "#FAFAF7";
const INK = "#1C1C1A";
const MUTED = "#6B6B66";
const LINE = "#E6E4DC";
// RadarChart.tsx と同じ系統色（ライトテーマの値。画像は常にライトで描く）
const COLOR: Record<DomainKey, string> = { READ: "#2563eb", WRITE: "#d97706", CODE: "#059669" };
// 頂点の並びも RadarChart と同じ: READ 上 / WRITE 右下 / LOGIC 左下
const ORDER: DomainKey[] = ["READ", "WRITE", "CODE"];
const ANGLE: Record<DomainKey, number> = { READ: -Math.PI / 2, WRITE: Math.PI / 6, CODE: (5 * Math.PI) / 6 };
const FONT = '"Inter", "Noto Sans JP", "Hiragino Sans", "Yu Gothic", "Meiryo", system-ui, sans-serif';

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function pt(cx: number, cy: number, r: number, d: DomainKey): [number, number] {
  return [cx + r * Math.cos(ANGLE[d]), cy + r * Math.sin(ANGLE[d])];
}

/** キャンバスに 1 枚描く（フォントはブラウザ任せなので日本語も出る） */
async function draw(canvas: HTMLCanvasElement, p: Props): Promise<void> {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unsupported");
  canvas.width = W;
  canvas.height = H;

  // 背景
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  // 上端のアクセント（3 色）
  const accents = ORDER.map((d) => COLOR[d]);
  accents.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect((W / 3) * i, 0, W / 3, 10);
  });

  // ---- 三角グラフ（左） ----
  const cx = 330;
  const cy = 335;
  const R = 225;
  const byDomain = Object.fromEntries(p.domains.map((d) => [d.domain, d])) as Record<DomainKey, DomainStat | undefined>;
  // 目盛り: Lv 2 / 4 / 6 / 8 / 10（score 20〜100 に対応）
  for (let lv = 2; lv <= 10; lv += 2) {
    const r = (R * lv) / 10;
    ctx.beginPath();
    ORDER.forEach((d, i) => {
      const [x, y] = pt(cx, cy, r, d);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.strokeStyle = lv === 10 ? "#C9C7BE" : LINE;
    ctx.lineWidth = lv === 10 ? 2 : 1.5;
    ctx.stroke();
    // 目盛りの数字（READ 軸に沿って）
    ctx.fillStyle = MUTED;
    ctx.font = `500 14px ${FONT}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(`Lv${lv}`, cx + 8, cy - r + 2);
  }
  // 軸線
  ORDER.forEach((d) => {
    const [x, y] = pt(cx, cy, R, d);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(x, y);
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  });
  // 値の多角形（score 0〜100 を半径に）
  ctx.beginPath();
  ORDER.forEach((d, i) => {
    const s = Math.max(0, Math.min(100, byDomain[d]?.score ?? 0));
    const [x, y] = pt(cx, cy, (R * s) / 100, d);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fillStyle = "rgba(28, 28, 26, 0.14)";
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.stroke();
  // 頂点の点と系統ラベル
  ORDER.forEach((d) => {
    const s = Math.max(0, Math.min(100, byDomain[d]?.score ?? 0));
    const [x, y] = pt(cx, cy, (R * s) / 100, d);
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fillStyle = COLOR[d];
    ctx.fill();
    ctx.strokeStyle = BG;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    const [lx, ly] = pt(cx, cy, R + 42, d);
    ctx.font = `800 26px ${FONT}`;
    ctx.fillStyle = COLOR[d];
    ctx.textAlign = d === "READ" ? "center" : d === "WRITE" ? "left" : "right";
    ctx.textBaseline = "middle";
    const lvText = byDomain[d] ? ` Lv.${byDomain[d]!.level}` : "";
    ctx.fillText(`${DOMAIN_META[d].label}${lvText}`, lx, ly);
  });

  // ---- 右側のテキスト ----
  const left = 640;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = INK;
  ctx.font = `800 40px ${FONT}`;
  const title = `${p.name}さんの能力プロフィール`;
  ctx.fillText(title.length > 18 ? `${p.name}さん` : title, left, 96);
  if (title.length > 18) {
    ctx.font = `700 28px ${FONT}`;
    ctx.fillText("能力プロフィール", left, 136);
  }

  // 系統ごとの行（色つきのバー＋数値）
  let y = 190;
  ORDER.forEach((d) => {
    const st = byDomain[d];
    const s = Math.max(0, Math.min(100, st?.score ?? 0));
    ctx.fillStyle = COLOR[d];
    ctx.font = `800 24px ${FONT}`;
    ctx.fillText(DOMAIN_META[d].label, left, y);
    ctx.fillStyle = INK;
    ctx.font = `700 30px ${FONT}`;
    ctx.fillText(st ? `Lv.${st.level}` : "未計測", left + 130, y + 2);
    ctx.fillStyle = MUTED;
    ctx.font = `500 20px ${FONT}`;
    if (st) ctx.fillText(`score ${st.score.toFixed(1)}`, left + 270, y);
    // バー
    ctx.fillStyle = LINE;
    ctx.fillRect(left, y + 14, 480, 10);
    ctx.fillStyle = COLOR[d];
    ctx.fillRect(left, y + 14, (480 * s) / 100, 10);
    y += 78;
  });

  // XP・ランク・連続
  ctx.fillStyle = INK;
  ctx.font = `700 26px ${FONT}`;
  const xpLine = `${p.xp.total.toLocaleString()} XP · ${p.xp.rank}${p.streak && p.streak > 0 ? ` · 🔥 ${p.streak} 日連続` : ""}`;
  ctx.fillText(xpLine, left, 440);

  // キャラ 4 人の顔（右下）
  const agents: AgentKey[] = ["READ", "WRITE", "CODE", "LEADER"];
  const faces = await Promise.all(agents.map((a) => loadImage(characterImagePath(a, "face", "cheer"))));
  faces.forEach((img, i) => {
    if (!img) return;
    const size = 88;
    const x = left + i * (size + 12);
    const fy = 470;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x + size / 2, fy + size / 2, size / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.fillStyle = "#FFFFFF";
    ctx.fill();
    ctx.clip();
    ctx.drawImage(img, x, fy, size, size);
    ctx.restore();
    ctx.beginPath();
    ctx.arc(x + size / 2, fy + size / 2, size / 2, 0, Math.PI * 2);
    ctx.strokeStyle = i < 3 ? COLOR[ORDER[i]] : "#8b5cf6";
    ctx.lineWidth = 3;
    ctx.stroke();
  });

  // フッター: ロゴ文字と URL
  ctx.fillStyle = INK;
  ctx.font = `800 30px ${FONT}`;
  ctx.textAlign = "left";
  ctx.fillText("T R I V I U M", 60, 596);
  ctx.fillStyle = MUTED;
  ctx.font = `500 20px ${FONT}`;
  ctx.textAlign = "right";
  ctx.fillText(p.appUrl.replace(/^https?:\/\//, ""), W - 60, 596);
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png");
  });
}

export function ShareProfile(p: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [busy, setBusy] = useState(false);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  // Web Share API（ファイル付き）が使えない環境で、投稿リンクを出す（hydration をずらさないよう、押してから判定する）
  const [showFallback, setShowFallback] = useState(false);

  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);

  const shareText = `Trivium で ${p.domains.map((d) => `${DOMAIN_META[d.domain].label} Lv${d.level}`).join(" / ")}。${p.xp.rank}・${p.xp.total} XP #Trivium #読み書き論理`;
  const fileName = "trivium-profile.png";

  const generate = useCallback(async (): Promise<Blob> => {
    if (blob) return blob;
    const canvas = canvasRef.current ?? document.createElement("canvas");
    await draw(canvas, p);
    const b = await toBlob(canvas);
    setBlob(b);
    setUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(b);
    });
    return b;
  }, [blob, p]);

  const share = useCallback(async () => {
    setBusy(true);
    setStatus("");
    try {
      const b = await generate();
      const file = new File([b], fileName, { type: "image/png" });
      const canShareFiles = typeof navigator.canShare === "function" && navigator.canShare({ files: [file] });
      if (canShareFiles && typeof navigator.share === "function") {
        try {
          await navigator.share({ files: [file], title: "Trivium 能力プロフィール", text: shareText, url: p.appUrl });
          setStatus("共有しました");
        } catch (err) {
          // ユーザーがシートを閉じただけなら黙る
          if ((err as Error).name !== "AbortError") setStatus("共有シートを開けませんでした。下のボタンから保存・投稿できます。");
        }
      } else {
        setShowFallback(true);
        setStatus("この環境では画像を保存して投稿してください（下のボタン）。");
      }
    } catch (err) {
      setStatus(`画像を作れませんでした: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [generate, p.appUrl, shareText]);

  const save = useCallback(async () => {
    const b = await generate();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(b);
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }, [generate]);

  const xUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(p.appUrl)}`;
  const lineUrl = `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(p.appUrl)}&text=${encodeURIComponent(shareText)}`;

  return (
    <div className="mt-3 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void share()}
          disabled={busy}
          className="rounded-lg border border-fg bg-fg px-3 py-1.5 text-xs font-semibold text-bg disabled:opacity-60"
        >
          {busy ? "画像を作成中…" : "三角グラフを共有"}
        </button>
        <button type="button" onClick={() => void save()} className="rounded-lg border border-line px-3 py-1.5 text-xs">
          画像を保存
        </button>
        {showFallback && (
          <>
            <a href={xUrl} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-line px-3 py-1.5 text-xs">
              X に投稿
            </a>
            <a href={lineUrl} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-line px-3 py-1.5 text-xs">
              LINE で送る
            </a>
          </>
        )}
        {status && <span className="text-[11px] text-muted">{status}</span>}
      </div>
      {url && (
        // eslint-disable-next-line @next/next/no-img-element -- ブラウザで生成した blob URL なので next/image は使えない
        <img src={url} alt="共有用の能力プロフィール画像（プレビュー）" className="w-full max-w-sm rounded-lg border border-line" />
      )}
      {/* 描画用（非表示）。toBlob に必要 */}
      <canvas ref={canvasRef} className="hidden" aria-hidden="true" />
    </div>
  );
}
