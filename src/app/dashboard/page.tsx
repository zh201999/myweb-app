"use client";

import { useRef, useState, useEffect } from "react";
import NetworkCanvas, { type NetworkCanvasHandle } from "@/components/network/NetworkCanvas";

// ── Space background helpers ───────────────────────────────────────────────────

function seededRng(seed: string) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return function () {
    h ^= h >>> 13;
    h  = Math.imul(h, 1540483477) >>> 0;
    h ^= h >>> 15;
    return (h >>> 0) / 0xffffffff;
  };
}

function drawSpaceBackground(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;

  ctx.fillStyle = "#06091a";
  ctx.fillRect(0, 0, w, h);

  const purpleGrad = ctx.createRadialGradient(w * 0.22, h * 0.48, 0, w * 0.22, h * 0.48, w * 0.62);
  purpleGrad.addColorStop(0,    "rgba(90, 26, 160, 0.22)");
  purpleGrad.addColorStop(0.35, "rgba(90, 26, 160, 0.10)");
  purpleGrad.addColorStop(1,    "rgba(90, 26, 160, 0)");
  ctx.fillStyle = purpleGrad;
  ctx.fillRect(0, 0, w, h);

  const tealGrad = ctx.createRadialGradient(w * 0.78, h * 0.52, 0, w * 0.78, h * 0.52, w * 0.58);
  tealGrad.addColorStop(0,    "rgba(20, 180, 168, 0.18)");
  tealGrad.addColorStop(0.35, "rgba(20, 180, 168, 0.08)");
  tealGrad.addColorStop(1,    "rgba(20, 180, 168, 0)");
  ctx.fillStyle = tealGrad;
  ctx.fillRect(0, 0, w, h);

  const bands = [
    { cx: w * 0.18, hw: w * 0.10, color: "rgba(110, 30, 200, 0.065)" },
    { cx: w * 0.42, hw: w * 0.09, color: "rgba(50, 110, 210, 0.040)" },
    { cx: w * 0.70, hw: w * 0.10, color: "rgba(20, 175, 158, 0.055)" },
  ];
  for (const b of bands) {
    const g = ctx.createLinearGradient(b.cx - b.hw, 0, b.cx + b.hw, 0);
    g.addColorStop(0,   "rgba(0,0,0,0)");
    g.addColorStop(0.5, b.color);
    g.addColorStop(1,   "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  const rng = seededRng("stars-v1");
  for (let i = 0; i < 130; i++) {
    const x     = rng() * w;
    const y     = rng() * h;
    const r     = rng() * 0.85 + 0.15;
    const alpha = rng() * 0.55 + 0.25;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(220, 235, 255, ${alpha.toFixed(2)})`;
    ctx.fill();
  }
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [editorOpen, setEditorOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const canvasRef = useRef<NetworkCanvasHandle>(null);
  const bgCanvasRef = useRef<HTMLCanvasElement>(null);

  const ITEM = "w-full text-left px-4 py-2.5 text-xs text-slate-300 hover:bg-slate-800 hover:text-white transition-colors";
  const DIVIDER = "border-t border-slate-800 my-1";

  function closeOptions() { setOptionsOpen(false); }

  // Draw the space background once on mount (and on window resize).
  useEffect(() => {
    const el = bgCanvasRef.current;
    if (!el) return;

    function resize() {
      if (!el) return;
      el.width  = window.innerWidth;
      el.height = window.innerHeight;
      drawSpaceBackground(el);
    }

    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  return (
    <main className="flex h-screen flex-col text-white" style={{ background: "#06091a" }}>

      {/* Fixed space-background canvas — behind everything */}
      <canvas
        ref={bgCanvasRef}
        style={{
          position: "fixed",
          inset: 0,
          width: "100vw",
          height: "100vh",
          zIndex: 0,
          pointerEvents: "none",
        }}
      />

      {/* All app content sits above the background */}
      <div className="relative flex flex-col h-full" style={{ zIndex: 1 }}>
        <header
          className="flex shrink-0 items-center justify-between border-b border-slate-800 px-8 py-4"
          style={{ background: "rgba(17, 24, 39, 0.85)", backdropFilter: "blur(4px)" }}
        >
          <h1 className="text-lg font-medium">MyWeb</h1>
          <div className="flex items-center gap-3">

            {/* Options dropdown */}
            <div className="relative">
              <button
                onClick={() => setOptionsOpen(o => !o)}
                className="px-3 py-1.5 rounded border border-slate-700 text-xs text-slate-300 hover:text-white hover:border-slate-500 transition-colors flex items-center gap-1.5"
              >
                Options
                <span className="text-[10px] text-slate-500">▾</span>
              </button>

              {optionsOpen && (
                <>
                  {/* Backdrop — closes dropdown on outside click */}
                  <div className="fixed inset-0 z-10" onClick={closeOptions} />

                  {/* Menu panel */}
                  <div className="absolute right-0 mt-1.5 z-20 w-52 bg-[#111827] border border-slate-700 rounded-lg shadow-2xl overflow-hidden py-1">

                    <button
                      className={ITEM}
                      onClick={() => { setEditorOpen(true); closeOptions(); }}
                    >
                      Edit Sectors
                    </button>

                    <div className={DIVIDER} />

                    <button
                      className={ITEM}
                      onClick={() => { canvasRef.current?.triggerImport(); closeOptions(); }}
                    >
                      Import CSV
                    </button>
                    <button
                      className={ITEM}
                      onClick={() => { canvasRef.current?.exportAll(); closeOptions(); }}
                    >
                      Export CSV (All)
                    </button>
                    <button
                      className={ITEM}
                      onClick={() => { canvasRef.current?.exportFiltered(); closeOptions(); }}
                    >
                      Export CSV (Filtered)
                    </button>
                  </div>
                </>
              )}
            </div>

            <div className="text-sm text-slate-400">Logged in</div>
          </div>
        </header>

        <div className="min-h-0 flex-1">
          <NetworkCanvas
            ref={canvasRef}
            editorOpen={editorOpen}
            onCloseEditor={() => setEditorOpen(false)}
          />
        </div>
      </div>
    </main>
  );
}
