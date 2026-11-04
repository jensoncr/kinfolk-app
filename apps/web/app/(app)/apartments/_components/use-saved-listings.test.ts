import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSavedListingsStore } from "./use-saved-listings";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body } as Response;
}

describe("createSavedListingsStore", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("loads saved ids on first subscribe and notifies listeners", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ listingIds: ["a", "b"] }));
    const store = createSavedListingsStore();
    const listener = vi.fn();
    store.subscribe(listener);

    await vi.waitFor(() => expect(listener).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith("/api/plan/saved");
    expect([...store.getSnapshot()].sort()).toEqual(["a", "b"]);
  });

  it("shares one load and one state across subscribers", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ listingIds: ["a"] }));
    const store = createSavedListingsStore();
    const first = vi.fn();
    const second = vi.fn();
    store.subscribe(first);
    store.subscribe(second);

    await vi.waitFor(() => expect(second).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().has("a")).toBe(true);
  });

  it("toggles optimistically and posts the desired end state", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ listingIds: [] }));
    const store = createSavedListingsStore();
    store.subscribe(() => {});

    store.toggleSavedListing("listing-1");
    expect(store.getSnapshot().has("listing-1")).toBe(true);
    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/plan/saved",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(postCall?.[1]?.body))).toEqual({
      kind: "listing",
      listingId: "listing-1",
      saved: true,
    });
  });

  it("reverts the optimistic flip when the server rejects", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) =>
      init?.method === "POST"
        ? jsonResponse({}, false)
        : jsonResponse({ listingIds: [] }),
    );
    const store = createSavedListingsStore();
    store.subscribe(() => {});

    store.toggleSavedListing("listing-1");
    expect(store.getSnapshot().has("listing-1")).toBe(true);
    await vi.waitFor(() => expect(store.getSnapshot().has("listing-1")).toBe(false));
  });

  it("keeps a toggle made before the initial load resolves", async () => {
    const initialLoad = deferred<Response>();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) =>
      init?.method === "POST" ? jsonResponse({}) : initialLoad.promise,
    );
    const store = createSavedListingsStore();
    store.subscribe(() => {});

    store.toggleSavedListing("listing-1");
    // The stale snapshot (without the just-toggled listing) resolves late.
    initialLoad.resolve(jsonResponse({ listingIds: ["other"] }));
    await vi.waitFor(() => expect(store.getSnapshot().has("other")).toBe(true));
    expect(store.getSnapshot().has("listing-1")).toBe(true);
  });
});
