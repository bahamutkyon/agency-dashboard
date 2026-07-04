import { db } from "./db.js";
import { v4 as uuid } from "uuid";
import type { Briefing, BriefingRow } from "./cockpitTypes.js";

export function saveBriefing(input: {
  date: string;
  content: Briefing | null;
  raw: string;
  status: BriefingRow["status"];
}): BriefingRow {
  const row: BriefingRow = {
    id: uuid(),
    date: input.date,
    content: input.content,
    raw: input.raw,
    status: input.status,
    createdAt: Date.now(),
  };
  db.prepare(
    `INSERT INTO cockpit_briefings (id, date, content, raw, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    row.id,
    row.date,
    row.content ? JSON.stringify(row.content) : null,
    row.raw,
    row.status,
    row.createdAt
  );
  return row;
}

export function getLatestBriefing(): BriefingRow | null {
  const r = db.prepare(
    `SELECT * FROM cockpit_briefings ORDER BY created_at DESC, rowid DESC LIMIT 1`
  ).get() as any;
  if (!r) return null;
  return {
    id: r.id,
    date: r.date,
    content: r.content ? (JSON.parse(r.content) as Briefing) : null,
    raw: r.raw,
    status: r.status,
    createdAt: r.created_at,
  };
}
