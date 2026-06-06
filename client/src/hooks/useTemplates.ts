import { useEffect, useMemo, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { api, type PromptTemplate } from "../lib/api";

/**
 * Prompt 範本選擇器：載入範本（focus 時刷新）、依 agent / 關鍵字過濾、插入到輸入框
 * （以範本內容取代開頭的 "/..." 觸發字）。
 */
export function useTemplates(
  agentId: string,
  setInput: Dispatch<SetStateAction<string>>,
  inputRef: RefObject<HTMLTextAreaElement | null>,
) {
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const [pickerFilter, setPickerFilter] = useState("");

  useEffect(() => {
    const fetch = () => api.templates().then(setTemplates).catch(() => {});
    fetch();
    window.addEventListener("focus", fetch);
    return () => window.removeEventListener("focus", fetch);
  }, []);

  const visibleTemplates = useMemo(() => {
    return templates.filter((t) => {
      if (t.agentId && t.agentId !== agentId) return false;
      if (!pickerFilter.trim()) return true;
      const q = pickerFilter.toLowerCase();
      return t.name.toLowerCase().includes(q) || t.body.toLowerCase().includes(q);
    });
  }, [templates, agentId, pickerFilter]);

  const insertTemplate = (t: PromptTemplate) => {
    setInput((cur) => {
      const m = cur.match(/^\/[^\s]*/);
      const rest = m ? cur.slice(m[0].length) : cur;
      return t.body + rest;
    });
    setShowPicker(false);
    setPickerFilter("");
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  return { showPicker, setShowPicker, pickerFilter, setPickerFilter, visibleTemplates, insertTemplate };
}
