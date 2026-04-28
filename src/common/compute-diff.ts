export function computeDiff(
  before: Record<string, any>,
  after: Record<string, any>,
  fields: string[],
): Record<string, { from: any; to: any }> {
  const changes: Record<string, { from: any; to: any }> = {};
  for (const field of fields) {
    const oldVal = before[field] ?? null;
    const newVal = after[field] ?? null;
    if (String(oldVal) !== String(newVal)) {
      changes[field] = { from: oldVal, to: newVal };
    }
  }
  return changes;
}
