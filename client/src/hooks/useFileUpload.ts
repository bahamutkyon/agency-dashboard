import { useState, type Dispatch, type RefObject, type SetStateAction, type ClipboardEvent } from "react";
import { api } from "../lib/api";

const TEXT_EXT = /\.(md|txt|json|csv|tsv|log|ya?ml|html?|xml|tsx?|jsx?|py|rb|go|rs|sh|bat|sql|css|scss|toml|ini|env)$/i;

/**
 * 拖放 / 選取檔案上傳：小型文字檔直接 inline 進輸入框，其餘上傳後以路徑引用。
 * 把結果塞回 ChatWindow 的輸入框（setInput）並聚焦（inputRef）。
 */
export function useFileUpload(
  setInput: Dispatch<SetStateAction<string>>,
  inputRef: RefObject<HTMLTextAreaElement | null>,
) {
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);

  const handleFiles = async (files: FileList | File[]) => {
    setUploading(true);
    const additions: string[] = [];
    try {
      for (const file of Array.from(files)) {
        const isImage = file.type.startsWith("image/");
        const isText = file.type.startsWith("text/") || TEXT_EXT.test(file.name);
        const tooBig = file.size > 10 * 1024 * 1024; // 10MB cap

        if (tooBig) {
          additions.push(`[檔案太大,跳過:${file.name} (${Math.round(file.size / 1024)} KB)]`);
          continue;
        }

        if (isText && file.size < 200_000) {
          // small text: inline directly
          const text = await file.text();
          additions.push(`<file name="${file.name}">\n${text}\n</file>`);
        } else {
          // upload binary / large file
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(r.result as string);
            r.onerror = () => reject(r.error);
            r.readAsDataURL(file);
          });
          const base64 = dataUrl.split(",")[1];
          const { path } = await api.uploadFile(file.name, base64, "base64");
          if (isImage) {
            additions.push(`請用 Read 工具讀取這張圖片（讀出其中所有文字）:${path}`);
          } else {
            additions.push(`請用 Read 工具讀取這個檔案:${path}`);
          }
        }
      }
      if (additions.length > 0) {
        setInput((cur) => (cur ? cur + "\n\n" : "") + additions.join("\n\n") + "\n\n");
        setTimeout(() => inputRef.current?.focus(), 0);
      }
    } catch (e: any) {
      alert("上傳失敗:" + (e.message || e));
    } finally {
      setUploading(false);
    }
  };

  /** Ctrl+V 貼上：只攔截剪貼簿中的圖片，走同一條上傳路徑；純文字貼上不干擾。 */
  const handlePaste = (e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imgs: File[] = [];
    for (const it of Array.from(items)) {
      if (it.kind === "file" && it.type.startsWith("image/")) {
        const f = it.getAsFile();
        if (f) imgs.push(f);
      }
    }
    if (imgs.length > 0) {
      e.preventDefault();
      void handleFiles(imgs);
    }
  };

  return { dragActive, setDragActive, uploading, handleFiles, handlePaste };
}
