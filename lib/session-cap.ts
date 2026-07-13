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
