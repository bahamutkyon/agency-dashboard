import path from "node:path";
import fs from "node:fs";
import type { Workspace } from "./store/types.js";

const SANDBOX_ROOT = path.join(process.cwd(), "data", "workspaces");
// 路徑層級上限；dirname 終會收斂到 root，此為極端情況的保險絲（正常永遠用不到）。
const MAX_PATH_DEPTH = 4096;

/**
 * 將路徑正規化為「實體絕對路徑」以抵禦 symlink 逃逸。
 * fs.realpathSync 要求路徑存在；對尚未建立的目錄，逐層往上回退到
 * 最近的存在祖先做 realpath，再把剩餘的（不存在）尾段以 lexical 方式接回。
 * 這樣即可解開「祖先目錄是 symlink」的情況，又不要求候選目錄本身已存在。
 */
function realAbs(input: string): string {
  let abs = path.resolve(input);
  let suffix = "";
  // 逐層往上找到存在的祖先
  for (let i = 0; i < MAX_PATH_DEPTH; i++) {
    try {
      const real = fs.realpathSync(abs);
      return suffix ? path.join(real, suffix) : real;
    } catch {
      const parent = path.dirname(abs);
      if (parent === abs) {
        // 已到 root（root 本身無法 realpath，例如不存在的磁碟機）→ 回退 lexical
        return path.resolve(input);
      }
      suffix = suffix ? path.join(path.basename(abs), suffix) : path.basename(abs);
      abs = parent;
    }
  }
  return path.resolve(input);
}

/** child 是否等於或位於 parent 之內（用正規化相對路徑判斷，避免 ".." 逃逸）。 */
function within(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  // rel === ""：child 即 parent 本身
  // rel 以 ".." 開頭：child 在 parent 之外
  // path.isAbsolute(rel)：跨磁碟機（Windows）→ 不同 root，視為外部
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export function resolveWorkspaceDir(ws: Pick<Workspace, "id" | "workingDir">): string {
  const fallback = path.join(SANDBOX_ROOT, ws.id);
  const custom = (ws.workingDir || "").trim();
  if (!custom) return fallback;
  // 驗證下沉到使用點：PATCH 的驗證是「早期友善報錯」，但不能是唯一防線。
  // 匯入、直接改 DB、或日後 banned 清單擴充都不經過 PATCH——這裡再驗一次，
  // 不合法就退回預設沙箱（而非沿用危險路徑）。failed closed。
  const err = validateWorkingDir(custom);
  if (err) {
    console.warn(`[workspaceDir] 自訂工作目錄無效，退回預設沙箱 ws=${ws.id}：${err}`);
    return fallback;
  }
  return path.resolve(custom);
}

export function ensureWorkspaceDir(ws: Pick<Workspace, "id" | "workingDir">): string {
  const dir = resolveWorkspaceDir(ws);
  const fallback = path.join(SANDBOX_ROOT, ws.id);
  try {
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  } catch (e: unknown) {
    // 自訂目錄建立失敗（不存在磁碟機、無權限、UNC 不可達…）。沙箱功能的失敗
    // 模式不能是「退回 dashboard 自身目錄」（fail-open），而要退回預設沙箱。
    if (dir !== fallback) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[workspaceDir] 建立自訂工作目錄失敗，退回預設沙箱 ws=${ws.id}：${msg}`);
      fs.mkdirSync(fallback, { recursive: true });
      return fallback;
    }
    throw e; // 連預設沙箱都建不出來 → 真錯誤，交給上層（resolveCwd 會吞成 undefined）
  }
}

/** 防呆：禁止工作目錄落在 dashboard 自身（沙箱子目錄例外）。OK 回 null，否則回錯誤訊息。 */
export function validateWorkingDir(candidate: string): string | null {
  // 用實體路徑（解 symlink）判斷，避免「沙箱內放 symlink 指向 server」之類的逃逸。
  const abs = realAbs(candidate);
  const sandboxReal = realAbs(SANDBOX_ROOT);
  if (within(sandboxReal, abs)) return null; // 沙箱子目錄一律允許（含 data/workspaces 本身與其下）
  const server = realAbs(process.cwd());
  const repoRoot = realAbs(path.resolve(process.cwd(), ".."));
  // 刻意列細項（非冗餘）：repoRoot 已涵蓋其下全部，但保留 server/client/data
  // 是為了縱深防禦 + 讓錯誤訊息能指出使用者撞到的具體目錄。請勿為了精簡而刪。
  const banned = [
    repoRoot,
    server,
    realAbs(path.join(path.resolve(process.cwd(), ".."), "client")),
    realAbs(path.join(process.cwd(), "data")),
  ];
  for (const b of banned) {
    if (within(b, abs)) return `工作目錄不可設在 dashboard 自身目錄內（${b}）`;
  }
  return null;
}
