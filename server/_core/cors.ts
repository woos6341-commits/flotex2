import type { RequestHandler } from "express";
import { BlockList, isIP } from "node:net";

const LOOPBACK_IPS = new BlockList();
LOOPBACK_IPS.addSubnet("127.0.0.0", 8, "ipv4");
LOOPBACK_IPS.addAddress("::1", "ipv6");
LOOPBACK_IPS.addSubnet("::ffff:127.0.0.0", 104, "ipv6");
function configuredOrigin(name: "EXPO_PACKAGER_PROXY_URL" | "EXPO_WEB_PREVIEW_URL"): string | null {
  const value = process.env[name];
  if (!value) return null;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && url.origin === value
      ? value
      : null;
  } catch {
    return null;
  }
}

function pairedPreviewOrigin(packagerOrigin: string): string | null {
  const url = new URL(packagerOrigin);
  const previewHostname = url.hostname.replace(/^8081-/, "8328-");
  if (previewHostname === url.hostname) return null;
  url.hostname = previewHostname;
  return url.origin;
}

export function trustedExpoWebOrigins(): Set<string> {
  const origins = new Set<string>();
  const packager = configuredOrigin("EXPO_PACKAGER_PROXY_URL");
  const preview = configuredOrigin("EXPO_WEB_PREVIEW_URL");
  // Loopback origins are request-local below. Never put one in this process-wide set: the
  // same starter can also be reached through a remote API host.
  for (const configured of [packager, preview]) {
    if (configured && !originHasLoopbackHostname(configured)) origins.add(configured);
  }
  // Backward-compatible production fallback while every runtime starts injecting the explicit
  // 8328 origin. Localhost cannot use hostname prefix derivation and is handled only by exact env.
  if (packager && !originHasLoopbackHostname(packager)) {
    const paired = pairedPreviewOrigin(packager);
    if (paired) origins.add(paired);
  }
  return origins;
}

export function isLoopbackApiHost(hostname: string): boolean {
  const normalized = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.+$/, "");
  if (normalized === "localhost" || normalized.endsWith(".localhost")) {
    return true;
  }
  const family = isIP(normalized);
  if (family === 0) return false;
  return LOOPBACK_IPS.check(normalized, family === 4 ? "ipv4" : "ipv6");
}

function originHasLoopbackHostname(origin: string): boolean {
  try {
    return isLoopbackApiHost(new URL(origin).hostname);
  } catch {
    return false;
  }
}

function isSameRequestOrigin(req: Parameters<RequestHandler>[0], origin: string): boolean {
  try {
    const forwardedProtocol = req.header("x-forwarded-proto")?.split(",", 1)[0]?.trim();
    const forwardedHost = req.header("x-forwarded-host")?.split(",", 1)[0]?.trim();
    const protocol = forwardedProtocol || req.protocol;
    const host = forwardedHost || req.get("host");
    return Boolean(host && new URL(origin).origin === `${protocol}://${host}`);
  } catch {
    return false;
  }
}

function configuredLocalExpoWebOrigins(): Set<string> {
  const origins = new Set<string>();
  // The managed headless Preview loads Metro from localhost:8081. Permit these exact
  // loopback origins only while the API itself is addressed through a loopback host;
  // remote APIs and production must continue to rely on explicitly injected origins.
  if (process.env.NODE_ENV === "development") {
    origins.add("http://localhost:8081");
    origins.add("http://127.0.0.1:8081");
  }
  for (const name of ["EXPO_PACKAGER_PROXY_URL", "EXPO_WEB_PREVIEW_URL"] as const) {
    const origin = configuredOrigin(name);
    if (!origin) continue;
    const url = new URL(origin);
    if (url.protocol === "http:" && isLoopbackApiHost(url.hostname)) origins.add(origin);
  }
  return origins;
}

export function createCorsMiddleware(
  allowedOrigins = trustedExpoWebOrigins(),
  localApiRequest = (hostname: string) => isLoopbackApiHost(hostname),
): RequestHandler {
  return (req, res, next) => {
    const origin = req.headers.origin;
    res.vary("Origin");

    // Native Expo requests do not carry Origin and authenticate with a Bearer token.
    if (!origin) {
      next();
      return;
    }
    const loopbackOrigin = originHasLoopbackHostname(origin);
    const allowedLocalOrigin =
      localApiRequest(req.hostname) && configuredLocalExpoWebOrigins().has(origin);
    const allowedConfiguredOrigin =
      !loopbackOrigin && allowedOrigins.has(origin);
    const allowedSameOrigin = !loopbackOrigin && isSameRequestOrigin(req, origin);
    if (!allowedConfiguredOrigin && !allowedLocalOrigin && !allowedSameOrigin) {
      res.status(403).json({ error: "origin_not_allowed" });
      return;
    }

    res.header("Access-Control-Allow-Origin", origin);
    res.header(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    );
    res.header(
      "Access-Control-Allow-Headers",
      "Content-Type, Accept, Authorization, X-Requested-With",
    );
    res.header("Access-Control-Allow-Credentials", "true");
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  };
}
