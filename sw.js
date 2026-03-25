// Service worker for PWA install support
// Intercepts manifest.json?uid=xxx requests to inject uid into start_url
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
    var url = new URL(event.request.url);

    // Intercept manifest.json requests that carry a uid query param
    if (url.pathname.endsWith('/manifest.json') && url.searchParams.has('uid')) {
        var uid = url.searchParams.get('uid');
        var manifest = {
            name: '\u81ea\u5f8b',
            short_name: '\u81ea\u5f8b',
            description: '\u81ea\u5f8b\u6253\u5361\u5e94\u7528',
            start_url: './index.html?uid=' + encodeURIComponent(uid),
            display: 'standalone',
            background_color: '#ffffff',
            theme_color: '#4f46e5',
            icons: [
                { src: 'icon-v2.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
                { src: 'icon-v2.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
                { src: 'icon-v2.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
                { src: 'icon-v2.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
                { src: 'icon-v2.png', sizes: '180x180', type: 'image/png', purpose: 'any' }
            ]
        };
        event.respondWith(
            new Response(JSON.stringify(manifest), {
                status: 200,
                headers: { 'Content-Type': 'application/manifest+json' }
            })
        );
        return;
    }

    // All other requests pass through to network
    event.respondWith(fetch(event.request));
});
