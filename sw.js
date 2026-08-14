/**
 * Destrade Pro — Background Service Worker
 * Enables background Push Notifications on Web, PWA & Android WebViews
 */

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(clients.claim());
});

self.addEventListener('push', (event) => {
    let data = { title: '⚡ Destrade Market Alert', body: 'New breakout detected!' };
    try {
        if (event.data) {
            data = event.data.json();
        }
    } catch (e) {
        if (event.data) data.body = event.data.text();
    }

    const options = {
        body: data.body,
        icon: 'https://destrade-default-rtdb.firebaseio.com/favicon.ico',
        badge: 'https://destrade-default-rtdb.firebaseio.com/favicon.ico',
        vibrate: [200, 100, 200, 100, 200],
        tag: data.tag || 'destrade-alert',
        renotify: true,
        data: data
    };

    event.waitUntil(
        self.registration.showNotification(data.title, options)
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            for (let i = 0; i < clientList.length; i++) {
                const client = clientList[i];
                if ('focus' in client) return client.focus();
            }
            if (clients.openWindow) return clients.openWindow('/');
        })
    );
});
