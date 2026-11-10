import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });

export const metadata: Metadata = {
  title: "VaultZK Engine — Prove Anything. Reveal Nothing.",
  description:
    "Zero-knowledge eligibility proofs powered by on-device Gemma agents. Documents are parsed locally, encrypted with AES-256-GCM and proven with Groth16 SNARKs. Zero bytes ever touch the cloud.",
  applicationName: "VaultZK Engine",
  keywords: ["zero-knowledge", "privacy", "Gemma", "Ollama", "zk-SNARK", "offline", "open source"],
};

export const viewport: Viewport = {
  themeColor: "#0b0f19",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className={`${inter.variable} ${mono.variable}`} suppressHydrationWarning>
      <body className="min-h-screen bg-bg font-sans text-ink antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
