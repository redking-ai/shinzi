// Shinzi Service Worker
const CACHE_NAME = 'shinzi-v3';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// Basic network-first strategy for navigation and assets
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});

// Handle messages from client to show notification with high priority
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
    const { title, options } = event.data;
    self.registration.showNotification(title, options);
  }
});

// REAL WEB PUSH (Fires even when app is closed, killed, or screen locked)
self.addEventListener('push', (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data = { text: event.data.text() };
    }
  }

  const title = data.title || 'Shinzi';
  const isIncomingCall = data.type === 'incoming_call' || data.type === 'call';

  const options = {
    body: data.body || data.text || 'You received a new message',
    icon: data.icon || '/icon-192.png',
    badge: '/icon-192.png',
    tag: isIncomingCall ? `shinzi-call-${data.callId || 'incoming'}` : (data.tag || `shinzi-${Date.now()}`),
    renotify: true,
    vibrate: isIncomingCall ? [500, 250, 500, 250, 500, 250, 500] : [200, 100, 200],
    data: {
      url: data.url || '/',
      type: data.type,
      callId: data.callId,
      convId: data.convId,
    },
    actions: isIncomingCall ? [
      { action: 'decline', title: 'Decline' },
      { action: 'answer', title: 'Answer' },
    ] : [],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const notifData = event.notification.data || {};

  if (event.action === 'decline') {
    if (notifData.callId) {
      event.waitUntil(
        fetch('/api/decline-call', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callId: notifData.callId, convId: notifData.convId || '' }),
        }).catch(() => {})
      );
    }
    return;
  }

  let urlToOpen = notifData.url || '/';
  if (event.action === 'answer') {
    urlToOpen = `/call?id=${notifData.callId || ''}&conv=${notifData.convId || ''}&autoAnswer=true`;
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          if ('navigate' in client && urlToOpen !== '/') {
            client.navigate(urlToOpen);
          }
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});
