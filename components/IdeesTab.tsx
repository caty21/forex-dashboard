"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { TvAdvancedChart } from "./TvChart";

// ── Constantes ────────────────────────────────────────────────────────────────

const INTERVALS: { v: string; l: string }[] = [
  { v: "60", l: "1h" }, { v: "240", l: "4h" },
  { v: "D",  l: "1J" }, { v: "W",   l: "1S" },
];

const QUICK_SYMBOLS = [
  { label: "EUR/USD", value: "FX:EURUSD" },
  { label: "GBP/USD", value: "FX:GBPUSD" },
  { label: "USD/JPY", value: "FX:USDJPY" },
  { label: "AUD/USD", value: "FX:AUDUSD" },
  { label: "NZD/USD", value: "FX:NZDUSD" },
  { label: "USD/CAD", value: "FX:USDCAD" },
  { label: "USD/CHF", value: "FX:USDCHF" },
  { label: "EUR/GBP", value: "FX:EURGBP" },
  { label: "EUR/JPY", value: "FX:EURJPY" },
  { label: "GBP/JPY", value: "FX:GBPJPY" },
  { label: "S&P 500", value: "FOREXCOM:SPXUSD" },
  { label: "DXY",     value: "CAPITALCOM:DXY" },
  { label: "Or",      value: "TVC:GOLD" },
  { label: "VIX",     value: "PEPPERSTONE:VIX" },
  { label: "BTC/USD", value: "BINANCE:BTCUSDT" },
];

// ── Types ─────────────────────────────────────────────────────────────────────

interface NoteImage { id: string; dataUrl: string; }

interface SlotState {
  symbol:   string;
  interval: string;
  title:    string;
  notes:    string;
  images:   NoteImage[];
}

interface Archive {
  id:      string;
  savedAt: string;
  slot:    SlotState;
}

// ── LocalStorage helpers ──────────────────────────────────────────────────────

const LS_SLOTS    = "ideas_slots_v1";
const LS_ARCHIVES = "ideas_archives_v1";

function loadLS<T>(key: string, fb: T): T {
  if (typeof window === "undefined") return fb;
  try { const r = localStorage.getItem(key); return r ? JSON.parse(r) as T : fb; } catch { return fb; }
}
function saveLS(key: string, val: unknown) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

const DEFAULT_SLOT = (symbol = "FX:EURUSD"): SlotState => ({
  symbol, interval: "240", title: "", notes: "", images: [],
});

// ── NotePane ──────────────────────────────────────────────────────────────────

function NotePane({ slot, onChange }: { slot: SlotState; onChange: (s: SlotState) => void }) {
  const [expanded, setExpanded] = useState(false);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const imgItem = Array.from(e.clipboardData.items).find(i => i.type.startsWith("image/"));
    if (!imgItem) return;
    e.preventDefault();
    const file = imgItem.getAsFile();
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const dataUrl = ev.target?.result as string;
      onChange({ ...slot, images: [...slot.images, { id: Date.now().toString(), dataUrl }] });
    };
    reader.readAsDataURL(file);
  }, [slot, onChange]);

  return (
    <>
      {/* Overlay expanded */}
      {expanded && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6" onClick={() => setExpanded(false)}>
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5 w-full max-w-3xl max-h-[90vh] overflow-auto shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-semibold text-slate-300">{slot.title || slot.symbol}</span>
              <button onClick={() => setExpanded(false)} className="text-slate-500 hover:text-white text-sm">✕</button>
            </div>
            <textarea
              className="w-full bg-slate-800/60 border border-slate-700/40 rounded-lg p-3 text-[12px] text-slate-200 outline-none resize-none focus:border-slate-500 h-[50vh]"
              value={slot.notes}
              onChange={e => onChange({ ...slot, notes: e.target.value })}
              onPaste={handlePaste}
              placeholder="Notes…"
            />
            {slot.images.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-3">
                {slot.images.map(img => (
                  <div key={img.id} className="relative group">
                    <img src={img.dataUrl} alt="" className="h-28 w-auto rounded-lg border border-slate-700/40 object-cover" />
                    <button
                      onClick={() => onChange({ ...slot, images: slot.images.filter(i => i.id !== img.id) })}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 rounded-full text-white text-[9px] hidden group-hover:flex items-center justify-center"
                    >✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Inline note */}
      <div className="flex flex-col h-full gap-2">
        <input
          className="bg-transparent border-b border-slate-700/50 text-[10px] text-slate-300 placeholder-slate-600 outline-none pb-1 shrink-0"
          placeholder="Titre / hypothèse…"
          value={slot.title}
          onChange={e => onChange({ ...slot, title: e.target.value })}
        />
        <textarea
          className="flex-1 bg-slate-800/30 border border-slate-700/30 rounded-lg p-2.5 text-[10px] text-slate-300 placeholder-slate-600 outline-none resize-none focus:border-slate-600 transition-all min-h-[100px]"
          placeholder={"Notes, niveaux clés…\nCtrl+V pour coller une image"}
          value={slot.notes}
          onChange={e => onChange({ ...slot, notes: e.target.value })}
          onPaste={handlePaste}
        />
        {/* Thumbnails */}
        {slot.images.length > 0 && (
          <div className="flex flex-wrap gap-1 shrink-0">
            {slot.images.map(img => (
              <div key={img.id} className="relative group">
                <img src={img.dataUrl} alt="" className="h-12 w-auto rounded border border-slate-700/40 object-cover" />
                <button
                  onClick={() => onChange({ ...slot, images: slot.images.filter(i => i.id !== img.id) })}
                  className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-white text-[8px] hidden group-hover:flex items-center justify-center"
                >✕</button>
              </div>
            ))}
          </div>
        )}
        {/* Expand button */}
        <button
          onClick={() => setExpanded(true)}
          className="text-[8px] text-slate-600 hover:text-sky-400 transition-colors self-end shrink-0"
        >
          ↗ Agrandir
        </button>
      </div>
    </>
  );
}

// ── SymbolPicker ──────────────────────────────────────────────────────────────

function SymbolPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [input, setInput]   = useState(value);
  const [open, setOpen]     = useState(false);
  const ref                 = useRef<HTMLDivElement>(null);

  useEffect(() => { setInput(value); }, [value]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const apply = () => {
    const s = input.trim().toUpperCase();
    if (!s) return;
    onChange(s.includes(":") ? s : `FX:${s}`);
    setOpen(false);
  };

  const filtered = QUICK_SYMBOLS.filter(s =>
    s.label.toLowerCase().includes(input.toLowerCase()) ||
    s.value.toLowerCase().includes(input.toLowerCase())
  );

  return (
    <div ref={ref} className="relative flex-1 min-w-0">
      <input
        className="bg-slate-700/40 border border-slate-700/50 rounded px-2 py-1 text-[10px] text-slate-200 outline-none w-full font-mono focus:border-slate-500 transition-colors"
        value={input}
        onChange={e => { setInput(e.target.value); setOpen(true); }}
        onKeyDown={e => e.key === "Enter" && apply()}
        onFocus={() => setOpen(true)}
        placeholder="EURUSD, FX:GBPUSD…"
      />
      {open && filtered.length > 0 && (
        <div className="absolute top-full left-0 mt-1 z-30 bg-slate-800 border border-slate-700 rounded-lg shadow-xl w-full min-w-[200px] py-1 max-h-48 overflow-y-auto">
          {filtered.map(s => (
            <button
              key={s.value}
              className="w-full text-left px-3 py-1.5 flex items-center justify-between text-[10px] hover:bg-slate-700 transition-colors"
              onMouseDown={e => { e.preventDefault(); onChange(s.value); setInput(s.value); setOpen(false); }}
            >
              <span className="text-slate-200">{s.label}</span>
              <span className="text-slate-600 text-[8px] font-mono">{s.value}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── ResearchSlot ──────────────────────────────────────────────────────────────

function ResearchSlot({
  slot, label, onChange, onArchive,
}: {
  slot:      SlotState;
  label:     string;
  onChange:  (s: SlotState) => void;
  onArchive: () => void;
}) {
  return (
    <div className="border border-slate-700/30 rounded-xl overflow-hidden bg-slate-800/10">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-slate-800/50 border-b border-slate-700/30">
        <span className="text-[8px] font-bold text-slate-600 uppercase tracking-widest shrink-0">{label}</span>
        <SymbolPicker value={slot.symbol} onChange={symbol => onChange({ ...slot, symbol })} />
        {/* Interval */}
        <div className="flex gap-0.5 shrink-0">
          {INTERVALS.map(iv => (
            <button
              key={iv.v}
              onClick={() => onChange({ ...slot, interval: iv.v })}
              className={`text-[8px] px-1.5 py-0.5 rounded font-mono transition-colors ${
                slot.interval === iv.v
                  ? "bg-sky-500/20 text-sky-400 border border-sky-500/30"
                  : "text-slate-600 hover:text-slate-400"
              }`}
            >{iv.l}</button>
          ))}
        </div>
        {/* Archive */}
        <button
          onClick={onArchive}
          className="ml-auto shrink-0 text-[8px] text-slate-600 hover:text-amber-400 border border-slate-700/40 hover:border-amber-500/30 px-2 py-1 rounded transition-colors flex items-center gap-1"
          title="Archiver et libérer l'espace"
        >
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/>
          </svg>
          Archiver
        </button>
      </div>

      {/* Chart + Notes */}
      <div className="grid grid-cols-[3fr_2fr]">
        {/* Chart */}
        <div className="border-r border-slate-700/30">
          <TvAdvancedChart
            key={`${slot.symbol}_${slot.interval}`}
            symbol={slot.symbol}
            interval={slot.interval}
            height={380}
          />
        </div>
        {/* Notes */}
        <div className="p-3 flex flex-col" style={{ minHeight: 380 }}>
          <NotePane slot={slot} onChange={onChange} />
        </div>
      </div>
    </div>
  );
}

// ── Archives panel ────────────────────────────────────────────────────────────

function ArchivesPanel({ archives, onDelete }: { archives: Archive[]; onDelete: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  if (!archives.length) return null;

  return (
    <div className="border border-slate-700/30 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-800/40 text-[10px] text-slate-400 hover:text-slate-200 transition-colors"
      >
        <span className="flex items-center gap-2">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/>
          </svg>
          Archives — {archives.length} recherche{archives.length > 1 ? "s" : ""}
        </span>
        <span className="text-slate-600">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="divide-y divide-slate-700/20">
          {archives.map(a => (
            <div key={a.id} className="px-4 py-3 flex items-start justify-between gap-4 hover:bg-slate-800/20 transition-colors">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[10px] font-semibold text-slate-300 font-mono">{a.slot.symbol}</span>
                  <span className="text-[8px] text-slate-600 border border-slate-700/50 rounded px-1">{a.slot.interval}</span>
                  {a.slot.title && <span className="text-[9px] text-slate-400 truncate">{a.slot.title}</span>}
                </div>
                <p className="text-[8px] text-slate-600">
                  {new Date(a.savedAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                </p>
                {a.slot.notes && (
                  <p className="text-[9px] text-slate-500 mt-1 line-clamp-2 max-w-xl">{a.slot.notes}</p>
                )}
                {a.slot.images.length > 0 && (
                  <div className="flex gap-1 mt-1.5">
                    {a.slot.images.slice(0, 4).map(img => (
                      <img key={img.id} src={img.dataUrl} alt="" className="h-8 w-auto rounded border border-slate-700/40 object-cover" />
                    ))}
                    {a.slot.images.length > 4 && (
                      <span className="text-[8px] text-slate-600 self-end">+{a.slot.images.length - 4}</span>
                    )}
                  </div>
                )}
              </div>
              <button
                onClick={() => onDelete(a.id)}
                className="text-[8px] text-red-500/40 hover:text-red-400 shrink-0 transition-colors mt-0.5"
              >Supprimer</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── IdeesTab (export) ─────────────────────────────────────────────────────────

export default function IdeesTab() {
  const [slots, setSlots] = useState<[SlotState, SlotState]>([
    DEFAULT_SLOT("FX:EURUSD"),
    DEFAULT_SLOT("FX:GBPUSD"),
  ]);
  const [archives, setArchives] = useState<Archive[]>([]);

  useEffect(() => {
    setSlots(loadLS<[SlotState, SlotState]>(LS_SLOTS, [DEFAULT_SLOT("FX:EURUSD"), DEFAULT_SLOT("FX:GBPUSD")]));
    setArchives(loadLS<Archive[]>(LS_ARCHIVES, []));
  }, []);

  const updateSlot = useCallback((idx: 0 | 1, s: SlotState) => {
    setSlots(prev => {
      const next: [SlotState, SlotState] = [prev[0], prev[1]];
      next[idx] = s;
      saveLS(LS_SLOTS, next);
      return next;
    });
  }, []);

  const archiveSlot = useCallback((idx: 0 | 1) => {
    const entry: Archive = { id: Date.now().toString(), savedAt: new Date().toISOString(), slot: slots[idx] };
    const next = [entry, ...archives];
    setArchives(next);
    saveLS(LS_ARCHIVES, next);
    const reset = DEFAULT_SLOT(idx === 0 ? "FX:EURUSD" : "FX:GBPUSD");
    setSlots(prev => {
      const n: [SlotState, SlotState] = [prev[0], prev[1]];
      n[idx] = reset;
      saveLS(LS_SLOTS, n);
      return n;
    });
  }, [slots, archives]);

  const deleteArchive = useCallback((id: string) => {
    const next = archives.filter(a => a.id !== id);
    setArchives(next);
    saveLS(LS_ARCHIVES, next);
  }, [archives]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="h-px flex-1 bg-purple-500/20" />
        <span className="text-purple-400 text-xs font-bold uppercase tracking-[0.3em]">Espace Idées · 2 recherches</span>
        <div className="h-px flex-1 bg-purple-500/20" />
      </div>

      <ResearchSlot slot={slots[0]} label="Recherche A" onChange={s => updateSlot(0, s)} onArchive={() => archiveSlot(0)} />
      <ResearchSlot slot={slots[1]} label="Recherche B" onChange={s => updateSlot(1, s)} onArchive={() => archiveSlot(1)} />

      <ArchivesPanel archives={archives} onDelete={deleteArchive} />
    </div>
  );
}
