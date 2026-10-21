export type SnapshotCache = {
  get(ownerId: string): Promise<unknown | null>;
  put(ownerId: string, snapshot: unknown): Promise<void>;
};

export function memorySnapshots(): SnapshotCache {
  const rows = new Map<string, unknown>();
  return {
    async get(ownerId: string) {
      return rows.get(ownerId) ?? null;
    },
    async put(ownerId: string, snapshot: unknown) {
      rows.set(ownerId, snapshot);
    },
  };
}

export async function openSnapshotCache(url: string): Promise<SnapshotCache> {
  const { createClient } = await import("redis");
  const client = createClient({ url });
  await client.connect();
  return {
    async get(ownerId: string) {
      const raw = await client.get(`finance:home:${ownerId}`);
      return raw ? JSON.parse(raw) as unknown : null;
    },
    async put(ownerId: string, snapshot: unknown) {
      await client.set(`finance:home:${ownerId}`, JSON.stringify(snapshot));
    },
  };
}
