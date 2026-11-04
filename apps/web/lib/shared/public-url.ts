import { isIP } from "node:net";

export function parsePublicHttpsUrl(value: string | URL | null | undefined) {
  const parsed = parseAbsoluteUrl(value);
  if (
    !parsed ||
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    isPrivateOrLocalHostname(parsed.hostname)
  ) {
    return null;
  }

  return parsed;
}

export function normalizePublicHttpsOrigin(
  value: string | URL | null | undefined,
) {
  return parsePublicHttpsUrl(value)?.origin ?? null;
}

export function isPrivateOrLocalHostname(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "::" ||
    host === "::1"
  ) {
    return true;
  }

  const mappedIpv4 = readIpv4MappedIpv6(host);
  if (mappedIpv4 === "invalid") {
    return true;
  }
  if (mappedIpv4) {
    return isPrivateOrLocalIpv4(mappedIpv4);
  }

  const decimalIntegerIpv4 = readDecimalIntegerIpv4(host);
  if (decimalIntegerIpv4) {
    return isPrivateOrLocalIpv4(decimalIntegerIpv4);
  }

  const ipv4 = readIpv4Octets(host);
  if (ipv4 === "invalid") {
    return true;
  }
  if (ipv4) {
    return isPrivateOrLocalIpv4(ipv4);
  }

  if (isIP(host) === 6) {
    return isPrivateOrLocalIpv6(host);
  }

  return false;
}

function parseAbsoluteUrl(value: string | URL | null | undefined) {
  if (value instanceof URL) {
    return new URL(value.toString());
  }

  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return new URL(trimmed);
  } catch {
    return null;
  }
}

function readIpv4MappedIpv6(host: string): number[] | "invalid" | null {
  const dotted = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (dotted) {
    return readIpv4Octets(dotted[1]);
  }

  const packed = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (!packed) {
    return null;
  }

  const high = Number.parseInt(packed[1], 16);
  const low = Number.parseInt(packed[2], 16);
  if (!Number.isFinite(high) || !Number.isFinite(low)) {
    return null;
  }

  return [
    (high >> 8) & 0xff,
    high & 0xff,
    (low >> 8) & 0xff,
    low & 0xff,
  ];
}

function readIpv4Octets(host: string): number[] | "invalid" | null {
  const parts = host.split(".");
  if (parts.length !== 4) {
    return null;
  }

  const octets: number[] = [];
  for (const part of parts) {
    if (!/^(0|[1-9]\d*)$/.test(part)) {
      return "invalid";
    }
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet > 255) {
      return "invalid";
    }
    octets.push(octet);
  }

  return octets;
}

function readDecimalIntegerIpv4(host: string) {
  if (!/^\d+$/.test(host)) {
    return null;
  }

  const value = Number(host);
  if (!Number.isInteger(value) || value < 0 || value > 0xff_ff_ff_ff) {
    return null;
  }

  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ];
}

function isPrivateOrLocalIpv4(octets: number[]) {
  const [first, second] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    first >= 224
  );
}

function isPrivateOrLocalIpv6(host: string) {
  const firstHextet = Number.parseInt(host.split(":")[0] || "0", 16);
  if (!Number.isFinite(firstHextet)) {
    return false;
  }

  return (
    (firstHextet >= 0xfc00 && firstHextet <= 0xfdff) ||
    (firstHextet >= 0xfe80 && firstHextet <= 0xfebf)
  );
}
