export async function runSync(options: { dryRun: boolean }): Promise<{ count: number }> {
  if (options.dryRun) {
    return { count: 0 };
  }
  return { count: 12 };
}
