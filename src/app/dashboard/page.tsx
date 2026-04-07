"use client";

import { useRef, useState } from "react";
import NetworkCanvas, { type NetworkCanvasHandle } from "@/components/network/NetworkCanvas";

export default function DashboardPage() {
  const [editorOpen, setEditorOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const canvasRef = useRef<NetworkCanvasHandle>(null);

  const ITEM = "w-full text-left px-4 py-2.5 text-xs text-slate-300 hover:bg-slate-800 hover:text-white transition-colors";
  const DIVIDER = "border-t border-slate-800 my-1";

  function closeOptions() { setOptionsOpen(false); }

  return (
    <main className="flex h-screen flex-col bg-slate-950 text-white">
      <header
        className="flex shrink-0 items-center justify-between border-b border-slate-800 px-8 py-4"
        style={{ background: "#111827" }}
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
    </main>
  );
}
