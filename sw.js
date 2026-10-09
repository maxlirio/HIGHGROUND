// HIGHGROUND's service worker: attack notifications for the family Realm (docs/realm-protocol.md), nothing else.
// There is deliberately NO fetch handler — the page loads exactly as it does without a worker, offline box and GitHub
// Pages alike — and it is only ever registered by the realm UI's "Warn me when my house is attacked" toggle
// (js/realm/ui.js). The push payload is written by server/realm.mjs notifyAttack and carried by server/push.mjs.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { try { d = { body: e.data.text() }; } catch { /* no payload */ } }
  e.waitUntil(self.registration.showNotification(d.title || "HIGHGROUND", {
    body: d.body || "Your house needs you.",
    tag: d.tag || "hg-attack", renotify: true,
    icon: "assets/icons/icon-192.png", badge: "assets/icons/icon-192.png",
    data: { url: d.url || "play.html?enter" },
  }));
});

// tap: focus the realm if a window is open, else open the play page — play.html?enter goes straight back in with the
// session this device is signed in with (or asks them to sign in)
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || "play.html?enter", self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of wins) if (new URL(c.url).origin === new URL(url).origin && "focus" in c) { try { await c.focus(); return; } catch { /* try the next */ } }
    await self.clients.openWindow(url);
  })());
});
