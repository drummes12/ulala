# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

delegated: React + TypeScript + Vite PWA, Supabase Postgres/Auth/Realtime/Edge Functions, IndexedDB local persistence. Chosen because the product needs installable offline behavior, shared trip state, and server-scheduled push notifications.

## Users

Two partners planning and taking a trip together. They plan ahead in spreadsheets, then check the itinerary while moving, often on phones and sometimes with poor connectivity.

## Product Purpose

Ulala keeps a shared trip itinerary clear enough to answer, at a glance, what comes next, whether a plan is still an idea or confirmed, and when the couple should leave. It reduces coordination stress instead of adding another planning surface.

## Positioning

A calm, shared itinerary built around one timeline and clear timing decisions rather than a general calendar, map, or project tracker.

## Operating Context

Plans start as spreadsheet rows and evolve during the trip. Both people may edit the itinerary, sometimes offline. A reusable invite link can bring another device or person into the same trip; the link can be regenerated to stop new joins. Notifications are opt-in per device and are only dependable for confirmed, synchronized plans.

## Capabilities and Constraints

- PWA must work offline after installation/first load and synchronize queued changes when online.
- Push notifications require HTTPS, service workers, explicit permission, and server dispatch. On iOS/iPadOS, the app must be added to Home Screen before permission is possible.
- Safari does not uniformly support Background Sync; sync retries happen while the app is open and on reopen/reconnect.
- Travel time and buffer are manually entered; the app must not invent live traffic estimates.
- Invite links are credentials: stored only as hashes on the server, removed from the URL after join, and regenerable.
- UI language is Spanish; repository code, commits, and technical documentation use English.

## Brand Commitments

Clean, visual, minimal, card-based interface with restrained depth and no nested-card clutter. The visual system should feel calm and legible under travel conditions.

## Evidence on Hand

No existing code, brand assets, itinerary exports, or real trip data are present in the repository. Test content must be clearly illustrative and replaceable.

## Product Principles

- Make the next decision obvious before showing secondary details.
- Preserve user edits offline and explain sync state plainly.
- Prefer one timeline and direct actions over multi-layer navigation.
- Treat times, statuses, and reminders as safety-critical information.
- Keep the interface quiet; visual emphasis belongs to what needs attention now.
