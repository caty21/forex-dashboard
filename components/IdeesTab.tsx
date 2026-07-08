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

interface SlotState {
  symbol:   string;
  interval: string;
  title:    string;
  notes:    string; // HTML (images inline en base64)
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
function saveLS(key: string, val: unknown): boolean {
  try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch { return false; }
}

const DEFAULT_SLOT = (symbol = "FX:EURUSD"): SlotState => ({
  symbol, interval: "240", title: "", notes: "",
});

// ── Toolbar de formatage ──────────────────────────────────────────────────────

const TOOLBAR_GROUPS = [
  [
    { cmd: "bold",      label: "B",   cls: "font-bold",  title: "Gras (Ctrl+B)" },
    { cmd: "italic",    label: "I",   cls: "italic",     title: "Italique (Ctrl+I)" },
    { cmd: "underline", label: "U",   cls: "underline",  title: "Souligné (Ctrl+U)" },
  ],
  [
    { cmd: "insertUnorderedList", label: "•",  cls: "", title: "Liste à puces" },
    { cmd: "insertOrderedList",   label: "1.", cls: "", title: "Liste numérotée" },
  ],
  [
    { cmd: "justifyLeft",   label: "⬱",  cls: "", title: "Aligner à gauche" },
    { cmd: "justifyCenter", label: "≡",  cls: "", title: "Centrer" },
    { cmd: "justifyRight",  label: "⬰",  cls: "", title: "Aligner à droite" },
  ],
];

function FormatToolbar({ editorRef, onSave, selImg, onResizeImg, onDeleteImg }: {
  editorRef: React.RefObject<HTMLDivElement>;
  onSave: () => void;
  selImg: HTMLImageElement | null;
  onResizeImg: (pct: number) => void;
  onDeleteImg: () => void;
}) {
  const exec = (cmd: string) => {
    editorRef.current?.focus();
    document.execCommand(cmd, false);
    onSave();
  };

  return (
    <div className="flex items-center gap-1 bg-slate-800/70 border border-slate-700/40 rounded-lg px-2 py-1 shrink-0 flex-wrap">
      {TOOLBAR_GROUPS.map((group, gi) => (
        <div key={gi} className="flex items-center gap-0.5">
          {gi > 0 && <div className="w-px h-3.5 bg-slate-700 mx-1" />}
          {group.map(b => (
            <button
              key={b.cmd}
              title={b.title}
              onMouseDown={e => { e.preventDefault(); exec(b.cmd); }}
              className={`w-6 h-6 rounded text-[10px] ${b.cls} text-slate-400 hover:text-white hover:bg-slate-600/60 transition-colors`}
            >{b.label}</button>
          ))}
        </div>
      ))}

      {/* Toolbar image si sélectionnée */}
      {selImg && (
        <>
          <div className="w-px h-3.5 bg-slate-700 mx-1" />
          <span className="text-[8px] text-slate-500">Image :</span>
          {[25, 40, 60, 80, 100].map(p => (
            <button key={p}
              onMouseDown={e => { e.preventDefault(); onResizeImg(p); }}
              className="text-[8px] px-1.5 py-0.5 rounded bg-slate-700/60 text-slate-300 hover:bg-sky-500/20 hover:text-sky-300 transition-colors"
            >{p}%</button>
          ))}
          <button
            onMouseDown={e => { e.preventDefault(); onDeleteImg(); }}
            className="text-[8px] text-red-400/60 hover:text-red-400 ml-1 transition-colors"
          >✕</button>
        </>
      )}
    </div>
  );
}

// ── RichEditor ────────────────────────────────────────────────────────────────

function RichEditor({
  html, onChange, className, style, showToolbar = true,
}: {
  html: string;
  onChange: (h: string) => void;
  className?: string;
  style?: React.CSSProperties;
  showToolbar?: boolean;
}) {
  const ref     = useRef<HTMLDivElement>(null);
  const skipRef = useRef(false);
  const [selImg, setSelImg] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!ref.current || ref.current.innerHTML === html) return;
    skipRef.current = true;
    ref.current.innerHTML = html;
  }, [html]);

  const save = useCallback(() => {
    if (skipRef.current) { skipRef.current = false; return; }
    onChange(ref.current?.innerHTML ?? "");
  }, [onChange]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const imgItem = Array.from(e.clipboardData.items).find(i => i.type.startsWith("image/"));
    if (!imgItem) return;
    e.preventDefault();
    const file = imgItem.getAsFile();
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const dataUrl = ev.target?.result as string;
      const img = document.createElement("img");
      img.src = dataUrl;
      img.style.width = "60%";
      img.style.maxWidth = "100%";
      img.style.borderRadius = "6px";
      img.style.display = "block";
      img.style.margin = "6px 0";
      img.style.cursor = "pointer";
      img.draggable = false;
      const br = document.createElement("br");
      const sel = window.getSelection();
      if (sel?.rangeCount) {
        const range = sel.getRangeAt(0);
        range.collapse(false);
        range.insertNode(br);
        range.insertNode(img);
        range.setStartAfter(br);
        sel.removeAllRanges();
        sel.addRange(range);
      } else {
        ref.current?.appendChild(img);
        ref.current?.appendChild(br);
      }
      onChange(ref.current?.innerHTML ?? "");
    };
    reader.readAsDataURL(file);
  }, [onChange]);

  const handleResizeImg = (pct: number) => {
    if (!selImg) return;
    selImg.style.width = `${pct}%`;
    onChange(ref.current?.innerHTML ?? "");
  };

  const handleDeleteImg = () => {
    if (!selImg) return;
    selImg.remove();
    setSelImg(null);
    onChange(ref.current?.innerHTML ?? "");
  };

  return (
    <div className="flex flex-col gap-1.5 h-full min-h-0">
      {showToolbar && (
        <FormatToolbar
          editorRef={ref}
          onSave={save}
          selImg={selImg}
          onResizeImg={handleResizeImg}
          onDeleteImg={handleDeleteImg}
        />
      )}
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={save}
        onPaste={handlePaste}
        onClick={e => {
          const t = e.target as HTMLElement;
          setSelImg(t.tagName === "IMG" ? t as HTMLImageElement : null);
        }}
        className={className}
        style={{ lineHeight: 1.7, ...style }}
      />
    </div>
  );
}

// ── NotePane ──────────────────────────────────────────────────────────────────

function NotePane({ slot, onChange }: { slot: SlotState; onChange: (s: SlotState) => void }) {
  const [expanded, setExpanded] = useState(false);

  const editorCls = "flex-1 bg-slate-800/30 border border-slate-700/30 rounded-lg p-3 text-[11px] text-slate-300 outline-none focus:border-slate-600 transition-all overflow-y-auto min-h-0";

  return (
    <>
      {expanded && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6" onClick={() => setExpanded(false)}>
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5 w-full max-w-4xl h-[88vh] flex flex-col shadow-2xl gap-3" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between shrink-0">
              <input
                className="bg-transparent text-[13px] font-semibold text-slate-200 placeholder-slate-600 outline-none flex-1"
                placeholder="Titre / hypothèse…"
                value={slot.title}
                onChange={e => onChange({ ...slot, title: e.target.value })}
              />
              <button onClick={() => setExpanded(false)} className="text-slate-500 hover:text-white ml-4 text-lg">✕</button>
            </div>
            <RichEditor
              html={slot.notes}
              onChange={notes => onChange({ ...slot, notes })}
              className="flex-1 bg-slate-800/40 border border-slate-700/30 rounded-xl p-4 text-[12px] text-slate-200 outline-none overflow-y-auto"
            />
          </div>
        </div>
      )}

      <div className="flex flex-col h-full gap-2 min-h-0">
        <input
          className="bg-transparent border-b border-slate-700/50 text-[10px] text-slate-300 placeholder-slate-600 outline-none pb-1 shrink-0"
          placeholder="Titre / hypothèse…"
          value={slot.title}
          onChange={e => onChange({ ...slot, title: e.target.value })}
        />
        <RichEditor
          html={slot.notes}
          onChange={notes => onChange({ ...slot, notes })}
          className={editorCls}
          style={{ minHeight: 120 }}
        />
        <button
          onClick={() => setExpanded(true)}
          className="text-[8px] text-slate-600 hover:text-sky-400 transition-colors self-end shrink-0"
        >↗ Agrandir</button>
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
            height={760}
          />
        </div>
        {/* Notes */}
        <div className="p-3 flex flex-col" style={{ minHeight: 760 }}>
          <NotePane slot={slot} onChange={onChange} />
        </div>
      </div>
    </div>
  );
}

// ── ArchiveCard ───────────────────────────────────────────────────────────────

function ArchiveCard({ a, onDelete, onRestore }: {
  a: Archive;
  onDelete: () => void;
  onRestore: (slot: 0 | 1) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const date = new Date(a.savedAt).toLocaleDateString("fr-FR", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
  const intervalLabel: Record<string, string> = {
    "1": "1m", "5": "5m", "15": "15m", "30": "30m",
    "60": "1H", "120": "2H", "240": "4H", "D": "1J", "W": "1S",
  };

  return (
    <>
      {/* Modal plein écran */}
      {expanded && (
        <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-6" onClick={() => setExpanded(false)}>
          <div className="bg-slate-900 border border-slate-700/50 rounded-2xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-700/40 shrink-0">
              <span className="text-[13px] font-bold text-slate-100 font-mono">{a.slot.symbol}</span>
              <span className="text-[9px] bg-slate-700/60 text-slate-400 rounded px-2 py-0.5">{intervalLabel[a.slot.interval] ?? a.slot.interval}</span>
              {a.slot.title && <span className="text-[12px] text-slate-300 flex-1">{a.slot.title}</span>}
              <span className="text-[9px] text-slate-600 ml-auto shrink-0">{date}</span>
              <button onClick={() => setExpanded(false)} className="text-slate-500 hover:text-white ml-3 text-lg shrink-0">✕</button>
            </div>
            <div
              className="flex-1 overflow-y-auto px-8 py-5 text-[13px] text-slate-200 prose-invert archive-content"
              dangerouslySetInnerHTML={{ __html: a.slot.notes }}
            />
          </div>
        </div>
      )}

      {/* Carte compacte */}
      {/* Pas de overflow-hidden ici : le menu déroulant "Restaurer" est en position
          absolute et serait rogné par un ancêtre overflow-hidden (cf. bug signalé). */}
      <div className="border border-slate-700/30 rounded-xl bg-slate-900/30 hover:bg-slate-800/30 transition-colors">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-700/20">
          <span className="text-[10px] font-bold text-sky-400/80 font-mono">{a.slot.symbol}</span>
          <span className="text-[8px] bg-slate-700/50 text-slate-500 rounded px-1.5 py-0.5">{intervalLabel[a.slot.interval] ?? a.slot.interval}</span>
          {a.slot.title && (
            <span className="text-[10px] text-slate-300 truncate flex-1 font-medium">{a.slot.title}</span>
          )}
          <span className="text-[8px] text-slate-600 ml-auto shrink-0">{date}</span>
          {/* Restaurer */}
          <div className="relative ml-2 shrink-0">
            <button
              onClick={() => setRestoring(v => !v)}
              className="text-[8px] text-emerald-500/60 hover:text-emerald-400 transition-colors"
              title="Restaurer dans un slot actif"
            >↩ Restaurer</button>
            {restoring && (
              <div className="absolute right-0 top-5 z-20 bg-slate-800 border border-slate-700/60 rounded-lg shadow-xl p-2 flex flex-col gap-1 min-w-[120px]">
                <p className="text-[8px] text-slate-500 mb-1">Charger dans :</p>
                <button
                  onClick={() => { onRestore(0); setRestoring(false); }}
                  className="text-[9px] text-left px-2 py-1 rounded hover:bg-slate-700 text-slate-300 transition-colors"
                >Recherche A</button>
                <button
                  onClick={() => { onRestore(1); setRestoring(false); }}
                  className="text-[9px] text-left px-2 py-1 rounded hover:bg-slate-700 text-slate-300 transition-colors"
                >Recherche B</button>
                <button
                  onClick={() => setRestoring(false)}
                  className="text-[8px] text-slate-600 hover:text-slate-400 mt-1 text-left px-2 transition-colors"
                >Annuler</button>
              </div>
            )}
          </div>
          <button
            onClick={() => setExpanded(true)}
            className="text-[8px] text-slate-600 hover:text-sky-400 transition-colors ml-1 shrink-0"
          >↗ Voir</button>
          <button
            onClick={() => { if (window.confirm("Supprimer définitivement cette archive ?")) onDelete(); }}
            title="Supprimer définitivement"
            className="text-[8px] text-red-400/80 hover:text-red-400 transition-colors ml-1 shrink-0"
          >✕ Supprimer</button>
        </div>

        {/* Corps : texte + images */}
        {a.slot.notes && (
          <div className="px-4 py-3">
            {/* Texte brut (sans tags HTML) — les tags de bloc sont convertis en
                retours à la ligne avant extraction, sinon .textContent colle tous
                les paragraphes/lignes de liste bout à bout sans séparation. */}
            {(() => {
              const withBreaks = a.slot.notes
                .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
                .replace(/<br\s*\/?>/gi, "\n");
              const doc = new DOMParser().parseFromString(withBreaks, "text/html");
              const text = (doc.body.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
              const imgs = Array.from(doc.images);
              return (
                <>
                  {text && (
                    <p className="text-[10px] text-slate-400 leading-relaxed whitespace-pre-line mb-2">{text}</p>
                  )}
                  {imgs.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {imgs.map((img, i) => (
                        <img
                          key={i}
                          src={img.src}
                          alt=""
                          className="max-h-48 w-auto rounded-lg border border-slate-700/40 object-cover cursor-pointer hover:opacity-80 transition-opacity"
                          onClick={() => setExpanded(true)}
                        />
                      ))}
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        )}
      </div>
    </>
  );
}

// ── Archives panel ────────────────────────────────────────────────────────────

function ArchivesPanel({ archives, onDelete, onRestore }: {
  archives: Archive[];
  onDelete: (id: string) => void;
  onRestore: (id: string, slot: 0 | 1) => void;
}) {
  if (!archives.length) return null;

  return (
    <div className="mt-2">
      <div className="flex items-center gap-2 mb-4 px-1">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-500">
          <polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/>
        </svg>
        <span className="text-[11px] font-semibold text-slate-400">Archives</span>
        <span className="text-[9px] bg-slate-700/50 text-slate-500 rounded-full px-2 py-0.5">{archives.length}</span>
      </div>
      <div className="flex flex-col gap-3">
        {archives.map(a => (
          <ArchiveCard
            key={a.id}
            a={a}
            onDelete={() => onDelete(a.id)}
            onRestore={slot => onRestore(a.id, slot)}
          />
        ))}
      </div>
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
  // Passe à true si une écriture localStorage échoue (ex: quota dépassé à cause
  // des images en base64 dans les notes archivées) — sans ça l'échec est silencieux
  // et une suppression/modification peut sembler ne "pas marcher" après rechargement.
  const [saveError, setSaveError] = useState(false);

  const persist = useCallback((key: string, val: unknown) => {
    setSaveError(!saveLS(key, val));
  }, []);

  useEffect(() => {
    setSlots(loadLS<[SlotState, SlotState]>(LS_SLOTS, [DEFAULT_SLOT("FX:EURUSD"), DEFAULT_SLOT("FX:GBPUSD")]));
    setArchives(loadLS<Archive[]>(LS_ARCHIVES, []));
  }, []);

  const updateSlot = useCallback((idx: 0 | 1, s: SlotState) => {
    setSlots(prev => {
      const next: [SlotState, SlotState] = [prev[0], prev[1]];
      next[idx] = s;
      persist(LS_SLOTS, next);
      return next;
    });
  }, [persist]);

  const archiveSlot = useCallback((idx: 0 | 1) => {
    const entry: Archive = { id: Date.now().toString(), savedAt: new Date().toISOString(), slot: slots[idx] };
    const next = [entry, ...archives];
    setArchives(next);
    persist(LS_ARCHIVES, next);
    const reset = DEFAULT_SLOT(idx === 0 ? "FX:EURUSD" : "FX:GBPUSD");
    setSlots(prev => {
      const n: [SlotState, SlotState] = [prev[0], prev[1]];
      n[idx] = reset;
      persist(LS_SLOTS, n);
      return n;
    });
  }, [slots, archives, persist]);

  const deleteArchive = useCallback((id: string) => {
    const next = archives.filter(a => a.id !== id);
    setArchives(next);
    persist(LS_ARCHIVES, next);
  }, [archives, persist]);

  const restoreArchive = useCallback((id: string, slotIdx: 0 | 1) => {
    const entry = archives.find(a => a.id === id);
    if (!entry) return;
    setSlots(prev => {
      const next = [...prev] as [SlotState, SlotState];
      next[slotIdx] = { ...entry.slot };
      persist(LS_SLOTS, next);
      return next;
    });
  }, [archives, persist]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="h-px flex-1 bg-purple-500/20" />
        <span className="text-purple-400 text-xs font-bold uppercase tracking-[0.3em]">Espace Idées · 2 recherches</span>
        <div className="h-px flex-1 bg-purple-500/20" />
      </div>

      {saveError && (
        <div className="text-[10px] text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
          ⚠ Échec de sauvegarde locale — le quota de stockage du navigateur est probablement dépassé
          (les archives avec images occupent beaucoup de place). Supprime quelques archives pour libérer
          de la place, sinon tes changements ne seront pas conservés au rechargement.
        </div>
      )}

      <ResearchSlot slot={slots[0]} label="Recherche A" onChange={s => updateSlot(0, s)} onArchive={() => archiveSlot(0)} />
      <ResearchSlot slot={slots[1]} label="Recherche B" onChange={s => updateSlot(1, s)} onArchive={() => archiveSlot(1)} />

      <ArchivesPanel archives={archives} onDelete={deleteArchive} onRestore={restoreArchive} />
    </div>
  );
}
