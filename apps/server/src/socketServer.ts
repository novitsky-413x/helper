import { Server as SocketIOServer } from "socket.io";
import type { Server as HttpServer } from "node:http";
import { config } from "./config.js";
import { logger } from "./logger.js";

let io: SocketIOServer | null = null;

export function initSocketServer(httpServer: HttpServer): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: config.webOrigin,
      credentials: true,
    },
    path: "/socket.io",
    transports: ["websocket", "polling"],
  });

  const terminalNs = io.of("/terminal");
  const autopilotNs = io.of("/autopilot");
  const agentNs = io.of("/agent");

  terminalNs.on("connection", (socket) => {
    logger.debug({ socketId: socket.id }, "terminal client connected");
    socket.on("disconnect", () => {
      logger.debug({ socketId: socket.id }, "terminal client disconnected");
    });
  });

  autopilotNs.on("connection", (socket) => {
    logger.debug({ socketId: socket.id }, "autopilot client connected");
    socket.on("disconnect", () => {
      logger.debug({ socketId: socket.id }, "autopilot client disconnected");
    });
  });

  agentNs.on("connection", (socket) => {
    logger.debug({ socketId: socket.id }, "agent client connected");
    socket.on("disconnect", () => {
      logger.debug({ socketId: socket.id }, "agent client disconnected");
    });
  });

  logger.info("Socket.io server initialized");
  return io;
}

export function getIO(): SocketIOServer | null {
  return io;
}

export function closeSocketServer() {
  if (io) {
    io.close();
    io = null;
    logger.info("Socket.io server closed");
  }
}
