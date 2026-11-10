"use client";

import { Fragment, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useLiveQuery } from "dexie-react-hooks";
import { toast } from "sonner";
import { Bar as RBar, BarChart, CartesianGrid, Cell, Funnel, FunnelChart, LabelList, Legend, Line, LineChart, Pie, PieChart, PolarAngleAxis, RadialBar, RadialBarChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { QRCodeSVG } from "qrcode.react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Download, FileDown, FileText, ShieldOff, Trash2 } from "lucide-react";
import { Badge, Button, Card, CardTitle, Checkbox, Dialog, DialogContent, EmptyState, Input, Label, PageHero, Select, Skeleton, Tip } from "@/components/ui";
import { CountUp, useNow } from "@/components/widgets";
import { getDb, type ProofRecord, type VerificationRecord } from "@/lib/db";
import { deriveStatus, proofCategoryLabel, revokeProofs, type DerivedStatus } from "@/lib/proofs";
import { downloadReceiptPdf } from "@/lib/pdf";
import { clearSyntheticHistory, seedDemoHistory } from "@/lib/seed";
import { cn, downloadBlob, errorMessage, formatBytes, shortHash, timeAgo, toCsv } from "@/lib/utils";

const STATUS_COLOR: Record<DerivedStatus, string> = { verified: "#22c55e", active: "#06b6d4", expired: "#eab308", revoked: "#ef4444" };
const STATUS_TONE: Record<DerivedStatus, "ok" | "accent" | "warn" | "danger"> = { verified: "ok", active: "accent", expired: "warn", revoked: "danger" };
const CAT_COLORS = ["#06b6d4", "#22c55e", "#a78bfa", "#eab308", "#f472b6"];
const DAY = 86_400_000;

interface Row extends ProofRecord {
  derived: DerivedStatus;
  verifs: VerificationRecord[];
}

type SortKey = "createdAt" | "label" | "verifierType" | "derived" | "genMs";

const tip = { background: "#0b0f19", border: "1px solid #06b6d4", borderRadius: 8, color: "#e2e8f0", fontSize: 12 };

export default function AuditPage() {
  const data = useLiveQuery(async () => {
    const db = getDb();
    const [proofs, verifs] = await Promise.all([db.proofs.toArray(), db.verifications.toArray()]);
    return { proofs, verifs };
  }, []);
  const now = useNow(5000);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [verifier, setVerifier] = useState("all");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "createdAt", dir: -1 });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [receipt, setReceipt] = useState<Row | null>(null);

  const rows: Row[] = useMemo(() => {
    if (!data) return [];
    const byProof = new Map<string, VerificationRecord[]>();
    data.verifs.forEach((v) => byProof.set(v.proofId, [...(byProof.get(v.proofId) ?? []), v]));
    return data.proofs.map((p) => {
      const vs = byProof.get(p.id) ?? [];
      return { ...p, verifs: vs, derived: deriveStatus(p, vs.filter((v) => v.result === "verified").length, now) };
    });
  }, [data, now]);

  const filtered = useMemo(() => {
    const f = from ? new Date(from).getTime() : 0;
    const t = to ? new Date(to).getTime() + DAY : Infinity;
    return rows.filter((r) => r.createdAt >= f && r.createdAt < t && (verifier === "all" || r.verifierType === verifier) && (category === "all" || r.category === category) && (status === "all" || r.derived === status));
  }, [rows, from, to, verifier, category, status]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      const x = a[sort.key];
      const y = b[sort.key];
      return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * sort.dir;
    });
    return arr;
  }, [filtered, sort]);

  const PAGE = 20;
  const pageRows = sorted.slice(page * PAGE, page * PAGE + PAGE);
  const pages = Math.max(1, Math.ceil(sorted.length / PAGE));

  const stats = useMemo(() => {
    const totalVerifs = data?.verifs.length ?? 0;
    return {
      proofs: rows.length,
      verifs: totalVerifs,
      active: rows.filter((r) => r.status === "active" && r.expiresAt > now).length,
      revoked: rows.filter((r) => r.status === "revoked").length,
    };
  }, [rows, data, now]);

  const line = useMemo(() => {
    const days = Array.from({ length: 30 }, (_, i) => {
      const d = new Date(now - (29 - i) * DAY);
      return { key: d.toDateString(), label: `${d.getMonth() + 1}/${d.getDate()}`, proofs: 0, verifications: 0 };
    });
    const idx = new Map(days.map((d, i) => [d.key, i]));
    filtered.forEach((r) => {
      const i = idx.get(new Date(r.createdAt).toDateString());
      if (i !== undefined) days[i].proofs++;
    });
    const ids = new Set(filtered.map((r) => r.id));
    data?.verifs.filter((v) => ids.has(v.proofId)).forEach((v) => {
      const i = idx.get(new Date(v.at).toDateString());
      if (i !== undefined) days[i].verifications++;
    });
    return days;
  }, [filtered, data, now]);

  const pie = useMemo(() => {
    const m = new Map<string, number>();
    filtered.forEach((r) => m.set(r.category, (m.get(r.category) ?? 0) + 1));
    return [...m.entries()].map(([k, v]) => ({ name: proofCategoryLabel(k as ProofRecord["category"]), value: v }));
  }, [filtered]);

  const bars = useMemo(() => {
    const m = new Map<string, number>();
    filtered.forEach((r) => m.set(r.verifierType, (m.get(r.verifierType) ?? 0) + 1));
    return [...m.entries()].map(([name, count]) => ({ name, count }));
  }, [filtered]);

  const heat = useMemo(() => {
    const grid = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
    filtered.forEach((r) => {
      const d = new Date(r.createdAt);
      grid[d.getDay()][d.getHours()]++;
    });
    return { grid, max: Math.max(1, ...grid.flat()) };
  }, [filtered]);

  const funnel = useMemo(() => {
    const generated = filtered.length;
    const shared = filtered.filter((r) => r.verifs.length > 0 || r.shares > 0).length;
    const verified = filtered.filter((r) => r.verifs.some((v) => v.result === "verified")).length;
    const expiredOrRevoked = filtered.filter((r) => r.derived === "expired" || r.derived === "revoked" || r.expiresAt <= now).length;
    return [
      { name: "Generated", value: generated, fill: "#06b6d4" },
      { name: "Shared", value: shared, fill: "#38bdf8" },
      { name: "Verified", value: verified, fill: "#22c55e" },
      { name: "Expired", value: expiredOrRevoked, fill: "#eab308" },
    ];
  }, [filtered, now]);

  const heatClass = (n: number) => {
    const r = n / heat.max;
    return n === 0 ? "bg-panel2/30" : r < 0.25 ? "bg-accent/25" : r < 0.5 ? "bg-accent/50" : r < 0.75 ? "bg-accent/75" : "bg-accent";
  };

  const toggleSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: 1 }));
  const allOnPage = pageRows.length > 0 && pageRows.every((r) => selected.has(r.id));
  const selRows = sorted.filter((r) => selected.has(r.id));

  const exportRows = (list: Row[], fmt: "csv" | "json") => {
    const flat = list.map((r) => ({ id: r.id, timestamp: new Date(r.createdAt).toISOString(), condition: r.label, verifier: r.verifierType, category: r.category, status: r.derived, duration_ms: r.genMs, proof_hash: r.proofHash }));
    if (fmt === "csv") downloadBlob("vaultzk-audit.csv", toCsv(flat), "text/csv");
    else downloadBlob("vaultzk-audit.json", JSON.stringify(flat, null, 2), "application/json");
    toast.success(`Exported ${list.length} record(s)`);
  };

  const timeline = useMemo(() => [...filtered].sort((a, b) => a.createdAt - b.createdAt).slice(-150), [filtered]);
  const noData = data && rows.length === 0;
  const hasSynthetic = rows.some((r) => r.synthetic);

  const SortHead = ({ k, children, className }: { k: SortKey; children: string; className?: string }) => (
    <th className={cn("py-2", className)}>
      <button onClick={() => toggleSort(k)} className="inline-flex items-center gap-1 uppercase tracking-wider hover:text-ink" aria-label={`Sort by ${children}`}>
        {children} {sort.key === k ? sort.dir === 1 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" /> : null}
      </button>
    </th>
  );

  if (!data) return <div className="grid gap-4 md:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-40" />)}</div>;

  return (
    <div className="space-y-6">
      <PageHero title="Your Complete Privacy Audit" subtitle="Every proof. Every verification. Full transparency.">
        <div className="flex flex-wrap gap-2">
          {hasSynthetic ? (
            <Button variant="outline" size="sm" onClick={async () => { await clearSyntheticHistory(); toast.success("Demo history cleared"); }}>Clear demo history</Button>
          ) : (
            <Button variant="outline" size="sm" onClick={async () => { await seedDemoHistory(true); toast.success("Demo history loaded"); }}>Load demo history</Button>
          )}
        </div>
      </PageHero>
      {hasSynthetic ? <p className="-mt-3 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">Charts include clearly-flagged synthetic demo history so the dashboard is populated on first launch. Your real proofs are merged in live.</p> : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {[
          { l: "Total proofs generated", v: <CountUp to={stats.proofs} />, c: "text-accent" },
          { l: "Total verifications", v: <CountUp to={stats.verifs} />, c: "text-ink" },
          { l: "Data leaked to cloud", v: <span>0 Bytes</span>, c: "text-ok" },
          { l: "Privacy score", v: <CountUp to={100} suffix="%" />, c: "text-ok" },
          { l: "Active proofs", v: <CountUp to={stats.active} />, c: "text-accent" },
          { l: "Revoked proofs", v: <CountUp to={stats.revoked} />, c: "text-danger" },
        ].map((m) => (
          <Card key={m.l} className="p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-mute">{m.l}</p>
            <p className={cn("mt-1 text-3xl font-black", m.c)}>{m.v}</p>
          </Card>
        ))}
      </div>

      <Card>
        <CardTitle>Advanced filters</CardTitle>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div><Label htmlFor="f-from">From</Label><Input id="f-from" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(0); }} /></div>
          <div><Label htmlFor="f-to">To</Label><Input id="f-to" type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(0); }} /></div>
          <div><Label htmlFor="f-ver">Verifier type</Label>
            <Select id="f-ver" value={verifier} onChange={(e) => { setVerifier(e.target.value); setPage(0); }}>
              <option value="all">All</option><option value="bank">Bank</option><option value="landlord">Landlord</option><option value="bar">Bar</option><option value="govt">Government</option><option value="unspecified">Unspecified</option>
            </Select></div>
          <div><Label htmlFor="f-cat">Condition type</Label>
            <Select id="f-cat" value={category} onChange={(e) => { setCategory(e.target.value); setPage(0); }}>
              <option value="all">All</option><option value="identity">Identity</option><option value="financial">Financial</option><option value="qualification">Qualifications</option><option value="background">Background</option><option value="custom">Custom logic</option>
            </Select></div>
          <div><Label htmlFor="f-st">Status</Label>
            <Select id="f-st" value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }}>
              <option value="all">All</option><option value="verified">Verified</option><option value="active">Active</option><option value="expired">Expired</option><option value="revoked">Revoked</option>
            </Select></div>
        </div>
        <p className="mt-2 text-xs text-mute">Showing {filtered.length} of {rows.length} proofs.</p>
      </Card>

      <Card>
        <CardTitle>Interactive timeline</CardTitle>
        {timeline.length === 0 ? (
          <div className="mt-3"><EmptyState icon={<FileText className="h-6 w-6" />} title={noData ? "No history yet" : "No proofs match these filters"} hint="Generate a proof to start your audit trail." /></div>
        ) : (
          <div className="mt-4 overflow-x-auto pb-3">
            <div className="relative flex min-w-max items-center gap-3 px-2 py-6">
              <div className="absolute inset-x-0 top-1/2 h-px bg-line" aria-hidden />
              {timeline.map((r) => (
                <Tip key={r.id} label={`${r.label} · ${r.derived} · ${new Date(r.createdAt).toLocaleString()}`}>
                  <button onClick={() => { setExpanded(r.id); setStatus("all"); document.getElementById("log-table")?.scrollIntoView({ behavior: "smooth" }); }} aria-label={`${r.label}, ${r.derived}`} className="relative z-10 h-4 w-4 rounded-full ring-4 ring-bg transition hover:scale-150" >
                    <span className="sr-only">{r.label}</span>
                    <svg viewBox="0 0 16 16" className="h-4 w-4"><circle cx="8" cy="8" r="8" fill={STATUS_COLOR[r.derived]} /></svg>
                  </button>
                </Tip>
              ))}
            </div>
            <div className="flex flex-wrap gap-3 text-xs text-mute">
              {(Object.keys(STATUS_COLOR) as DerivedStatus[]).map((s) => <span key={s} className="flex items-center gap-1.5"><svg viewBox="0 0 10 10" className="h-2.5 w-2.5"><circle cx="5" cy="5" r="5" fill={STATUS_COLOR[s]} /></svg>{s}</span>)}
            </div>
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <Card className="lg:col-span-2 xl:col-span-2">
          <CardTitle>Proofs generated — last 30 days</CardTitle>
          <div className="mt-3 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={line}>
                <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
                <XAxis dataKey="label" stroke="#94a3b8" fontSize={11} interval={3} />
                <YAxis stroke="#94a3b8" fontSize={11} allowDecimals={false} />
                <RTooltip contentStyle={tip} />
                <Legend />
                <Line type="monotone" dataKey="proofs" stroke="#06b6d4" strokeWidth={2.5} dot={false} />
                <Line type="monotone" dataKey="verifications" stroke="#22c55e" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card>
          <CardTitle>Privacy protection score</CardTitle>
          <div className="relative mt-3 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <RadialBarChart innerRadius="70%" outerRadius="100%" data={[{ name: "score", value: 100, fill: "#22c55e" }]} startAngle={210} endAngle={-30}>
                <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
                <RadialBar dataKey="value" background cornerRadius={12} />
              </RadialBarChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <p className="text-5xl font-black text-ok">100</p>
              <p className="text-xs text-mute">0 bytes left device</p>
            </div>
          </div>
        </Card>
        <Card>
          <CardTitle>Condition type distribution</CardTitle>
          <div className="mt-3 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pie} dataKey="value" nameKey="name" innerRadius={50} outerRadius={85} paddingAngle={3}>
                  {pie.map((_, i) => <Cell key={i} fill={CAT_COLORS[i % CAT_COLORS.length]} stroke="#0b0f19" />)}
                </Pie>
                <RTooltip contentStyle={tip} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card>
          <CardTitle>Verifier categories</CardTitle>
          <div className="mt-3 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bars}>
                <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
                <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} />
                <YAxis stroke="#94a3b8" fontSize={11} allowDecimals={false} />
                <RTooltip contentStyle={tip} cursor={{ fill: "rgba(6,182,212,0.08)" }} />
                <RBar dataKey="count" fill="#06b6d4" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card>
          <CardTitle>Proof lifecycle funnel</CardTitle>
          <div className="mt-3 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <FunnelChart>
                <RTooltip contentStyle={tip} />
                <Funnel dataKey="value" data={funnel} isAnimationActive>
                  <LabelList position="right" fill="#e2e8f0" stroke="none" dataKey="name" fontSize={12} />
                </Funnel>
              </FunnelChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="lg:col-span-2 xl:col-span-3">
          <CardTitle>Activity heatmap — day × hour</CardTitle>
          <div className="mt-3 overflow-x-auto">
            <div className="min-w-[640px] space-y-1">
              {heat.grid.map((hours, d) => (
                <div key={d} className="flex items-center gap-1">
                  <span className="w-9 text-[10px] text-mute">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d]}</span>
                  {hours.map((n, h) => (
                    <Tip key={h} label={`${n} proof(s) at ${h}:00`}>
                      <span className={cn("h-5 flex-1 rounded-sm", heatClass(n))} />
                    </Tip>
                  ))}
                </div>
              ))}
              <div className="flex gap-1 pl-10 text-[9px] text-slate-500">{Array.from({ length: 24 }, (_, h) => <span key={h} className="flex-1 text-center">{h % 3 === 0 ? h : ""}</span>)}</div>
            </div>
          </div>
        </Card>
      </div>

      <Card id="log-table">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Detailed log</CardTitle>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={selRows.length === 0} onClick={() => exportRows(selRows, "csv")}><FileDown className="h-3.5 w-3.5" /> CSV</Button>
            <Button size="sm" variant="outline" disabled={selRows.length === 0} onClick={() => exportRows(selRows, "json")}><Download className="h-3.5 w-3.5" /> JSON</Button>
            <Button size="sm" variant="danger" disabled={selRows.length === 0} onClick={async () => { const n = await revokeProofs(selRows.map((r) => r.id), "Bulk revoke"); toast.warning(`${n} proof(s) revoked`); setSelected(new Set()); }}><ShieldOff className="h-3.5 w-3.5" /> Bulk revoke</Button>
            <Button size="sm" variant="subtle" disabled={selRows.length === 0} onClick={async () => { const ids = selRows.map((r) => r.id); await getDb().proofs.bulkDelete(ids); await getDb().verifications.where("proofId").anyOf(ids).delete(); toast.success(`${ids.length} record(s) deleted`); setSelected(new Set()); }}><Trash2 className="h-3.5 w-3.5" /> Delete</Button>
          </div>
        </div>
        {selected.size > 0 ? <p className="mt-2 text-xs text-accent">{selected.size} selected</p> : null}
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="text-xs text-mute">
              <tr>
                <th className="w-8 py-2"><Checkbox checked={allOnPage} onCheckedChange={(v) => setSelected((s) => { const n = new Set(s); pageRows.forEach((r) => (v === true ? n.add(r.id) : n.delete(r.id))); return n; })} aria-label="Select all rows on page" /></th>
                <th className="w-6" />
                <SortHead k="createdAt">Timestamp</SortHead>
                <SortHead k="label">Condition</SortHead>
                <SortHead k="verifierType">Verifier</SortHead>
                <SortHead k="derived">Status</SortHead>
                <SortHead k="genMs" className="text-right">Duration</SortHead>
                <th className="text-right uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/50">
              {pageRows.map((r) => (
                <Fragment key={r.id}>
                  <tr className={cn("transition hover:bg-panel/40", selected.has(r.id) && "bg-accent/5")}>
                    <td className="py-2"><Checkbox checked={selected.has(r.id)} onCheckedChange={(v) => setSelected((s) => { const n = new Set(s); if (v === true) n.add(r.id); else n.delete(r.id); return n; })} aria-label={`Select ${r.label}`} /></td>
                    <td><button onClick={() => setExpanded(expanded === r.id ? null : r.id)} aria-label="Toggle details" aria-expanded={expanded === r.id} className="text-mute hover:text-ink">{expanded === r.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button></td>
                    <td className="whitespace-nowrap text-xs text-mute">{new Date(r.createdAt).toLocaleString()}</td>
                    <td className="max-w-xs truncate pr-3 font-medium">{r.label}</td>
                    <td className="capitalize text-mute">{r.verifierType}</td>
                    <td><Badge tone={STATUS_TONE[r.derived]}>{r.derived}</Badge></td>
                    <td className="text-right font-mono text-xs">{r.genMs} ms</td>
                    <td>
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="outline" onClick={() => setReceipt(r)} aria-label={`View receipt for ${r.label}`}>Receipt</Button>
                        <Button size="sm" variant="ghost" disabled={r.status === "revoked"} onClick={async () => { await revokeProofs([r.id]); toast.warning("Proof revoked"); }} aria-label={`Revoke ${r.label}`}><ShieldOff className="h-3.5 w-3.5" /></Button>
                        <Button size="sm" variant="ghost" onClick={() => exportRows([r], "json")} aria-label={`Export ${r.label}`}><Download className="h-3.5 w-3.5" /></Button>
                      </div>
                    </td>
                  </tr>
                  {expanded === r.id ? (
                    <tr className="bg-bg/50">
                      <td colSpan={8} className="p-4">
                        <motion.dl initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid gap-x-6 gap-y-1.5 font-mono text-xs sm:grid-cols-[140px_1fr]">
                          <dt className="text-mute">Proof ID</dt><dd>{r.id}</dd>
                          <dt className="text-mute">Proof hash</dt><dd className="break-all">{r.proofHash}</dd>
                          <dt className="text-mute">Circuit / size</dt><dd>{r.circuit} · {formatBytes(r.sizeBytes)}</dd>
                          <dt className="text-mute">Expiry</dt><dd>{new Date(r.expiresAt).toLocaleString()}</dd>
                          <dt className="text-mute">Verifications</dt><dd>{r.verifs.length ? r.verifs.map((v) => `${v.result} (${timeAgo(v.at, now)})`).join(", ") : "none recorded"}</dd>
                          {r.revokedAt ? <><dt className="text-danger">Revoked</dt><dd className="text-danger">{new Date(r.revokedAt).toLocaleString()}</dd></> : null}
                          {r.synthetic ? <><dt className="text-warn">Origin</dt><dd className="text-warn">synthetic demo record</dd></> : null}
                        </motion.dl>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
          {pageRows.length === 0 ? <div className="py-6"><EmptyState icon={<FileText className="h-6 w-6" />} title="Nothing to show" hint="Adjust filters or generate a proof." /></div> : null}
        </div>
        <div className="mt-3 flex items-center justify-between text-xs text-mute">
          <span>Page {page + 1} / {pages}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Prev</Button>
            <Button size="sm" variant="outline" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      </Card>

      <Dialog open={!!receipt} onOpenChange={(o) => !o && setReceipt(null)}>
        {receipt ? (
          <DialogContent title="Privacy receipt" description="Official record of what was proven — and what was not disclosed.">
            <div className="flex flex-col items-center gap-4 sm:flex-row">
              <div className="rounded-lg bg-white p-2"><QRCodeSVG value={`vaultzk:receipt:${receipt.id}:${receipt.proofHash}`} size={120} level="M" /></div>
              <dl className="min-w-0 flex-1 space-y-1 font-mono text-xs">
                <div><dt className="text-mute">Statement</dt><dd className="text-ink">{receipt.label}</dd></div>
                <div><dt className="text-mute">Proof</dt><dd>{receipt.id}</dd></div>
                <div><dt className="text-mute">Hash</dt><dd>{shortHash(receipt.proofHash, 16, 10)}</dd></div>
                <div><dt className="text-mute">Status</dt><dd><Badge tone={STATUS_TONE[receipt.derived]}>{receipt.derived}</Badge></dd></div>
                <div><dt className="text-mute">Data disclosed</dt><dd className="text-ok">None (0 bytes)</dd></div>
              </dl>
            </div>
            <Button className="mt-5 w-full" onClick={() => void downloadReceiptPdf(receipt, receipt.verifs).then(() => toast.success("Receipt PDF saved")).catch((e) => toast.error(errorMessage(e)))}><FileDown className="h-4 w-4" /> Export PDF receipt</Button>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}
