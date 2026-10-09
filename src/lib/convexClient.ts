import { ConvexClient } from 'convex/browser'
import { api } from '../../convex/_generated/api'
import { getMeta, setMeta } from './db'

const convexUrl = import.meta.env.VITE_CONVEX_URL as string | undefined

if (!convexUrl) {
  throw new Error(
    'VITE_CONVEX_URL is missing. Run `pnpm convex:dev` once and copy the URL into .env.local.'
  )
}

export const convex = new ConvexClient(convexUrl)

export { api }

export async function ensureUser() {
  const stored = await getMeta<string>('user_id')
  if (stored) return { id: stored }
  const id = crypto.randomUUID()
  await setMeta('user_id', id)
  return { id }
}
