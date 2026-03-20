// VORA Service Worker — Push Notifications + Background Alarm Checker
const CACHE_NAME = 'vora-sw-v2';

self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => { self.clients.claim(); });

// ── Background alarm checker — runs every 60s even when tab is backgrounded ──
let alarmInterval = null;

function startAlarmChecker() {
  if(alarmInterval) clearInterval(alarmInterval);
  alarmInterval = setInterval(checkAlarms, 60000);
  checkAlarms(); // check immediately on start
}

async function checkAlarms() {
  // Get all clients (open tabs)
  const allClients = await self.clients.matchAll({ includeUncontrolled: true });

  // Ask the page to check alarms if tab is visible
  if(allClients.length > 0) {
    allClients.forEach(client => client.postMessage({ type: 'CHECK_ALARMS' }));
    return;
  }

  // No tab open — check alarms ourselves using IndexedDB or broadcast
  // We broadcast to any client that opens
  self.registration.showNotification('VORA', {
    body: 'You have pending reminders — open VORA to check',
    icon: '/icon.png',
    badge: '/icon.png',
    silent: true,
    tag: 'vora-wake'
  });
}

// Start checking when SW activates
self.addEventListener('activate', e => {
  self.clients.claim();
  startAlarmChecker();
});

// Handle messages from the page
self.addEventListener('message', e => {
  if(!e.data) return;
  if(e.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if(e.data.type === 'NEW_ALARM') {
    // Restart checker when new alarm is saved
    startAlarmChecker();
  }
  if(e.data.type === 'START_CHECKER') {
    startAlarmChecker();
  }
});

// Handle push notifications from FCM
self.addEventListener('push', e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch(err) {
    data = { title: 'VORA Reminder', body: e.data ? e.data.text() : '' };
  }
  const title = data.title || 'VORA Reminder';
  const options = {
    body: data.body || '',
    icon: '/icon.png',
    badge: '/icon.png',
    vibrate: [200, 100, 200, 100, 200],
    requireInteraction: true,
    data: { url: data.url || '/' }
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

// Handle notification click
self.addEventListener('notificationclick', e => {
  e.notification.close();
  if(e.action === 'dismiss') return;
  const url = e.notification.data?.url || '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for(const client of clientList) {
        if('focus' in client) return client.focus();
      }
      if(clients.openWindow) return clients.openWindow(url);
    })
  );
});
