import { v } from 'convex/values'
import { mutation } from './_generated/server'

export const save = mutation({
  args: {
    userId: v.string(),
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
    userAgent: v.string()
  },
  returns: v.id('pushSubscriptions'),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('pushSubscriptions')
      .withIndex('by_endpoint', (q) => q.eq('endpoint', args.endpoint))
      .first()
    const now = Date.now()
    if (existing) {
      await ctx.db.patch(existing._id, {
        userId: args.userId,
        p256dh: args.p256dh,
        auth: args.auth,
        userAgent: args.userAgent,
        lastSeenAt: now
      })
      return existing._id
    }
    return ctx.db.insert('pushSubscriptions', {
      userId: args.userId,
      endpoint: args.endpoint,
      p256dh: args.p256dh,
      auth: args.auth,
      userAgent: args.userAgent,
      lastSeenAt: now
    })
  }
})
