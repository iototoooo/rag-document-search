import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { UserMenu } from "@/components/layout/UserMenu";
import "./globals.css";

export const metadata: Metadata = {
  title: "社内文書検索AI",
  description: "社内文書を検索して回答する学習用RAGアプリ",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="flex min-h-dvh flex-col">
        <header className="sticky top-0 z-10 border-b border-zinc-200 bg-background/90 backdrop-blur dark:border-zinc-800">
          <div className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between px-4">
            <Link href="/" className="text-base font-bold">
              社内文書検索AI
            </Link>
            <Suspense fallback={null}>
              <UserMenu />
            </Suspense>
          </div>
        </header>
        <div className="flex flex-1 flex-col">{children}</div>
      </body>
    </html>
  );
}
