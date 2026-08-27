import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Header } from "@/components/Header";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  // OGP 画像を絶対URLにするために必要（本番は公開URL）
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  title: { default: "Trivium", template: "%s | Trivium" },
  description: "AI does not do the work for you. It helps you take the next step. — READ / WRITE / CODE を学ぶ、あなた専用の学習ループ。",
  applicationName: "Trivium",
  openGraph: {
    type: "website",
    siteName: "Trivium",
    locale: "ja_JP",
    title: "Trivium",
    description: "AI は答えを書かない。一段だけヒントを出して、次の一歩を踏ませる学習サービス。",
  },
  twitter: { card: "summary_large_image" },
  appleWebApp: { capable: true, title: "Trivium", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafaf7" },
    { media: "(prefers-color-scheme: dark)", color: "#111110" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className={`${inter.variable} ${mono.variable}`}>
      <body className="antialiased">
        <Header />
        <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-4 sm:px-6">{children}</main>
      </body>
    </html>
  );
}
