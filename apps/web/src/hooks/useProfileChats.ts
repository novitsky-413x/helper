import { useEffect, useRef } from "react";
import type { Message } from "@ai-sdk/react";
import type { Profile } from "../types/appTypes";

const LS_PROFILE_CHATS = "helper-profile-chats";

function loadProfileChatsFromStorage(): Record<string, unknown[]> {
  try {
    const raw = localStorage.getItem(LS_PROFILE_CHATS);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, unknown[]> = {};
    for (const [profileId, maybeMsgs] of Object.entries(parsed)) {
      if (!Array.isArray(maybeMsgs)) continue;
      const msgs = maybeMsgs.filter((m) => typeof m === "object" && m !== null);
      out[profileId] = msgs;
    }
    return out;
  } catch {
    return {};
  }
}

export function useProfileChats(params: {
  activeProfile: Profile | null | undefined;
  profiles: Profile[];
  profilesLoaded: boolean;
  messages: unknown[];
  setMessages: (msgs: Message[]) => void;
  setLastUsage: (v: null) => void;
  setResolvedModelId: (v: string | null) => void;
  setResolvedBaseModel: (v: string | null) => void;
  usedModelsByProfileRef: React.MutableRefObject<Record<string, string[]>>;
  setUsedModels: React.Dispatch<React.SetStateAction<string[]>>;
}) {
  const {
    activeProfile, profiles, profilesLoaded, messages, setMessages,
    setLastUsage, setResolvedModelId, setResolvedBaseModel,
    usedModelsByProfileRef, setUsedModels,
  } = params;

  const profileChatsRef = useRef<Record<string, unknown[]>>(loadProfileChatsFromStorage());
  const prevProfileIdRef = useRef<string | null>(null);
  const hydratedChatProfilesRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const currentId = activeProfile?.id ?? null;
    if (!currentId) return;
    if (!hydratedChatProfilesRef.current.has(currentId)) return;
    if (prevProfileIdRef.current && prevProfileIdRef.current !== currentId) return;
    profileChatsRef.current[currentId] = messages;
    localStorage.setItem(LS_PROFILE_CHATS, JSON.stringify(profileChatsRef.current));
  }, [messages, activeProfile?.id]);

  useEffect(() => {
    const nextId = activeProfile?.id ?? null;
    const prevId = prevProfileIdRef.current;
    let timer: number | null = null;
    if (prevId && prevId !== nextId) {
      profileChatsRef.current[prevId] = messages;
      hydratedChatProfilesRef.current.add(prevId);
    }
    if (nextId && prevId !== nextId) {
      setMessages((profileChatsRef.current[nextId] ?? []) as Parameters<typeof setMessages>[0]);
      hydratedChatProfilesRef.current.add(nextId);
      timer = window.setTimeout(() => {
        setLastUsage(null);
        setResolvedModelId(null);
        setResolvedBaseModel(null);
        setUsedModels(usedModelsByProfileRef.current[nextId] ?? []);
      }, 0);
    }
    prevProfileIdRef.current = nextId;
    return () => {
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [activeProfile?.id, messages, setLastUsage, setMessages, setResolvedModelId, setResolvedBaseModel, setUsedModels, usedModelsByProfileRef]);

  useEffect(() => {
    if (!profilesLoaded) return;
    const validIds = new Set(profiles.map((p) => p.id));
    for (const k of Object.keys(profileChatsRef.current)) {
      if (!validIds.has(k)) {
        delete profileChatsRef.current[k];
      }
    }
    localStorage.setItem(LS_PROFILE_CHATS, JSON.stringify(profileChatsRef.current));
  }, [profiles, profilesLoaded]);

  return {
    clearCurrentChat: () => {
      const id = activeProfile?.id;
      if (id) {
        profileChatsRef.current[id] = [];
        localStorage.setItem(LS_PROFILE_CHATS, JSON.stringify(profileChatsRef.current));
      }
      setMessages([]);
    },
  };
}
