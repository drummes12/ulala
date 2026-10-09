import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'
import { bookingStatus, planStatus } from './validators'

export default defineSchema({
  trips: defineTable({
    name: v.string(),
    timezone: v.string(),
    inviteTokenHash: v.string(),
    inviteCode: v.optional(v.string()),
    inviteCreatedAt: v.number(),
    createdBy: v.union(v.string(), v.null()),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index('by_invite', ['inviteTokenHash'])
    .index('by_invite_code', ['inviteCode']),

  tripMembers: defineTable({
    tripId: v.id('trips'),
    userId: v.string(),
    displayName: v.union(v.string(), v.null()),
    joinedAt: v.number()
  })
    .index('by_trip', ['tripId'])
    .index('by_trip_user', ['tripId', 'userId'])
    .index('by_user', ['userId']),

  plans: defineTable({
    planId: v.string(),
    tripId: v.id('trips'),
    title: v.string(),
    localDate: v.string(),
    startTime: v.string(),
    endTime: v.union(v.string(), v.null()),
    startAtMs: v.number(),
    reminderAtMs: v.number(),
    location: v.string(),
    notes: v.string(),
    status: planStatus,
    bookingStatus: bookingStatus,
    travelMinutes: v.number(),
    bufferMinutes: v.number(),
    reminderMinutes: v.number(),
    version: v.number(),
    deletedAt: v.union(v.number(), v.null()),
    createdBy: v.union(v.string(), v.null()),
    updatedBy: v.union(v.string(), v.null()),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index('by_trip', ['tripId'])
    .index('by_trip_plan', ['tripId', 'planId'])
    .index('by_status_reminder', ['status', 'reminderAtMs']),

  pushSubscriptions: defineTable({
    userId: v.string(),
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
    userAgent: v.string(),
    lastSeenAt: v.number()
  })
    .index('by_endpoint', ['endpoint'])
    .index('by_user', ['userId']),

  notificationDeliveries: defineTable({
    planId: v.string(),
    subscriptionId: v.id('pushSubscriptions'),
    planVersion: v.number(),
    reminderAtMs: v.number(),
    status: v.union(
      v.literal('pending'),
      v.literal('sent'),
      v.literal('failed')
    ),
    sentAt: v.union(v.number(), v.null()),
    error: v.union(v.string(), v.null())
  })
    .index('by_plan_sub_version', ['planId', 'subscriptionId', 'planVersion'])
    .index('by_status_time', ['status', 'reminderAtMs']),

  inviteAttempts: defineTable({
    subject: v.string(),
    attemptedAt: v.number()
  }).index('by_subject', ['subject', 'attemptedAt'])
})
