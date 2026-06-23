import { runSync } from "./sync";

export async function main(argv: string[]): Promise<string> {
  const dryRun = argv.includes("--dry-run");
  const result = await runSync({ dryRun });
  return `synced ${result.count} records`;
}
