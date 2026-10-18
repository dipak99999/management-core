// Subscription expiry sweep. Runs daily; two responsibilities:
//
//   1. Flip subscriptions whose currentPeriodEnd is in the past AND
//      cancelAtPeriodEnd=true to isActive=false. These are planned
//      cancellations — the user said "cancel at end of cycle" and we
//      honoured the current period but shouldn't renew.
//
//   2. For subscriptions whose nextBillingAt is in the past AND NOT
//      cancelled, record a renewal event + leave them active for a
//      7-day grace period. The real recharge happens via Razorpay's
//      subscription auto-renewal webhook (payment.captured on the
//      subscription id), which `billing/webhook` already handles.
//      This job is the safety net: if a webhook was missed, we'll
//      notice the overdue subscription + alert the operator.
//
// Doesn't double-charge: no server-side `/orders` is created here. All
// charging flows through Razorpay's recurring-payment contract (which
// customers authorize at checkout) OR a human triggers a re-subscribe.

import { prisma } from "@lumaara/db";
import { getLogger } from "@lumaara/service-auth";

const log = getLogger("scheduler:subscription-expiry");

const GRACE_DAYS = Number(process.env.SUBSCRIPTION_GRACE_DAYS ?? 7);

export interface SubscriptionExpiryResult {
  cancelled: number;
  overdueFlagged: number;
  deactivatedPastGrace: number;
  durMs: number;
}

export async function runSubscriptionExpiryTick(): Promise<SubscriptionExpiryResult> {
  const started = Date.now();
  const now = new Date();
  const graceCutoff = new Date(now.getTime() - GRACE_DAYS * 24 * 60 * 60 * 1000);

  // 1. Planned cancellations — period ended + user asked to cancel.
  const cancelled = await prisma.tenantSubscription.updateMany({
    where: {
      isActive: true,
      cancelAtPeriodEnd: true,
      currentPeriodEnd: { lte: now },
    },
    data: {
      isActive: false,
      endDate: now,
    },
  });
  if (cancelled.count > 0) {
    log.info("planned cancellations deactivated", { count: cancelled.count });
  }

  // 2. Overdue + still active — webhook may have been missed. Flag by
  //    writing a BillingEvent of our own; operator sees it in the audit.
  const overdue = await prisma.tenantSubscription.findMany({
    where: {
      isActive: true,
      cancelAtPeriodEnd: false,
      nextBillingAt: { lte: now, gt: graceCutoff },
    },
    select: { id: true, tenantId: true, planId: true, nextBillingAt: true },
  });
  for (const sub of overdue) {
    // Idempotent: our synthetic upstreamId collides on day-boundaries so
    // repeated ticks don't re-insert.
    const upstreamId = `sched-overdue-${sub.id}-${now.toISOString().slice(0, 10)}`;
    try {
      await prisma.billingEvent.create({
        data: {
          provider: "razorpay",
          eventType: "scheduler.subscription.overdue",
          upstreamId,
          tenantId: sub.tenantId,
          payload: { subscriptionId: sub.id, nextBillingAt: sub.nextBillingAt } as never,
          processedAt: now,
        },
      });
    } catch {
      // unique collision on same-day re-run — fine
    }
  }
  if (overdue.length > 0) {
    log.warn("overdue subscriptions flagged", { count: overdue.length });
  }

  // 3. Past grace — deactivate. Tenant loses access until they re-subscribe.
  const deactivated = await prisma.tenantSubscription.updateMany({
    where: {
      isActive: true,
      cancelAtPeriodEnd: false,
      nextBillingAt: { lte: graceCutoff },
    },
    data: {
      isActive: false,
      endDate: now,
    },
  });
  if (deactivated.count > 0) {
    log.warn("subscriptions deactivated past grace window", {
      count: deactivated.count,
      graceDays: GRACE_DAYS,
    });
  }

  return {
    cancelled: cancelled.count,
    overdueFlagged: overdue.length,
    deactivatedPastGrace: deactivated.count,
    durMs: Date.now() - started,
  };
}
