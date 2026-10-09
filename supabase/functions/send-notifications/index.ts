import { createClient } from '@supabase/supabase-js'
import * as webpush from '@negrel/webpush'

type PlanRow = {
  id: string
  trip_id: string
  title: string
  local_date: string
  start_time: string
  start_at: string
  location: string | null
  reminder_minutes: number
  version: number
  trips:
    | Array<{ name: string; timezone: string }>
    | { name: string; timezone: string }
    | null
}

type SubscriptionRow = {
  id: string
  endpoint: string
  p256dh: string
  auth: string
}

const cronSecret = Deno.env.get('CRON_SECRET')
const supabaseUrl = Deno.env.get('SUPABASE_URL')
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const vapidKeysJson = Deno.env.get('VAPID_KEYS')
const contact = Deno.env.get('PUSH_CONTACT') ?? 'mailto:admin@example.com'

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.')
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

Deno.serve(async (request) => {
  if (!cronSecret || request.headers.get('x-cron-secret') !== cronSecret) {
    return json({ error: 'Unauthorized' }, 401)
  }
  if (!vapidKeysJson) {
    return json({ error: 'VAPID_KEYS is not configured' }, 500)
  }

  const now = new Date()
  const { data: plans, error } = await supabase
    .from('plans')
    .select(
      'id,trip_id,title,local_date,start_time,start_at,location,reminder_minutes,version,trips(name,timezone)',
    )
    .eq('status', 'confirmed')
    .is('deleted_at', null)
    .gte('start_at', now.toISOString())
    .lte(
      'start_at',
      new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    )
    .limit(500)

  if (error) return json({ error: error.message }, 500)

  const duePlans = ((plans ?? []) as PlanRow[]).filter((plan) => {
    const reminderAt = new Date(plan.start_at).getTime() -
      plan.reminder_minutes * 60_000
    return (
      reminderAt <= now.getTime() && reminderAt > now.getTime() - 5 * 60_000
    )
  })

  const results = []
  for (const plan of duePlans) {
    const { data: members, error: membersError } = await supabase
      .from('trip_members')
      .select('user_id')
      .eq('trip_id', plan.trip_id)
    if (membersError) return json({ error: membersError.message }, 500)

    const userIds = (members ?? []).map((member) => member.user_id)
    if (!userIds.length) continue

    const { data: subscriptions, error: subscriptionsError } = await supabase
      .from('push_subscriptions')
      .select('id,endpoint,p256dh,auth')
      .in('user_id', userIds)
    if (subscriptionsError) {
      return json({ error: subscriptionsError.message }, 500)
    }

    for (const subscription of (subscriptions ?? []) as SubscriptionRow[]) {
      const delivery = await claimDelivery(plan, subscription)
      if (!delivery) continue
      const result = await sendDelivery(plan, subscription, delivery.id)
      results.push(result)
    }
  }

  return json({ due: duePlans.length, results })
})

async function claimDelivery(plan: PlanRow, subscription: SubscriptionRow) {
  const reminderAt = new Date(
    new Date(plan.start_at).getTime() - plan.reminder_minutes * 60_000,
  ).toISOString()
  const { data: inserted } = await supabase
    .from('notification_deliveries')
    .upsert(
      {
        plan_id: plan.id,
        subscription_id: subscription.id,
        plan_version: plan.version,
        reminder_at: reminderAt,
        status: 'pending',
      },
      {
        onConflict: 'plan_id,subscription_id,plan_version',
        ignoreDuplicates: true,
      },
    )
    .select('id')
    .maybeSingle()

  if (!inserted?.id) return null
  const { data: claimed } = await supabase
    .from('notification_deliveries')
    .update({ status: 'sending' })
    .eq('id', inserted.id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle()
  return claimed
}

async function sendDelivery(
  plan: PlanRow,
  subscription: SubscriptionRow,
  deliveryId: string,
) {
  const vapidKeys = await webpush.importVapidKeys(JSON.parse(vapidKeysJson!), {
    extractable: false,
  })
  const appServer = await webpush.ApplicationServer.new({
    contactInformation: contact,
    vapidKeys,
  })
  const subscriber = appServer.subscribe({
    endpoint: subscription.endpoint,
    keys: { p256dh: subscription.p256dh, auth: subscription.auth },
  })

  const trip = Array.isArray(plan.trips) ? plan.trips[0] : plan.trips
  const body = `${plan.local_date} ${
    plan.start_time.slice(0, 5)
  } · ${plan.title}${plan.location ? ` · ${plan.location}` : ''}`
  try {
    await subscriber.pushTextMessage(
      JSON.stringify({
        title: `Ulala · ${trip?.name ?? 'Viaje'}`,
        body,
        tag: `${plan.id}:${plan.version}`,
        url: '/',
      }),
      {},
    )
    await supabase
      .from('notification_deliveries')
      .update({ status: 'sent', sent_at: new Date().toISOString() })
      .eq('id', deliveryId)
    return { deliveryId, status: 'sent' }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Push failed'
    const gone = /404|410/.test(message)
    if (gone) {
      await supabase
        .from('push_subscriptions')
        .delete()
        .eq('id', subscription.id)
    }
    await supabase
      .from('notification_deliveries')
      .update({ status: 'failed', error: message })
      .eq('id', deliveryId)
    return { deliveryId, status: gone ? 'subscription_removed' : 'failed' }
  }
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
