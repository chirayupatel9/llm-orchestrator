import express from "express";
import cors from "cors";
import path from "path";
import { progressBus, ProgressEvent } from "../utils/progress.js";
import { orchestrate } from "../orchestrator/index.js";
import { OrchestratorOutput } from "../types.js";

export function createServer(port = 3000) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Serve the single-file UI
  const uiPath = path.resolve(process.cwd(), "ui/index.html");
  app.get("/", (_req, res) => res.sendFile(uiPath));

  /**
   * POST /query
   * Body: { query: string, topK?: number }
   * Returns: SSE stream of ProgressEvent objects, then a final "done" event
   */
  app.post("/query", async (req, res) => {
    const { query, topK = 5 } = req.body as { query?: string; topK?: number };

    if (!query || typeof query !== "string" || query.trim().length === 0) {
      res.status(400).json({ error: "query is required" });
      return;
    }

    // Set up SSE
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    function send(eventName: string, data: unknown) {
      res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
      // Force flush so browser receives each frame immediately
      if (typeof (res as any).flush === "function") (res as any).flush();
    }

    // Forward progress events to SSE
    function onProgress(e: ProgressEvent) {
      send("progress", e);
    }
    progressBus.on("progress", onProgress);

    // Cleanup on client disconnect
    req.on("close", () => {
      progressBus.off("progress", onProgress);
    });

    try {
      const output: OrchestratorOutput = await orchestrate(query.trim(), { topK });
      send("done", output);
    } catch (err) {
      send("error", { message: (err as Error).message });
    } finally {
      progressBus.off("progress", onProgress);
      res.end();
    }
  });

  return app.listen(port, () => {
    const url = `http://localhost:${port}`;
    process.stdout.write(`\n  Orchestrator UI  →  ${url}\n\n`);

    // Auto-open browser (best-effort, non-fatal)
    const { exec } = require("child_process") as typeof import("child_process");
    const cmd =
      process.platform === "darwin" ? `open ${url}` :
      process.platform === "win32" ? `start ${url}` :
      `xdg-open ${url}`;
    exec(cmd, () => {/* ignore errors */});
  });
}
