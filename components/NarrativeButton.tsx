"use client";

import { useState } from "react";
import { Sparkles, X } from "lucide-react";
import type { Currency, BiasPhase } from "@/lib/types";

interface Props {
  currency: Currency;
  phase: BiasPhase;
  macroScore: number;
}

export default function NarrativeButton({ currency, phase, macroScore }: Props) {
  const [open, setOpen] = useState(false);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/narrative", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "summary",
          currency,
          data: { phase, macroScore },
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setAnalysis(data.analysis);
      setOpen(true);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        onClick={run}
        disabled={loading}
        className="flex items-center gap-1 text-[10px] text-indigo-600 hover:text-indigo-800 disabled:opacity-50"
      >
        <Sparkles size={11} />
        {loading ? "Analyse…" : "Résumé IA"}
      </button>

      {error && (
        <span className="text-[10px] text-red-500 truncate max-w-[160px]" title={error}>
          ⚠ {error.replace(/^Error:\s*/i, "").slice(0, 40)}
        </span>
      )}

      {open && analysis && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setOpen(false)}>
          <div
            className="bg-white rounded-xl shadow-xl max-w-sm w-full p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Sparkles size={15} className="text-indigo-500" />
                <span className="font-medium text-sm">Analyse {currency} — Groq AI</span>
              </div>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-700">
                <X size={15} />
              </button>
            </div>
            <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{analysis}</p>
            <div className="mt-3 text-[10px] text-gray-400 text-right">
              Powered by Groq · Llama 3.1 8B
            </div>
          </div>
        </div>
      )}
    </>
  );
}
