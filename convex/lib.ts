import type { Id } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'

export async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export async function requireMember(
  ctx: QueryCtx | MutationCtx,
  tripId: Id<'trips'>,
  userId: string
) {
  const member = await ctx.db
    .query('tripMembers')
    .withIndex('by_trip_user', (q) =>
      q.eq('tripId', tripId).eq('userId', userId)
    )
    .first()
  if (!member) throw new Error('Este dispositivo ya no pertenece al viaje.')
  return member
}
