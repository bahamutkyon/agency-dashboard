import { useCallback, useEffect, useState } from "react";
import { api, type Project } from "../lib/api";

/**
 * 專案清單 hook — 載入工作區下的所有專案，並提供 create / update / remove / refresh。
 * 仿 useNotes / useAutonomy 結構。
 */
export function useProjects(workspaceId: string) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const res = await api.listProjects(workspaceId);
      setProjects(res.projects);
    } catch {
      // silent — caller can handle via stale state
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = async (name: string): Promise<Project> => {
    const res = await api.createProject(workspaceId, name);
    await refresh();
    return res.project;
  };

  const update = async (id: string, patch: { name?: string; memory?: string }): Promise<Project> => {
    const res = await api.updateProject(id, patch);
    setProjects((prev) => prev.map((p) => (p.id === id ? res.project : p)));
    return res.project;
  };

  const remove = async (id: string): Promise<void> => {
    await api.deleteProject(id);
    setProjects((prev) => prev.filter((p) => p.id !== id));
  };

  return { projects, loading, create, update, remove, refresh };
}
