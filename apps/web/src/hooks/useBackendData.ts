import { useCallback, useEffect, useMemo, useState } from "react";
import type { McpForm } from "../components/McpModal";
import type { ModelCatalog, McpServer, MemoryRow, Profile, TaskCategory, UsageSnapshot } from "../types/appTypes";

const LS_PROFILE = "helper-active-profile";

export function useBackendData(params: {
  profileDeleteConfirm: string;
  memoryDeleteConfirm: string;
  mcpDeleteConfirm: string;
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
      }
    } catch {
      /* ignore */
    } finally {
      setModelsLoading(false);
    }
  }, []);

  const loadProfiles = useCallback(async () => {
    const r = await fetch("/api/profiles");
    if (!r.ok) return;
    const j = (await r.json()) as { profiles: Profile[] };
    const list = j.profiles;
    setProfiles(list);
    const fromLs = localStorage.getItem(LS_PROFILE);
    if (fromLs && list.some((p) => p.id === fromLs)) {
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
      void loadModels();
      void loadProfiles();
      void loadMcp();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadModels, loadProfiles, loadMcp]);

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

  const addProfile = useCallback(async () => {
    const name = newProfileName.trim() || "Profile";
    const r = await fetch("/api/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const p = await r.json();
    setNewProfileName("");
    await loadProfiles();
    onProfileChange(p.id);
  }, [newProfileName, loadProfiles, onProfileChange]);

  const renameProfile = useCallback(async (id: string, name: string) => {
    await fetch(`/api/profiles/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    await loadProfiles();
  }, [loadProfiles]);

  const saveCategoryOrder = useCallback(async (category: TaskCategory, order: string[]) => {
    if (!activeProfile?.id) return;
    const prev = activeProfile.modelPreferences?.categories ?? {};
    await fetch(`/api/profiles/${activeProfile.id}/model-preferences`, {
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
    await loadProfiles();
  }, [activeProfile, loadProfiles]);

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
    await fetch(`/api/profiles/${activeProfile.id}/memory-policy`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    await loadProfiles();
  }, [activeProfile, loadProfiles]);

  const removeProfile = useCallback(
    async (id: string) => {
      if (!confirm(params.profileDeleteConfirm)) return;
      await fetch(`/api/profiles/${id}`, { method: "DELETE" });
      await loadProfiles();
      const next = profiles.find((p) => p.id !== id);
      if (next) onProfileChange(next.id);
    },
    [params.profileDeleteConfirm, loadProfiles, profiles, onProfileChange]
  );

  const saveMemory = useCallback(async (id: string, text: string) => {
    await fetch(`/api/memory/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    await loadMemory();
  }, [loadMemory]);

  const removeMemory = useCallback(
    async (id: string) => {
      if (!confirm(params.memoryDeleteConfirm)) return;
      await fetch(`/api/memory/${id}`, { method: "DELETE" });
      await loadMemory();
    },
    [params.memoryDeleteConfirm, loadMemory]
  );

  const saveMcp = useCallback(async () => {
    const args = mcpForm.args
      .split(/\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    await fetch("/api/mcp/servers", {
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
    setMcpForm({ name: "", transport: mcpForm.transport, url: "", command: "", args: "", enabled: true });
    await loadMcp();
  }, [mcpForm, loadMcp]);

  const testMcp = useCallback(async (id: string) => {
    setTestResult(null);
    const r = await fetch(`/api/mcp/servers/${id}/test`, { method: "POST" });
    const j = await r.json();
    setTestResult(JSON.stringify(j, null, 2));
  }, []);

  const deleteMcp = useCallback(
    async (id: string) => {
      if (!confirm(params.mcpDeleteConfirm)) return;
      await fetch(`/api/mcp/servers/${id}`, { method: "DELETE" });
      await loadMcp();
      setTestResult(null);
    },
    [params.mcpDeleteConfirm, loadMcp]
  );

  return {
    models,
    modelCatalog,
    modelsLoading,
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
    saveMemory,
    removeMemory,
    saveMcp,
    testMcp,
    deleteMcp,
  };
}
