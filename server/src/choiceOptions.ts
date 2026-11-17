/** 從專案經理最後一則回覆抓出「A. … / B. … / C. …」選項，前端變成一鍵回覆按鈕。 */
export interface ChoiceOption { key: string; label: string }

const LINE = /^\s*(?:[-*]\s*)?(?:\*\*)?([A-F])(?:\*\*)?\s*[.．、:：)）](?:\*\*)?\s*(.+?)\s*$/;
const LABEL_MAX = 40;

export function parseChoiceOptions(text: string): ChoiceOption[] | null {
  const groups: ChoiceOption[][] = [];
  let cur: ChoiceOption[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(LINE);
    const expected = String.fromCharCode(65 + cur.length); // 下一個應該是 A、B、C…
    if (m && m[1] === expected) {
      const raw = m[2].replace(/\*\*/g, "").trim();
      const chars = [...raw];
      cur.push({ key: m[1], label: chars.length > LABEL_MAX ? chars.slice(0, LABEL_MAX).join("") + "…" : raw });
    } else if (m && m[1] === "A") {
      if (cur.length) groups.push(cur);
      cur = [{ key: "A", label: m[2].replace(/\*\*/g, "").trim() }];
    } else if (line.trim() !== "" && cur.length) {
      groups.push(cur); cur = [];
    }
  }
  if (cur.length) groups.push(cur);
  const last = groups.filter((g) => g.length >= 2).pop();
  return last ?? null;
}
