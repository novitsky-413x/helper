import { getDb } from "../../db.js";
import { logger } from "../../logger.js";
import { getIO } from "../../socketServer.js";
import { registerShutdownTask } from "../../lifecycle.js";
import { runObservationCycle } from "./observer.js";
import type { AutopilotMode } from "@helper/shared";

const DEFAULT_INTERVAL_MS = 60 * 1000;
let observerTimer: ReturnType<typeof setInterval> | null = null;
let currentMode: AutopilotMode = "advisory";

export function getAutopilotMode(): AutopilotMode {
  return currentMode;
}

export function setAutopilotMode(mode: AutopilotMode) {
  currentMode = mode;
  logger.info({ mode }, "Autopilot mode changed");
  getIO()?.of("/autopilot").emit("autopilot:action", {
    observationId: "mode-change",
    action: `Mode set to ${mode}`,
  });
}

export function initAutopilot() {
  observerTimer = setInterval(() => {
    if (currentMode === "passive") return;
    void runObservationCycle(currentMode).catch((e) =>
      logger.error({ err: e }, "Autopilot observation cycle failed")
    );
  }, DEFAULT_INTERVAL_MS);
  observerTimer.unref();

  const io = getIO();
  io?.of("/autopilot").on("connection", (socket) => {
    socket.on("autopilot:set-mode", (mode: AutopilotMode) => {
      if (["passive", "advisory", "autonomous"].includes(mode)) {
        setAutopilotMode(mode);
      }
    });
  });

  logger.info({ mode: currentMode, intervalMs: DEFAULT_INTERVAL_MS }, "Autopilot initialized");
}

export function stopAutopilot() {
  if (observerTimer) {
    clearInterval(observerTimer);
    observerTimer = null;
  }
}

registerShutdownTask("autopilot:stop", stopAutopilot);
