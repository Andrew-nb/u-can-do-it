// Minimal service worker for PWA install support - v2 (Force update to clear old domain cache)
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    console.log('Deleting old cache:', cacheName);
                    return caches.delete(cacheName);
                })
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    event.respondWith(
        fetch(event.request).catch(() => {
            // Network failed — for page navigation, show a friendly offline page
            if (event.request.mode === 'navigate') {
                return new Response(
                    '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>离线</title></head>' +
                    '<body style="display:flex;justify-content:center;align-items:center;height:100vh;font-family:system-ui;background:#f0f4ff">' +
                    '<div style="text-align:center"><h2>📡 网络连接已断开</h2><p>请检查网络后刷新页面</p>' +
                    '<button onclick="location.reload()" style="margin-top:16px;padding:10px 24px;border:none;border-radius:8px;background:#4f46e5;color:#fff;font-size:16px;cursor:pointer">重新加载</button></div></body></html>',
                    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
                );
            }
            return new Response('', { status: 408, statusText: 'Offline' });
        })
    );
});
