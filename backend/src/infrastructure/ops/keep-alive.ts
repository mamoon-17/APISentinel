export function startKeepAlive(input: {
  url: string;
  intervalMs: number;
  timeoutMs?: number;
}): { stop: () => void } {
  const timeoutMs = input.timeoutMs ?? 10_000;

  async function pingOnce() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      await fetch(input.url, {
        method: "GET",
        signal: controller.signal,
        headers: { "user-agent": "APISentinel-keep-alive" },
      });
    } catch (err) {
      // Keep-alive must never crash the process.
      console.warn(`[keep-alive] ping failed url=${input.url}`, err);
    } finally {
      clearTimeout(timer);
    }
  }

  // Ping shortly after boot so Render warms the instance.
  void pingOnce();

  const handle = setInterval(() => {
    void pingOnce();
  }, input.intervalMs);

  // Don't keep Node alive just because of this timer.
  handle.unref?.();

  return {
    stop: () => clearInterval(handle),
  };
}

