/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';

declare let self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html')));
registerRoute(
  ({ request }) => ['style', 'script', 'worker', 'font', 'image'].includes(request.destination),
  new CacheFirst({ cacheName: 'ulala-assets' })
);

self.addEventListener('push', (event) => {
  if (!event.data) return;
  const payload = event.data.json() as {
    title?: string;
    body?: string;
    tag?: string;
    url?: string;
  };
  event.waitUntil(
    self.registration.showNotification(payload.title || 'Ulala', {
      body: payload.body || '',
      tag: payload.tag,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: payload.url || '/' }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string } | undefined)?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => client.url.includes(self.location.origin));
      if (existing) return existing.focus();
      return self.clients.openWindow(url);
    })
  );
});
