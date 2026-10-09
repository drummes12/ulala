import { v } from 'convex/values'
import { internalMutation, internalQuery } from './_generated/server'
import { planDoc, subscriptionDoc } from './validators'

export const duePlans = internalQuery({
  args: {
    nowMs: v.number(),
    windowMs: v.number(),
    horizonMs: v.number()
  },
  returns: v.array(planDoc),
  handler: async (ctx, args) => {
    const plans = await ctx.db
      .query('plans')
      .withIndex('by_status_reminder', (q) =>
        q
          .eq('status', 'confirmed')
          .gt('reminderAtMs', args.nowMs - args.windowMs)
          .lte('reminderAtMs', args.nowMs)
      )
      .collect()
    return plans.filter(
      (plan) =>
        plan.deletedAt === null &&
        plan.startAtMs >= args.nowMs &&
        plan.startAtMs <= args.nowMs + args.horizonMs
    )
  }
})

export const memberSubscriptions = internalQuery({
  args: { tripId: v.id('trips') },
  returns: v.array(subscriptionDoc),
  handler: async (ctx, args) => {
    const members = await ctx.db
      .query('tripMembers')
      .withIndex('by_trip', (q) => q.eq('tripId', args.tripId))
      .collect()
    const subscriptions = []
    for (const member of members) {
      const rows = await ctx.db
        .query('pushSubscriptions')
        .withIndex('by_user', (q) => q.eq('userId', member.userId))
        .collect()
      subscriptions.push(...rows)
    }
    return subscriptions
  }
})

export const claimDelivery = internalMutation({
  args: {
    planId: v.string(),
    subscriptionId: v.id('pushSubscriptions'),
    planVersion: v.number(),
    reminderAtMs: v.number()
  },
  returns: v.union(v.id('notificationDeliveries'), v.null()),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('notificationDeliveries')
      .withIndex('by_plan_sub_version', (q) =>
        q
          .eq('planId', args.planId)
          .eq('subscriptionId', args.subscriptionId)
          .eq('planVersion', args.planVersion)
      )
      .first()
    if (existing) return null
    return ctx.db.insert('notificationDeliveries', {
      planId: args.planId,
      subscriptionId: args.subscriptionId,
      planVersion: args.planVersion,
      reminderAtMs: args.reminderAtMs,
      status: 'pending',
      sentAt: null,
      error: null
    })
  }
})

export const completeDelivery = internalMutation({
  args: {
    deliveryId: v.id('notificationDeliveries'),
    ok: v.boolean(),
    error: v.union(v.string(), v.null())
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.deliveryId, {
      status: args.ok ? 'sent' : 'failed',
      sentAt: args.ok ? Date.now() : null,
      error: args.error
    })
  }
})
