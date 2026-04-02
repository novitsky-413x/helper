import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { buildTool } from "./buildTool.js";
import { logger } from "../logger.js";

function extensionFromContentType(contentType: string): string {
  const semi = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  const map: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/svg+xml": ".svg",
    "text/plain": ".txt",
    "text/html": ".html",
    "application/json": ".json",
    "application/pdf": ".pdf",
    "application/zip": ".zip",
    "application/octet-stream": ".bin",
  };
  if (map[semi]) return map[semi];
  const subtype = semi.split("/")[1]?.replace(/[^a-z0-9]/gi, "") ?? "";
  return subtype ? `.${subtype.slice(0, 16)}` : ".bin";
}

function parseContentDisposition(header: string | null): string {
  if (!header) return "";
  const star = header.match(/filename\*\s*=\s*[^']*''([^;\s]+)/i);
  if (star) {
    try {
      return decodeURIComponent(star[1].replace(/^"(.*)"$/, "$1"));
    } catch {
      /* ignore */
    }
  }
  const quoted = header.match(/filename\s*=\s*"((?:\\.|[^"\\])*)"/i);
  if (quoted) return quoted[1].replace(/\\(.)/g, "$1");
  const plain = header.match(/filename\s*=\s*([^;\s]+)/i);
  if (plain) return plain[1].replace(/^"(.*)"$/, "$1");
  return "";
}

function extractFilenameFromUrl(urlString: string): string {
  try {
    const u = new URL(urlString);
    const seg = u.pathname.split("/").filter(Boolean).pop();
    return seg ? decodeURIComponent(seg) : "";
  } catch {
    return "";
  }
}

function safeBasename(name: string): string {
  const base = path.basename(name.replace(/\\/g, "/"));
  if (!base || base === "." || base === "..") return "";
  return base;
}

function isInsideWorkspace(filePath: string, workingDirectory: string): boolean {
  const resolvedFile = path.resolve(filePath);
  const resolvedWd = path.resolve(workingDirectory);
  const rel = path.relative(resolvedWd, resolvedFile);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
): Promise<Response> {
  let response = await fetch(url, init);
  if (response.status === 429 || response.status === 503) {
    logger.warn({ status: response.status, url }, "download_file retrying after transient HTTP status");
    await delayMs(1000);
    response = await fetch(url, init);
  }
  return response;
}

export const DownloadFileTool = buildTool({
  name: "download_file",
  description:
    "Download a file from a URL and save it to the workspace. Useful for saving generated images, downloading documents, or fetching any file from the internet.",
  inputSchema: z.object({
    url: z.string().url().describe("The URL to download from"),
    filename: z
      .string()
      .optional()
      .describe("Desired filename. If omitted, derived from URL, Content-Disposition, or a UUID."),
  }),
  isReadOnly: false,
  isConcurrencySafe: true,

  async call(input, context) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const fetchInit: RequestInit = {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; HelperBot/1.0)",
          Accept: "*/*",
        },
      };

      const response = await fetchWithRetry(input.url, fetchInit);

      if (!response.ok) {
        return `Download failed: HTTP ${response.status} ${response.statusText}`;
      }

      const contentTypeHeader = response.headers.get("content-type") ?? "application/octet-stream";
      const ext = extensionFromContentType(contentTypeHeader);

      const arrayBuffer = await response.arrayBuffer();
      clearTimeout(timeout);
      const buf = Buffer.from(arrayBuffer);

      let resolvedFilename = "";
      if (input.filename?.trim()) {
        resolvedFilename = safeBasename(input.filename.trim());
      }
      if (!resolvedFilename) {
        resolvedFilename = safeBasename(extractFilenameFromUrl(input.url));
      }
      if (!resolvedFilename) {
        resolvedFilename = safeBasename(
          parseContentDisposition(response.headers.get("content-disposition")),
        );
      }
      if (!resolvedFilename) {
        resolvedFilename = `download-${randomUUID()}${ext}`;
      } else if (!path.extname(resolvedFilename)) {
        resolvedFilename = `${resolvedFilename}${ext}`;
      }

      const dest = path.join(context.workingDirectory, resolvedFilename);
      if (!isInsideWorkspace(dest, context.workingDirectory)) {
        return "Download failed: resolved path would escape the workspace (invalid filename).";
      }

      await fs.writeFile(dest, buf);

      return (
        `Downloaded successfully: ${dest} — ${buf.length} bytes, content-type: ${contentTypeHeader}`
      );
    } catch (e: unknown) {
      const err = e as { name?: string; message?: string };
      logger.warn({ err: e, url: input.url }, "download_file failed");
      if (err.name === "AbortError") {
        return `Download failed: timeout (30s) for ${input.url}`;
      }
      return `Download failed: ${err.message ?? String(e)}`;
    } finally {
      clearTimeout(timeout);
    }
  },
});
