import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'

const crons = cronJobs()

crons.interval('send notifications', { minutes: 1 }, internal.sendNotifications.sendAll)

export default crons
