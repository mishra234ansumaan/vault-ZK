"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { ProofSpec } from "@/lib/fields";

export type EngineId = "ollama" | "transformers" | "rules" | "none";

export interface Settings {
  displayName: string;
  autoLockMinutes: number;
  biometricEnabled: boolean;
  twoFactor: boolean;
  gemmaModel: string;
  quantization: "Q4" | "Q8" | "FP16";
  device: "cpu" | "gpu";
  memoryLimitGb: number;
  engineMode: "auto" | "ollama" | "transformers" | "rules";
  theme: "dark" | "darker" | "midnight";
  accent: string;
  fontScale: number;
  animation: "full" | "reduced" | "none";
  compact: boolean;
  devMode: boolean;
  showCircuit: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  displayName: "",
  autoLockMinutes: 5,
  biometricEnabled: true,
  twoFactor: false,
  gemmaModel: "gemma2:2b",
  quantization: "Q4",
  device: "cpu",
  memoryLimitGb: 4,
  engineMode: "auto",
  theme: "dark",
  accent: "#06b6d4",
  fontScale: 100,
  animation: "full",
  compact: false,
  devMode: false,
  showCircuit: true,
};

export interface GemmaLogEntry {
  id: number;
  at: number;
  level: "info" | "tool" | "result" | "error" | "inference";
  tool?: string;
  message: string;
  ms?: number;
}

export interface GemmaState {
  engine: EngineId;
  label: string;
  model: string;
  status: "checking" | "ready" | "fallback" | "error";
  ollamaReachable: boolean;
  lastLatencyMs: number | null;
  tokensPerSec: number | null;
  lastDoc: string | null;
  installedModels: string[];
}

interface AppState {
  network: "offline" | "online";
  locked: boolean;
  pinSet: boolean;
  sidebarCollapsed: boolean;
  mobileNavOpen: boolean;
  settings: Settings;
  gemma: GemmaState;
  gemmaLogs: GemmaLogEntry[];
  pendingSpec: { spec: ProofSpec; goal: string } | null;
  panicOpen: boolean;
  setNetwork: (n: "offline" | "online") => void;
  setLocked: (v: boolean) => void;
  setPinSet: (v: boolean) => void;
  toggleSidebar: () => void;
  setMobileNav: (v: boolean) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  setGemma: (patch: Partial<GemmaState>) => void;
  pushLog: (e: Omit<GemmaLogEntry, "id" | "at"> & { at?: number }) => void;
  clearLogs: () => void;
  setPendingSpec: (p: { spec: ProofSpec; goal: string } | null) => void;
  setPanicOpen: (v: boolean) => void;
}

let logSeq = 0;

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      network: "offline",
      locked: false,
      pinSet: false,
      sidebarCollapsed: false,
      mobileNavOpen: false,
      settings: DEFAULT_SETTINGS,
      gemma: {
        engine: "none",
        label: "Checking…",
        model: DEFAULT_SETTINGS.gemmaModel,
        status: "checking",
        ollamaReachable: false,
        lastLatencyMs: null,
        tokensPerSec: null,
        lastDoc: null,
        installedModels: [],
      },
      gemmaLogs: [],
      pendingSpec: null,
      panicOpen: false,
      setNetwork: (network) => set({ network }),
      setLocked: (locked) => set({ locked }),
      setPinSet: (pinSet) => set({ pinSet }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setMobileNav: (mobileNavOpen) => set({ mobileNavOpen }),
      updateSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
      setGemma: (patch) => set((s) => ({ gemma: { ...s.gemma, ...patch } })),
      pushLog: (e) =>
        set((s) => ({
          gemmaLogs: [...s.gemmaLogs.slice(-299), { ...e, id: ++logSeq, at: e.at ?? Date.now() }],
        })),
      clearLogs: () => set({ gemmaLogs: [] }),
      setPendingSpec: (pendingSpec) => set({ pendingSpec }),
      setPanicOpen: (panicOpen) => set({ panicOpen }),
    }),
    {
      name: "vaultzk-ui",
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      partialize: (s) => ({ network: s.network, sidebarCollapsed: s.sidebarCollapsed, settings: s.settings }),
      merge: (persisted, current) => {
        const p = persisted as Partial<AppState> | undefined;
        return { ...current, ...p, settings: { ...DEFAULT_SETTINGS, ...(p?.settings ?? {}) } };
      },
    },
  ),
);
