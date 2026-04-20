import { EventEmitter } from "events";

export type ProgressEventType =
  | "plan"
  | "step:start"
  | "step:done"
  | "step:fail"
  | "step:info"
  | "rank"
  | "synthesize:start"
  | "synthesize:done"
  | "token"
  | "error";

export interface ProgressEvent {
  type: ProgressEventType;
  stepId?: string;
  stepType?: string;
  description?: string;
  durationMs?: number;
  message?: string;
  data?: unknown;
}

type ProgressListener = (e: ProgressEvent) => void;

class ProgressBus {
  private emitter = new EventEmitter();

  publish(payload: ProgressEvent): void {
    this.emitter.emit("progress", payload);
  }

  on(event: "progress", listener: ProgressListener): this {
    this.emitter.on(event, listener);
    return this;
  }

  off(event: "progress", listener: ProgressListener): this {
    this.emitter.off(event, listener);
    return this;
  }
}

// Singleton
export const progressBus = new ProgressBus();