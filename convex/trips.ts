import { v } from 'convex/values'
import { mutation } from './_generated/server'
import { requireMember, sha256Hex } from './lib'

export const createTrip = mutation({
  args: {
    userId: v.string(),
    name: v.string(),
    timezone: v.string(),
    displayName: v.string()
  },
  returns: v.object({ tripId: v.id('trips'), inviteToken: v.string() }),
  handler: async (ctx, args) => {
    const inviteToken = crypto.randomUUID()
    const now = Date.now()
    const tripId = await ctx.db.insert('trips', {
      name: args.name,
      timezone: args.timezone,
      inviteTokenHash: await sha256Hex(inviteToken),
      inviteCreatedAt: now,
      createdBy: args.userId,
      createdAt: now,
      updatedAt: now
    })
    await ctx.db.insert('tripMembers', {
      tripId,
      userId: args.userId,
      displayName: args.displayName || null,
      joinedAt: now
    })
    return { tripId, inviteToken }
  }
})

export const joinTrip = mutation({
  args: {
    userId: v.string(),
    inviteToken: v.string(),
    displayName: v.string()
  },
  returns: v.object({ tripId: v.id('trips'), tripName: v.string() }),
  handler: async (ctx, args) => {
    const now = Date.now()
    const subject = await sha256Hex(`invite:${args.userId}`)
    const recent = await ctx.db
      .query('inviteAttempts')
      .withIndex('by_subject', (q) =>
        q.eq('subject', subject).gt('attemptedAt', now - 60_000)
      )
      .collect()
    if (recent.length >= 5) {
      throw new Error('Demasiados intentos. Espera unos minutos.')
    }
    await ctx.db.insert('inviteAttempts', { subject, attemptedAt: now })

    const inviteTokenHash = await sha256Hex(args.inviteToken)
    const trip = await ctx.db
      .query('trips')
      .withIndex('by_invite', (q) => q.eq('inviteTokenHash', inviteTokenHash))
      .first()
    if (!trip) throw new Error('El enlace no es válido o fue regenerado.')

    const existing = await ctx.db
      .query('tripMembers')
      .withIndex('by_trip_user', (q) =>
        q.eq('tripId', trip._id).eq('userId', args.userId)
      )
      .first()
    if (!existing) {
      await ctx.db.insert('tripMembers', {
        tripId: trip._id,
        userId: args.userId,
        displayName: args.displayName || null,
        joinedAt: now
      })
    }
    return { tripId: trip._id, tripName: trip.name }
  }
})

export const regenerateInvite = mutation({
  args: { userId: v.string(), tripId: v.id('trips') },
  returns: v.object({ inviteToken: v.string() }),
  handler: async (ctx, args) => {
    await requireMember(ctx, args.tripId, args.userId)
    const inviteToken = crypto.randomUUID()
    const now = Date.now()
    await ctx.db.patch(args.tripId, {
      inviteTokenHash: await sha256Hex(inviteToken),
      inviteCreatedAt: now,
      updatedAt: now
    })
    return { inviteToken }
  }
})
