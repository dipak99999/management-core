import { Router } from "express";

// Short-URL tracking endpoints — used specifically by CAMPAIGN sends (not the
// transactional EmailMessage.trackingId path, which uses
// auth-service /email/track/{open,click} already). This lets us have branded
// URLs like https://crm.example.com/t/o/<id>.gif that don't touch auth.
//
// NOTE: auth-service/src/routes/email-tracking.ts already handles
//   /email/track/open/:trackingId.png
//   /email/track/click/:trackingId
// for CampaignRecipient.trackingId. This module is here for future
// campaign-side extensions (e.g. UTM annotation, geolocation, TrackingEvent
// detail rows). Kept as a stub until the P1 tracking-events batch decides
// whether to add /t here or extend /email/track in auth-service.

export const trackingRouter = Router();

trackingRouter.get("/health", (_req, res) => {
  res.json({ ok: true, kind: "tracking-crm" });
});
