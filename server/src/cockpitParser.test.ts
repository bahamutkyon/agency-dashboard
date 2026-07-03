import { describe, it, expect } from "vitest";
import { parseBriefing } from "./cockpitParser.js";

const good = "前言…\n```json\n" + JSON.stringify({
  sections: [{ kind: "decisions", title: "待拍板", items: [{ title: "76F", body: "要不要雙機" }] }],
}) + "\n```\n收尾";

describe("parseBriefing", () => {
  it("擷取 fenced json、補上 date/generatedAt", () => {
    const r = parseBriefing(good, "2026-07-03", 123);
    expect(r.status).toBe("ok");
    expect(r.briefing?.sections[0].items[0].title).toBe("76F");
    expect(r.briefing?.date).toBe("2026-07-03");
    expect(r.briefing?.generatedAt).toBe(123);
  });
  it("無 json → parse_failed、briefing 為 null", () => {
    const r = parseBriefing("完全沒有 json 的一段話", "2026-07-03", 1);
    expect(r.status).toBe("parse_failed");
    expect(r.briefing).toBeNull();
  });
  it("json 格式壞掉 → parse_failed", () => {
    const r = parseBriefing("```json\n{壞掉}\n```", "2026-07-03", 1);
    expect(r.status).toBe("parse_failed");
  });
});
