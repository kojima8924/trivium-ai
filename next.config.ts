import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker 用: .next/standalone に最小構成のサーバを出力する
  output: "standalone",
};

export default nextConfig;
