import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureCurrentKinfolkUser: vi.fn(),
  getApartmentListingDetail: vi.fn(),
}));

vi.mock("@/lib/apartments/search", () => ({
  getApartmentListingDetail: mocks.getApartmentListingDetail,
}));

vi.mock("@/lib/shared/users", () => ({
  ensureCurrentKinfolkUser: mocks.ensureCurrentKinfolkUser,
}));

import { GET } from "./route";

function routeContext(listingId: string) {
  return {
    params: Promise.resolve({ listingId }),
  };
}

async function readJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

describe("/apartments/listings/[listingId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureCurrentKinfolkUser.mockResolvedValue({
      user: { id: "user-1" },
    });
    mocks.getApartmentListingDetail.mockResolvedValue({
      id: "listing-123",
      address: "123 Pacific Ave",
    });
  });

  it("trims listing route params before fetching detail", async () => {
    const response = await GET(
      new Request("https://kinfolk.test/apartments/listings/listing-123"),
      routeContext("  listing-123  "),
    );

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({
      listing: {
        id: "listing-123",
        address: "123 Pacific Ave",
      },
    });
    expect(mocks.getApartmentListingDetail).toHaveBeenCalledWith(
      "listing-123",
      "user-1",
    );
  });

  it("returns not found for blank listing route params before detail lookup", async () => {
    const response = await GET(
      new Request("https://kinfolk.test/apartments/listings/%20"),
      routeContext("   "),
    );

    expect(response.status).toBe(404);
    await expect(readJson(response)).resolves.toEqual({
      error: "Listing not found",
    });
    expect(mocks.getApartmentListingDetail).not.toHaveBeenCalled();
  });
});
