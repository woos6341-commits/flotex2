import { createHmac, timingSafeEqual } from "node:crypto";
import type { Express } from "express";
import * as db from "../db";
import { ENV } from "../_core/env";

function validSignature(body: string, signature: string | undefined) {
  if (!ENV.brokerWebhookSecret || !signature) return false;
  const expected = createHmac("sha256", ENV.brokerWebhookSecret).update(body).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature.replace(/^sha256=/, ""), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function registerBrokerWebhook(app: Express) {
  app.post("/api/webhooks/broker/:provider", async (req, res) => {
    const raw = JSON.stringify(req.body ?? {});
    if (!validSignature(raw, req.header("x-broker-signature"))) return res.status(401).json({ ok: false, error: "invalid_signature" });
    const provider = String(req.params.provider).slice(0, 80);
    const eventId = req.header("x-broker-event-id") || String(req.body?.eventId || "");
    const eventType = String(req.body?.type || req.body?.eventType || "order_update").slice(0, 80);
    if (!eventId) return res.status(400).json({ ok: false, error: "missing_event_id" });
    try {
      const result = await db.receiveBrokerWebhook(provider, eventId, eventType, req.body?.brokerOrderId, raw);
      return res.json({ ok: true, duplicate: result.duplicate });
    } catch (error) {
      console.error("[broker-webhook] failed", error);
      return res.status(500).json({ ok: false, error: "webhook_processing_failed" });
    }
  });
}
