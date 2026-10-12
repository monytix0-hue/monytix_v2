export type RateLimit = {
  allow(key: string): boolean;
};

export function createRateLimit(limit: number, windowMs: number): RateLimit {
  const buckets = new Map<string, { count: number; reset: number }>();
  return {
    allow(key) {
      const now = Date.now();
      if (buckets.size > 10_000) {
        for (const [bucketKey, bucket] of buckets) {
          if (bucket.reset <= now) {
            buckets.delete(bucketKey);
          }
        }
      }
      const current = buckets.get(key);
      if (!current || current.reset <= now) {
        buckets.set(key, { count: 1, reset: now + windowMs });
        return true;
      }
      if (current.count >= limit) {
        return false;
      }
      current.count += 1;
      return true;
    },
  };
}
