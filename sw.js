// Minimal service worker for PWA install support
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
    // Pass through all requests to the network normally
    event.respondWith(fetch(event.request));
});
