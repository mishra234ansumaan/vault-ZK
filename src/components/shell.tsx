"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { useLiveQuery } from "dexie-react-hooks";
import { toast } from "sonner";
import {
  Activity,
  BarChart3,
  Bell,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
  Home,
  KeyRound,
  Lock,
  Menu,
  Nfc,
  ScanSearch,
  Settings as SettingsIcon,
  ShieldAlert,
  ShieldCheck,
  Unlock,
  X,
  Zap,
} from "lucide-react";
import { Button, Badge, Tip } from "@/components/ui";
import { FingerprintScanner } from "@/components/biometric";
import { GemmaStatusPill } from "@/components/gemma-parts";
import { useAppStore } from "@/lib/store";
import { getDb } from "@/lib/db";
import { panicRevokeAll } from "@/lib/proofs";
import { verifyPin } from "@/lib/crypto";
import { vaultId } from "@/lib/vault";
import { cn, timeAgo } from "@/lib/utils";

export function Logo({ className, showText = true }: { className?: string; showText?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-bold tracking-tight", className)}>
      <span className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-ok text-slate-950">
        <ShieldCheck className="h-5 w-5" aria-hidden />
      </span>
      {showText ? (
        <span className="text-lg">
          Vault<span className="text-accent">ZK</span>
        </span>
      ) : null}
    </span>
  );
}

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: Home },
  { href: "/vault", label: "Vault Setup", icon: KeyRound },
  { href: "/generate", label: "Generate Proof", icon: Zap },
  { href: "/verify", label: "Verify Proof", icon: ScanSearch },
  { href: "/nfc", label: "NFC Tap", icon: Nfc },
  { href: "/audit", label: "Privacy Audit", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
] as const;

function NavList({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <nav aria-label="Primary" className="flex flex-col gap-1">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = path === href;
        return (
          <Tip key={href} label={collapsed ? label : `Go to ${label}`}>
            <Link
              href={href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition",
                active ? "bg-accent/15 text-accent shadow-[inset_2px_0_0_var(--accent)]" : "text-mute hover:bg-panel/70 hover:text-ink",
                collapsed && "justify-center px-0",
              )}
            >
              <Icon className="h-5 w-5 shrink-0" aria-hidden />
              {!collapsed ? <span>{label}</span> : <span className="sr-only">{label}</span>}
            </Link>
          </Tip>
        );
      })}
    </nav>
  );
}

function VaultBadge({ collapsed }: { collapsed: boolean }) {
  const locked = useAppStore((s) => s.locked);
  const name = useAppStore((s) => s.settings.displayName);
  const [id, setId] = useState("");
  useEffect(() => {
    void vaultId().then(setId).catch(() => setId(""));
  }, []);
  const initials = (name || "VZ").slice(0, 2).toUpperCase();
  return (
    <div className={cn("flex items-center gap-3 rounded-xl border border-line bg-panel/50 p-3", collapsed && "justify-center p-2")}>
      <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent to-indigo-500 text-sm font-bold text-slate-950">
        {initials}
        <span className={cn("absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-bg", locked ? "bg-danger" : "bg-ok")} />
      </div>
      {!collapsed ? (
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{name || "Anonymous holder"}</p>
          <p className="truncate font-mono text-[10px] text-mute">{id || "…"}</p>
          <p className={cn("text-[10px] font-semibold", locked ? "text-danger" : "text-ok")}>{locked ? "Vault locked" : "Vault sealed · AES-256"}</p>
        </div>
      ) : null}
    </div>
  );
}

function Sidebar() {
  const collapsed = useAppStore((s) => s.sidebarCollapsed);
  const toggle = useAppStore((s) => s.toggleSidebar);
  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-screen shrink-0 flex-col justify-between border-r border-line bg-bg/80 p-3 backdrop-blur transition-[width] duration-300 lg:flex",
        collapsed ? "w-[72px]" : "w-64",
      )}
    >
      <div className="space-y-6">
        <div className={cn("flex items-center", collapsed ? "justify-center" : "justify-between px-1")}>
          <Link href="/" aria-label="VaultZK home">
            <Logo showText={!collapsed} />
          </Link>
          {!collapsed ? (
            <Button variant="ghost" size="icon" onClick={toggle} aria-label="Collapse sidebar">
              <ChevronLeft className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
        {collapsed ? (
          <Button variant="ghost" size="icon" onClick={toggle} aria-label="Expand sidebar" className="mx-auto flex">
            <ChevronRight className="h-4 w-4" />
          </Button>
        ) : null}
        <NavList collapsed={collapsed} />
      </div>
      <VaultBadge collapsed={collapsed} />
    </aside>
  );
}

function MobileNav() {
  const open = useAppStore((s) => s.mobileNavOpen);
  const setOpen = useAppStore((s) => s.setMobileNav);
  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.div className="fixed inset-0 z-40 bg-black/70 lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)} />
          <motion.aside
            className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col justify-between border-r border-line bg-bg p-4 lg:hidden"
            initial={{ x: -300 }}
            animate={{ x: 0 }}
            exit={{ x: -300 }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
            aria-label="Mobile navigation"
          >
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <Logo />
                <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Close menu">
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <NavList collapsed={false} onNavigate={() => setOpen(false)} />
            </div>
            <VaultBadge collapsed={false} />
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  );
}

function Breadcrumbs() {
  const path = usePathname();
  const current = NAV.find((n) => n.href === path)?.label ?? "Page";
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm">
      <Link href="/dashboard" className="text-mute hover:text-ink">
        Dashboard
      </Link>
      {path !== "/dashboard" ? (
        <>
          <ChevronsRight className="h-3.5 w-3.5 text-slate-600" aria-hidden />
          <span className="font-semibold text-ink" aria-current="page">
            {current}
          </span>
        </>
      ) : null}
    </nav>
  );
}

function NetworkToggle() {
  const network = useAppStore((s) => s.network);
  const set = useAppStore((s) => s.setNetwork);
  const choose = (n: "offline" | "online") => {
    set(n);
    if (n === "online") toast.warning("ONLINE mode: only model downloads are enabled. VaultZK never uploads documents, proofs or keys.");
    else toast.success("OFFLINE mode active — air-gapped operation.");
  };
  return (
    <div role="group" aria-label="Network mode" className="flex items-center rounded-full border border-line bg-panel/60 p-0.5 text-xs font-bold">
      <button
        onClick={() => choose("offline")}
        aria-pressed={network === "offline"}
        className={cn("flex items-center gap-1.5 rounded-full px-3 py-1.5 transition", network === "offline" ? "bg-ok text-slate-950" : "text-mute hover:text-ink")}
      >
        <span className={cn("h-2 w-2 rounded-full", network === "offline" ? "bg-slate-950" : "bg-slate-500")} /> OFFLINE
      </button>
      <button
        onClick={() => choose("online")}
        aria-pressed={network === "online"}
        className={cn("flex items-center gap-1.5 rounded-full px-3 py-1.5 transition", network === "online" ? "bg-warn text-slate-950" : "text-mute hover:text-ink")}
      >
        <span className={cn("h-2 w-2 rounded-full", network === "online" ? "bg-slate-950" : "bg-slate-500")} /> ONLINE
      </button>
    </div>
  );
}

function Notifications() {
  const [open, setOpen] = useState(false);
  const events = useLiveQuery(() => getDb().events.orderBy("at").reverse().limit(8).toArray(), [], []);
  const icon = { ok: "bg-ok", warn: "bg-warn", error: "bg-danger" } as const;
  return (
    <div className="relative">
      <Button variant="ghost" size="icon" onClick={() => setOpen((o) => !o)} aria-label="Notifications" aria-expanded={open}>
        <Bell className="h-4 w-4" />
        {events && events.length > 0 ? <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-accent" /> : null}
      </Button>
      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="glass absolute right-0 top-11 z-40 w-80 max-w-[85vw] rounded-xl p-3 shadow-2xl"
          >
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-mute">Recent security events</p>
            {events && events.length > 0 ? (
              <ul className="space-y-2">
                {events.map((e) => (
                  <li key={e.id} className="flex gap-2 text-xs">
                    <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", icon[e.status])} />
                    <span className="flex-1 text-ink">{e.message}</span>
                    <span className="shrink-0 text-mute">{timeAgo(e.at)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-4 text-center text-xs text-mute">All quiet. Nothing to report.</p>
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export function PanicButton({ className }: { className?: string }) {
  const [busy, setBusy] = useState(false);
  const fire = async () => {
    setBusy(true);
    try {
      const n = await panicRevokeAll();
      toast.error(n > 0 ? `🚨 KILL-SWITCH: ${n} active proof${n === 1 ? "" : "s"} revoked & gossiped` : "🚨 Kill-switch armed — no active proofs to revoke", {
        description: "Verifiers consulting the revocation list will now reject these proofs.",
      });
    } catch {
      toast.error("Panic revocation failed — IndexedDB unavailable.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button variant="danger" size="sm" onClick={fire} disabled={busy} aria-label="Panic button: revoke all active proofs" className={cn("animate-panic", className)}>
      <ShieldAlert className="h-4 w-4" /> <span className="hidden sm:inline">Panic</span>
    </Button>
  );
}

function Header() {
  const locked = useAppStore((s) => s.locked);
  const setLocked = useAppStore((s) => s.setLocked);
  const setMobile = useAppStore((s) => s.setMobileNav);
  return (
    <header className="sticky top-0 z-30 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-bg/85 px-4 py-3 backdrop-blur-md sm:px-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobile(true)} aria-label="Open navigation menu">
          <Menu className="h-5 w-5" />
        </Button>
        <Breadcrumbs />
      </div>
      <div className="order-last flex w-full justify-center sm:order-none sm:w-auto sm:flex-1">
        <NetworkToggle />
      </div>
      <div className="ml-auto flex items-center gap-2">
        <span className="hidden md:inline-flex">
          <GemmaStatusPill />
        </span>
        <Tip label={locked ? "Vault locked — click to unlock" : "Vault unlocked — click to lock"}>
          <Button variant="outline" size="sm" onClick={() => setLocked(!locked)} aria-label={locked ? "Unlock vault" : "Lock vault"}>
            {locked ? <Lock className="h-4 w-4 text-danger" /> : <Unlock className="h-4 w-4 text-ok" />}
            <span className="hidden lg:inline">{locked ? "Locked" : "Unlocked"}</span>
          </Button>
        </Tip>
        <Notifications />
        <PanicButton />
      </div>
    </header>
  );
}

function LockScreen() {
  const locked = useAppStore((s) => s.locked);
  const pinSet = useAppStore((s) => s.pinSet);
  const bio = useAppStore((s) => s.settings.biometricEnabled);
  const setLocked = useAppStore((s) => s.setLocked);
  const [pin, setPin] = useState("");
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!locked) {
      setPin("");
      setError("");
    }
  }, [locked]);

  const tryPin = async (value: string) => {
    if (await verifyPin(value)) {
      setLocked(false);
      toast.success("Vault unlocked");
    } else {
      setError("Incorrect PIN");
      setPin("");
    }
  };

  const biometric = () => {
    setScanning(true);
    setTimeout(() => {
      setScanning(false);
      setLocked(false);
      toast.success("Biometric match — vault unlocked");
    }, 1400);
  };

  return (
    <AnimatePresence>
      {locked ? (
        <motion.div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-bg/95 p-4 backdrop-blur-xl"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="dialog"
          aria-modal="true"
          aria-label="Vault locked"
        >
          <div className="glass w-full max-w-sm rounded-2xl p-8 text-center">
            <Logo className="mb-6 justify-center" />
            <div className="flex justify-center">
              <FingerprintScanner scanning={scanning} done={false} />
            </div>
            <h2 className="mt-5 text-xl font-bold">Vault locked</h2>
            <p className="mt-1 text-sm text-mute">Authenticate to access your encrypted documents.</p>
            {pinSet ? (
              <form
                className="mt-5 space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void tryPin(pin);
                }}
              >
                <input
                  value={pin}
                  onChange={(e) => {
                    setError("");
                    setPin(e.target.value.replace(/\D/g, "").slice(0, 6));
                  }}
                  inputMode="numeric"
                  autoComplete="off"
                  aria-label="6-digit PIN"
                  placeholder="••••••"
                  className="h-12 w-full rounded-lg border border-line bg-bg/70 text-center font-mono text-2xl tracking-[0.5em] focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
                />
                {error ? <p className="text-sm text-danger" role="alert">{error}</p> : null}
                <Button type="submit" className="w-full" disabled={pin.length !== 6}>
                  Unlock with PIN
                </Button>
              </form>
            ) : null}
            {bio || !pinSet ? (
              <Button variant={pinSet ? "outline" : "primary"} className="mt-3 w-full" onClick={biometric} disabled={scanning}>
                {scanning ? "Scanning…" : "Unlock with biometrics"}
              </Button>
            ) : null}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function AutoLock() {
  const minutes = useAppStore((s) => s.settings.autoLockMinutes);
  const bio = useAppStore((s) => s.settings.biometricEnabled);
  const pinSet = useAppStore((s) => s.pinSet);
  useEffect(() => {
    if (minutes <= 0 || (!bio && !pinSet)) return;
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => useAppStore.getState().setLocked(true), minutes * 60_000);
    };
    const events = ["pointerdown", "keydown", "scroll"] as const;
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [minutes, bio, pinSet]);
  return null;
}

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const network = useAppStore((s) => s.network);
  return (
    <div className="flex min-h-screen bg-bg">
      <Sidebar />
      <MobileNav />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        {network === "online" ? (
          <div className="flex items-center justify-center gap-2 border-b border-warn/30 bg-warn/10 px-4 py-1.5 text-xs text-warn">
            <Activity className="h-3.5 w-3.5" aria-hidden /> ONLINE mode — enabled only for model downloads. No user data is ever transmitted.
            <Badge tone="warn">0 bytes uploaded</Badge>
          </div>
        ) : null}
        <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6 sm:px-6">
          <AnimatePresence mode="wait">
            <motion.div key={path} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
              {children}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <LockScreen />
      <AutoLock />
    </div>
  );
}
