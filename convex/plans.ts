import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { requireMember } from './lib'
import { bookingStatus, memberDoc, planDoc, planStatus, tripDoc } from './validators'

export const snapshot = query({
  args: { userId: v.string(), tripId: v.id('trips') },
  returns: v.object({
    trip: tripDoc,
    members: v.array(memberDoc),
    plans: v.array(planDoc)
  }),
  handler: async (ctx, args) => {
    const trip = await ctx.db.get(args.tripId)
    if (!trip) throw new Error('El viaje no existe.')
    await requireMember(ctx, args.tripId, args.userId)
    const members = await ctx.db
      .query('tripMembers')
      .withIndex('by_trip', (q) => q.eq('tripId', args.tripId))
      .collect()
    const plans = await ctx.db
      .query('plans')
      .withIndex('by_trip', (q) => q.eq('tripId', args.tripId))
      .collect()
    return { trip, members, plans }
  }
})

export const save = mutation({
  args: {
    userId: v.string(),
    tripId: v.id('trips'),
    planId: v.string(),
    baseVersion: v.number(),
    deleted: v.boolean(),
    title: v.string(),
    localDate: v.string(),
    startTime: v.string(),
    endTime: v.union(v.string(), v.null()),
    startAtMs: v.number(),
    location: v.string(),
    notes: v.string(),
    status: planStatus,
    bookingStatus: bookingStatus,
    travelMinutes: v.number(),
    bufferMinutes: v.number(),
    reminderMinutes: v.number()
  },
  returns: v.object({
    status: v.union(v.literal('saved'), v.literal('conflict')),
    plan: v.union(planDoc, v.null())
  }),
  handler: async (ctx, args) => {
    await requireMember(ctx, args.tripId, args.userId)
    const existing = await ctx.db
      .query('plans')
      .withIndex('by_trip_plan', (q) =>
        q.eq('tripId', args.tripId).eq('planId', args.planId)
      )
      .first()
    const now = Date.now()

    if (existing && existing.version !== args.baseVersion) {
      return { status: 'conflict' as const, plan: existing }
    }

    if (args.deleted) {
      if (!existing) return { status: 'saved' as const, plan: null }
      await ctx.db.patch(existing._id, {
        deletedAt: now,
        version: existing.version + 1,
        updatedBy: args.userId,
        updatedAt: now
      })
      return { status: 'saved' as const, plan: await ctx.db.get(existing._id) }
    }

    const fields = {
      title: args.title,
      localDate: args.localDate,
      startTime: args.startTime,
      endTime: args.endTime,
      startAtMs: args.startAtMs,
      reminderAtMs: args.startAtMs - args.reminderMinutes * 60_000,
      location: args.location,
      notes: args.notes,
      status: args.status,
      bookingStatus: args.bookingStatus,
      travelMinutes: args.travelMinutes,
      bufferMinutes: args.bufferMinutes,
      reminderMinutes: args.reminderMinutes
    }

    if (existing) {
      await ctx.db.patch(existing._id, {
        ...fields,
        deletedAt: null,
        version: existing.version + 1,
        updatedBy: args.userId,
        updatedAt: now
      })
      return { status: 'saved' as const, plan: await ctx.db.get(existing._id) }
    }

    const docId = await ctx.db.insert('plans', {
      planId: args.planId,
      tripId: args.tripId,
      ...fields,
      version: 1,
      deletedAt: null,
      createdBy: args.userId,
      updatedBy: args.userId,
      createdAt: now,
      updatedAt: now
    })
    return { status: 'saved' as const, plan: await ctx.db.get(docId) }
  }
})
