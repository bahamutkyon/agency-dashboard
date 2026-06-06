import { useEffect, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { api, type Note } from "../lib/api";

/**
 * 筆記庫選擇器：載入筆記（focus 時刷新）、把選定筆記以 <context> 包裹插入輸入框開頭。
 */
export function useNotes(
  setInput: Dispatch<SetStateAction<string>>,
  inputRef: RefObject<HTMLTextAreaElement | null>,
) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [showNotePicker, setShowNotePicker] = useState(false);

  useEffect(() => {
    const fetch = () => api.notes().then(setNotes).catch(() => {});
    fetch();
    window.addEventListener("focus", fetch);
    return () => window.removeEventListener("focus", fetch);
  }, []);

  const attachNote = (n: Note) => {
    const wrapped = `<context source="${n.title}">\n${n.body}\n</context>\n\n`;
    setInput((cur) => wrapped + cur);
    setShowNotePicker(false);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  return { notes, showNotePicker, setShowNotePicker, attachNote };
}
