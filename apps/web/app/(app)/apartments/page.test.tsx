import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ApartmentsMapViewDynamicProps = {
  initialListing?: Record<string, unknown> | null;
  initialListingId?: string | null;
  snapshot: Record<string, unknown>;
};

const mocks = vi.hoisted(() => ({
  apartmentsMapViewDynamic: vi.fn(),
  ensureCurrentKinfolkUser: vi.fn(),
  getApartmentListingDetail: vi.fn(),
  getApartmentSearchSnapshot: vi.fn(),
  preloadApartmentSearchCatalog: vi.fn(),
}));

vi.mock("@/app/(app)/apartments/_components/apartments-map-view-dynamic", async () => {
  const React = await vi.importActual<typeof import("react")>("react");

  return {
    ApartmentsMapViewDynamic: (props: ApartmentsMapViewDynamicProps) => {
      mocks.apartmentsMapViewDynamic(props);
      return React.createElement("main", {
        "data-initial-listing-id": props.initialListingId ?? "",
        "data-initial-listing-detail-id": String(props.initialListing?.id ?? ""),
        "data-listing-count": String(
          Array.isArray(props.snapshot.listings) ? props.snapshot.listings.length : 0,
        ),
        "data-market": String(props.snapshot.market ?? ""),
      });
    },
  };
});

vi.mock("@/lib/apartments/search", () => ({
  getApartmentListingDetail: mocks.getApartmentListingDetail,
  getApartmentSearchSnapshot: mocks.getApartmentSearchSnapshot,
  preloadApartmentSearchCatalog: mocks.preloadApartmentSearchCatalog,
}));

vi.mock("@/lib/shared/users", () => ({
  ensureCurrentKinfolkUser: mocks.ensureCurrentKinfolkUser,
}));

import ApartmentsPage, { generateMetadata } from "./page";

function apartmentSnapshot({
  listings = [{ id: "listing-1" }],
  market = "San Francisco",
}: {
  listings?: Array<Record<string, unknown>>;
  market?: string;
} = {}) {
  return {
    activeProfile: {
      budgetMax: 4200,
      budgetMin: 2400,
      dealbreakers: [],
      householdSizeMax: 3,
      householdSizeMin: 2,
      moveInEnd: "",
      moveInStart: "",
      mustHaves: [],
      neighborhoods: ["Pacific Heights"],
      pets: "open",
    },
    listings,
    market,
    neighborhoods: [{ id: "pac-heights", name: "Pacific Heights" }],
    refreshedAt: "2026-06-21T12:00:00.000Z",
    refreshStale: false,
    source: {
      detail: "connected",
      kind: "supabase",
      status: "connected",
    },
  };
}

function listingDetail(id = "listing-123") {
  return {
    id,
    address: "123 Pacific Ave",
    bathrooms: 1,
    bedrooms: 2,
    effectiveMonthlyRent: null,
    effectivePerPersonRent: null,
    fitScore: 72,
    monthlyRent: 4200,
    neighborhood: "Pacific Heights",
    perPersonRent: 2100,
    photoUrl: "https://photos.example.com/listing.jpg",
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function flushMicrotasks(count = 5) {
  for (let i = 0; i < count; i++) {
    await Promise.resolve();
  }
}

describe("ApartmentsPage", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureCurrentKinfolkUser.mockResolvedValue({
      user: { id: "user-1" },
    });
    mocks.getApartmentListingDetail.mockResolvedValue(listingDetail());
    mocks.getApartmentSearchSnapshot.mockResolvedValue(apartmentSnapshot());
    mocks.preloadApartmentSearchCatalog.mockResolvedValue(undefined);
  });

  it("loads the current user's apartment snapshot and passes a scalar listing query to the map", async () => {
    const html = renderToStaticMarkup(
      await ApartmentsPage({
        searchParams: Promise.resolve({ listing: "listing-123" }),
      }),
    );

    expect(mocks.ensureCurrentKinfolkUser).toHaveBeenCalledOnce();
    expect(mocks.preloadApartmentSearchCatalog).toHaveBeenCalledOnce();
    expect(mocks.getApartmentSearchSnapshot).toHaveBeenCalledWith("user-1");
    expect(mocks.getApartmentListingDetail).toHaveBeenCalledWith(
      "listing-123",
      "user-1",
    );
    expect(mocks.apartmentsMapViewDynamic).toHaveBeenCalledWith({
      initialListing: listingDetail(),
      initialListingId: "listing-123",
      snapshot: apartmentSnapshot(),
    });
    expect(html).toContain('data-initial-listing-id="listing-123"');
    expect(html).toContain('data-initial-listing-detail-id="listing-123"');
    expect(html).toContain('data-listing-count="1"');
    expect(html).toContain('data-market="San Francisco"');
  });

  it("trims scalar listing query values before fetching and focusing details", async () => {
    const html = renderToStaticMarkup(
      await ApartmentsPage({
        searchParams: Promise.resolve({ listing: "  listing-123  " }),
      }),
    );

    expect(mocks.getApartmentListingDetail).toHaveBeenCalledWith(
      "listing-123",
      "user-1",
    );
    expect(mocks.apartmentsMapViewDynamic).toHaveBeenCalledWith({
      initialListing: listingDetail(),
      initialListingId: "listing-123",
      snapshot: apartmentSnapshot(),
    });
    expect(html).toContain('data-initial-listing-id="listing-123"');
  });

  it("ignores blank scalar listing query values before detail lookup", async () => {
    const html = renderToStaticMarkup(
      await ApartmentsPage({
        searchParams: Promise.resolve({ listing: "   " }),
      }),
    );

    expect(mocks.getApartmentListingDetail).not.toHaveBeenCalled();
    expect(mocks.apartmentsMapViewDynamic).toHaveBeenCalledWith({
      initialListing: null,
      initialListingId: null,
      snapshot: apartmentSnapshot(),
    });
    expect(html).toContain('data-initial-listing-id=""');
  });

  it("loads an anonymous snapshot and ignores array or empty listing query values", async () => {
    const emptySnapshot = apartmentSnapshot({
      listings: [],
      market: "No configured market",
    });
    mocks.ensureCurrentKinfolkUser.mockResolvedValueOnce({ user: null });
    mocks.getApartmentSearchSnapshot.mockResolvedValueOnce(emptySnapshot);

    const html = renderToStaticMarkup(
      await ApartmentsPage({
        searchParams: Promise.resolve({ listing: ["listing-123", "listing-456"] }),
      }),
    );

    expect(mocks.getApartmentSearchSnapshot).toHaveBeenCalledWith(null);
    expect(mocks.getApartmentListingDetail).not.toHaveBeenCalled();
    expect(mocks.apartmentsMapViewDynamic).toHaveBeenCalledWith({
      initialListing: null,
      initialListingId: null,
      snapshot: emptySnapshot,
    });
    expect(html).toContain('data-initial-listing-id=""');
    expect(html).toContain('data-listing-count="0"');
    expect(html).toContain('data-market="No configured market"');
  });

  it("starts loading the apartment snapshot before listing search params finish resolving", async () => {
    const currentUser = deferred<{ user: { id: string } }>();
    const params = deferred<{ listing?: string | string[] }>();
    mocks.ensureCurrentKinfolkUser.mockReturnValueOnce(currentUser.promise);

    const page = ApartmentsPage({
      searchParams: params.promise,
    });

    expect(mocks.getApartmentSearchSnapshot).not.toHaveBeenCalled();

    currentUser.resolve({ user: { id: "user-1" } });
    await flushMicrotasks();

    expect(mocks.getApartmentSearchSnapshot).toHaveBeenCalledWith("user-1");
    expect(mocks.getApartmentListingDetail).not.toHaveBeenCalled();

    params.resolve({ listing: "listing-123" });
    const html = renderToStaticMarkup(await page);

    expect(html).toContain('data-initial-listing-id="listing-123"');
    expect(mocks.getApartmentListingDetail).toHaveBeenCalledWith(
      "listing-123",
      "user-1",
    );
  });

  it("starts loading the deep-linked listing detail before the apartment snapshot finishes", async () => {
    const snapshot = deferred<ReturnType<typeof apartmentSnapshot>>();
    mocks.getApartmentSearchSnapshot.mockReturnValueOnce(snapshot.promise);

    const page = ApartmentsPage({
      searchParams: Promise.resolve({ listing: "listing-123" }),
    });

    await flushMicrotasks();

    expect(mocks.getApartmentListingDetail).toHaveBeenCalledWith(
      "listing-123",
      "user-1",
    );
    expect(mocks.apartmentsMapViewDynamic).not.toHaveBeenCalled();

    snapshot.resolve(apartmentSnapshot());
    const html = renderToStaticMarkup(await page);

    expect(html).toContain('data-initial-listing-detail-id="listing-123"');
  });

  it("normalizes per-listing metadata URLs to the configured web origin", async () => {
    vi.stubEnv(
      "NEXT_PUBLIC_KINFOLK_BASE_URL",
      " https://kinfolk.example.com/app/// ",
    );
    mocks.getApartmentListingDetail.mockResolvedValueOnce(
      listingDetail("listing/one?two"),
    );

    const metadata = await generateMetadata({
      searchParams: Promise.resolve({ listing: " listing/one?two " }),
    });

    expect(mocks.getApartmentListingDetail).toHaveBeenCalledWith(
      "listing/one?two",
      null,
    );
    expect(metadata.openGraph).toMatchObject({
      url: "https://kinfolk.example.com/apartments?listing=listing%2Fone%3Ftwo",
    });
    expect(metadata.twitter).toMatchObject({
      images: ["https://photos.example.com/listing.jpg"],
    });
  });

  it.each([
    ["HTTP", "http://kinfolk.example.com"],
    ["non-web", "javascript:alert(1)"],
    ["FTP", "ftp://kinfolk.example.com"],
    ["localhost", "https://localhost:3000"],
    ["private IPv4", "https://192.168.1.20/app"],
    ["unique-local IPv6", "https://[fd00::1]:3000/app"],
    ["IPv4-mapped loopback", "https://[::ffff:127.0.0.1]/app"],
    ["credentialed", "https://user:pass@kinfolk.example.com/app"],
    ["malformed", "not a url"],
  ])("omits per-listing metadata URLs for %s app base config", async (_, baseUrl) => {
    vi.stubEnv("NEXT_PUBLIC_KINFOLK_BASE_URL", baseUrl);

    const metadata = await generateMetadata({
      searchParams: Promise.resolve({ listing: "listing-123" }),
    });

    expect(metadata.openGraph).toBeDefined();
    expect(metadata.openGraph).not.toHaveProperty("url");
  });
});
