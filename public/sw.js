/* TavaOne Solar — service worker */
const CACHE = 'solar-sw-v1';

self.addEventListener('push', event => {
  let data = { title: 'Solar Alert', body: 'Space weather conditions have changed.', kp: null, xray: null };
  try { if (event.data) data = { ...data, ...event.data.json() }; } catch {}

  let body = data.body;
  if (!body) {
    if (data.kp !== null && data.kp !== undefined) body = `Kp ${data.kp} — geomagnetic storm active`;
    else if (data.xray) body = `${data.xray}-class solar flare detected`;
    else body = 'Check solar conditions now.';
  }

  event.waitUntil(
    self.registration.showNotification(data.title ?? 'Solar Alert', {
      body,
      icon: '/favicon-32.png',
      badge: '/favicon-16.png',
      tag: 'solar-alert',
      renotify: true,
      requireInteraction: true,
      data: { url: '/' },
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url ?? '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(wins => {
      const match = wins.find(w => w.url.includes(self.location.origin));
      if (match) { match.focus(); match.navigate(url); }
      else clients.openWindow(url);
    })
  );
});
