import { type Dispatch, type RefObject, type SetStateAction } from "react";
import type { Note, PromptTemplate } from "../lib/api";

interface ComposerProps {
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  inputRef: RefObject<HTMLTextAreaElement>;
  status: string;
  onSend: () => void;
  // 範本
  showPicker: boolean;
  setShowPicker: (v: boolean) => void;
  setPickerFilter: (v: string) => void;
  visibleTemplates: PromptTemplate[];
  insertTemplate: (t: PromptTemplate) => void;
  // 筆記
  notes: Note[];
  showNotePicker: boolean;
  setShowNotePicker: (v: boolean) => void;
  attachNote: (n: Note) => void;
}

/** 輸入區：textarea（"/" 叫出範本、Enter 送出）+ 範本/筆記下拉 + 筆記/送出按鈕。 */
export function Composer({
  input, setInput, inputRef, status, onSend,
  showPicker, setShowPicker, setPickerFilter, visibleTemplates, insertTemplate,
  notes, showNotePicker, setShowNotePicker, attachNote,
}: ComposerProps) {
  const busy = status === "busy" || status === "starting";
  return (
    <div className="p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] border-t border-zinc-800 bg-panel relative">
      {showNotePicker && notes.length > 0 && (
        <div className="absolute bottom-full left-3 right-3 mb-2 max-h-64 overflow-y-auto bg-zinc-900 border border-zinc-700 rounded-lg shadow-lg z-10">
          <div className="px-3 py-2 text-xs text-zinc-500 border-b border-zinc-800 flex items-center justify-between">
            <span>📎 選擇筆記附加到下一條訊息</span>
            <button onClick={() => setShowNotePicker(false)} className="text-zinc-500 hover:text-zinc-300">×</button>
          </div>
          {notes.map((n) => (
            <button key={n.id} onClick={() => attachNote(n)}
              className="w-full text-left px-3 py-2 hover:bg-zinc-800 border-b border-zinc-800/50 last:border-0">
              <div className="text-sm font-medium flex items-center gap-1">
                {n.pinned && "📌"}
                {n.title}
              </div>
              <div className="text-xs text-zinc-500 mt-1 line-clamp-1">{n.body.slice(0, 80)}</div>
            </button>
          ))}
        </div>
      )}
      {showPicker && visibleTemplates.length > 0 && (
        <div className="absolute bottom-full left-3 right-3 mb-2 max-h-64 overflow-y-auto bg-zinc-900 border border-zinc-700 rounded-lg shadow-lg z-10">
          <div className="px-3 py-2 text-xs text-zinc-500 border-b border-zinc-800">
            📋 模板({visibleTemplates.length})— ↑↓ 選擇 · Enter 插入 · Esc 取消
          </div>
          {visibleTemplates.slice(0, 10).map((t) => (
            <button
              key={t.id}
              onClick={() => insertTemplate(t)}
              className="w-full text-left px-3 py-2 hover:bg-zinc-800 border-b border-zinc-800/50 last:border-0"
            >
              <div className="text-sm font-medium">{t.name}</div>
              <div className="text-xs text-zinc-500 mt-1 line-clamp-1">{t.body.slice(0, 80)}</div>
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <textarea
          ref={inputRef}
          className="flex-1 bg-zinc-900 px-3 py-2 rounded text-base md:text-sm resize-none focus:outline-none focus:ring-1 focus:ring-accent"
          rows={2}
          placeholder="跟這位員工說話… (Enter 送出 / Shift+Enter 換行 / 「/」叫出模板)"
          value={input}
          onChange={(e) => {
            const v = e.target.value;
            setInput(v);
            const m = v.match(/^\/([^\s\n]*)$/);
            if (m) {
              setShowPicker(true);
              setPickerFilter(m[1]);
            } else {
              setShowPicker(false);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape" && showPicker) {
              setShowPicker(false);
              e.preventDefault();
              return;
            }
            if (e.key === "Enter" && showPicker && visibleTemplates.length > 0) {
              e.preventDefault();
              insertTemplate(visibleTemplates[0]);
              return;
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          disabled={busy}
        />
        <div className="flex flex-col gap-1">
          <button
            onClick={() => setShowNotePicker(!showNotePicker)}
            disabled={notes.length === 0}
            className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 rounded text-zinc-300 text-xs"
            title={notes.length === 0 ? "先去「筆記」面板建立筆記" : "附加筆記到下一條訊息"}
          >
            📎 筆記
          </button>
          <button
            onClick={onSend}
            disabled={busy || !input.trim()}
            className="px-4 py-1 bg-accent hover:bg-violet-500 disabled:opacity-40 rounded text-white text-sm flex-1"
          >
            送出
          </button>
        </div>
      </div>
    </div>
  );
}
