import { v } from 'convex/values'
import { mutation } from './_generated/server'
import { requireMember } from './lib'

export const updateDisplayName = mutation({
  args: {
    userId: v.string(),
    tripId: v.id('trips'),
    displayName: v.string()
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const member = await requireMember(ctx, args.tripId, args.userId)
    await ctx.db.patch(member._id, {
      displayName: args.displayName || null
    })
  }
})
