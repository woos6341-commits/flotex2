import { TRPCError } from "@trpc/server";

/** Bound the outer locking transactions so they cannot occupy every pooled DB connection.
 * The inner financial operation still owns its existing database transaction and checks. */
export function createFinancialGate(maxActive = 4, maxWaiting = 100, waitMs = 15_000) {
  let active = 0;
  const queue: Array<{ start: () => void; timer: ReturnType<typeof setTimeout> }> = [];
  const busy = () => new TRPCError({ code: "TOO_MANY_REQUESTS", message: "العمليات المالية مزدحمة حاليًا؛ حاول مجددًا بعد قليل." });

  async function acquire(): Promise<void> {
    if (active < maxActive && queue.length === 0) { active += 1; return; }
    if (queue.length >= maxWaiting) throw busy();
    await new Promise<void>((resolve, reject) => {
      const entry = {
        start: () => { clearTimeout(entry.timer); active += 1; resolve(); },
        timer: setTimeout(() => {
          const index = queue.indexOf(entry);
          if (index >= 0) queue.splice(index, 1);
          reject(busy());
        }, waitMs),
      };
      queue.push(entry);
    });
  }

  function release() {
    active -= 1;
    queue.shift()?.start();
  }

  return {
    async run<T>(work: () => Promise<T>): Promise<T> {
      await acquire();
      try { return await work(); } finally { release(); }
    },
  };
}
