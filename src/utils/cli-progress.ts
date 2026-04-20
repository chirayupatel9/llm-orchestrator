import { progressBus, ProgressEvent } from "./progress.js";
import { Spinner, printBanner } from "./spinner.js";

// Attach the terminal spinner UI to the progress bus.
// Call before `orchestrate()`. Returns a cleanup function.
export function attachCliProgress(query: string): () => void {
  printBanner(query);

  const spinners = new Map<string, Spinner>();

  const TYPE_LABEL: Record<string, string> = {
    search: "search  ",
    fetch: "fetch   ",
    rank: "rank    ",
    synthesize: "synth   ",
    planner: "plan    ",
  };

  function label(type?: string) {
    return TYPE_LABEL[type ?? ""] ?? (type?.padEnd(8) ?? "        ");
  }

  function handler(e: ProgressEvent) {
    switch (e.type) {
      case "plan": {
        // Close the planner spinner
        spinners.get("planner")?.succeed(`plan     ${e.message}`);
        spinners.delete("planner");
        break;
      }

      case "step:start": {
        const id = e.stepId!;
        const s = new Spinner(`${label(e.stepType)} ${e.description ?? id}`).start();
        spinners.set(id, s);
        break;
      }

      case "step:done": {
        const id = e.stepId!;
        spinners
          .get(id)
          ?.succeed(`${label(e.stepType)} ${e.description ?? id}  ${dim(`${e.durationMs}ms`)}`);
        spinners.delete(id);
        break;
      }

      case "step:fail": {
        const id = e.stepId!;
        spinners.get(id)?.fail(`${label(e.stepType)} ${e.description ?? id}  ${e.message ?? ""}`);
        spinners.delete(id);
        break;
      }

      case "step:info": {
        spinners.get(e.stepId ?? "")?.info(e.message ?? "");
        break;
      }

      case "rank": {
        const s = new Spinner(`rank     ${e.message ?? "Ranking snippets..."}`).start();
        spinners.set("__rank__", s);
        setTimeout(() => {
          spinners.get("__rank__")?.succeed(`rank     ${e.message ?? "Snippets ranked"}`);
          spinners.delete("__rank__");
        }, 200);
        break;
      }

      case "synthesize:start": {
        const s = new Spinner(`synth    ${e.message ?? "Synthesizing..."}`).start();
        spinners.set("__synth__", s);
        break;
      }

      case "synthesize:done": {
        spinners.get("__synth__")?.succeed(`synth    Answer ready`);
        spinners.delete("__synth__");
        break;
      }
    }
  }

  progressBus.on("progress", handler);
  return () => progressBus.off("progress", handler);
}

function dim(s: string): string {
  return `\x1b[2m${s}\x1b[0m`;
}
