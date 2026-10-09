# Ulala

Shared, offline-first travel itinerary PWA for two people.

Stack: React + Vite PWA + Dexie (local/offline) + Convex (backend, realtime, crons).

## Local development

Requirements: Node.js 24+, pnpm 12+, and a Convex account (free tier).

```bash
pnpm install
pnpm convex:dev   # first run: logs in, creates the dev deployment, writes
                  # CONVEX_DEPLOYMENT + VITE_CONVEX_URL into .env.local
pnpm dev
```

`convex dev` also pushes `convex/` functions and regenerates `convex/_generated`
types. Leave it running while developing, or push once with
`pnpm exec convex dev --once`.

## Useful commands

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm convex:codegen
pnpm convex:deploy   # push functions to the production deployment
```

## Data model

Two independent axes per plan:

- `status`: `idea` | `confirmed` | `done` — whether the plan is part of the
  itinerary and whether it already happened.
- `bookingStatus`: `none` | `not_required` | `recommended` | `required` |
  `booked` — reservation/ticket management, independent of the above.

Notifications are sent only for `status = 'confirmed'`.

## Auth and invites

There is no account system: each device generates a random `userId` stored in
IndexedDB (`meta.user_id`). Membership in a trip is granted by the invite
token — trips store only `sha256(token)`, never the raw token, and
`joinTrip` is rate-limited (5 attempts/min per device). Convex functions
verify membership on every read and write (`requireMember` in
`convex/lib.ts`).

## Notifications

`convex/crons.ts` runs `sendNotifications.sendAll` every minute. The action
(`convex/sendNotifications.ts`, Node runtime) finds `confirmed` plans whose
`reminderAtMs` fell inside the last 5 minutes, claims one delivery per
plan+subscription+version (`notificationDeliveries`), and sends Web Push via
`web-push`.

Backend env vars (per deployment, `convex env set <KEY> <value>` or the
dashboard):

- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`: base64url VAPID keys. Local copies
  live in `.env.local` (non-`VITE_` names so they never reach the bundle).
- `PUSH_CONTACT`: `mailto:` address included in push requests.

The frontend also needs `VITE_VAPID_PUBLIC_KEY` to subscribe. On iOS/iPadOS
the app must be installed to the Home Screen before requesting permission.

## Cloudflare Pages deployment

Frontend settings:

- Build command: `pnpm build`
- Build output directory: `dist`
- `NODE_VERSION`: `24.21.0`
- `PNPM_VERSION`: `12.8.1`
- `VITE_CONVEX_URL`: production deployment URL (`https://<name>.convex.cloud`)
- `VITE_VAPID_PUBLIC_KEY`: public VAPID application-server key

`public/_headers` applies security and cache headers; `public/_redirects`
provides the SPA fallback. `pnpm-workspace.yaml` declares the root package
explicitly so older pnpm tooling does not mistake it for an incomplete
monorepo, and `allowBuilds` covers the `postinstall` scripts Cloudflare's
deploy step needs (`esbuild`, `workerd`).

Backend: create a production deployment from the Convex dashboard, push with
`pnpm convex:deploy`, and set the env vars above on that deployment.

## CSV columns

Required: `fecha`, `hora_inicio`, `titulo`.
Optional: `hora_fin`, `lugar`, `notas`, `estado`, `reserva`, `traslado_min`, `margen_min`, `recordatorio_min`.

Dates accept `YYYY-MM-DD` or `DD/MM/YYYY`; times accept `H:mm`, `HH:mm`, `HH:mm:ss` or ranges like `17:30-20:30` in `hora_inicio`. Values are interpreted in the trip timezone.

`estado` maps to plan status plus booking status:

- `Confirmado`, `Reservado` → confirmed + booked
- `Por reservar` → confirmed + required
- `Reserva recomendada`/`Reserva sugerida` → confirmed + recommended
- `Sin reserva previa` → confirmed + not required
- `Libre`, `Opcional`, `Plan`, `Idea` → idea
- `Hecho`, `Realizado` → done

An explicit `reserva` column (`sin_definir`, `sin_reserva`, `reserva_sugerida`, `por_reservar`, `reservado`) overrides the booking derived from `estado`. Unknown statuses are rejected with a row error; extra columns are preserved as lines inside `notas`.
