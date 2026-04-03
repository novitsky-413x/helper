import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentTask, AgentTaskStatus } from "@helper/shared";
import type { McpForm } from "../components/McpModal";
import type { ModelCatalog, McpServer, MemoryRow, Profile, TaskCategory, UsageSnapshot, ModelHealthEntry } from "../types/appTypes";
import { useAppStore } from "../store/index.js";

const LS_PROFILE = "helper-active-profile";

const TASK_STATUSES = new Set<AgentTaskStatus>(["pending", "in_progress", "completed", "cancelled"]);

function taskRowToAgentTask(row: Record<string, unknown>): AgentTask | null {
  const id = typeof row.id === "string" ? row.id : null;
  const title = typeof row.title === "string" ? row.title : null;
  const status = typeof row.status === "string" ? (row.status as AgentTaskStatus) : null;
  if (!id || !title || !status || !TASK_STATUSES.has(status)) return null;
  const priority = typeof row.priority === "number" ? row.priority : 0;
  const createdAt = typeof row.createdAt === "string" ? row.createdAt : new Date().toISOString();
  const updatedAt = typeof row.updatedAt === "string" ? row.updatedAt : createdAt;
  return {
    id,
    profileId: typeof row.profileId === "string" ? row.profileId : undefined,
    sessionId: typeof row.sessionId === "string" ? row.sessionId : undefined,
    title,
    description: typeof row.description === "string" ? row.description : undefined,
    status,
    priority,
    parentId: typeof row.parentId === "string" ? row.parentId : undefined,
    result: typeof row.result === "string" ? row.result : undefined,
    createdAt,
    updatedAt,
  };
}

export function useBackendData({
  profileDeleteConfirm,
  memoryDeleteConfirm,
  mcpDeleteConfirm,
  onProfileAddFailed,
  onMcpSaveFailed,
  onSettingsRequestFailed,
}: {
  profileDeleteConfirm: string;
  memoryDeleteConfirm: string;
  mcpDeleteConfirm: string;
  onProfileAddFailed?: () => void;
  onMcpSaveFailed?: () => void;
  /** Rename profile, memory policy, model order, memory rows, profile delete */
  onSettingsRequestFailed?: () => void;
}) {
  const [models, setModels] = useState<ModelCatalog["chatModels"]>([]);
  const [modelCatalog, setModelCatalog] = useState<ModelCatalog | null>(null);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profilesLoaded, setProfilesLoaded] = useState(false);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [memoryRows, setMemoryRows] = useState<MemoryRow[]>([]);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [newProfileName, setNewProfileName] = useState("");
  const [mcpForm, setMcpForm] = useState<McpForm>({
    name: "",
    transport: "http",
    url: "",
    command: "",
    args: "",
    enabled: true,
  });
  const [testResult, setTestResult] = useState<string | null>(null);
  const [lastUsage, setLastUsage] = useState<UsageSnapshot | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageLoadedForProfileId, setUsageLoadedForProfileId] = useState<string | null>(null);
  const [modelHealth, setModelHealth] = useState<Record<string, ModelHealthEntry>>({});
  const healthPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeProfile = useMemo(
    () => profiles.find((p) => p.id === activeProfileId) ?? profiles[0] ?? null,
    [profiles, activeProfileId]
  );

  const loadModels = useCallback(async () => {
    setModelsLoading(true);
    try {
      const r = await fetch("/api/model-catalog");
      if (!r.ok) return;
      const j = (await r.json()) as { catalog?: ModelCatalog };
      if (j.catalog) {
        setModelCatalog(j.catalog);
        setModels(j.catalog.chatModels ?? []);
        if (j.catalog.healthByModel) {
          setModelHealth(j.catalog.healthByModel);
        }
      }
    } catch {
      /* ignore */
    } finally {
      setModelsLoading(false);
    }
  }, []);

  const pollHealth = useCallback(async (remainingRetries = 5) => {
    try {
      const r = await fetch("/api/models/health");
      if (!r.ok) return;
      const j = (await r.json()) as { health: Record<string, ModelHealthEntry>; checking: boolean };
      setModelHealth(j.health);
      const entryCount = Object.keys(j.health).length;
      if (j.checking || (entryCount < 3 && remainingRetries > 0)) {
        healthPollRef.current = setTimeout(
          () => void pollHealth(remainingRetries - 1),
          j.checking ? 2000 : 4000
        );
      }
    } catch {
      if (remainingRetries > 0) {
        healthPollRef.current = setTimeout(() => void pollHealth(remainingRetries - 1), 4000);
      }
    }
  }, []);

  const loadProfiles = useCallback(async () => {
    const r = await fetch("/api/profiles");
    if (!r.ok) return;
    const j = (await r.json()) as { profiles: Profile[] };
    const list = j.profiles;
    setProfiles(list);
    const fromLs = localStorage.getItem(LS_PROFILE);
    if (list.length === 0) {
      setActiveProfileId(null);
      localStorage.removeItem(LS_PROFILE);
    } else if (fromLs && list.some((p) => p.id === fromLs)) {
      setActiveProfileId(fromLs);
    } else if (list[0]) {
      setActiveProfileId(list[0].id);
      localStorage.setItem(LS_PROFILE, list[0].id);
    }
    setProfilesLoaded(true);
  }, []);

  const onProfileChange = useCallback((id: string) => {
    setActiveProfileId(id);
    localStorage.setItem(LS_PROFILE, id);
  }, []);

  const loadMemory = useCallback(async () => {
    if (!activeProfile) return;
    setMemoryLoading(true);
    try {
      const r = await fetch(`/api/memory?userId=${encodeURIComponent(activeProfile.mem0UserId)}`);
      if (!r.ok) return;
      const j = (await r.json()) as { results?: MemoryRow[] };
      setMemoryRows(j.results ?? []);
    } finally {
      setMemoryLoading(false);
    }
  }, [activeProfile]);

  const loadAgentTasks = useCallback(async () => {
    const pid = activeProfile?.id;
    if (!pid) {
      useAppStore.getState().setAgentTasks([]);
      return;
    }
    try {
      const r = await fetch(`/api/tasks?profileId=${encodeURIComponent(pid)}`);
      if (!r.ok) return;
      const j = (await r.json()) as { tasks?: Record<string, unknown>[] };
      const raw = j.tasks ?? [];
      const tasks = raw.map(taskRowToAgentTask).filter((t): t is AgentTask => t != null);
      useAppStore.getState().setAgentTasks(tasks);
    } catch {
      /* ignore */
    }
  }, [activeProfile?.id]);

  const loadMcp = useCallback(async () => {
    const r = await fetch("/api/mcp/servers");
    if (!r.ok) return;
    const j = (await r.json()) as { servers?: McpServer[] };
    setMcpServers(j.servers ?? []);
  }, []);

  const loadUsage = useCallback(async () => {
    const key = activeProfileId ?? "__default__";
    setUsageLoading(true);
    const query = activeProfileId ? `?profileId=${encodeURIComponent(activeProfileId)}` : "";
    try {
      const r = await fetch(`/api/chat/usage${query}`);
      if (!r.ok) return;
      const j = (await r.json()) as { usage?: UsageSnapshot | null };
      setLastUsage(j.usage ?? null);
      setUsageLoadedForProfileId(key);
    } finally {
      setUsageLoading(false);
    }
  }, [activeProfileId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadModels().then(() => void pollHealth());
      void loadProfiles();
      void loadMcp();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      if (healthPollRef.current) clearTimeout(healthPollRef.current);
    };
  }, [loadModels, loadProfiles, loadMcp, pollHealth]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadMemory();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadMemory, activeProfile?.id]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadUsage();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadUsage, activeProfile?.id]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadAgentTasks();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadAgentTasks]);

  const addProfile = useCallback(async () => {
    const name = newProfileName.trim() || "Profile";
    try {
      const r = await fetch("/api/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const p = (await r.json()) as { id?: string };
      if (!r.ok || !p.id) {
        console.warn("addProfile failed", r.status, p);
        onProfileAddFailed?.();
        return;
      }
      setNewProfileName("");
      await loadProfiles();
      onProfileChange(p.id);
    } catch (e) {
      console.warn("addProfile failed", e);
      onProfileAddFailed?.();
    }
  }, [newProfileName, loadProfiles, onProfileChange, onProfileAddFailed]);

  const renameProfile = useCallback(async (id: string, name: string) => {
    const r = await fetch(`/api/profiles/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!r.ok) {
      onSettingsRequestFailed?.();
      return;
    }
    await loadProfiles();
  }, [loadProfiles, onSettingsRequestFailed]);

  const saveCategoryOrder = useCallback(async (category: TaskCategory, order: string[]) => {
    if (!activeProfile?.id) return;
    const prev = activeProfile.modelPreferences?.categories ?? {};
    const r = await fetch(`/api/profiles/${activeProfile.id}/model-preferences`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        modelPreferences: {
          categories: {
            ...prev,
            [category]: { order },
          },
        },
      }),
    });
    if (!r.ok) {
      onSettingsRequestFailed?.();
      return;
    }
    await loadProfiles();
  }, [activeProfile, loadProfiles, onSettingsRequestFailed]);

  const moveCategoryModel = useCallback(
    async (category: TaskCategory, modelId: string, direction: "up" | "down") => {
      const defaults = modelCatalog?.defaults?.[category] ?? [];
      const profileOrder = activeProfile?.modelPreferences?.categories?.[category]?.order ?? [];
      const merged = [...new Set([...profileOrder, ...defaults])];
      const idx = merged.indexOf(modelId);
      if (idx < 0) return;
      const swapWith = direction === "up" ? idx - 1 : idx + 1;
      if (swapWith < 0 || swapWith >= merged.length) return;
      const copy = [...merged];
      [copy[idx], copy[swapWith]] = [copy[swapWith], copy[idx]];
      await saveCategoryOrder(category, copy);
    },
    [activeProfile, modelCatalog, saveCategoryOrder]
  );

  const saveMemoryPolicy = useCallback(async (patch: { topK?: number; maxChars?: number; pinnedOnlyForSimple?: boolean }) => {
    if (!activeProfile?.id) return;
    const r = await fetch(`/api/profiles/${activeProfile.id}/memory-policy`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!r.ok) {
      onSettingsRequestFailed?.();
      return;
    }
    await loadProfiles();
  }, [activeProfile, loadProfiles, onSettingsRequestFailed]);

  const removeProfile = useCallback(
    async (id: string) => {
      if (!confirm(profileDeleteConfirm)) return;
      const r = await fetch(`/api/profiles/${id}`, { method: "DELETE" });
      if (!r.ok) {
        onSettingsRequestFailed?.();
        return;
      }
      await loadProfiles();
    },
    [profileDeleteConfirm, loadProfiles, onSettingsRequestFailed]
  );

  const saveMemory = useCallback(async (id: string, text: string) => {
    const r = await fetch(`/api/memory/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!r.ok) {
      onSettingsRequestFailed?.();
      return;
    }
    await loadMemory();
  }, [loadMemory, onSettingsRequestFailed]);

  const removeMemory = useCallback(
    async (id: string) => {
      if (!confirm(memoryDeleteConfirm)) return;
      const r = await fetch(`/api/memory/${id}`, { method: "DELETE" });
      if (!r.ok) {
        onSettingsRequestFailed?.();
        return;
      }
      await loadMemory();
    },
    [memoryDeleteConfirm, loadMemory, onSettingsRequestFailed]
  );

  const saveMcp = useCallback(async () => {
    const args = mcpForm.args
      .split(/\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      const r = await fetch("/api/mcp/servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: mcpForm.name.trim() || "MCP",
          enabled: mcpForm.enabled,
          transport: mcpForm.transport,
          url: mcpForm.transport === "http" ? mcpForm.url.trim() : undefined,
          command: mcpForm.transport === "stdio" ? mcpForm.command.trim() : undefined,
          args: mcpForm.transport === "stdio" ? args : undefined,
        }),
      });
      if (!r.ok) {
        onMcpSaveFailed?.();
        return;
      }
      setMcpForm({ name: "", transport: mcpForm.transport, url: "", command: "", args: "", enabled: true });
      await loadMcp();
    } catch {
      onMcpSaveFailed?.();
    }
  }, [mcpForm, loadMcp, onMcpSaveFailed]);

  const testMcp = useCallback(async (id: string) => {
    setTestResult(null);
    try {
      const r = await fetch(`/api/mcp/servers/${id}/test`, { method: "POST" });
      const j = (await r.json()) as Record<string, unknown>;
      if (!r.ok) {
        setTestResult(JSON.stringify({ error: j.error ?? j, status: r.status }, null, 2));
        return;
      }
      setTestResult(JSON.stringify(j, null, 2));
    } catch (e) {
      setTestResult(String(e));
    }
  }, []);

  const deleteMcp = useCallback(
    async (id: string) => {
      if (!confirm(mcpDeleteConfirm)) return;
      const r = await fetch(`/api/mcp/servers/${id}`, { method: "DELETE" });
      if (!r.ok) {
        onMcpSaveFailed?.();
        return;
      }
      await loadMcp();
      setTestResult(null);
    },
    [mcpDeleteConfirm, loadMcp, onMcpSaveFailed]
  );

  return {
    models,
    modelCatalog,
    modelsLoading,
    modelHealth,
    profiles,
    profilesLoaded,
    activeProfileId,
    activeProfile,
    memoryRows,
    memoryLoading,
    mcpServers,
    newProfileName,
    setNewProfileName,
    mcpForm,
    setMcpForm,
    testResult,
    lastUsage,
    usageLoading,
    usageLoadedForProfileId,
    setLastUsage,
    onProfileChange,
    loadMemory,
    loadMcp,
    loadUsage,
    addProfile,
    renameProfile,
    saveCategoryOrder,
    moveCategoryModel,
    saveMemoryPolicy,
    removeProfile,
    loadProfiles,
    saveMemory,
    removeMemory,
    saveMcp,
    testMcp,
    deleteMcp,
  };
}
