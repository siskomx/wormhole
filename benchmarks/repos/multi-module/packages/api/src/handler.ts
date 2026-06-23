import { loadConfig } from "../../../core/src";

export function getServiceStatus() {
  const config = loadConfig();
  return {
    service: config.serviceName,
    timeoutMs: config.timeoutMs,
  };
}
