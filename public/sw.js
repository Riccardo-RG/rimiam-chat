/* Notification delivery only. Never cache application/API responses or Workspace data. */
const databaseName = "rimiam-web-push-v1";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("state");
      request.result.createObjectStore("seen");
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}
async function binding() {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("state");
      const request = tx.objectStore("state").get("binding");
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}
async function bind(value, expected) {
  const db = await database();
  let applied = false;
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction("state", "readwrite");
      const store = tx.objectStore("state");
      const read = store.get("binding");
      read.onsuccess = () => {
        if (same(read.result ?? null, expected)) {
          applied = true;
          store.put(value, "binding");
        }
      };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
  if (applied && !value)
    for (const notification of await self.registration.getNotifications())
      notification.close();
  return applied;
}
async function claim(id) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("seen", "readwrite");
      const store = tx.objectStore("seen");
      let fresh = false;
      const request = store.get(id);
      request.onsuccess = () => {
        if (!request.result) {
          fresh = true;
          store.put(Date.now(), id);
        }
      };
      // Receipts contain only opaque delivery IDs. Older-than-TTL entries are
      // pruned after 30 days; no Workspace content is stored in this database.
      const cursor = store.openCursor();
      cursor.onsuccess = () => {
        const entry = cursor.result;
        if (!entry) return;
        if (entry.value < Date.now() - 30 * 86400000) entry.delete();
        entry.continue();
      };
      tx.oncomplete = () => resolve(fresh);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
function same(a, b) {
  return (
    (!a && !b) ||
    Boolean(
      a &&
      b &&
      a.actor === b.actor &&
      a.session === b.session &&
      a.device === b.device,
    )
  );
}
async function target(data, current) {
  if (!current || current.device !== data.deviceId) return null;
  const response = await fetch(
    `/api/web-push/deliveries/${data.id}?device=${data.deviceId}`,
    {
      credentials: "include",
      cache: "no-store",
      redirect: "error",
    },
  );
  if (!response.ok) return null;
  const value = await response.json();
  if (
    typeof value.url !== "string" ||
    !/^\/\?workspace=[0-9a-f-]{36}$/i.test(value.url)
  )
    return null;
  return same(current, await binding())
    ? { url: value.url, english: value.locale === "en" }
    : null;
}
async function receive(event) {
  let data;
  try {
    data = event.data?.json();
  } catch {
    return;
  }
  if (!uuid.test(data?.id ?? "") || !uuid.test(data?.deviceId ?? "")) return;
  const current = await binding();
  const destination = await target(data, current);
  if (
    !destination ||
    !(await claim(data.id)) ||
    !same(current, await binding())
  )
    return;
  await self.registration.showNotification("RIMIAM", {
    body: destination.english
      ? "There are updates in one of your spaces."
      : "Ci sono aggiornamenti in uno dei tuoi spazi.",
    icon: "/icons/rimiam-192.png",
    tag: `rimiam:${data.id}`,
    renotify: false,
    data: { ...data, actor: current.actor, session: current.session },
  });
  // A logout racing the OS display closes the generic notice as soon as observed.
  if (!same(current, await binding()))
    for (const notice of await self.registration.getNotifications({
      tag: `rimiam:${data.id}`,
    }))
      notice.close();
}
self.addEventListener("install", (event) =>
  event.waitUntil(self.skipWaiting()),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);
self.addEventListener("push", (event) => {
  // Unknown eligibility or a failed read is not permission to disclose. Browsers
  // may show their own generic fallback because subscriptions are userVisibleOnly.
  event.waitUntil(receive(event).catch(() => {}));
});
self.addEventListener("message", (event) => {
  if (
    !event.source?.url ||
    new URL(event.source.url).origin !== self.location.origin
  )
    return;
  const port = event.ports[0];
  if (!port) return;
  const task = async () => {
    if (event.data?.type === "RIMIAM_PUSH_STATE") return binding();
    if (event.data?.type !== "RIMIAM_PUSH_BIND")
      throw new Error("Invalid message");
    const value = event.data.binding;
    if (
      value !== null &&
      (!uuid.test(value?.device ?? "") ||
        typeof value?.actor !== "string" ||
        !value.actor ||
        value.actor.length > 200 ||
        typeof value?.session !== "string" ||
        !value.session ||
        value.session.length > 200)
    )
      throw new Error("Invalid binding");
    if (!Object.hasOwn(event.data, "expected"))
      throw new Error("Expected binding required");
    return bind(value, event.data.expected);
  };
  event.waitUntil(
    task().then(
      (value) => port.postMessage({ ok: true, value }),
      () => port.postMessage({ ok: false }),
    ),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const data = event.notification.data;
      const current = await binding();
      if (
        !current ||
        current.actor !== data?.actor ||
        current.session !== data?.session
      )
        return;
      const destination = await target(data, current);
      if (!destination) return;
      await self.clients.openWindow(
        new URL(destination.url, self.location.origin).href,
      );
    })().catch(() => {}),
  );
});
self.addEventListener("pushsubscriptionchange", (event) => {
  // A browser-rotated endpoint needs an explicit, authenticated opt-in again.
  event.waitUntil(
    binding()
      .then((current) => bind(null, current))
      .catch(() => {}),
  );
});
