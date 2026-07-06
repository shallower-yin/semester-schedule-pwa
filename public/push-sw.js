self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "日程提醒", body: event.data ? event.data.text() : "" };
  }
  const appUrl = self.registration.scope;
  event.waitUntil(
    self.registration.showNotification(payload.title || "日程提醒", {
      body: payload.body || "有一项日程即将开始",
      icon: new URL("app-icon-192.png", appUrl).href,
      badge: new URL("app-icon-192.png", appUrl).href,
      tag: payload.tag || "schedule-reminder",
      data: { url: payload.url || appUrl }
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

  event.waitUntil(
    self.clients.openWindow(targetUrl).then((windowClient) => (
      windowClient ? windowClient.focus() : null
    ))
  );
});
