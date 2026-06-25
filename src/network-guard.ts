import { lookup } from "node:dns/promises";
import net from "node:net";

export type NetworkGuardOptions = {
  allowPrivateNetwork?: boolean;
};

function ipv4Parts(address: string): number[] | undefined {
  const parts = address.split(".").map(Number);
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? parts
    : undefined;
}

function isPrivateIpv4(address: string): boolean {
  const parts = ipv4Parts(address);
  if (!parts) {
    return false;
  }
  const [first, second] = parts;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    first >= 224 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19))
  );
}

function mappedIpv4(address: string): string | undefined {
  const lower = address.toLowerCase();
  const marker = "::ffff:";
  if (lower.startsWith(marker)) {
    return lower.slice(marker.length);
  }
  return undefined;
}

function isPrivateIpv6(address: string): boolean {
  const lower = address.toLowerCase();
  const mapped = mappedIpv4(lower);
  if (mapped) {
    return isPrivateIpv4(mapped);
  }
  return (
    lower === "::" ||
    lower === "::1" ||
    lower.startsWith("fe80:") ||
    lower.startsWith("fc") ||
    lower.startsWith("fd") ||
    lower.startsWith("ff")
  );
}

export function isPrivateAddress(address: string): boolean {
  const normalized = address.replace(/^\[|\]$/g, "");
  const family = net.isIP(normalized);
  if (family === 4) {
    return isPrivateIpv4(normalized);
  }
  if (family === 6) {
    return isPrivateIpv6(normalized);
  }
  const lower = normalized.toLowerCase();
  return lower === "localhost" || lower === "metadata.google.internal";
}

export async function assertAllowedHttpUrl(rawUrl: string, options: NetworkGuardOptions = {}): Promise<URL> {
  const url = new URL(rawUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Unsupported URL protocol: ${url.protocol}`);
  }
  if (options.allowPrivateNetwork) {
    return url;
  }
  if (isPrivateAddress(url.hostname)) {
    throw new Error(`Private network URL is blocked: ${url.origin}`);
  }
  if (net.isIP(url.hostname.replace(/^\[|\]$/g, "")) === 0) {
    const addresses = await lookup(url.hostname, { all: true, verbatim: true });
    const privateAddress = addresses.find((address) => isPrivateAddress(address.address));
    if (privateAddress) {
      throw new Error(`Private network DNS result is blocked: ${url.hostname}`);
    }
  }
  return url;
}
