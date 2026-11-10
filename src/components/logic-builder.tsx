"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Button, Checkbox, Input, Label, Select } from "@/components/ui";
import { COUNTRIES, EDUCATION_LEVELS, FIELD_DEFS, FIELD_KEYS, describeCondition, type Condition, type FieldKey, type ProofSpec } from "@/lib/fields";
import { cn, uid } from "@/lib/utils";

export interface Chip extends Condition {
  id: string;
}

export interface LogicState {
  chips: Chip[];
  slots: Array<string | null>;
  op: "AND" | "OR";
}

export const EXAMPLE_LOGIC: LogicState = (() => {
  const chips: Chip[] = [
    { id: "c1", field: "age", threshold: 21 },
    { id: "c2", field: "monthlyIncome", threshold: 5000 },
    { id: "c3", field: "creditScore", threshold: 750 },
  ];
  return { chips, slots: ["c1", "c2", "c3", null], op: "OR" };
})();

export function logicToSpec(s: LogicState): ProofSpec {
  const get = (i: number): Condition | null => {
    const chip = s.chips.find((c) => c.id === s.slots[i]);
    return chip ? { field: chip.field, threshold: chip.threshold, negate: chip.negate } : null;
  };
  const a = [get(0), get(1)].filter((c): c is Condition => c !== null);
  const b = [get(2), get(3)].filter((c): c is Condition => c !== null);
  return { mode: "logic", groupA: a, groupB: b, op: s.op };
}

function defaultThreshold(f: FieldKey): number {
  const d = FIELD_DEFS[f];
  if (d.kind === "flag") return 1;
  if (d.kind === "level") return 2;
  if (d.kind === "residency") return 1;
  return { age: 21, bankBalance: 50000, monthlyIncome: 5000, creditScore: 700, netWorth: 100000, yearsExperience: 3 }[f as "age"] ?? d.min;
}

function CircuitPreview({ s }: { s: LogicState }) {
  const filled = (i: number) => s.chips.find((c) => c.id === s.slots[i]);
  const ys = [28, 68, 128, 168];
  return (
    <svg viewBox="0 0 520 196" className="w-full" role="img" aria-label="Boolean circuit preview">
      {ys.map((y, i) => (
        <g key={i}>
          <rect x="6" y={y - 16} width="170" height="32" rx="8" className={cn(filled(i) ? "fill-accent/15 stroke-accent" : "fill-panel/40 stroke-line")} />
          <text x="16" y={y + 4} className="fill-ink text-[11px]">
            {filled(i) ? describeCondition(filled(i) as Condition).slice(0, 26) : `slot ${i + 1} (empty)`}
          </text>
          <path d={`M176 ${y} H ${i < 2 ? 230 : 230} V ${i < 2 ? 48 : 148}`} className="animate-flow fill-none stroke-accent/70" strokeDasharray="4 4" />
        </g>
      ))}
      <circle cx="250" cy="48" r="20" className="fill-panel stroke-accent" />
      <text x="250" y="52" textAnchor="middle" className="fill-accent text-[11px] font-bold">
        AND
      </text>
      <circle cx="250" cy="148" r="20" className="fill-panel stroke-accent" />
      <text x="250" y="152" textAnchor="middle" className="fill-accent text-[11px] font-bold">
        AND
      </text>
      <path d="M270 48 H330 V98 M270 148 H330 V98" className="animate-flow fill-none stroke-ok/70" strokeDasharray="4 4" />
      <circle cx="350" cy="98" r="24" className="fill-panel stroke-ok" />
      <text x="350" y="102" textAnchor="middle" className="fill-ok text-xs font-bold">
        {s.op}
      </text>
      <path d="M374 98 H430" className="animate-flow fill-none stroke-ok" strokeDasharray="4 4" />
      <rect x="430" y="76" width="84" height="44" rx="10" className="fill-ok/15 stroke-ok" />
      <text x="472" y="95" textAnchor="middle" className="fill-ok text-[10px] font-bold">
        ZK PROOF
      </text>
      <text x="472" y="110" textAnchor="middle" className="fill-ink text-[9px]">
        hides branch
      </text>
    </svg>
  );
}

export function LogicBuilder({ state, onChange }: { state: LogicState; onChange: (s: LogicState) => void }) {
  const [field, setField] = useState<FieldKey>("age");
  const [threshold, setThreshold] = useState("21");
  const [negate, setNegate] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const def = FIELD_DEFS[field];

  const addChip = () => {
    const t = def.kind === "flag" ? 1 : Number(threshold);
    if (!Number.isFinite(t) || t < def.min || t > def.max) return;
    onChange({ ...state, chips: [...state.chips, { id: uid("c"), field, threshold: t, negate: negate || undefined }] });
  };
  const place = (slot: number, chipId: string | null) => {
    const slots = state.slots.map((s) => (s === chipId && chipId !== null ? null : s));
    slots[slot] = chipId;
    onChange({ ...state, slots });
    setPicked(null);
  };
  const removeChip = (id: string) => onChange({ ...state, chips: state.chips.filter((c) => c.id !== id), slots: state.slots.map((s) => (s === id ? null : s)) });

  return (
    <div className="space-y-5">
      <div className="grid gap-3 rounded-xl border border-line bg-panel/30 p-4 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
        <div>
          <Label htmlFor="lb-field">Condition</Label>
          <Select
            id="lb-field"
            value={field}
            onChange={(e) => {
              const f = e.target.value as FieldKey;
              setField(f);
              setThreshold(String(defaultThreshold(f)));
            }}
          >
            {FIELD_KEYS.map((k) => (
              <option key={k} value={k}>
                {FIELD_DEFS[k].proveLabel}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="lb-th">{def.kind === "flag" ? "Threshold" : "Minimum value"}</Label>
          {def.kind === "residency" ? (
            <Select id="lb-th" value={threshold} onChange={(e) => setThreshold(e.target.value)}>
              {COUNTRIES.map((c, i) => (
                <option key={c} value={i + 1}>
                  {c}
                </option>
              ))}
            </Select>
          ) : def.kind === "level" ? (
            <Select id="lb-th" value={threshold} onChange={(e) => setThreshold(e.target.value)}>
              {EDUCATION_LEVELS.map((c, i) => (
                <option key={c} value={i + 1}>
                  {c}
                </option>
              ))}
            </Select>
          ) : (
            <Input id="lb-th" type="number" value={def.kind === "flag" ? "1" : threshold} disabled={def.kind === "flag"} min={def.min} max={def.max} onChange={(e) => setThreshold(e.target.value)} />
          )}
        </div>
        <label className="flex h-10 cursor-pointer items-center gap-2 text-sm">
          <Checkbox checked={negate} onCheckedChange={(v) => setNegate(v === true)} aria-label="Negate condition" /> NOT
        </label>
        <Button onClick={addChip} type="button">
          <Plus className="h-4 w-4" /> Add chip
        </Button>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-mute">Condition tray — drag into a slot (or click chip, then slot)</p>
        <div className="flex min-h-12 flex-wrap gap-2">
          {state.chips.length === 0 ? <p className="text-sm text-mute">No chips yet. Create one above or load the example.</p> : null}
          {state.chips.map((c) => (
            <span
              key={c.id}
              draggable
              onDragStart={(e) => e.dataTransfer.setData("text/plain", c.id)}
              onClick={() => setPicked(picked === c.id ? null : c.id)}
              className={cn(
                "flex cursor-grab items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium active:cursor-grabbing",
                picked === c.id ? "border-accent bg-accent/20 text-accent" : "border-line bg-panel2/50",
                state.slots.includes(c.id) && "opacity-60",
              )}
              role="button"
              tabIndex={0}
              aria-pressed={picked === c.id}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setPicked(picked === c.id ? null : c.id)}
            >
              {describeCondition(c)}
              <button type="button" aria-label={`Remove chip ${describeCondition(c)}`} onClick={(e) => (e.stopPropagation(), removeChip(c.id))} className="text-mute hover:text-danger">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      </div>

      <div className="grid items-stretch gap-3 md:grid-cols-[1fr_auto_1fr]">
        {[0, 1].map((g) => (
          <div key={g} className={cn("rounded-xl border border-line bg-panel/30 p-3", g === 1 && "md:col-start-3 md:row-start-1")}>
            <p className="mb-2 text-xs font-bold text-accent">GROUP {g === 0 ? "A" : "B"} · slots joined by AND</p>
            <div className="grid grid-cols-2 gap-2">
              {[g * 2, g * 2 + 1].map((i) => {
                const chip = state.chips.find((c) => c.id === state.slots[i]);
                return (
                  <button
                    key={i}
                    type="button"
                    onDragOver={(e) => (e.preventDefault(), setDragOver(i))}
                    onDragLeave={() => setDragOver(null)}
                    onDrop={(e) => (e.preventDefault(), setDragOver(null), place(i, e.dataTransfer.getData("text/plain")))}
                    onClick={() => (picked ? place(i, picked) : chip ? place(i, null) : undefined)}
                    aria-label={chip ? `Slot ${i + 1}: ${describeCondition(chip)} (click to clear)` : `Slot ${i + 1} empty`}
                    className={cn(
                      "flex h-16 items-center justify-center rounded-lg border-2 border-dashed px-2 text-center text-xs transition",
                      dragOver === i ? "border-accent bg-accent/15" : chip ? "border-accent/60 bg-accent/10 text-ink" : "border-line text-slate-500 hover:border-accent/50",
                    )}
                  >
                    {chip ? describeCondition(chip) : "Drop here"}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        <div className="flex items-center justify-center md:col-start-2 md:row-start-1">
          <div role="group" aria-label="Group operator" className="flex overflow-hidden rounded-lg border border-line text-sm font-bold">
            {(["AND", "OR"] as const).map((o) => (
              <button key={o} type="button" onClick={() => onChange({ ...state, op: o })} aria-pressed={state.op === o} className={cn("px-4 py-2 transition", state.op === o ? "bg-accent text-slate-950" : "text-mute hover:text-ink")}>
                {o}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-line bg-black/30 p-3">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-mute">Live boolean circuit preview</p>
        <CircuitPreview s={state} />
      </div>
    </div>
  );
}
