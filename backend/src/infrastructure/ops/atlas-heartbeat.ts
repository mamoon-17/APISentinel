import { MongoClient } from "mongodb";

type HeartbeatDoc = {
  _id: string;
  ts: Date;
  tag: "heartbeat";
};

export function startAtlasHeartbeat(input: {
  mongoUri: string;
  dbName: string;
  collectionName: string;
  intervalMs: number;
}): { stop: () => Promise<void> } {
  const client = new MongoClient(input.mongoUri, {
    // Keep it simple; rely on defaults + driver pooling.
  });

  let timer: NodeJS.Timeout | null = null;
  let stopped = false;
  let connected = false;

  async function beatOnce() {
    if (stopped) return;
    try {
      if (!connected) {
        await client.connect();
        connected = true;
      }
      const col = client
        .db(input.dbName)
        .collection<HeartbeatDoc>(input.collectionName);

      const _id = "apisentinel-heartbeat";
      await col.updateOne(
        { _id },
        { $set: { _id, ts: new Date(), tag: "heartbeat" } },
        { upsert: true },
      );

      // Delete immediately after the write so we don't accumulate docs.
      await col.deleteOne({ _id });
    } catch (err) {
      console.warn("[atlas-heartbeat] beat failed", err);
    }
  }

  void beatOnce();
  timer = setInterval(() => void beatOnce(), input.intervalMs);
  timer.unref?.();

  return {
    stop: async () => {
      stopped = true;
      if (timer) clearInterval(timer);
      try {
        await client.close();
      } catch {
        // ignore
      }
    },
  };
}

