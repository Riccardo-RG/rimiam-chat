import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createContext, runInContext } from "node:vm";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";

const script = readFileSync(
  new URL("../public/sw.js", import.meta.url),
  "utf8",
);
type Binding = { actor: string; session: string; device: string };
function worker(database = new IDBFactory()) {
  const handlers = new Map<string, (event: unknown) => void>();
  const shown: { title: string; options: Record<string, unknown> }[] = [];
  const showNotification = vi.fn(async (title, options) => {
    shown.push({ title, options });
  });
  const openWindow = vi.fn(async () => {});
  const fetch = vi.fn(async () =>
    Response.json({ url: `/?workspace=${randomUUID()}` }),
  );
  const context = createContext({
    indexedDB: database,
    URL,
    Object,
    Date,
    fetch,
    self: {
      location: { origin: "https://app.example.test" },
      registration: { showNotification, getNotifications: async () => [] },
      clients: { openWindow, claim: async () => {} },
      skipWaiting: async () => {},
      addEventListener: (name: string, handler: (event: unknown) => void) =>
        handlers.set(name, handler),
    },
  });
  runInContext(script, context);
  const run = <T>(expression: string, values: Record<string, unknown> = {}) => {
    Object.assign(context, values);
    return runInContext(expression, context) as Promise<T>;
  };
  async function dispatch(name: string, fields: Record<string, unknown>) {
    const pending: Promise<unknown>[] = [];
    handlers.get(name)!({
      ...fields,
      waitUntil: (work: Promise<unknown>) => pending.push(work),
    });
    await Promise.all(pending);
  }
  return {
    context,
    run,
    fetch,
    shown,
    showNotification,
    openWindow,
    dispatch,
    database,
  };
}
const identity = (): Binding => ({
  actor: randomUUID(),
  session: randomUUID(),
  device: randomUUID(),
});
const push = (value: { id: string; deviceId: string }) => ({
  data: { json: () => value },
});

describe("notification service worker with persistent IndexedDB", () => {
  it("deduplicates concurrent deliveries and the same delivery after worker restart", async () => {
    const w = worker(),
      binding = identity(),
      payload = { id: randomUUID(), deviceId: binding.device };
    expect(await w.run("bind(value, null)", { value: binding })).toBe(true);
    await Promise.all([
      w.dispatch("push", push(payload)),
      w.dispatch("push", push(payload)),
    ]);
    expect(w.shown).toHaveLength(1);
    expect(w.shown[0]).toMatchObject({
      title: "RIMIAM",
      options: {
        body: "Ci sono aggiornamenti in uno dei tuoi spazi.",
        tag: `rimiam:${payload.id}`,
        renotify: false,
      },
    });
    expect(w.fetch).toHaveBeenCalledWith(
      `/api/web-push/deliveries/${payload.id}?device=${binding.device}`,
      { credentials: "include", cache: "no-store", redirect: "error" },
    );
    const restarted = worker(w.database);
    await restarted.dispatch("push", push(payload));
    expect(restarted.shown).toHaveLength(0);
    expect(await restarted.run("binding()")).toEqual(binding);
  });
  it("shows only generic English copy when the validated destination selects English", async () => {
    const w = worker(),
      binding = identity(),
      payload = { id: randomUUID(), deviceId: binding.device };
    await w.run("bind(value,null)", { value: binding });
    w.fetch.mockResolvedValueOnce(
      Response.json({
        url: "/?workspace=" + randomUUID(),
        locale: "en",
        body: "Private reply",
      }),
    );
    await w.dispatch("push", push(payload));
    expect(w.shown[0]?.options.body).toBe(
      "There are updates in one of your spaces.",
    );
    expect(JSON.stringify(w.shown)).not.toContain("Private reply");
  });
  it("fails closed when unbound, access ended, fetch failed, or the target is external", async () => {
    const w = worker(),
      binding = identity(),
      payload = { id: randomUUID(), deviceId: binding.device };
    await w.dispatch("push", push(payload));
    expect(w.fetch).not.toHaveBeenCalled();
    await w.run("bind(value,null)", { value: binding });
    w.fetch.mockResolvedValueOnce(new Response(null, { status: 401 }));
    await w.dispatch("push", push(payload));
    w.fetch.mockRejectedValueOnce(new Error("offline"));
    await w.dispatch("push", push(payload));
    w.fetch.mockResolvedValueOnce(
      Response.json({ url: "https://evil.test/private" }),
    );
    await w.dispatch("push", push(payload));
    expect(w.shown).toHaveLength(0);
    await w.dispatch("push", push(payload));
    expect(w.shown).toHaveLength(1);
  });
  it("does not display a late response across an account switch or let stale cleanup clear the new binding", async () => {
    const w = worker(),
      first = identity(),
      second = identity(),
      payload = { id: randomUUID(), deviceId: first.device };
    await w.run("bind(value,null)", { value: first });
    let release!: (value: Response) => void;
    w.fetch.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const pending = w.dispatch("push", push(payload));
    await expect.poll(() => typeof release).toBe("function");
    expect(
      await w.run("bind(next,previous)", { next: second, previous: first }),
    ).toBe(true);
    expect(await w.run("bind(null,previous)", { previous: first })).toBe(false);
    release(Response.json({ url: `/?workspace=${randomUUID()}` }));
    await pending;
    expect(w.shown).toHaveLength(0);
    expect(await w.run("binding()")).toEqual(second);
    await w.dispatch(
      "push",
      push({ id: randomUUID(), deviceId: second.device }),
    );
    expect(w.shown).toHaveLength(1);
  });
  it("revalidates notification clicks and never opens another account's destination", async () => {
    const w = worker(),
      binding = identity(),
      payload = { id: randomUUID(), deviceId: binding.device };
    await w.run("bind(value,null)", { value: binding });
    await w.dispatch("push", push(payload));
    const close = vi.fn();
    const notification = { close, data: w.shown[0].options.data };
    w.fetch.mockResolvedValueOnce(new Response(null, { status: 404 }));
    await w.dispatch("notificationclick", { notification });
    expect(w.openWindow).not.toHaveBeenCalled();
    await w.run("bind(null,previous)", { previous: binding });
    await w.dispatch("notificationclick", { notification });
    expect(w.openWindow).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(2);
  });
  it("requires a same-origin message and an exact expected binding for changes", async () => {
    const w = worker(),
      first = identity(),
      second = identity(),
      reply = vi.fn();
    await w.run("bind(value,null)", { value: first });
    await w.dispatch("message", {
      source: { url: "https://evil.test/" },
      ports: [{ postMessage: reply }],
      data: { type: "RIMIAM_PUSH_BIND", binding: null, expected: first },
    });
    expect(reply).not.toHaveBeenCalled();
    await w.dispatch("message", {
      source: { url: "https://app.example.test/" },
      ports: [{ postMessage: reply }],
      data: { type: "RIMIAM_PUSH_BIND", binding: second, expected: null },
    });
    expect(reply).toHaveBeenLastCalledWith({ ok: true, value: false });
    expect(await w.run("binding()")).toEqual(first);
  });
});
