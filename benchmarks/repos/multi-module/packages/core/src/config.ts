export type ServiceConfig = {
  serviceName: string;
  timeoutMs: number;
  retryCount: number;
};

export function loadConfig(): ServiceConfig {
  return {
    serviceName: process.env.SERVICE_NAME ?? "fixture-api",
    timeoutMs: Number(process.env.TIMEOUT_MS ?? 5000),
    retryCount: Number(process.env.RETRY_COUNT ?? 2),
  };
}
