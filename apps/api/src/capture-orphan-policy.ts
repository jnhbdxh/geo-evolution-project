export const captureOrphanMinimumAgeMs = 24 * 60 * 60 * 1_000;

export function isCaptureOrphanPastGracePeriod(
  objectLastModifiedAt: Date,
  databaseNow: Date,
): boolean {
  return databaseNow.getTime() - objectLastModifiedAt.getTime() >= captureOrphanMinimumAgeMs;
}
