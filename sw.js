// Batch Portal — push notification service worker.
// Must be served from the SITE ROOT (same folder as index.html) on
// GitHub Pages so its scope covers every page of the app.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (err) {
    data = { title: "Batch Portal", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "Batch Portal";
  const options = {
    body: data.body || "",
    icon: "/icon-192.png",   // optional — safe to leave even if the file doesn't exist
    badge: "/icon-192.png",
    data: { url: data.url || "/home.html" },
    tag: data.tag || "batchportal"
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/home.html";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(targetUrl.replace(/^\//, "")) && "focus" in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
