// Service worker mínimo para que la app se pueda instalar en el celular.
// No guarda nada en caché: todo se pide siempre a la red, así nunca se queda una versión vieja.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
