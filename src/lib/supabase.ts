import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Supabase env vars are missing. Copy .env.example to .env.local and fill the local values.'
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false
  },
  realtime: {
    params: { eventsPerSecond: 10 }
  }
})

export async function ensureAnonymousSession() {
  const { data } = await supabase.auth.getSession()
  if (data.session?.user) return data.session.user
  const { data: signed, error } = await supabase.auth.signInAnonymously()
  if (error) throw error
  if (!signed.user) throw new Error('Anonymous sign-in did not return a user.')
  return signed.user
}
