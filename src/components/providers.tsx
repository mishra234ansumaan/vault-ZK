"use client";

import { useEffect, type ReactNode } from "react";
import { MotionConfig } from "framer-motion";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui";
import { useAppStore } from "@/lib/store";
import { refreshGemmaStatus } from "@/lib/gemma/engine";
import { hasPin } from "@/lib/crypto";
import { seedDemoHistory } from "@/lib/seed";
import { startGossip } from "@/lib/proofs";
import { vaultId } from "@/lib/vault";

export function Providers({ children }: { children: ReactNode }) {
  const settings = useAppStore((s) => s.settings);

  useEffect(() => {
    void useAppStore.persist.rehydrate();
    startGossip();
    void (async () => {
      try {
        await vaultId();
        await seedDemoHistory();
        const pin = await hasPin();
        useAppStore.getState().setPinSet(pin);
        if (pin) useAppStore.getState().setLocked(true);
      } catch {
        useAppStore.getState().pushLog({ level: "error", message: "IndexedDB unavailable — vault features disabled in this browser context" });
      }
    })();
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    void refreshGemmaStatus();
    const t = setInterval(() => void refreshGemmaStatus(), 30_000);
    return () => clearInterval(t);
  }, [settings.gemmaModel, settings.engineMode]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = settings.theme;
    root.dataset.motion = settings.animation;
    root.style.setProperty("--accent", settings.accent);
    root.style.fontSize = `${settings.fontScale * (settings.compact ? 0.92 : 1)}%`;
  }, [settings.theme, settings.animation, settings.accent, settings.fontScale, settings.compact]);

  return (
    <MotionConfig reducedMotion={settings.animation === "full" ? "user" : "always"}>
      <TooltipProvider>
        {children}
        <Toaster theme="dark" position="bottom-right" richColors closeButton />
      </TooltipProvider>
    </MotionConfig>
  );
}
