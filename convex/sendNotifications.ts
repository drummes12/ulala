'use node'

import webpush from 'web-push'
import { v } from 'convex/values'
import { internal } from './_generated/api'
import { internalAction } from './_generated/server'

export const sendAll = internalAction({
  returns: v.object({ sent: v.number() }),
  handler: async (ctx) => {
    const publicKey = process.env.VAPID_PUBLIC_KEY
    const privateKey = process.env.VAPID_PRIVATE_KEY
    if (!publicKey || !privateKey) {
      throw new Error(
        'VAPID keys are not configured. Run `convex env set VAPID_PUBLIC_KEY ...` and `VAPID_PRIVATE_KEY ...`.'
      )
    }
    webpush.setVapidDetails(
      process.env.PUSH_CONTACT ?? 'mailto:admin@example.com',
      publicKey,
      privateKey
    )

    const nowMs = Date.now()
    const plans = await ctx.runQuery(internal.notifications.duePlans, {
      nowMs,
      windowMs: 5 * 60_000,
      horizonMs: 7 * 24 * 60 * 60_000
    })
    if (plans.length === 0) return { sent: 0 }

    let sent = 0
    for (const plan of plans) {
      const subscriptions = await ctx.runQuery(
        internal.notifications.memberSubscriptions,
        { tripId: plan.tripId }
      )
      const payload = JSON.stringify({
        title: `Ulala · ${plan.title}`,
        body: `A las ${plan.startTime} · ${plan.location}`,
        url: '/',
        planId: plan.planId
      })

      for (const subscription of subscriptions) {
        const deliveryId = await ctx.runMutation(
          internal.notifications.claimDelivery,
          {
            planId: plan.planId,
            subscriptionId: subscription._id,
            planVersion: plan.version,
            reminderAtMs: plan.reminderAtMs
          }
        )
        if (!deliveryId) continue

        try {
          await webpush.sendNotification(
            {
              endpoint: subscription.endpoint,
              keys: { p256dh: subscription.p256dh, auth: subscription.auth }
            },
            payload
          )
          await ctx.runMutation(internal.notifications.completeDelivery, {
            deliveryId,
            ok: true,
            error: null
          })
          sent += 1
        } catch (error) {
          await ctx.runMutation(internal.notifications.completeDelivery, {
            deliveryId,
            ok: false,
            error: error instanceof Error ? error.message : String(error)
          })
        }
      }
    }
    return { sent }
  }
})
