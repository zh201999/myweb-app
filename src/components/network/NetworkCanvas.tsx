"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import {
  CONTACTS_SEED,
  SECTORS_DEFAULT,
  YOU_COLORS_DEFAULT,
  type Contact,
  type SectorPalette,
  type YouColors,
} from "./networkData";
import { KEYS, load, save } from "@/lib/persistence";
import {
  buildImportPlan,
  exportContactsToCSV,
  downloadCSV,
  type ImportPlan,
} from "@/lib/csv";

// ── Helpers ────────────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  active:   "bg-emerald-900/60 text-emerald-300 border border-emerald-800",
  priority: "bg-amber-900/60  text-amber-300  border border-amber-800",
  dormant:  "bg-slate-700     text-slate-400  border border-slate-600",
};

const INPUT = "w-full bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500 placeholder-slate-600";
const LABEL = "text-[10px] uppercase tracking-wider font-semibold text-slate-500";

// ── Auto-palette pool for new imported sectors ─────────────────────────────────
// A fixed set of visually distinct bg/border pairs to assign to sectors that
// arrive via CSV import and don't already have a palette. Deterministic order
// so the same import always produces the same color assignment.
const SECTOR_PALETTE_POOL: { bg: string; border: string }[] = [
  { bg: "#291900", border: "#f59e0b" }, // amber
  { bg: "#1f0a0a", border: "#f87171" }, // red
  { bg: "#052e16", border: "#4ade80" }, // green
  { bg: "#082f49", border: "#38bdf8" }, // sky
  { bg: "#1e1b4b", border: "#818cf8" }, // indigo
  { bg: "#2d0d37", border: "#e879f9" }, // fuchsia
  { bg: "#2a1200", border: "#fb923c" }, // orange
  { bg: "#132407", border: "#a3e635" }, // lime
  { bg: "#001e25", border: "#22d3ee" }, // cyan
  { bg: "#1f1a00", border: "#facc15" }, // yellow
  { bg: "#2d0a1e", border: "#f472b6" }, // pink
  { bg: "#291507", border: "#c2855a" }, // brown
];

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function colorDist(a: string, b: string): number {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

/**
 * Pick the palette from SECTOR_PALETTE_POOL that is most visually distinct
 * from the already-assigned palettes. Skips exact duplicates first; falls back
 * to the entry with the greatest minimum border-color distance.
 */
function pickPaletteForSector(used: { bg: string; border: string }[]): { bg: string; border: string } {
  const usedBorders = used.map(p => p.border);
  let best = SECTOR_PALETTE_POOL[0];
  let bestDist = -1;
  for (const candidate of SECTOR_PALETTE_POOL) {
    if (used.some(p => p.bg === candidate.bg && p.border === candidate.border)) continue;
    const minDist = usedBorders.length === 0
      ? Infinity
      : Math.min(...usedBorders.map(b => colorDist(candidate.border, b)));
    if (minDist > bestDist) { bestDist = minDist; best = candidate; }
  }
  return best;
}

// ── Graph utility types ────────────────────────────────────────────────────────

type VN = {
  destroy: () => void;
  on:   (event: string, cb: (params: unknown) => void) => void;
  once: (event: string, cb: (params: unknown) => void) => void;
  setOptions: (options: unknown) => void;
  getPositions: (nodeIds?: string[]) => Record<string, { x: number; y: number }>;
};

interface NodeDS {
  add:    (items: unknown[]) => void;
  update: (items: unknown[]) => void;
  remove: (ids: unknown[]) => void;
  get:    (id: string) => unknown | null;
}
interface EdgeDS {
  add:    (items: unknown[]) => void;
  update: (items: unknown[]) => void;
  clear:  () => void;
}

// ── Crater rendering helpers ───────────────────────────────────────────────────

function seededRng(seed: string) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return () => {
    h ^= h << 13; h ^= h >> 17; h ^= h << 5;
    h = h >>> 0;
    return h / 4294967296;
  };
}

// ── Crater helpers ─────────────────────────────────────────────────────────────

interface CraterDef { cx: number; cy: number; cr: number; }

// Generates non-overlapping crater positions within a circle of `nodeRadius`.
// Uses rejection sampling so craters never touch each other or the node edge.
// Constants are designed to be easy to tune:
//   MARGIN     — fraction of nodeRadius kept clear at the edge (craters stay inside)
//   GAP        — minimum pixel gap between crater edges
//   MAX_TRIES  — attempts per crater before giving up (prevents infinite loop)
function generateCraters(
  rng:         () => number,
  nodeRadius:  number,
  count:       number,
  minCraterR:  number,
  maxCraterR:  number,
): CraterDef[] {
  const MARGIN    = 0.80; // craters must fit within 80% of the node radius
  const GAP       = 1.2;  // minimum px gap between crater edges
  const MAX_TRIES = 35;
  const placed: CraterDef[] = [];

  for (let i = 0; i < count; i++) {
    const cr = minCraterR + rng() * (maxCraterR - minCraterR);
    const maxDist = nodeRadius * MARGIN - cr;
    if (maxDist <= 0) continue; // node too small for this crater

    for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
      // sqrt distribution → uniform area coverage (avoids center bias)
      const dist  = Math.sqrt(rng()) * maxDist;
      const angle = rng() * Math.PI * 2;
      const cx    = Math.cos(angle) * dist;
      const cy    = Math.sin(angle) * dist;

      const overlaps = placed.some(p => {
        const dx = cx - p.cx, dy = cy - p.cy;
        return Math.sqrt(dx * dx + dy * dy) < cr + p.cr + GAP;
      });
      if (!overlaps) { placed.push({ cx, cy, cr }); break; }
    }
    // If no valid slot after MAX_TRIES, this crater is silently skipped.
  }
  return placed;
}

// Draw craters on a node.
// contactCount (for company nodes) drives crater count and size range.
// Omit contactCount for contact nodes → uses contact-specific defaults.
function drawCraters(
  ctx:          CanvasRenderingContext2D,
  x:            number,
  y:            number,
  radius:       number,
  nodeId:       string,
  contactCount?: number,
) {
  const rng = seededRng(nodeId);

  let count: number;
  let minR: number;
  let maxR: number;

  if (contactCount !== undefined) {
    // Company node: scale crater count with group size but cap for readability.
    count = Math.min(2 + Math.floor(Math.sqrt(contactCount)), 7);
    minR  = radius * 0.09;
    maxR  = radius * 0.19;
  } else {
    // Contact node: 2–4 craters, weighted so 3 is most common.
    const roll = rng();
    count = roll < 0.20 ? 2 : roll < 0.72 ? 3 : 4;
    minR  = radius * 0.09;
    maxR  = radius * 0.15;
  }

  const craters = generateCraters(rng, radius, count, minR, maxR);

  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.clip();
  for (const { cx, cy, cr } of craters) {
    ctx.beginPath();
    ctx.arc(x + cx, y + cy, cr, 0, Math.PI * 2);
    ctx.fillStyle   = "rgba(0,0,0,0.22)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth   = 0.5;
    ctx.stroke();
  }
  ctx.restore();
}

// Saturn-style elliptical ring. Accepts fill/border colors so it matches the
// node's current sector palette.
function drawSaturnRing(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  nodeRadius: number,
  fillColor  = "#1e293b",
  borderColor = "#94a3b8",
) {
  const rx = nodeRadius * 2.1;
  const ry = nodeRadius * 0.46;

  ctx.save();

  // Back half of ring (drawn faintly — node covers it).
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, Math.PI, Math.PI * 2);
  ctx.strokeStyle = `${borderColor}30`;
  ctx.lineWidth = 3;
  ctx.stroke();

  // Re-draw the node circle to cover the back arc.
  ctx.beginPath();
  ctx.arc(x, y, nodeRadius, 0, Math.PI * 2);
  ctx.fillStyle   = fillColor;
  ctx.fill();
  ctx.strokeStyle = borderColor;
  ctx.lineWidth   = 2;
  ctx.stroke();

  // Front half of ring (on top of node).
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI);
  ctx.strokeStyle = `${borderColor}88`;
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.restore();
}

// ── Company node size ──────────────────────────────────────────────────────────
// Scale company node radius with contact count using a sqrt curve so growth
// is noticeable for small companies but tapers off for large hubs.
// Easy to tune: adjust BASE, GROWTH, and MAX.

function getCompanyNodeSize(contactCount: number): number {
  const BASE   = 16;  // minimum radius (px) for a 2-contact company
  const GROWTH = 4;   // scaling factor — higher = faster growth
  const MAX    = 32;  // hard cap so no company dominates the canvas
  return Math.min(Math.round(BASE + GROWTH * Math.sqrt(Math.max(0, contactCount - 1))), MAX);
}

// ── Orbit layout helper ────────────────────────────────────────────────────────
// Returns evenly-distributed positions arranged in a circle around `center`.
// Orbit radius accounts for the company node's own size so contacts don't overlap it.

function orbitPositions(
  center:      { x: number; y: number },
  count:       number,
  companySize: number = 16,
): Array<{ x: number; y: number }> {
  if (count === 0) return [];
  // Orbit radius must clear the company node itself plus a comfortable gap.
  const baseRadius = count <= 2 ? 70 : count <= 5 ? 90 : 115;
  const radius     = Math.max(baseRadius, companySize + 52);
  // Start from the top (−π/2) so contacts fan out naturally.
  const startAngle = -Math.PI / 2;
  return Array.from({ length: count }, (_, i) => {
    const angle = startAngle + (i * Math.PI * 2) / count;
    return {
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle),
    };
  });
}

// ── Graph structure helpers ────────────────────────────────────────────────────

interface GraphStructureResult {
  companyNodeIds: string[];
  groupedContactIds: Set<string>;
}

function applyGraphStructure(
  nodesDS: NodeDS,
  edgesDS: EdgeDS,
  contacts: Contact[],
  oldCompanyNodeIds: string[],
  networkInstance: VN | null,
  getPalette: (sector: string) => { bg: string; border: string },
): GraphStructureResult {
  if (oldCompanyNodeIds.length) nodesDS.remove(oldCompanyNodeIds);
  edgesDS.clear();

  const companyMap = new Map<string, { c: Contact; idx: number }[]>();
  contacts.forEach((c, idx) => {
    const key = c.company.trim();
    if (!companyMap.has(key)) companyMap.set(key, []);
    companyMap.get(key)!.push({ c, idx });
  });

  const newEdges: Array<Record<string, unknown>> = [];
  const newCompanyNodes: Array<Record<string, unknown>> = [];
  const newCompanyNodeIds: string[] = [];
  const groupedContactIds = new Set<string>();

  const edgeDef = (
    id: string, from: string, to: string,
    alpha = 0.35, width = 1.5,
    hidden = false,
  ): Record<string, unknown> => ({
    id, from, to,
    color: { color: `rgba(148,163,184,${alpha})` },
    width,
    smooth: { enabled: true, type: "curvedCW", roundness: 0.2 },
    hidden,
  });

  companyMap.forEach((members, company) => {
    if (members.length >= 2) {
      const cNodeId = `company-${company}`;
      newCompanyNodeIds.push(cNodeId);

      let extraPos: Record<string, unknown> = {};
      if (networkInstance) {
        const cIds = members.map(m => `contact-${m.c.id ?? m.idx + 1}`);
        const pos  = networkInstance.getPositions([...cIds, "self"]);
        const selfP = pos["self"] ?? { x: 0, y: 0 };
        const valid = cIds.map(id => pos[id]).filter(Boolean);
        if (valid.length) {
          const cx = valid.reduce((s, p) => s + p.x, 0) / valid.length;
          const cy = valid.reduce((s, p) => s + p.y, 0) / valid.length;
          extraPos = {
            x: selfP.x + (cx - selfP.x) * 0.5,
            y: selfP.y + (cy - selfP.y) * 0.5,
          };
        }
      }

      const sector    = members[0].c.sector;
      const palette   = getPalette(sector);
      const nodeSize  = getCompanyNodeSize(members.length);

      newCompanyNodes.push({
        id: cNodeId, label: company,
        shape: "dot", size: nodeSize,
        color: { background: palette.bg, border: palette.border },
        font: { color: palette.border, size: 11 },
        borderWidth: 2,
        ...extraPos,
      });

      newEdges.push(edgeDef(`edge-self-${cNodeId}`, "self", cNodeId, 0.4, 1.5));

      members.forEach(({ c, idx }) => {
        const contactId = `contact-${c.id ?? idx + 1}`;
        groupedContactIds.add(contactId);
        nodesDS.update([{ id: contactId, hidden: true }]);
        newEdges.push(edgeDef(`edge-${cNodeId}-${contactId}`, cNodeId, contactId, 0.25, 1, true));
      });
    } else {
      const { c, idx } = members[0];
      const contactId = `contact-${c.id ?? idx + 1}`;
      nodesDS.update([{ id: contactId, hidden: false }]);
      newEdges.push(edgeDef(`edge-self-${contactId}`, "self", contactId));
    }
  });

  nodesDS.add(newCompanyNodes);
  edgesDS.add(newEdges);
  return { companyNodeIds: newCompanyNodeIds, groupedContactIds };
}


// ── SectorEditorModal ──────────────────────────────────────────────────────────

function SectorEditorModal({
  sectorPalettes,
  youColors,
  onSave,
  onClose,
}: {
  sectorPalettes: SectorPalette[];
  youColors: YouColors;
  onSave: (palettes: SectorPalette[], you: YouColors) => void;
  onClose: () => void;
}) {
  const [drafts, setDrafts]         = useState<SectorPalette[]>(() => sectorPalettes.map(p => ({ ...p })));
  const [draftYou, setDraftYou]     = useState<YouColors>({ ...youColors });
  const [newName, setNewName]       = useState("");

  function updateDraft(idx: number, key: keyof SectorPalette, val: string) {
    setDrafts(prev => prev.map((p, i) => i === idx ? { ...p, [key]: val } : p));
  }

  function removeDraft(idx: number) {
    setDrafts(prev => prev.filter((_, i) => i !== idx));
  }

  function addSector() {
    const name = newName.trim();
    if (!name || drafts.some(p => p.name.toLowerCase() === name.toLowerCase())) return;
    setDrafts(prev => [...prev, { name, bg: "#1e293b", border: "#64748b" }]);
    setNewName("");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Panel */}
      <div className="relative z-10 w-[460px] max-h-[85vh] flex flex-col bg-[#111827] border border-slate-700 rounded-xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 shrink-0 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Edit Sectors</h2>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-white text-xl leading-none transition-colors"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-6">

          {/* You node */}
          <div>
            <p className={`${LABEL} mb-3`}>You (Center Node)</p>
            <div className="bg-slate-800/50 rounded-lg p-4 flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <div
                  className="w-7 h-7 rounded-full flex-shrink-0"
                  style={{ background: draftYou.fill, border: `2px solid ${draftYou.border}` }}
                />
                <span className="text-xs text-slate-200 font-medium">You</span>
              </div>
              <div className="grid grid-cols-3 gap-4">
                {([ ["Fill", "fill"], ["Border", "border"], ["Text", "text"] ] as [string, keyof YouColors][]).map(([lbl, key]) => (
                  <div key={key} className="flex flex-col gap-1.5">
                    <label className="text-[10px] text-slate-500 uppercase tracking-wider">{lbl}</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={draftYou[key]}
                        onChange={e => setDraftYou(prev => ({ ...prev, [key]: e.target.value }))}
                        className="w-8 h-6 rounded cursor-pointer border border-slate-600 bg-transparent p-0"
                      />
                      <span className="text-[10px] text-slate-500 font-mono">{draftYou[key]}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Sector rows */}
          <div>
            <p className={`${LABEL} mb-3`}>Sectors</p>
            <div className="flex flex-col gap-2">
              {drafts.map((p, idx) => (
                <div key={idx} className="bg-slate-800/50 rounded-lg px-3 py-2.5 flex items-center gap-3">
                  <div
                    className="w-5 h-5 rounded-full flex-shrink-0"
                    style={{ background: p.bg, border: `2px solid ${p.border}` }}
                  />
                  <span className="text-xs text-white font-medium flex-1 min-w-0 truncate">{p.name}</span>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="flex flex-col items-center gap-0.5">
                      <label className="text-[9px] text-slate-500">Fill</label>
                      <input
                        type="color"
                        value={p.bg}
                        onChange={e => updateDraft(idx, "bg", e.target.value)}
                        className="w-7 h-5 rounded cursor-pointer border border-slate-600 bg-transparent p-0"
                      />
                    </div>
                    <div className="flex flex-col items-center gap-0.5">
                      <label className="text-[9px] text-slate-500">Border</label>
                      <input
                        type="color"
                        value={p.border}
                        onChange={e => updateDraft(idx, "border", e.target.value)}
                        className="w-7 h-5 rounded cursor-pointer border border-slate-600 bg-transparent p-0"
                      />
                    </div>
                    <button
                      onClick={() => removeDraft(idx)}
                      title="Remove sector"
                      className="ml-1 text-slate-600 hover:text-red-400 text-sm transition-colors leading-none"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Add sector */}
          <div>
            <p className={`${LABEL} mb-3`}>Add Sector</p>
            <div className="flex gap-2">
              <input
                className="flex-1 bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500 placeholder-slate-600"
                placeholder="Sector name…"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addSector()}
              />
              <button
                onClick={addSector}
                className="px-4 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-white text-xs font-medium transition-colors"
              >
                Add
              </button>
            </div>
          </div>
        </div>

        {/* Footer actions */}
        <div className="px-6 py-4 border-t border-slate-800 shrink-0 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded border border-slate-700 text-slate-300 hover:text-white hover:border-slate-500 text-xs font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => { onSave(drafts, draftYou); onClose(); }}
            className="flex-1 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ── ImportPreviewModal ─────────────────────────────────────────────────────────

function ImportPreviewModal({
  plan,
  onConfirm,
  onClose,
}: {
  plan: ImportPlan;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const preview = plan.toImport.slice(0, 10);
  const total   = plan.toImport.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      <div className="relative z-10 w-[540px] max-h-[85vh] flex flex-col bg-[#111827] border border-slate-700 rounded-xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 shrink-0 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Import Preview</h2>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-white text-xl leading-none transition-colors"
          >
            ×
          </button>
        </div>

        {/* Stats */}
        <div className="px-6 pt-4 pb-3 shrink-0 flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span className="text-emerald-400 text-xs">✓</span>
            <span className="text-xs text-slate-200">
              <span className="font-semibold text-white">{total}</span> contact{total !== 1 ? "s" : ""} ready to import
            </span>
          </div>
          {plan.skippedNoName.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-amber-400 text-xs">⚠</span>
              <span className="text-xs text-slate-400">
                <span className="font-semibold text-amber-400">{plan.skippedNoName.length}</span> row{plan.skippedNoName.length !== 1 ? "s" : ""} skipped — missing name
              </span>
            </div>
          )}
          {plan.skippedDuplicates.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-amber-400 text-xs">⚠</span>
              <span className="text-xs text-slate-400">
                <span className="font-semibold text-amber-400">{plan.skippedDuplicates.length}</span> row{plan.skippedDuplicates.length !== 1 ? "s" : ""} skipped — duplicate name + company
              </span>
            </div>
          )}
        </div>

        {/* Preview table */}
        {total > 0 && (
          <div className="flex-1 overflow-y-auto px-6 pb-4 min-h-0">
            <p className={`${LABEL} mb-2`}>
              {total > 10 ? `First 10 of ${total} contacts` : `${total} contact${total !== 1 ? "s" : ""}`}
            </p>
            <div className="rounded border border-slate-800 overflow-hidden">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="bg-slate-800/60 text-slate-500 uppercase tracking-wider">
                    <th className="px-3 py-2 text-left font-semibold">Name</th>
                    <th className="px-3 py-2 text-left font-semibold">Company</th>
                    <th className="px-3 py-2 text-left font-semibold">Sector</th>
                    <th className="px-3 py-2 text-left font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {preview.map(({ contact: c, rowNum }) => (
                    <tr key={rowNum} className="hover:bg-slate-800/30 transition-colors">
                      <td className="px-3 py-2 text-white font-medium truncate max-w-[130px]">{c.name}</td>
                      <td className="px-3 py-2 text-slate-400 truncate max-w-[110px]">{c.company || "—"}</td>
                      <td className="px-3 py-2 text-slate-400 truncate max-w-[90px]">{c.sector || "—"}</td>
                      <td className="px-3 py-2">
                        <span className={`capitalize ${
                          c.status === "active"   ? "text-emerald-400" :
                          c.status === "priority" ? "text-amber-400"   : "text-slate-500"
                        }`}>{c.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {total === 0 && (
          <div className="flex-1 flex items-center justify-center pb-6">
            <p className="text-xs text-slate-500">Nothing to import — all rows were skipped.</p>
          </div>
        )}

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-800 shrink-0 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded border border-slate-700 text-slate-300 hover:text-white hover:border-slate-500 text-xs font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => { onConfirm(); onClose(); }}
            disabled={total === 0}
            className="flex-1 py-2 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold transition-colors"
          >
            Confirm Import{total > 0 ? ` (${total})` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── TagInput — autocomplete tag editor ────────────────────────────────────────

function TagInput({
  tags,
  allTags,
  onChange,
}: {
  tags: string[];
  allTags: string[];
  onChange: (tags: string[]) => void;
}) {
  const [input, setInput] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);

  const suggestions = useMemo(() => {
    if (!input.trim()) return [];
    const lower = input.toLowerCase();
    return allTags.filter(t => t.toLowerCase().startsWith(lower) && !tags.includes(t));
  }, [input, allTags, tags]);

  function addTag(tag: string) {
    const trimmed = tag.trim();
    if (!trimmed || tags.includes(trimmed)) return;
    onChange([...tags, trimmed]);
    setInput("");
    setShowSuggestions(false);
  }

  function removeTag(tag: string) {
    onChange(tags.filter(t => t !== tag));
  }

  return (
    <div className="flex flex-col gap-2">
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tags.map(tag => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 text-[10px] border border-slate-700"
            >
              {tag}
              <button
                type="button"
                onClick={() => removeTag(tag)}
                className="text-slate-500 hover:text-red-400 leading-none transition-colors"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="relative">
        <input
          className={INPUT}
          placeholder="Add tag…"
          value={input}
          onChange={e => { setInput(e.target.value); setShowSuggestions(true); }}
          onKeyDown={e => {
            if ((e.key === "Enter" || e.key === ",") && input.trim()) {
              e.preventDefault();
              addTag(input);
            }
            if (e.key === "Escape") setShowSuggestions(false);
          }}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
        />
        {showSuggestions && suggestions.length > 0 && (
          <div className="absolute z-10 top-full mt-1 w-full bg-[#111827] border border-slate-700 rounded shadow-lg max-h-36 overflow-y-auto">
            {suggestions.map(tag => (
              <button
                key={tag}
                type="button"
                onMouseDown={() => addTag(tag)}
                className="w-full text-left px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
              >
                {tag}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── ContactEditModal ───────────────────────────────────────────────────────────

function ContactEditModal({
  contact,
  allTags,
  sectors,
  onSave,
  onClose,
  onDelete,
}: {
  contact: Contact;
  allTags: string[];
  sectors: string[];
  onSave: (updated: Contact) => void;
  onClose: () => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState<Contact>({ ...contact });
  const [confirmDelete, setConfirmDelete] = useState(false);

  function set<K extends keyof Contact>(key: K, value: Contact[K]) {
    setDraft(prev => ({ ...prev, [key]: value }));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      <div className="relative z-10 w-[500px] max-h-[85vh] flex flex-col bg-[#111827] border border-slate-700 rounded-xl shadow-2xl overflow-hidden">

        <div className="px-5 py-3.5 border-b border-slate-800 shrink-0 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Edit Profile</h2>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-white text-xl leading-none transition-colors"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 grid grid-cols-2 gap-x-3 gap-y-3 content-start">

          {/* Name | Status */}
          <div className="flex flex-col gap-1">
            <label className={LABEL}>Name</label>
            <input type="text" className={INPUT} value={draft.name}
              onChange={e => set("name", e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <label className={LABEL}>Status</label>
            <select className={INPUT} value={draft.status}
              onChange={e => set("status", e.target.value as Contact["status"])}>
              <option value="active">Active</option>
              <option value="priority">Priority</option>
              <option value="dormant">Dormant</option>
            </select>
          </div>

          {/* Title — full width */}
          <div className="col-span-2 flex flex-col gap-1">
            <label className={LABEL}>Title</label>
            <input type="text" className={INPUT} value={draft.title}
              onChange={e => set("title", e.target.value)} />
          </div>

          {/* Company | Sector */}
          <div className="flex flex-col gap-1">
            <label className={LABEL}>Company</label>
            <input type="text" className={INPUT} value={draft.company}
              onChange={e => set("company", e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <label className={LABEL}>Sector</label>
            <select className={INPUT} value={draft.sector}
              onChange={e => set("sector", e.target.value)}>
              {sectors.map(s => <option key={s} value={s}>{s}</option>)}
              {/* keep the current value selectable even if it's an unlisted sector */}
              {!sectors.includes(draft.sector) && draft.sector && (
                <option value={draft.sector}>{draft.sector}</option>
              )}
            </select>
          </div>

          {/* Location — full width */}
          <div className="col-span-2 flex flex-col gap-1">
            <label className={LABEL}>Location</label>
            <input type="text" className={INPUT} value={draft.geo}
              onChange={e => set("geo", e.target.value)} />
          </div>

          {/* Source | Connection Type */}
          <div className="flex flex-col gap-1">
            <label className={LABEL}>Source</label>
            <input type="text" className={INPUT} value={draft.source}
              onChange={e => set("source", e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <label className={LABEL}>Connection Type</label>
            <input type="text" className={INPUT} value={draft.connection.type}
              onChange={e => set("connection", { ...draft.connection, type: e.target.value })} />
          </div>

          {/* Last Contact | Direct Connection */}
          <div className="flex flex-col gap-1">
            <label className={LABEL}>Last Contact</label>
            <input type="date" className={INPUT} value={draft.lastContact}
              onChange={e => set("lastContact", e.target.value)} />
          </div>
          <div className="flex flex-col gap-1 justify-end">
            <label className="flex items-center gap-2 cursor-pointer h-[30px]">
              <input
                type="checkbox"
                checked={draft.direct}
                onChange={e => set("direct", e.target.checked)}
                className="w-4 h-4 rounded accent-blue-500 cursor-pointer"
              />
              <span className={LABEL}>Direct Connection</span>
            </label>
          </div>

          {/* Strength | Influence */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className={LABEL}>Strength</label>
              <span className="text-[10px] text-slate-400">{draft.strength}/10</span>
            </div>
            <input type="range" min={1} max={10} step={1} value={draft.strength}
              onChange={e => set("strength", Number(e.target.value))}
              className="w-full accent-blue-500" />
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className={LABEL}>Influence</label>
              <span className="text-[10px] text-slate-400">{draft.influence}/10</span>
            </div>
            <input type="range" min={1} max={10} step={1} value={draft.influence}
              onChange={e => set("influence", Number(e.target.value))}
              className="w-full accent-violet-500" />
          </div>

          {/* Notes — full width */}
          <div className="col-span-2 flex flex-col gap-1">
            <label className={LABEL}>Notes</label>
            <textarea className={`${INPUT} resize-none h-16`} value={draft.notes}
              onChange={e => set("notes", e.target.value)} />
          </div>

          {/* Tags — full width */}
          <div className="col-span-2 flex flex-col gap-1">
            <label className={LABEL}>Tags</label>
            <TagInput tags={draft.tags} allTags={allTags}
              onChange={tags => set("tags", tags)} />
          </div>

        </div>

        {confirmDelete ? (
          <div className="px-5 py-3.5 border-t border-slate-800 shrink-0 flex items-center gap-2">
            <span className="text-xs text-slate-400 flex-1">Remove this contact?</span>
            <button
              onClick={onDelete}
              className="px-3 py-2 rounded bg-red-900/40 border border-red-700 text-red-400 hover:bg-red-800/50 text-xs font-medium transition-colors"
            >
              Yes, remove
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="px-3 py-2 rounded border border-slate-700 text-slate-400 hover:text-white text-xs transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="px-5 py-3.5 border-t border-slate-800 shrink-0 flex gap-2">
            <button
              onClick={() => setConfirmDelete(true)}
              className="px-3 py-2 rounded border border-red-900/50 text-red-600 hover:text-red-400 hover:border-red-700 text-xs transition-colors"
            >
              Remove
            </button>
            <button
              onClick={onClose}
              className="flex-1 py-2 rounded border border-slate-700 text-slate-300 hover:text-white hover:border-slate-500 text-xs font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => { onSave(draft); onClose(); }}
              className="flex-1 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors"
            >
              Save
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── ContactPanel — view mode ───────────────────────────────────────────────────

function ContactPanel({
  contact,
  allTags,
  sectors,
  onBack,
  onSave,
  onDelete,
}: {
  contact: Contact;
  allTags: string[];
  sectors: string[];
  onBack: () => void;
  onSave: (updated: Contact) => void;
  onDelete: () => void;
}) {
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    setIsEditing(false);
  }, [contact]);

  const bar = (v: number, max = 10) => `${Math.round((v / max) * 100)}%`;

  return (
    <>
      {isEditing && (
        <ContactEditModal
          contact={contact}
          allTags={allTags}
          sectors={sectors}
          onSave={updated => { onSave(updated); setIsEditing(false); }}
          onClose={() => setIsEditing(false)}
          onDelete={onDelete}
        />
      )}

      <div className="flex flex-col h-full">
        <button
          onClick={onBack}
          className="flex items-center gap-1 px-4 pt-4 pb-2 text-xs text-slate-500 hover:text-slate-200 transition-colors w-fit"
        >
          ← Contacts
        </button>

        <div className="flex-1 overflow-y-auto px-4 pb-4 flex flex-col gap-5">
          <div className="flex flex-col gap-2 pt-1">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-base font-bold text-white leading-tight">{contact.name}</h3>
              <button className="shrink-0 px-2.5 py-1 rounded border border-slate-700 text-[10px] text-slate-400 hover:text-white hover:border-slate-500 transition-colors">
                Note Log
              </button>
            </div>
            <p className="text-xs text-slate-400 leading-snug">
              {contact.title}&nbsp;&middot;&nbsp;{contact.company}
            </p>
            <div className="flex flex-wrap gap-1.5">
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium capitalize ${STATUS_STYLES[contact.status] ?? STATUS_STYLES.dormant}`}>
                {contact.status}
              </span>
              {contact.direct && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-indigo-900/60 text-indigo-300 border border-indigo-800">
                  Direct
                </span>
              )}
            </div>
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-1">Details</p>
            <div className="flex flex-col divide-y divide-slate-800">
              {(
                [
                  ["Sector",     contact.sector],
                  ["Location",   contact.geo],
                  ["Source",     contact.source],
                  ["Connection", contact.connection.type],
                ] as [string, string][]
              ).map(([label, value]) => (
                <div key={label} className="flex items-baseline justify-between py-2">
                  <span className="text-[11px] text-slate-500 shrink-0">{label}</span>
                  <span className="text-xs text-slate-200 text-right ml-2 truncate max-w-[56%]">{value}</span>
                </div>
              ))}
              <div className="flex items-baseline justify-between py-2">
                <span className="text-[11px] text-slate-500 shrink-0">Last Contact</span>
                <span className="text-xs text-slate-200 text-right ml-2">
                  {(() => {
                    const d = new Date(contact.lastContact);
                    if (isNaN(d.getTime())) return contact.lastContact;
                    const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
                    return `${contact.lastContact} (${days}d ago)`;
                  })()}
                </span>
              </div>
            </div>
          </div>

          {(["strength", "influence"] as const).map(key => (
            <div key={key} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">
                  {key === "strength" ? "Relationship Strength" : "Influence Level"}
                </span>
                <span className="text-[10px] text-slate-500">{contact[key]}/10</span>
              </div>
              <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${key === "strength" ? "bg-blue-500" : "bg-violet-500"}`}
                  style={{ width: bar(contact[key]) }}
                />
              </div>
            </div>
          ))}

          {contact.notes && (
            <div className="flex flex-col gap-1.5">
              <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">Notes</p>
              <p className="text-xs text-slate-300 leading-relaxed">{contact.notes}</p>
            </div>
          )}

          {contact.tags.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">Tags</p>
              <div className="flex flex-wrap gap-1">
                {contact.tags.map(tag => (
                  <span key={tag} className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 text-[10px] border border-slate-700">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-slate-800 shrink-0">
          <button
            onClick={() => setIsEditing(true)}
            className="w-full py-2.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold tracking-wide transition-colors"
          >
            Edit Profile
          </button>
        </div>
      </div>
    </>
  );
}

function SummaryCard({ label, value, valueClass = "text-white" }: {
  label: string; value: number; valueClass?: string;
}) {
  return (
    <div className="bg-slate-800 rounded p-3 flex flex-col gap-1">
      <span className={`text-lg font-bold ${valueClass}`}>{value}</span>
      <span className="text-[11px] text-slate-400">{label}</span>
    </div>
  );
}

function EmptyContactState() {
  return (
    <div className="flex flex-col items-center justify-center h-full p-6 text-center gap-3">
      <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center text-slate-600 text-xl select-none">◌</div>
      <p className="text-xs text-slate-500 leading-relaxed">
        Click a contact node in the graph to view their details.
      </p>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export interface NetworkCanvasHandle {
  triggerImport:  () => void;
  exportAll:      () => void;
  exportFiltered: () => void;
}

const NetworkCanvas = forwardRef<NetworkCanvasHandle, {
  editorOpen?: boolean;
  onCloseEditor?: () => void;
}>(function NetworkCanvas({
  editorOpen = false,
  onCloseEditor = () => {},
}, ref) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const nodesDataRef  = useRef<NodeDS | null>(null);
  const edgesDataRef  = useRef<EdgeDS | null>(null);
  const networkRef    = useRef<VN | null>(null);
  const hiddenNodesRef        = useRef<Set<string>>(new Set());
  const companyNodeIdsRef     = useRef<string[]>([]);
  const groupedContactIdsRef  = useRef<Set<string>>(new Set());
  const expandedCompaniesRef  = useRef<Set<string>>(new Set());
  const prevGroupSigRef       = useRef<string>("");

  // State initializers always use server-safe defaults so SSR output matches
  // the first client render. localStorage is loaded in a useEffect after mount.
  const [contacts, setContacts] = useState<Contact[]>([...CONTACTS_SEED]);
  const contactsRef = useRef(contacts);
  useEffect(() => { contactsRef.current = contacts; }, [contacts]);

  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [selectedSectors, setSelectedSectors] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery]         = useState("");
  const selectedSectorsRef = useRef<Set<string>>(new Set());
  useEffect(() => { selectedSectorsRef.current = selectedSectors; }, [selectedSectors]);

  // ── Sector color state ──────────────────────────────────────────────────────
  const [sectorPalettes, setSectorPalettes] = useState<SectorPalette[]>(
    SECTORS_DEFAULT.map(p => ({ ...p }))
  );
  const sectorPalettesRef = useRef(sectorPalettes);
  useEffect(() => { sectorPalettesRef.current = sectorPalettes; }, [sectorPalettes]);

  // ── You node color state ────────────────────────────────────────────────────
  const [youColors, setYouColors] = useState<YouColors>({ ...YOU_COLORS_DEFAULT });
  const youColorsRef = useRef(youColors);
  useEffect(() => { youColorsRef.current = youColors; }, [youColors]);

  // ── Hydration flag ──────────────────────────────────────────────────────────
  // False during SSR and the first client render. Becomes true after the mount
  // effect loads localStorage, triggering a second render with persisted data.
  // The graph init and all save effects are gated on this flag so they:
  //   (a) never run during SSR/initial hydration
  //   (b) never overwrite localStorage with seed defaults
  const [hasHydrated, setHasHydrated] = useState(false);

  // Single mount effect: load all persisted state then mark hydrated.
  useEffect(() => {
    const savedContacts = load<Contact[] | null>(KEYS.contacts, null);
    if (savedContacts) setContacts(savedContacts);

    const savedPalettes = load<SectorPalette[] | null>(KEYS.sectorPalettes, null);
    if (savedPalettes) setSectorPalettes(savedPalettes);

    const savedYouColors = load<YouColors | null>(KEYS.youColors, null);
    if (savedYouColors) setYouColors(savedYouColors);

    setHasHydrated(true);
  }, []);

  // Persist on change — only after hydration so we never clobber stored data
  // with the seed defaults that are present during the first render.
  useEffect(() => { if (hasHydrated) save(KEYS.contacts, contacts); },       [hasHydrated, contacts]);
  useEffect(() => { if (hasHydrated) save(KEYS.sectorPalettes, sectorPalettes); }, [hasHydrated, sectorPalettes]);
  useEffect(() => { if (hasHydrated) save(KEYS.youColors, youColors); },     [hasHydrated, youColors]);

  // Auto-assign palettes for any sector in contacts that doesn't have one yet.
  // Runs after every contacts change (CSV import, manual edit, etc.).
  // Uses the functional-updater form so `prev` is always the committed palette
  // list — no stale-closure risk. sectorPalettes is intentionally NOT in deps
  // to prevent the loop: effect → setSectorPalettes → re-render → effect.
  useEffect(() => {
    if (!hasHydrated) return;
    setSectorPalettes(prev => {
      const knownNames = new Set(prev.map(p => p.name));
      const missing = [
        ...new Set(contacts.map(c => c.sector.trim()).filter(s => s && !knownNames.has(s))),
      ];
      if (missing.length === 0) return prev; // no change → no re-render
      const updated = [...prev];
      for (const name of missing) {
        const { bg, border } = pickPaletteForSector(updated);
        updated.push({ name, bg, border });
      }
      return updated;
    });
  }, [hasHydrated, contacts]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sectors list: driven by palette definitions + any orphaned contact sectors
  const sectors = useMemo(() => {
    const fromPalettes = sectorPalettes.map(p => p.name);
    const fromContacts = contacts.map(c => c.sector);
    return [...new Set([...fromPalettes, ...fromContacts])];
  }, [sectorPalettes, contacts]);

  const sectorsRef = useRef(sectors);
  useEffect(() => { sectorsRef.current = sectors; }, [sectors]);

  const filteredContacts = useMemo(() => {
    let result = selectedSectors.size === 0
      ? contacts
      : contacts.filter(c => selectedSectors.has(c.sector));
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(c =>
        c.name.toLowerCase().includes(q) || c.company.toLowerCase().includes(q)
      );
    }
    return result;
  }, [contacts, selectedSectors, searchQuery]);

  // Keep a ref so imperative export handles always read the latest filtered list.
  const filteredContactsRef = useRef(filteredContacts);
  useEffect(() => { filteredContactsRef.current = filteredContacts; }, [filteredContacts]);

  const activeCount   = contacts.filter(c => c.status === "active").length;
  const priorityCount = contacts.filter(c => c.status === "priority").length;
  const dormantCount  = contacts.filter(c => c.status === "dormant").length;

  const allTags = useMemo(
    () => [...new Set(contacts.flatMap(c => c.tags))].sort(),
    [contacts],
  );

  function toggleSector(sector: string) {
    setSelectedSectors(prev => {
      const next = new Set(prev);
      if (next.has(sector)) next.delete(sector); else next.add(sector);
      return next;
    });
  }

  function handleSaveContact(updated: Contact) {
    setContacts(prev => prev.map(c => c.id === updated.id ? updated : c));
    setSelectedContact(updated);
  }

  function handleDeleteContact(id: number) {
    setContacts(prev => prev.filter(c => c.id !== id));
    setSelectedContact(null);
  }

  function handleSaveEditor(palettes: SectorPalette[], you: YouColors) {
    setSectorPalettes(palettes);
    setYouColors(you);
  }

  // ── CSV import / export ─────────────────────────────────────────────────────
  const csvFileRef = useRef<HTMLInputElement>(null);
  const [importFeedback, setImportFeedback] = useState<string>("");
  const [importPlan,     setImportPlan]     = useState<ImportPlan | null>(null);

  function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const text     = ev.target?.result as string;
      const current  = contactsRef.current;
      const startId  = current.length > 0
        ? Math.max(...current.map(c => c.id)) + 1
        : 1;
      const plan = buildImportPlan(text, current, startId);
      setImportPlan(plan);
    };
    e.target.value = ""; // reset so the same file can be re-selected later
    reader.readAsText(file);
  }

  function handleConfirmImport(plan: ImportPlan) {
    const { toImport, skippedNoName, skippedDuplicates } = plan;

    if (toImport.length > 0) {
      setContacts(prev => [...prev, ...toImport.map(p => p.contact)]);
      // Palette auto-assignment is handled by the contacts-change useEffect above.
    }

    // Console log skipped rows for debugging
    if (skippedNoName.length > 0)
      console.warn("[CSV Import] Skipped (no name):",
        skippedNoName.map(r => r.hint).join(" | "));
    if (skippedDuplicates.length > 0)
      console.warn("[CSV Import] Skipped (duplicates):",
        skippedDuplicates.map(r => r.hint).join(" | "));

    // Build feedback message
    const parts: string[] = [];
    if (toImport.length > 0)
      parts.push(`Imported ${toImport.length} contact${toImport.length !== 1 ? "s" : ""}.`);
    else
      parts.push("No contacts imported.");
    if (skippedNoName.length > 0)
      parts.push(`Skipped ${skippedNoName.length} missing name.`);
    if (skippedDuplicates.length > 0)
      parts.push(`Skipped ${skippedDuplicates.length} duplicate${skippedDuplicates.length !== 1 ? "s" : ""}.`);

    setImportFeedback(parts.join(" "));
    setTimeout(() => setImportFeedback(""), 6000);
  }

  function handleExport() {
    const csv  = exportContactsToCSV(contactsRef.current);
    const date = new Date().toISOString().slice(0, 10);
    downloadCSV(csv, `myweb-contacts-${date}.csv`);
  }

  function handleExportFiltered() {
    const csv  = exportContactsToCSV(filteredContactsRef.current);
    const date = new Date().toISOString().slice(0, 10);
    downloadCSV(csv, `myweb-contacts-filtered-${date}.csv`);
  }

  // ── Expose CSV actions to parent via ref ─────────────────────────────────────
  useImperativeHandle(ref, () => ({
    triggerImport:  () => csvFileRef.current?.click(),
    exportAll:      handleExport,
    exportFiltered: handleExportFiltered,
  }));

  // ── Build graph — runs once, after hydration completes ──────────────────────
  // Depends on hasHydrated so it fires on the second render (with localStorage
  // data) rather than the first (with seed defaults). Since hasHydrated flips
  // only once (false → true), this effect still runs exactly once.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!hasHydrated || !containerRef.current) return;

    let vn: VN | null = null;

    const init = async () => {
      const { DataSet, Network } = await import("vis-network/standalone");

      const initialContacts = contactsRef.current;

      const getPalette = (sector: string) =>
        sectorPalettesRef.current.find(p => p.name === sector) ?? { bg: "#020617", border: "#cbd5e1" };

      const nodes: Array<Record<string, unknown>> = [
        {
          id: "self", label: "You", shape: "dot", size: 36,
          color: { background: youColorsRef.current.fill, border: youColorsRef.current.border },
          font: { color: youColorsRef.current.text, size: 18 },
          borderWidth: 3,
        },
        ...initialContacts.map((c, i) => {
          const pal = getPalette(c.sector);
          return {
            id: `contact-${c.id ?? i + 1}`,
            label: c.name,
            shape: "dot", size: 12,
            color: { background: pal.bg, border: pal.border },
            font: { color: "#ffffff", size: 12 },
            borderWidth: 2,
          };
        }),
      ];

      const nodesData = new DataSet(nodes) as unknown as NodeDS;
      const edgesData = new DataSet([])   as unknown as EdgeDS;
      nodesDataRef.current = nodesData;
      edgesDataRef.current = edgesData;

      const initResult = applyGraphStructure(
        nodesDataRef.current,
        edgesDataRef.current,
        initialContacts,
        [],
        null,
        getPalette,
      );
      companyNodeIdsRef.current    = initResult.companyNodeIds;
      groupedContactIdsRef.current = initResult.groupedContactIds;

      const options = {
        autoResize: true,
        height: "100%",
        width: "100%",
        interaction: { hover: true, navigationButtons: true, keyboard: true },
        physics: {
          enabled: true,
          solver: "barnesHut",
          barnesHut: {
            // Moderate repulsion keeps nodes apart without explosive force.
            gravitationalConstant: -3500,
            // No central gravity — nodes settle freely in space.
            centralGravity: 0.0,
            springLength: 140,
            springConstant: 0.04,
            // High damping → quick settling, no oscillation or jitter.
            damping: 0.88,
            avoidOverlap: 0.9,
          },
          stabilization: {
            enabled: true,
            iterations: 250,
            fit: true,
            updateInterval: 25,
          },
          // Smaller timestep = more stable simulation.
          timestep: 0.3,
          adaptiveTimestep: true,
          // Physics auto-pauses when all nodes move less than this per step.
          minVelocity: 0.75,
        },
        layout: { improvedLayout: true },
      };

      const rawNetwork = new Network(
        containerRef.current!,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { nodes: nodesData as any, edges: edgesData as any },
        options,
      );

      vn = rawNetwork as unknown as VN;
      networkRef.current = vn;

      // After initial layout: pin "You" in place. Physics stays enabled so
      // dragging produces live magnetic repulsion on nearby nodes.
      vn.once("stabilized", () => {
        nodesData.update([{ id: "self", fixed: { x: true, y: true } }]);
      });

      function toggleCompanyExpand(cNodeId: string) {
        const company = cNodeId.replace("company-", "");
        const isExpanded = expandedCompaniesRef.current.has(cNodeId);

        if (isExpanded) {
          expandedCompaniesRef.current.delete(cNodeId);
        } else {
          expandedCompaniesRef.current.add(cNodeId);
        }

        const expanding = expandedCompaniesRef.current.has(cNodeId);
        const allContacts = contactsRef.current;
        const nextHidden = new Set<string>(hiddenNodesRef.current);

        // Gather members for this company in order.
        const members = allContacts
          .map((c, i) => ({ c, contactId: `contact-${c.id ?? i + 1}` }))
          .filter(({ c }) => c.company.trim() === company);

        if (expanding) {
          // Place contacts at evenly-spaced orbit positions around the company
          // node before unhiding them, so they appear in a clean ring rather
          // than all stacking at the same point.
          const companyPos  = vn!.getPositions([cNodeId])[cNodeId] ?? { x: 0, y: 0 };
          const companySize = getCompanyNodeSize(members.length);
          const positions   = orbitPositions(companyPos, members.length, companySize);

          members.forEach(({ c, contactId }, i) => {
            const sectorFiltered =
              selectedSectorsRef.current.size > 0 &&
              !selectedSectorsRef.current.has(c.sector);

            if (sectorFiltered) {
              nextHidden.add(contactId);
              nodesData.update([{ id: contactId, hidden: true }]);
              edgesData.update([{ id: `edge-${cNodeId}-${contactId}`, hidden: true }]);
            } else {
              nextHidden.delete(contactId);
              // Set orbit position first so the node appears at the right spot.
              nodesData.update([{
                id: contactId,
                x: positions[i].x,
                y: positions[i].y,
                hidden: false,
              }]);
              edgesData.update([{ id: `edge-${cNodeId}-${contactId}`, hidden: false }]);
            }
          });
        } else {
          // Collapsing — hide all member contacts.
          members.forEach(({ contactId }) => {
            nextHidden.add(contactId);
            nodesData.update([{ id: contactId, hidden: true }]);
            edgesData.update([{ id: `edge-${cNodeId}-${contactId}`, hidden: true }]);
          });
        }

        hiddenNodesRef.current = nextHidden;
      }

      vn.on("click", (params) => {
        const p = params as { nodes: string[] };
        const clickedId = p.nodes[0];

        if (!clickedId) {
          setSelectedContact(null);
          return;
        }

        const id = String(clickedId);

        if (id.startsWith("company-")) {
          toggleCompanyExpand(id);
          return;
        }

        if (!id.startsWith("contact-")) {
          setSelectedContact(null);
          return;
        }

        const rawId = id.replace("contact-", "");
        const found = contactsRef.current.find(c => String(c.id) === rawId) ?? null;
        if (found) setSelectedContact(found);
      });

      // AfterDrawing — crater + Saturn ring overlays.
      // Use contactsRef.current (not a closed-over snapshot) so that contacts
      // imported after graph-init are included in every redraw.
      vn.on("afterDrawing", (ctx) => {
        const canvas = ctx as CanvasRenderingContext2D;
        const liveContactNodeIds = contactsRef.current.map((c, i) => `contact-${c.id ?? i + 1}`);
        const allIds = [...liveContactNodeIds, ...companyNodeIdsRef.current];
        const positions = vn!.getPositions(allIds);

        liveContactNodeIds.forEach(nodeId => {
          if (hiddenNodesRef.current.has(nodeId)) return;
          const pos = positions[nodeId];
          if (!pos) return;
          drawCraters(canvas, pos.x, pos.y, 12, nodeId);
        });

        companyNodeIdsRef.current.forEach(nodeId => {
          const pos = positions[nodeId];
          if (!pos) return;
          const company     = nodeId.replace("company-", "");
          const members     = contactsRef.current.filter(c => c.company.trim() === company);
          const nodeRadius  = getCompanyNodeSize(members.length);
          const sector      = members[0]?.sector;
          const pal = sector
            ? (sectorPalettesRef.current.find(p => p.name === sector) ?? { bg: "#1e293b", border: "#94a3b8" })
            : { bg: "#1e293b", border: "#94a3b8" };
          drawSaturnRing(canvas, pos.x, pos.y, nodeRadius, pal.bg, pal.border);
          drawCraters(canvas, pos.x, pos.y, nodeRadius, nodeId, members.length);
        });
      });
    };

    init();
    return () => { vn?.destroy(); };
  }, [hasHydrated]); // fires once when hydration flips true; ESLint disable above covers this

  // ── Structural rebuild when contacts change (company grouping) ───────────────
  useEffect(() => {
    if (!nodesDataRef.current || !edgesDataRef.current) return;

    const getPalette = (sector: string) =>
      sectorPalettesRef.current.find(p => p.name === sector) ?? { bg: "#020617", border: "#cbd5e1" };

    // Patch existing contact nodes; add new ones (e.g. from CSV import) with
    // the full planet-style definition so they match manually created contacts.
    contacts.forEach((c, i) => {
      const pal    = getPalette(c.sector);
      const nodeId = `contact-${c.id ?? i + 1}`;
      if (nodesDataRef.current!.get(nodeId)) {
        // Node already in DataSet — patch only the fields that can change.
        nodesDataRef.current!.update([{
          id: nodeId,
          label: c.name,
          color: { background: pal.bg, border: pal.border },
        }]);
      } else {
        // Node does not exist yet (imported after graph init) — add it with the
        // exact same properties used during initial graph construction.
        nodesDataRef.current!.add([{
          id: nodeId,
          label: c.name,
          shape: "dot", size: 12,
          color: { background: pal.bg, border: pal.border },
          font: { color: "#ffffff", size: 12 },
          borderWidth: 2,
        }]);
      }
    });

    const sig = contacts.map(c => `${c.id}:${c.company.trim()}`).join("|");
    if (sig === prevGroupSigRef.current) return;
    prevGroupSigRef.current = sig;

    expandedCompaniesRef.current = new Set();

    const result = applyGraphStructure(
      nodesDataRef.current,
      edgesDataRef.current,
      contacts,
      companyNodeIdsRef.current,
      networkRef.current,
      getPalette,
    );
    companyNodeIdsRef.current    = result.companyNodeIds;
    groupedContactIdsRef.current = result.groupedContactIds;
  }, [contacts]);

  // ── Sync graph node colors when sector palettes change ───────────────────────
  useEffect(() => {
    if (!nodesDataRef.current) return;

    const getPalette = (sector: string) =>
      sectorPalettes.find(p => p.name === sector) ?? { bg: "#020617", border: "#cbd5e1" };

    const updates: Array<Record<string, unknown>> = contacts.map((c, i) => {
      const pal = getPalette(c.sector);
      return { id: `contact-${c.id ?? i + 1}`, color: { background: pal.bg, border: pal.border } };
    });

    companyNodeIdsRef.current.forEach(cNodeId => {
      const company     = cNodeId.replace("company-", "");
      const members     = contacts.filter(c => c.company.trim() === company);
      const sector      = members[0]?.sector;
      if (!sector) return;
      const pal      = getPalette(sector);
      const nodeSize = getCompanyNodeSize(members.length);
      updates.push({ id: cNodeId, size: nodeSize, color: { background: pal.bg, border: pal.border }, font: { color: pal.border, size: 11 } });
    });

    nodesDataRef.current.update(updates);
  }, [sectorPalettes, contacts]);

  // ── Sync "You" node colors ───────────────────────────────────────────────────
  useEffect(() => {
    if (!nodesDataRef.current) return;
    nodesDataRef.current.update([{
      id: "self",
      color: { background: youColors.fill, border: youColors.border },
      font: { color: youColors.text, size: 18 },
    }]);
  }, [youColors]);

  // ── Visibility sync (sector filter + company grouping state) ─────────────────
  useEffect(() => {
    if (!nodesDataRef.current || !edgesDataRef.current) return;

    const nextHidden = new Set<string>();
    const nodeUpdates = contacts.map((c, i) => {
      const id = `contact-${c.id ?? i + 1}`;
      const sectorFiltered = selectedSectors.size > 0 && !selectedSectors.has(c.sector);
      const companyId = `company-${c.company.trim()}`;
      const inCollapsedGroup =
        groupedContactIdsRef.current.has(id) &&
        !expandedCompaniesRef.current.has(companyId);
      const hidden = sectorFiltered || inCollapsedGroup;
      if (hidden) nextHidden.add(id);
      return { id, hidden };
    });

    hiddenNodesRef.current = nextHidden;
    nodesDataRef.current.update(nodeUpdates);

    contacts.forEach((c, i) => {
      const contactId = `contact-${c.id ?? i + 1}`;
      if (!groupedContactIdsRef.current.has(contactId)) return;
      const companyId = `company-${c.company.trim()}`;
      const isExpanded = expandedCompaniesRef.current.has(companyId);
      const sectorFiltered = selectedSectors.size > 0 && !selectedSectors.has(c.sector);
      edgesDataRef.current!.update([{
        id: `edge-${companyId}-${contactId}`,
        hidden: !isExpanded || sectorFiltered,
      }]);
    });
  }, [selectedSectors, contacts]);

  // ── JSX ─────────────────────────────────────────────────────────────────────

  return (
    <div className="h-full w-full flex bg-transparent">

      {/* Sector editor modal */}
      {editorOpen && (
        <SectorEditorModal
          sectorPalettes={sectorPalettes}
          youColors={youColors}
          onSave={handleSaveEditor}
          onClose={onCloseEditor}
        />
      )}

      {/* CSV import preview modal */}
      {importPlan && (
        <ImportPreviewModal
          plan={importPlan}
          onConfirm={() => handleConfirmImport(importPlan)}
          onClose={() => setImportPlan(null)}
        />
      )}

      {/* Graph canvas */}
      <div className="flex-1 min-h-0 min-w-0" ref={containerRef} />

      {/* Right sidebar */}
      <div className="w-80 shrink-0 border-l border-slate-800 bg-[#111827] flex flex-col overflow-hidden">

        {/* Search */}
        <div className="p-4 border-b border-slate-800 shrink-0">
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search contacts or companies…"
            className="w-full bg-slate-800 text-white text-sm px-3 py-2 rounded border border-slate-700 placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />
        </div>

        {/* Hidden CSV file input — triggered from the Options dropdown in the header */}
        <input
          ref={csvFileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={handleImport}
        />

        {/* Import feedback notification */}
        {importFeedback && (
          <div className="px-4 py-2 border-b border-slate-800 shrink-0">
            <p className="text-[10px] text-emerald-400 leading-snug">{importFeedback}</p>
          </div>
        )}

        {/* Summary */}
        <div className="px-4 pt-4 pb-2 shrink-0">
          <h4 className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">Summary</h4>
        </div>
        <div className="grid grid-cols-2 gap-2 px-4 pb-4 border-b border-slate-800 shrink-0">
          <SummaryCard label="Contacts" value={contacts.length} />
          <SummaryCard label="Priority" value={priorityCount} valueClass="text-amber-400" />
          <SummaryCard label="Active"   value={activeCount}   valueClass="text-emerald-400" />
          <SummaryCard label="Dormant"  value={dormantCount}  valueClass="text-slate-400" />
        </div>

        {/* Sector filter pills */}
        <div className="px-4 pt-4 pb-2 shrink-0">
          <h4 className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">
            Filter by Sector ({sectors.length})
          </h4>
        </div>
        <div className="flex flex-wrap gap-2 px-4 pb-4 border-b border-slate-800 shrink-0">
          {sectors.map(sector => {
            const active  = selectedSectors.has(sector);
            const palette = sectorPalettes.find(p => p.name === sector);
            return (
              <button
                key={sector}
                onClick={() => toggleSector(sector)}
                className="px-3 py-1 rounded-full text-[11px] font-medium border transition-colors"
                style={active ? {
                  backgroundColor: palette?.bg ?? "#2563eb",
                  borderColor:     palette?.border ?? "#3b82f6",
                  color:           "#ffffff",
                  boxShadow:       `0 0 0 1px ${palette?.border ?? "#3b82f6"}40`,
                } : {
                  backgroundColor: (palette?.bg ?? "#1e293b") + "33",
                  borderColor:     (palette?.border ?? "#64748b") + "70",
                  color:           palette?.border ?? "#94a3b8",
                }}
              >
                {sector}
              </button>
            );
          })}
        </div>

        {/* Contact list */}
        {!selectedContact && (
          <div className="flex-1 overflow-y-auto">
            <div className="px-4 pt-4 pb-2">
              <h4 className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">
                Contacts ({filteredContacts.length})
              </h4>
            </div>
            <div className="flex flex-col">
              {filteredContacts.map(contact => (
                <button
                  key={contact.id}
                  onClick={() => setSelectedContact(contact)}
                  className="w-full text-left px-4 py-2.5 flex flex-col gap-0.5 border-b border-slate-800/60 hover:bg-slate-800/40 transition-colors"
                >
                  <span className="text-xs font-medium text-white leading-tight">{contact.name}</span>
                  <span className="text-[10px] text-slate-500 leading-tight">
                    {contact.company}&nbsp;&middot;&nbsp;{contact.sector}
                  </span>
                </button>
              ))}
              {filteredContacts.length === 0 && (
                <p className="px-4 py-4 text-xs text-slate-600">No contacts match the active filters.</p>
              )}
            </div>
          </div>
        )}

        {/* Selected contact details */}
        {selectedContact && (
          <div className="flex-1 overflow-y-auto">
            <ContactPanel
              contact={selectedContact}
              allTags={allTags}
              sectors={sectors}
              onBack={() => setSelectedContact(null)}
              onSave={handleSaveContact}
              onDelete={() => handleDeleteContact(selectedContact.id)}
            />
          </div>
        )}
      </div>
    </div>
  );
});

export default NetworkCanvas;
