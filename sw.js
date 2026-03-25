// Service Worker: Network-first with cache fallback + timeout
const CACHE_NAME = 'v1';
const TIMEOUT_MS = 5000; // 5 second network timeout

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
    // Clean old caches
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

// Fetch with timeout helper
function fetchWithTimeout(request, ms) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), ms);
        fetch(request).then(
            res => { clearTimeout(timer); resolve(res); },
            err => { clearTimeout(timer); reject(err); }
        );
    });
}

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Only handle GET requests
    if (event.request.method !== 'GET') return;

    // Skip API requests — always go to network, no caching
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/verify')) {
        return;
    }

    event.respondWith(
        fetchWithTimeout(event.request, TIMEOUT_MS)
            .then(response => {
                // Network succeeded — clone and cache the response
                if (response.ok) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                }
                return response;
            })
            .catch(() => {
                // Network failed or timed out — try cache
                return caches.match(event.request).then(cached => {
                    if (cached) return cached;
                    // Navigation request: show offline page
                    if (event.request.mode === 'navigate') {
                        return new Response(
                            '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>离线</title></head>' +
                            '<body style="display:flex;justify-content:center;align-items:center;height:100vh;font-family:system-ui;background:#f0f4ff">' +
                            '<div style="text-align:center"><h2>📡 网络连接不稳定</h2><p>部分资源加载失败，请检查网络后重试</p>' +
                            '<button onclick="location.reload()" style="margin-top:16px;padding:10px 24px;border:none;border-radius:8px;background:#4f46e5;color:#fff;font-size:16px;cursor:pointer">重新加载</button></div></body></html>',
                            { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
                        );
                    }
                    return new Response('', { status: 408, statusText: 'Offline' });
                });
            })
    );
});
