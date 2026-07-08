export type SectionKind = "decisions" | "new_items" | "status" | "learning";

export interface BriefingAction {
  type: "approve" | "reject";
  proposalIds: string[];
}

export interface BriefingItem {
  title: string;
  body: string;
  workspaceId?: string;
  discussSeed?: string;
  action?: BriefingAction;
}

export interface BriefingSection {
  kind: SectionKind;
  title: string;
  items: BriefingItem[];
}

export interface Briefing {
  date: string;
  generatedAt: number;
  sections: BriefingSection[];
}

export interface BriefingRow {
  id: string;
  date: string;
  content: Briefing | null;
  raw: string;
  status: "ok" | "parse_failed" | "error";
  createdAt: number;
}

export interface CockpitContextPack {
  generatedAtIso: string;
  workspaces: {
    id: string;
    name: string;
    memoryExcerpt: string;
    latestReport?: string;
    /** 此工作區目前 active 的目標（空陣列表示無目標） */
    goals: {
      id: string;
      title: string;
      metric: string;
      currentValue: string;
      targetValue: string;
      deadline: string;
    }[];
  }[];
  pendingProposals: {
    id: string;
    agentId: string;
    kind: string;
    content: string;
  }[];
  staleTopics: string[];
}
