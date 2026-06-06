import { useState } from "react";
import { api } from "../lib/api";

/**
 * Session 標籤管理：新增/移除並即時持久化。初始值由 ChatWindow 載入歷史時透過 setTags 寫入。
 */
export function useTags(sessionId: string) {
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");

  const saveTags = async (next: string[]) => {
    setTags(next);
    try { await api.updateSession(sessionId, { tags: next }); } catch {}
  };

  const addTag = () => {
    const t = tagInput.trim().replace(/^#/, "");
    if (!t || tags.includes(t)) { setTagInput(""); return; }
    saveTags([...tags, t]);
    setTagInput("");
  };

  const removeTag = (t: string) => saveTags(tags.filter((x) => x !== t));

  return { tags, setTags, tagInput, setTagInput, addTag, removeTag };
}
