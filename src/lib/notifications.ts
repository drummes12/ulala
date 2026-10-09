import { api, convex, ensureUser } from './convexClient'

export function notificationSupport() {
  const secure =
    window.isSecureContext ||
    location.hostname === 'localhost' ||
    location.hostname === '127.0.0.1'
  return {
    supported:
      secure &&
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window,
    isIos: /iphone|ipad|ipod/i.test(navigator.userAgent),
    isStandalone:
      window.matchMedia('(display-mode: standalone)').matches ||
      ('standalone' in navigator &&
        Boolean((navigator as Navigator & { standalone?: boolean }).standalone))
  }
}

export async function enableNotifications() {
  const support = notificationSupport()
  if (!support.supported)
    throw new Error('Este navegador no permite notificaciones push.')
  if (support.isIos && !support.isStandalone) {
    throw new Error(
      'En iPhone o iPad, instala Ulala en la pantalla de inicio antes de activar avisos.'
    )
  }
  const publicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY
  if (!publicKey) throw new Error('Falta configurar VITE_VAPID_PUBLIC_KEY.')

  const permission = await Notification.requestPermission()
  if (permission !== 'granted')
    throw new Error('Permiso de notificaciones denegado.')

  const registration = await navigator.serviceWorker.ready
  const applicationServerKey = urlBase64ToUint8Array(publicKey) as BufferSource
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey
  })
  const json = subscription.toJSON()
  if (!subscription.endpoint || !json.keys?.p256dh || !json.keys.auth) {
    throw new Error('La suscripción push está incompleta.')
  }

  const user = await ensureUser()
  await convex.mutation(api.subscriptions.save, {
    userId: user.id,
    endpoint: subscription.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
    userAgent: navigator.userAgent
  })
  return subscription
}

function urlBase64ToUint8Array(value: string) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4)
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const output = new Uint8Array(raw.length)
  for (let index = 0; index < raw.length; index += 1)
    output[index] = raw.charCodeAt(index)
  return output
}
