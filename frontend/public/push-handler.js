self.addEventListener("push", (event) => {
	let payload = {};
	try {
		payload = event.data ? event.data.json() : {};
	} catch {
		payload = { body: event.data?.text() || "" };
	}
	const badgeCount = Number(payload.badge_count || 0);
	const badge = badgeCount > 0 ? self.registration.setAppBadge?.(badgeCount) : self.registration.clearAppBadge?.();
	event.waitUntil(Promise.all([
		self.registration.showNotification(payload.title || "物资管理", {
			body: payload.body || "有一条新通知",
			tag: payload.tag || "temple-inventory",
			icon: "/assets/temple_inventory/frontend/pwa-icons/icon-192.png",
			badge: "/assets/temple_inventory/frontend/pwa-icons/icon-192.png",
			data: { url: payload.url || "/inventory/notifications" },
		}),
		Promise.resolve(badge).catch(() => undefined),
	]));
});

self.addEventListener("notificationclick", (event) => {
	event.notification.close();
	const path = event.notification.data?.url || "/inventory/notifications";
	const target = new URL(path, self.location.origin).href;
	event.waitUntil((async () => {
		const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
		const inventory = clients.find((client) => new URL(client.url).origin === self.location.origin && new URL(client.url).pathname.startsWith("/inventory"));
		if (inventory) {
			await inventory.navigate(target);
			await inventory.focus();
			return;
		}
		await self.clients.openWindow(target);
	})());
});
