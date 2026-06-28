// D7 Service Worker — Self-destruct
// Unregisters itself immediately and forces page reload to break cache loops

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', () => {
  self.registration.unregister().then(() => {
    return self.clients.matchAll({ type: 'window' });
  }).then(clients => {
    clients.forEach(client => client.navigate(client.url));
  });
});
