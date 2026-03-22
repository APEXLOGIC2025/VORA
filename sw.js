// VORA Service Worker v4 — Background alarm notifications
const CACHE = 'vora-v4';

self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => { self.clients.claim(); });

// Store alarms in SW memory (survives tab being backgrounded)
let swAlarms = [];

// Check alarms every 60 seconds directly in SW
setInterval(() => {
  checkAndFireAlarms();
}, 60000);

function checkAndFireAlarms() {
  const now = Date.now();
  let changed = false;
  swAlarms.forEach(alarm => {
    if (!alarm.fired && new Date(alarm.fireAt).getTime() <= now) {
      alarm.fired = true;
      changed = true;
      // Fire notification directly from SW — works when tab is backgrounded
      self.registration.showNotification(alarm.title || 'VORA Reminder', {
        body: alarm.body || '',
        icon: '/icon.png',
        badge: '/icon.png',
        vibrate: [200, 100, 200, 100, 200],
        requireInteraction: true,
        tag: alarm.id || 'vora-alarm',
        data: { url: '/' }
      });
    }
  });
  // Clean fired alarms older than 24h
  swAlarms = swAlarms.filter(a => {
    if (!a.fired) return true;
    return (now - new Date(a.fireAt).getTime()) < 86400000;
  });
  // Also notify open tabs to check their localStorage alarms
  if (!changed) {
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      clients.forEach(c => c.postMessage({ type: 'CHECK_ALARMS' }));
    });
  }
}

// Handle messages from main app
self.addEventListener('message', e => {
  if (!e.data) return;
  if (e.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  // Page sends alarm data to SW when reminder is set
  if (e.data.type === 'SET_ALARMS') {
    swAlarms = e.data.alarms || [];
    console.log('SW: received', swAlarms.length, 'alarms');
  }
  // Page sends single new alarm
  if (e.data.type === 'ADD_ALARM') {
    const alarm = e.data.alarm;
    if (alarm) {
      // Remove existing alarm with same id
      swAlarms = swAlarms.filter(a => a.id !== alarm.id);
      swAlarms.push(alarm);
      console.log('SW: alarm added, total:', swAlarms.length);
    }
  }
});

// Handle push from FCM
self.addEventListener('push', e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch(err) {
    data = { title: 'VORA Reminder', body: e.data ? e.data.text() : '' };
  }
  e.waitUntil(
    self.registration.showNotification(data.title || 'VORA Reminder', {
      body: data.body || '',
      icon: '/icon.png',
      badge: '/icon.png',
      vibrate: [200, 100, 200],
      requireInteraction: true
    })
  );
});

// Handle notification click — open VORA
self.addEventListener('notificationclick', e => {
  e.notification.close();
  if (e.action === 'dismiss') return;
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const c of clientList) {
        if (c.url.includes(self.location.origin) && 'focus' in c) return c.focus();
      }
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});
