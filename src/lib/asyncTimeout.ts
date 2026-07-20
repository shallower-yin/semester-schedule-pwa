// Races a promise against a timer so a stuck async call (a hung native bridge call, an unreachable
// network request) can never freeze the UI. On timeout the returned promise rejects with `message`.
export async function withTimeout<T>(operation: PromiseLike<T>, timeoutMs: number, message: string): Promise<T> {
  let timer = 0;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve(operation), timeout]);
  } finally {
    window.clearTimeout(timer);
  }
}
