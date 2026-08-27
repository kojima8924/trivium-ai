import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ブランド画像は scripts/brand-assets.ts で事前に縮小・透過済みなので、
  // 実行時の画像最適化（sharp 依存）を使わない。standalone イメージを軽く・確実にする。
  images: { unoptimized: true },
  // sharp は素材生成スクリプト専用（devDependency）。standalone の trace から外して実行イメージを軽くする
  outputFileTracingExcludes: { "*": ["./node_modules/sharp/**", "./node_modules/@img/**"] },
  // Docker 用: .next/standalone に最小構成のサーバを出力する
  output: "standalone",
};

export default nextConfig;
