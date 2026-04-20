#!/usr/bin/env node

// Load .env from project root
import dotenv from "dotenv";
import path from "path";

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import { Command } from "commander";
import { orchestrate } from "./orchestrator/index.js";
import { formatOutput } from "./utils/format.js";
import { attachCliProgress } from "./utils/cli-progress.js";

const program = new Command();

program
  .name("orchestrate")
  .description("LLM-powered research orchestrator with grounded, cited outputs")
  .version("1.0.0")
  .argument("[query]", "The research question to answer (omit when using --serve)")
  .option("-k, --top-k <number>", "Number of snippets to use for synthesis", "5")
  .option("-v, --verbose", "Show live step spinners in terminal", false)
  .option("--serve [port]", "Launch browser UI on given port (default: 3000)")
  .option("--json", "Output raw JSON instead of formatted text", false)
  .option("--no-trace", "Omit the trace from output", false)
  .action(async (query: string | undefined, opts) => {
    const topK    = parseInt(opts.topK as string, 10);
    const verbose = opts.verbose as boolean;
    const useJson = opts.json as boolean;
    const noTrace = !opts.trace as boolean;
    const serveOpt = opts.serve;

    if (isNaN(topK) || topK < 1) {
      console.error("--top-k must be a positive integer");
      process.exit(1);
    }

    // --serve mode
    if (serveOpt !== undefined) {
      const port = serveOpt === true ? 3000 : parseInt(String(serveOpt), 10);
      if (isNaN(port)) {
        console.error("--serve port must be a number");
        process.exit(1);
      }
      const { createServer } = await import("./server/index.js");
      createServer(port);
      return;
    }

    // CLI mode
    if (!query) {
      console.error("Error: query argument is required when not using --serve");
      program.help();
      process.exit(1);
    }

    let cleanup: (() => void) | undefined;
    if (verbose) {
      cleanup = attachCliProgress(query);
    }

    try {
      const output = await orchestrate(query, { topK });
      cleanup?.();
      console.log(formatOutput(output, { json: useJson, noTrace }));
      process.exit(0);
    } catch (err) {
      cleanup?.();
      console.error(`\nFatal error: ${(err as Error).message}`);
      process.exit(1);
    }
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});