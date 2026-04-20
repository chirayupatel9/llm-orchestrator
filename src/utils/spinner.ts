/**
 * Lightweight terminal spinner
 * Works on any TTY; gracefully degrades to plain lines in CI/pipe
 */

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const isTTY = process.stderr.isTTY;

const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
  clearLine: "\x1b[2K\r",
};

export class Spinner {
  private text: string;
  private frame = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  constructor(text: string) {
    this.text = text;
  }

  start(): this {
    if (!isTTY) {
      process.stderr.write(`  → ${this.text}\n`);
      return this;
    }
    this.timer = setInterval(() => {
      const f = FRAMES[this.frame % FRAMES.length];
      process.stderr.write(`${C.clearLine}${C.cyan}${f}${C.reset} ${this.text}`);
      this.frame++;
    }, 80);
    return this;
  }

  update(text: string): void {
    this.text = text;
  }

  succeed(text?: string): void {
    this.stop(`${C.green}✓${C.reset} ${text ?? this.text}`);
  }

  fail(text?: string): void {
    this.stop(`${C.red}✗${C.reset} ${text ?? this.text}`);
  }

  warn(text?: string): void {
    this.stop(`${C.yellow}⚠${C.reset} ${text ?? this.text}`);
  }

  info(text: string): void {
    if (!isTTY) {
      process.stderr.write(`    ${C.gray}${text}${C.reset}\n`);
      return;
    }
    const current = this.text;
    if (this.timer) clearInterval(this.timer);
    process.stderr.write(`${C.clearLine}  ${C.gray}${text}${C.reset}\n`);
    // restart
    this.frame = 0;
    this.timer = setInterval(() => {
      const f = FRAMES[this.frame % FRAMES.length];
      process.stderr.write(`${C.clearLine}${C.cyan}${f}${C.reset} ${current}`);
      this.frame++;
    }, 80);
  }

  private stop(line: string): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (isTTY) {
      process.stderr.write(`${C.clearLine}${line}\n`);
    } else {
      process.stderr.write(`  ${line}\n`);
    }
  }
}

export function printBanner(query: string): void {
  const line = "─".repeat(Math.min(process.stderr.columns ?? 60, 64));
  process.stderr.write(`\n${C.dim}${line}${C.reset}\n`);
  process.stderr.write(`${C.bold}  Orchestrator${C.reset}  ${C.dim}${query.slice(0, 56)}${query.length > 56 ? "…" : ""}${C.reset}\n`);
  process.stderr.write(`${C.dim}${line}${C.reset}\n\n`);
}
