self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "日程提醒", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(payload.title || "日程提醒", {
      body: payload.body || "有一项日程即将开始",
      icon: "app-icon-192.png",
      badge: "app-icon-192.png",
      tag: payload.tag || "schedule-reminder",
      data: { url: payload.url || self.registration.scope }
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const appUrl = self.registration.scope;
  let targetUrl = appUrl;
  try {
    const requestedUrl = new URL(event.notification.data?.url || appUrl, appUrl);
    const scopeUrl = new URL(appUrl);
    if (
      requestedUrl.origin === scopeUrl.origin
      && requestedUrl.pathname.startsWith(scopeUrl.pathname)
    ) {
      targetUrl = requestedUrl.href;
    }
  } catch {
    targetUrl = appUrl;
  }

  event.waitUntil(openOrFocusApp(targetUrl, appUrl));
});

async function openOrFocusApp(targetUrl, appUrl) {
  const windowClients = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true
  });
  const scopeUrl = new URL(appUrl);
  const appClient = windowClients.find((client) => {
    try {
      const clientUrl = new URL(client.url);
      return clientUrl.origin === scopeUrl.origin
        && clientUrl.pathname.startsWith(scopeUrl.pathname);
    } catch {
      return false;
    }
  });

  if (appClient) {
    if (typeof appClient.navigate === "function" && appClient.url !== targetUrl) {
      try {
        await appClient.navigate(targetUrl);
      } catch {
        // Focusing the existing PWA is still useful if navigation is unavailable.
      }
    }
    return appClient.focus();
  }

  const openedClient = await self.clients.openWindow(targetUrl);
  return openedClient ? openedClient.focus() : null;
}
