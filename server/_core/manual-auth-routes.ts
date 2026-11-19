import type { Express, Request, Response } from "express";
import { toPublicAuthUser } from "../manual-auth";
import { unregisterPushToken } from "../push";
import { requestSessionToken } from "../session-management";
import { revokePresentedSession } from "../revoke-presented-session";
import { getSessionCookieName, getSessionCookieOptions } from "./cookies";
import { authenticationUnavailable, isInvalidAuthentication } from "./auth-errors";
import { sdk } from "./sdk";

export function registerManualAuthRoutes(app: Express) {
  app.get("/api/auth/me", async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "private, no-store");
    try {
      const user = await sdk.authenticateRequest(req);
      res.json({ user: toPublicAuthUser(user) });
    } catch (error) {
      if (isInvalidAuthentication(error)) res.status(401).json({ error: "Not authenticated", user: null });
      else res.status(503).json({ error: authenticationUnavailable().message });
    }
  });

  app.post("/api/auth/logout", async (req: Request, res: Response) => {
    const pushToken = typeof req.body?.pushToken === "string" ? req.body.pushToken : "";
    let revocationFailed = false;
    try {
      const user = await sdk.authenticateRequest(req);
      await revokePresentedSession(user.id, requestSessionToken(req));
      if (pushToken) await unregisterPushToken(user.id, pushToken);
    } catch (error) {
      // An already invalid/revoked token is logged out. Availability failure is not success.
      revocationFailed = !isInvalidAuthentication(error);
    }
    res.setHeader("Cache-Control", "private, no-store");
    res.clearCookie(getSessionCookieName(req), { ...getSessionCookieOptions(req), maxAge: -1 });
    if (revocationFailed) {
      res.status(503).json({ success: false, error: "تم مسح جلسة المتصفح، لكن تعذر تأكيد إبطال الجلسة على الخادم. أعد المحاولة عند عودة الاتصال." });
    } else res.json({ success: true });
  });
}
