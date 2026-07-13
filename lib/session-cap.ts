// lib/session-cap.ts
declare global {
  // eslint-disable-next-line no-var
  var __piSessionCounter: { count: number } | undefined;
}

const MAX = 50;

function getCounter() {
  if (!globalThis.__piSessionCounter) {
    globalThis.__piSessionCounter = { count: 0 };
  }
  return globalThis.__piSessionCounter;
}

export function sessionCapCheck(): { allowed: boolean; current: number } {
  const counter = getCounter();
  if (counter.count >= MAX) {
    return { allowed: false, current: counter.count };
  }
  return { allowed: true, current: counter.count };
}

export function sessionCapIncrement(): void {
  const counter = getCounter();
  counter.count++;
}

export function sessionCapDecrement(): void {
  const counter = getCounter();
  if (counter.count > 0) counter.count--;
}

export const SESSION_CAP_MAX = MAX;

// M2.2 known limitation: sessionCapDecrement has no production call site.
// The fork's SessionManager does not expose a close hook for the M1 RSC
// subsystem, so the in-memory counter only grows during a server's lifetime.
// A process-exit observer below ensures graceful shutdown logs the final
// count; M2.3+ will add a proper session-close hook.
if (typeof process !== "undefined") {
  process.on("beforeExit", () => {
    const counter = getCounter();
    // eslint-disable-next-line no-console
    console.log(
      `[session-cap] shutdown: final count = ${counter.count} (max ${MAX})`
    );
  });
}
