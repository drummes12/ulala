import { v } from 'convex/values'

export const planStatus = v.union(
  v.literal('idea'),
  v.literal('confirmed'),
  v.literal('done')
)

export const bookingStatus = v.union(
  v.literal('none'),
  v.literal('not_required'),
  v.literal('recommended'),
  v.literal('required'),
  v.literal('booked')
)

export const tripDoc = v.object({
  _id: v.id('trips'),
  _creationTime: v.number(),
  name: v.string(),
  timezone: v.string(),
  inviteTokenHash: v.string(),
  inviteCreatedAt: v.number(),
  createdBy: v.union(v.string(), v.null()),
  createdAt: v.number(),
  updatedAt: v.number()
})

export const memberDoc = v.object({
  _id: v.id('tripMembers'),
  _creationTime: v.number(),
  tripId: v.id('trips'),
  userId: v.string(),
  displayName: v.union(v.string(), v.null()),
  joinedAt: v.number()
})

export const planDoc = v.object({
  _id: v.id('plans'),
  _creationTime: v.number(),
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

export const subscriptionDoc = v.object({
  _id: v.id('pushSubscriptions'),
  _creationTime: v.number(),
  userId: v.string(),
  endpoint: v.string(),
  p256dh: v.string(),
  auth: v.string(),
  userAgent: v.string(),
  lastSeenAt: v.number()
})
