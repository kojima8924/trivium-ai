import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Header } from "@/components/Header";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Trivium", template: "%s | Trivium" },
  description: "AI does not do the work for you. It helps you take the next step. — READ / WRITE / CODE を学ぶ、あなた専用の学習ループ。",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#fafaf7",
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
