import { spawn } from "node:child_process";
import { readFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

export async function piperSynth(
  text: string,
  piperExecutable: string,
  modelPath: string
): Promise<Buffer> {
  const trimmed = text.trim();
  if (!trimmed) {
    return Buffer.alloc(0);
  }

  const outFile = path.join(tmpdir(), `helper-piper-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`);

  return await new Promise((resolve, reject) => {
    const proc = spawn(piperExecutable, ["--model", modelPath, "--output_file", outFile], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    let stderr = "";
    proc.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
    });

    proc.on("error", (err) => {
      reject(err);
    });

    proc.on("close", (code) => {
      try {
        if (code !== 0) {
          reject(new Error(stderr.trim() || `piper exited with code ${code}`));
          return;
        }
        const buf = readFileSync(outFile);
        unlinkSync(outFile);
        resolve(buf);
      } catch (e) {
        try {
          unlinkSync(outFile);
        } catch {
          /* ignore */
        }
        reject(e);
      }
    });

    proc.stdin?.write(trimmed + "\n", (err) => {
      if (err) reject(err);
      else proc.stdin?.end();
    });
  });
}
