import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  connectWorkspace,
  type WorkspaceConnection,
} from "../src/client/workspace-sync";
import { WorkspaceConnectionNotice } from "../src/client/workspace-connection";

class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instances: FakeEventSource[] = [];
  readyState: number = FakeEventSource.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn(() => {
    this.readyState = FakeEventSource.CLOSED;
  });

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  open() {
    this.readyState = FakeEventSource.OPEN;
    this.onopen?.();
  }

  fail(state: number = FakeEventSource.CONNECTING) {
    this.readyState = state;
    this.onerror?.();
  }
}

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function settleRead() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("read-only Workspace synchronization", () => {
  let browser: EventTarget;
  let page: EventTarget & { visibilityState: string };
  let network: { onLine: boolean };
  let connections: ReturnType<typeof connectWorkspace>[];

  beforeEach(() => {
    browser = new EventTarget();
    page = Object.assign(new EventTarget(), { visibilityState: "visible" });
    network = { onLine: true };
    connections = [];
    FakeEventSource.instances = [];
    vi.stubGlobal("window", browser);
    vi.stubGlobal("document", page);
    vi.stubGlobal("navigator", network);
    vi.stubGlobal("EventSource", FakeEventSource);
  });

  afterEach(() => {
    for (const connection of connections) connection.close();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function connect(read: (signal: AbortSignal) => Promise<void>) {
    const states: WorkspaceConnection[] = [];
    const sync = connectWorkspace("workspace-a", read, (state) =>
      states.push(state),
    );
    connections.push(sync);
    const events = FakeEventSource.instances.at(-1)!;
    return { sync, events, states };
  }

  it("coalesces revision bursts into one follow-up read without losing a later revision", async () => {
    const requests: ReturnType<typeof deferred>[] = [];
    const read = vi.fn(() => {
      const request = deferred();
      requests.push(request);
      return request.promise;
    });
    const { sync, events, states } = connect(read);

    expect(events.url).toBe("/api/workspaces/workspace-a/events");
    expect(states).toEqual(["loading"]);
    events.open();
    for (let index = 0; index < 20; index++) events.onmessage?.();
    await sync.refresh();
    expect(read).toHaveBeenCalledTimes(1);

    requests[0].resolve();
    await settleRead();
    expect(read).toHaveBeenCalledTimes(2);
    expect(states).toEqual(["loading", "live"]);
    requests[1].resolve();
    await settleRead();
    expect(read).toHaveBeenCalledTimes(2);

    events.onmessage?.();
    expect(read).toHaveBeenCalledTimes(3);
    requests[2].resolve();
    await settleRead();
    expect(states).toEqual(["loading", "live"]);
  });

  it("verifies once per reconnecting outage without flooding reads and resets after opening", async () => {
    const read = vi.fn(async () => {});
    const { events, states } = connect(read);
    await settleRead();
    events.open();
    await settleRead();
    expect(states.at(-1)).toBe("live");
    read.mockClear();
    const beforeErrors = states.length;

    for (let index = 0; index < 30; index++) events.fail();
    await settleRead();
    expect(read).toHaveBeenCalledTimes(1);
    expect(states.slice(beforeErrors)).toEqual(["reconnecting"]);
    expect(FakeEventSource.instances).toHaveLength(1);

    events.open();
    await settleRead();
    expect(read).toHaveBeenCalledTimes(2);
    expect(states.at(-1)).toBe("live");
    for (let index = 0; index < 30; index++) events.fail();
    await settleRead();
    expect(read).toHaveBeenCalledTimes(3);
    expect(states.at(-1)).toBe("reconnecting");
  });

  it("rechecks terminal closure after a successful outage read so later access denial is observed", async () => {
    const read = vi.fn(async () => {});
    const { events, states } = connect(read);
    await settleRead();
    events.open();
    await settleRead();
    read.mockClear();

    events.fail();
    await settleRead();
    expect(read).toHaveBeenCalledTimes(1);
    expect(states.at(-1)).toBe("reconnecting");
    read.mockRejectedValueOnce(new Error("WORKSPACE_ACCESS_DENIED"));
    events.fail(FakeEventSource.CLOSED);
    await settleRead();
    expect(read).toHaveBeenCalledTimes(2);
    expect(states.at(-1)).toBe("failed");

    for (let index = 0; index < 30; index++)
      events.fail(FakeEventSource.CLOSED);
    await settleRead();
    expect(read).toHaveBeenCalledTimes(2);
    expect(states.at(-1)).toBe("failed");
  });

  it("uses only one verification when an outage is terminal from its first error", async () => {
    const read = vi.fn(async () => {});
    const { events, states } = connect(read);
    await settleRead();
    events.open();
    await settleRead();
    read.mockClear();
    read.mockRejectedValueOnce(new Error("AUTHENTICATION_REQUIRED"));

    for (let index = 0; index < 30; index++)
      events.fail(FakeEventSource.CLOSED);
    await settleRead();
    expect(read).toHaveBeenCalledTimes(1);
    expect(states.at(-1)).toBe("failed");
  });

  it("queues one terminal verification behind an in-flight outage read", async () => {
    const read = vi.fn(async () => {});
    const { events, states } = connect(read);
    await settleRead();
    events.open();
    await settleRead();
    read.mockClear();
    const outageRead = deferred();
    read
      .mockReturnValueOnce(outageRead.promise)
      .mockRejectedValueOnce(new Error("WORKSPACE_ACCESS_DENIED"));

    events.fail();
    for (let index = 0; index < 30; index++)
      events.fail(FakeEventSource.CLOSED);
    expect(read).toHaveBeenCalledTimes(1);
    outageRead.resolve();
    await settleRead();
    expect(read).toHaveBeenCalledTimes(2);
    expect(states.at(-1)).toBe("failed");
  });

  it("can explicitly replace a terminal stream, ignoring old callbacks", async () => {
    const read = vi
      .fn<(signal: AbortSignal) => Promise<void>>()
      .mockResolvedValue(undefined);
    const { sync, events, states } = connect(read);
    await settleRead();
    events.open();
    await settleRead();
    const oldOpen = events.onopen!;
    const oldMessage = events.onmessage!;
    const oldError = events.onerror!;
    read.mockClear();

    for (let index = 0; index < 30; index++)
      events.fail(FakeEventSource.CLOSED);
    await settleRead();
    expect(read).toHaveBeenCalledTimes(1);
    expect(states.at(-1)).toBe("failed");
    expect(FakeEventSource.instances).toHaveLength(1);
    await sync.refresh();
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(events.close).toHaveBeenCalledTimes(1);
    expect(events.onopen).toBeNull();
    expect(events.onmessage).toBeNull();
    expect(events.onerror).toBeNull();
    expect(states.at(-1)).toBe("reconnecting");
    const replacement = FakeEventSource.instances[1];
    await sync.refresh();
    expect(FakeEventSource.instances).toHaveLength(2);
    replacement.open();
    await settleRead();
    expect(states.at(-1)).toBe("live");

    const count = read.mock.calls.length;
    const published = [...states];
    oldOpen();
    oldMessage();
    oldError();
    await settleRead();
    expect(read).toHaveBeenCalledTimes(count);
    expect(states).toEqual(published);
    expect(
      FakeEventSource.instances.filter(
        (source) => source.readyState !== FakeEventSource.CLOSED,
      ),
    ).toEqual([replacement]);
    const signal = read.mock.calls.at(-1)![0];
    sync.close();
    expect(signal.aborted).toBe(true);
    expect(replacement.close).toHaveBeenCalledTimes(1);
    expect(replacement.readyState).toBe(FakeEventSource.CLOSED);
  });

  it("replaces a terminal stream once when returning online, without opening one while offline", async () => {
    const read = vi.fn(async () => {});
    const { sync, events, states } = connect(read);
    await settleRead();
    events.open();
    await settleRead();
    network.onLine = false;
    browser.dispatchEvent(new Event("offline"));
    events.fail(FakeEventSource.CLOSED);
    await sync.refresh();
    expect(states.at(-1)).toBe("offline");
    expect(FakeEventSource.instances).toHaveLength(1);

    network.onLine = true;
    browser.dispatchEvent(new Event("online"));
    browser.dispatchEvent(new Event("online"));
    await settleRead();
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(events.close).toHaveBeenCalledTimes(1);
    expect(states.at(-1)).toBe("reconnecting");
    FakeEventSource.instances[1].open();
    await settleRead();
    expect(states.at(-1)).toBe("live");
  });

  it("preserves EventSource-owned reconnecting streams during manual and online refreshes", async () => {
    const read = vi.fn(async () => {});
    const { sync, events, states } = connect(read);
    await settleRead();
    events.open();
    await settleRead();
    events.fail();
    await settleRead();

    await sync.refresh();
    browser.dispatchEvent(new Event("online"));
    await settleRead();
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(events.close).not.toHaveBeenCalled();
    expect(events.readyState).toBe(FakeEventSource.CONNECTING);
    expect(states.at(-1)).toBe("reconnecting");
  });

  it("does not read while offline and refreshes when connectivity returns", async () => {
    const read = vi.fn(async () => {});
    const { sync, events, states } = connect(read);
    await settleRead();
    events.open();
    await settleRead();
    read.mockClear();

    network.onLine = false;
    browser.dispatchEvent(new Event("offline"));
    events.onmessage?.();
    events.fail();
    page.dispatchEvent(new Event("visibilitychange"));
    await sync.refresh();
    expect(read).not.toHaveBeenCalled();
    expect(states.at(-1)).toBe("offline");

    network.onLine = true;
    browser.dispatchEvent(new Event("online"));
    await settleRead();
    expect(read).toHaveBeenCalledTimes(1);
    expect(states.at(-1)).toBe("reconnecting");
    events.open();
    await settleRead();
    expect(states.at(-1)).toBe("live");
  });

  it.each(["online", "manual", "message"] as const)(
    "recovers on %s when an offline cycle leaves the underlying stream open without another open event",
    async (trigger) => {
      const read = vi.fn(async () => {});
      const { sync, events, states } = connect(read);
      await settleRead();
      events.open();
      await settleRead();
      read.mockClear();

      network.onLine = false;
      browser.dispatchEvent(new Event("offline"));
      expect(states.at(-1)).toBe("offline");
      expect(events.readyState).toBe(FakeEventSource.OPEN);
      expect(read).not.toHaveBeenCalled();

      network.onLine = true;
      if (trigger === "online") browser.dispatchEvent(new Event("online"));
      else if (trigger === "manual") await sync.refresh();
      else events.onmessage?.();
      await settleRead();
      expect(read).toHaveBeenCalledTimes(1);
      expect(states.at(-1)).toBe("live");
      expect(FakeEventSource.instances).toHaveLength(1);
      expect(events.close).not.toHaveBeenCalled();
    },
  );

  it("recovers a failed online read by manual retry while the same stream remains open", async () => {
    const read = vi.fn(async () => {});
    const { sync, events, states } = connect(read);
    await settleRead();
    events.open();
    await settleRead();
    network.onLine = false;
    browser.dispatchEvent(new Event("offline"));
    read.mockRejectedValueOnce(new Error("NETWORK_UNAVAILABLE"));

    network.onLine = true;
    browser.dispatchEvent(new Event("online"));
    await settleRead();
    expect(states.at(-1)).toBe("failed");
    expect(events.readyState).toBe(FakeEventSource.OPEN);
    await sync.refresh();
    expect(states.at(-1)).toBe("live");
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(events.close).not.toHaveBeenCalled();
  });

  it("starts offline without a read and loads after the online event", async () => {
    network.onLine = false;
    const read = vi.fn(async () => {});
    const { states } = connect(read);
    expect(states).toEqual(["offline"]);
    expect(read).not.toHaveBeenCalled();

    network.onLine = true;
    browser.dispatchEvent(new Event("online"));
    await settleRead();
    expect(read).toHaveBeenCalledTimes(1);
    expect(states).toEqual(["offline", "loading", "reconnecting"]);
  });

  it("refreshes a visible page without fetching merely because it became hidden", async () => {
    const read = vi.fn(async () => {});
    connect(read);
    await settleRead();
    read.mockClear();

    page.visibilityState = "hidden";
    page.dispatchEvent(new Event("visibilitychange"));
    expect(read).not.toHaveBeenCalled();
    page.visibilityState = "visible";
    page.dispatchEvent(new Event("visibilitychange"));
    await settleRead();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it.each(["foreground", "back-forward cache", "offline foreground"] as const)(
    "replaces the pre-suspension stream and fences its hung read on %s",
    async (trigger) => {
      const suspended = deferred();
      const read = vi
        .fn<(signal: AbortSignal) => Promise<void>>()
        .mockImplementationOnce(() => suspended.promise)
        .mockResolvedValue(undefined);
      const { events, states } = connect(read);
      events.open();
      const oldSignal = read.mock.calls[0][0];
      const queuedMessage = events.onmessage!;
      if (trigger === "back-forward cache") {
        browser.dispatchEvent(new Event("pagehide"));
        browser.dispatchEvent(
          Object.assign(new Event("pageshow"), { persisted: true }),
        );
      } else {
        page.visibilityState = "hidden";
        page.dispatchEvent(new Event("visibilitychange"));
        if (trigger === "offline foreground") {
          network.onLine = false;
          browser.dispatchEvent(new Event("offline"));
        }
        page.visibilityState = "visible";
        page.dispatchEvent(new Event("visibilitychange"));
        if (!network.onLine) {
          expect(read).toHaveBeenCalledTimes(1);
          network.onLine = true;
          browser.dispatchEvent(new Event("online"));
        }
      }
      await settleRead();
      expect(oldSignal.aborted).toBe(true);
      expect(read).toHaveBeenCalledTimes(2);
      expect(FakeEventSource.instances).toHaveLength(2);
      expect(events.close).toHaveBeenCalledOnce();
      const replacement = FakeEventSource.instances[1];
      replacement.open();
      await settleRead();
      expect(states.at(-1)).toBe("live");
      suspended.reject(new Error("NETWORK_UNAVAILABLE"));
      queuedMessage();
      await settleRead();
      expect(states.at(-1)).toBe("live");
      expect(read).toHaveBeenCalledTimes(3);
      replacement.onmessage?.();
      expect(read).toHaveBeenCalledTimes(4);
    },
  );

  it("reconnects a terminal stream while the page stays open if the snapshot confirms access", async () => {
    vi.useFakeTimers();
    const read = vi.fn(async () => {});
    const { events, states } = connect(read);
    await settleRead();
    events.fail(FakeEventSource.CLOSED);
    await settleRead();
    expect(states.at(-1)).toBe("failed");
    await vi.advanceTimersByTimeAsync(2000);
    expect(FakeEventSource.instances).toHaveLength(2);
    FakeEventSource.instances[1].open();
    await settleRead();
    expect(states.at(-1)).toBe("live");
  });

  it("backs off transient snapshot failures, then stops retrying if access ends", async () => {
    vi.useFakeTimers();
    const read = vi
      .fn<(signal: AbortSignal) => Promise<void>>()
      .mockRejectedValueOnce(new Error("NETWORK_UNAVAILABLE"))
      .mockRejectedValueOnce(new Error("SERVICE_UNAVAILABLE"))
      .mockRejectedValue(new Error("WORKSPACE_ACCESS_DENIED"));
    const { events, states } = connect(read);
    await settleRead();
    await vi.advanceTimersByTimeAsync(2000);
    expect(read).toHaveBeenCalledTimes(2);
    events.readyState = FakeEventSource.CLOSED;
    events.onerror?.();
    await settleRead();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(read).toHaveBeenCalledTimes(3);
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(states.at(-1)).toBe("failed");
  });

  it("keeps a failed read visible until a successful read recovers it", async () => {
    const read = vi
      .fn<(signal: AbortSignal) => Promise<void>>()
      .mockRejectedValueOnce(new Error("read unavailable"))
      .mockRejectedValueOnce(new Error("read unavailable"))
      .mockResolvedValue(undefined);
    const { sync, events, states } = connect(read);
    await settleRead();
    expect(states).toEqual(["loading", "failed"]);
    events.fail();
    await settleRead();
    expect(states).toEqual(["loading", "failed"]);

    await sync.refresh();
    expect(states.at(-1)).toBe("reconnecting");
    events.open();
    await settleRead();
    expect(states.at(-1)).toBe("live");
    expect(read.mock.calls.every(([signal]) => !signal.aborted)).toBe(true);
  });

  it.each(["resolve", "reject"] as const)(
    "aborts and removes listeners on disposal; a late %s cannot publish or start a pending read",
    async (outcome) => {
      const windowAdded = vi.spyOn(browser, "addEventListener");
      const windowRemoved = vi.spyOn(browser, "removeEventListener");
      const documentAdded = vi.spyOn(page, "addEventListener");
      const documentRemoved = vi.spyOn(page, "removeEventListener");
      const request = deferred();
      const read = vi
        .fn<(signal: AbortSignal) => Promise<void>>()
        .mockImplementation(() => request.promise);
      const { sync, events, states } = connect(read);
      events.onmessage?.();
      const published = [...states];
      const signal = read.mock.calls[0][0];
      const queuedOpen = events.onopen!;
      const queuedMessage = events.onmessage!;
      const queuedError = events.onerror!;

      sync.close();
      expect(signal.aborted).toBe(true);
      expect(events.close).toHaveBeenCalledTimes(1);
      expect(windowRemoved.mock.calls).toEqual(windowAdded.mock.calls);
      expect(documentRemoved.mock.calls).toEqual(documentAdded.mock.calls);
      expect(windowRemoved.mock.calls.map(([name]) => name)).toEqual([
        "online",
        "offline",
        "pagehide",
        "pageshow",
      ]);
      expect(documentRemoved.mock.calls.map(([name]) => name)).toEqual([
        "visibilitychange",
      ]);

      if (outcome === "resolve") request.resolve();
      else request.reject(new Error("aborted read completed late"));
      await settleRead();
      browser.dispatchEvent(new Event("online"));
      browser.dispatchEvent(new Event("offline"));
      page.dispatchEvent(new Event("visibilitychange"));
      queuedOpen();
      queuedMessage();
      queuedError();
      await sync.refresh();
      expect(read).toHaveBeenCalledTimes(1);
      expect(states).toEqual(published);
    },
  );
});

describe("Workspace connection notice", () => {
  it.each(["loading", "live"] as const)(
    "does not add a notice for %s",
    (state) => {
      expect(
        renderToStaticMarkup(
          createElement(WorkspaceConnectionNotice, { state, retry: vi.fn() }),
        ),
      ).toBe("");
    },
  );

  it.each([
    { state: "offline", text: "Sei offline.", retry: false },
    {
      state: "reconnecting",
      text: "Riconnessione agli aggiornamenti",
      retry: true,
    },
    {
      state: "failed",
      text: "Non riesco ad aggiornare lo spazio.",
      retry: true,
    },
  ] as const)("explains $state with readable status text", (entry) => {
    const html = renderToStaticMarkup(
      createElement(WorkspaceConnectionNotice, {
        state: entry.state,
        retry: vi.fn(),
      }),
    );
    expect(html).toContain('role="status"');
    expect(html).toContain(entry.text);
    expect(html.includes("Aggiorna lo spazio")).toBe(entry.retry);
    if (entry.retry) expect(html).toContain('<button type="button"');
    else expect(html).not.toContain("<button");
  });
});
