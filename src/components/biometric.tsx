"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Fingerprint, ShieldCheck } from "lucide-react";
import { Button, Dialog, DialogContent } from "@/components/ui";
import { cn } from "@/lib/utils";

export function FingerprintScanner({ scanning, done, className }: { scanning: boolean; done: boolean; className?: string }) {
  return (
    <div className={cn("relative flex h-28 w-28 items-center justify-center rounded-full border border-accent/40 bg-accent/5", className)}>
      {scanning ? <span className="absolute inset-0 animate-pulse-ring rounded-full border border-accent" /> : null}
      {done ? <ShieldCheck className="h-14 w-14 text-ok" aria-hidden /> : <Fingerprint className={cn("h-14 w-14", scanning ? "text-accent" : "text-mute")} aria-hidden />}
      {scanning ? (
        <motion.span
          className="absolute left-3 right-3 h-0.5 bg-accent shadow-[0_0_12px_var(--accent)]"
          animate={{ top: ["15%", "80%", "15%"] }}
          transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
        />
      ) : null}
    </div>
  );
}

/** Simulated biometric confirmation (FaceID / fingerprint). */
export function BiometricDialog({ open, onOpenChange, onConfirmed, reason }: { open: boolean; onOpenChange: (v: boolean) => void; onConfirmed: () => void; reason: string }) {
  const [scanning, setScanning] = useState(false);
  const [done, setDone] = useState(false);

  const start = () => {
    setScanning(true);
    setTimeout(() => {
      setScanning(false);
      setDone(true);
      setTimeout(() => {
        setDone(false);
        onOpenChange(false);
        onConfirmed();
      }, 600);
    }, 1300);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !scanning && onOpenChange(v)}>
      <DialogContent title="Biometric confirmation" description={reason}>
        <div className="flex flex-col items-center gap-5 py-2">
          <FingerprintScanner scanning={scanning} done={done} />
          <Button onClick={start} disabled={scanning || done} aria-label="Start biometric scan">
            {scanning ? "Scanning…" : done ? "Verified" : "Touch sensor to confirm"}
          </Button>
          <p className="text-center text-xs text-mute">Simulated on-device biometric check. No biometric data is stored or transmitted.</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
