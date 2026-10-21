export const QUEUES = ["intake", "cash", "holdings", "obligations", "reconciliation", "context", "decisions"] as const;

export type QueueName = (typeof QUEUES)[number];

export type QueueClient = {
  enqueue(input: { task: string; queue: QueueName; payload: Record<string, unknown> }): Promise<void>;
};

export async function publishRecord(queue: QueueClient | null | undefined, record: { inserted?: boolean }): Promise<void> {
  if (!queue || record.inserted === false) return;
  await queue.enqueue({ task: "intake.record", queue: "intake", payload: { record: record as unknown as Record<string, unknown> } });
}
