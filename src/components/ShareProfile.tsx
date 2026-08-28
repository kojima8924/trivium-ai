"use client";

// 能力プロフィール（三角グラフ）を画像にして SNS に共有するボタン群。
// 画像の描画そのものは share/draw-card.ts（純粋）に任せ、ここは UI と共有処理だけを持つ。
//   - Web Share API（navigator.share + files）が使えるスマホでは LINE / X / Instagram 等へ直接共有
//   - 使えない環境（PC ブラウザ等）では画像を保存しつつ、X / LINE の共有 URL を開くボタンを出す
import { useCallback, useEffect, useRef, useState } from "react";
import { DOMAIN_META } from "@/lib/domain";
import { drawShareCard, type ShareCardData } from "@/components/share/draw-card";

type Props = ShareCardData;

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
    await drawShareCard(canvas, p);
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
