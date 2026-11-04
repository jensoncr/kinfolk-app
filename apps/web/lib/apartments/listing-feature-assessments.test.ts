import { describe, expect, it, vi } from "vitest";

const openRouterMocks = vi.hoisted(() => ({
  fetchOpenRouterJson: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/integrations/openrouter-client", () => ({
  fetchOpenRouterJson: openRouterMocks.fetchOpenRouterJson,
  normalizeOpenRouterModelId: (model: string) => model.replace(/^openrouter\//u, ""),
  openRouterBaseUrl: "https://openrouter.test/api/v1",
}));

import {
  backfillListingFeatureEvidence,
  formatFeatureAssessmentGuidance,
  loadListingFeatureAssessmentsForCards,
  listingFeatureSourceVersionForTests,
} from "./listing-feature-assessments";

type StubCall = {
  args: unknown[];
  method: string;
  table: string;
};

describe("backfillListingFeatureEvidence", () => {
  it("counts unsupported feature assessments distinctly in agent guidance", () => {
    const guidance = formatFeatureAssessmentGuidance(
      new Map([
        [
          "listing-1",
          [
            {
              confidence: 0.88,
              evidence: [],
              key: "office_workspace",
              label: "office/workspace fit",
              limitations: [],
              status: "no",
              summary:
                "Listing evidence argues against office/workspace fit: \"No clear office.\"",
            },
          ],
        ],
        [
          "listing-2",
          [
            {
              confidence: 0.15,
              evidence: [],
              key: "office_workspace",
              label: "office/workspace fit",
              limitations: [
                "The stored listing text, amenities, detail payload, and persisted photo evidence do not confirm this feature.",
              ],
              status: "unclear",
              summary:
                "No stored office, den, desk, or workspace evidence found for this listing.",
            },
          ],
        ],
      ]),
    );

    expect(guidance).toContain(
      "Feature evidence included for 2 listing checks (0 supported, 1 unsupported, 1 unclear).",
    );
    expect(guidance).toContain(
      "if status is no, say the evidence argues against it",
    );
  });

  it("does not promote negated office text into positive feature evidence", async () => {
    const { client } = createSupabaseStub([
      {
        address_line: "123 Market St",
        amenities: [],
        bathrooms: 1,
        bedrooms: 1,
        description:
          "Compact apartment with no dedicated home office, den, or workspace.",
        id: "listing-1",
        provider_detail_payload: null,
        provider_payload_hash: "hash-1",
        source_url: "https://example.test/listing-1",
        square_feet: 720,
      },
    ]);

    const assessments = await loadListingFeatureAssessmentsForCards(client, {
      cards: [{ id: "listing-1" }],
      requestedTerms: ["office"],
    });

    const [assessment] = assessments.get("listing-1") ?? [];
    expect(assessment).toMatchObject({
      status: "no",
      summary: expect.stringContaining(
        "Listing evidence argues against office/workspace fit",
      ),
    });
    expect(assessment?.evidence[0]?.excerpt).toContain(
      "No clear office/workspace fit",
    );
  });

  it("ignores stale persisted feature evidence from older source versions", async () => {
    const { client } = createSupabaseStub(
      [
        {
          address_line: "123 Market St",
          amenities: [],
          bathrooms: 1,
          bedrooms: 1,
          description: "Classic apartment with bright bay windows.",
          id: "listing-1",
          provider_detail_payload: null,
          provider_payload_hash: "hash-1",
          source_url: "https://example.test/listing-1",
          square_feet: 720,
        },
      ],
      [
        {
          claim_key: "office_workspace",
          claim_text: "Old photo analysis found a desk nook.",
          confidence: 0.95,
          evidence_excerpt: "Old photo analysis found a desk nook.",
          listing_id: "listing-1",
          metadata: {
            listingId: "listing-1",
            source: "photo_vision",
            sourceVersion: "listing-feature-v0",
          },
          source_column: "url",
          source_json_path: null,
          source_table: "apartment_listing_photos",
        },
      ],
    );

    const assessments = await loadListingFeatureAssessmentsForCards(client, {
      cards: [{ id: "listing-1" }],
      requestedTerms: ["office"],
    });

    const [assessment] = assessments.get("listing-1") ?? [];
    expect(assessment).toMatchObject({
      evidence: [],
      status: "unclear",
      summary: "No stored office, den, desk, or workspace evidence found for this listing.",
    });
  });

  it("dry-runs active listing extraction without document or evidence writes", async () => {
    const { calls, client } = createSupabaseStub([
      {
        address_line: "123 Market St",
        amenities: ["shared coworking lounge"],
        bathrooms: 1,
        bedrooms: 1,
        description: "Bright apartment with a dedicated home office nook.",
        id: "listing-1",
        provider_detail_payload: null,
        provider_payload_hash: "hash-1",
        source_url: "https://example.test/listing-1",
        square_feet: 720,
      },
    ]);

    const result = await backfillListingFeatureEvidence(client, {
      dryRun: true,
      includeVision: true,
      limit: 5,
      maxPhotosPerListing: 8,
    });

    expect(result).toEqual({
      dryRun: true,
      evidenceCandidates: 1,
      evidenceInserted: 0,
      force: false,
      includeVision: true,
      listingsScanned: 1,
      listingsSkipped: 0,
      sourceVersion: listingFeatureSourceVersionForTests(),
      visionPhotosChecked: 0,
    });
    expect(calls.filter((call) => call.method === "from").map((call) => call.table))
      .toEqual(["apartment_listings"]);
    expect(
      calls.some((call) => ["delete", "insert", "update", "upsert"].includes(call.method)),
    ).toBe(false);
  });

  it("defaults malformed direct worker limits before querying listings and photos", async () => {
    const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    const { calls, client } = createFeatureEvidenceRefreshStub();

    try {
      const result = await backfillListingFeatureEvidence(client, {
        includeVision: true,
        limit: Number.NaN,
        maxPhotosPerListing: Number.NaN,
      });

      expect(result.listingsScanned).toBe(1);
      expect(calls).toContainEqual({
        args: [50],
        method: "limit",
        table: "apartment_listings",
      });
      expect(calls).toContainEqual({
        args: [3],
        method: "limit",
        table: "apartment_listing_photos",
      });
    } finally {
      if (originalOpenRouterKey === undefined) {
        delete process.env.OPENROUTER_API_KEY;
      } else {
        process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
      }
    }
  });

  it("clamps oversized direct worker limits before querying listings and photos", async () => {
    const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    const { calls, client } = createFeatureEvidenceRefreshStub();

    try {
      await backfillListingFeatureEvidence(client, {
        includeVision: true,
        limit: 999,
        maxPhotosPerListing: 99,
      });

      expect(calls).toContainEqual({
        args: [500],
        method: "limit",
        table: "apartment_listings",
      });
      expect(calls).toContainEqual({
        args: [8],
        method: "limit",
        table: "apartment_listing_photos",
      });
    } finally {
      if (originalOpenRouterKey === undefined) {
        delete process.env.OPENROUTER_API_KEY;
      } else {
        process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
      }
    }
  });

  it("treats blank OpenRouter keys as unconfigured before reading listing photos", async () => {
    const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "   ";
    openRouterMocks.fetchOpenRouterJson.mockReset();
    const { calls, client } = createFeatureEvidenceRefreshStub({
      photoRows: [{ position: 1, url: "https://example.test/photo.jpg" }],
    });

    try {
      const result = await backfillListingFeatureEvidence(client, {
        force: true,
        includeVision: true,
        limit: 1,
        maxPhotosPerListing: 3,
      });

      expect(result.visionPhotosChecked).toBe(0);
      expect(calls.some((call) => call.table === "apartment_listing_photos"))
        .toBe(false);
      expect(openRouterMocks.fetchOpenRouterJson).not.toHaveBeenCalled();
    } finally {
      if (originalOpenRouterKey === undefined) {
        delete process.env.OPENROUTER_API_KEY;
      } else {
        process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
      }
    }
  });

  it("defaults blank listing feature vision model config before provider requests", async () => {
    const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;
    const originalVisionModel = process.env.KINFOLK_LISTING_FEATURE_VISION_MODEL;
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    process.env.KINFOLK_LISTING_FEATURE_VISION_MODEL = "   ";
    openRouterMocks.fetchOpenRouterJson.mockReset();
    openRouterMocks.fetchOpenRouterJson.mockResolvedValueOnce({
      data: {
        evidence: [
          {
            confidence: 0.7,
            excerpt: "Visible desk nook.",
            featureKey: "office_workspace",
            status: "likely",
          },
        ],
      },
      rawBody: "{}",
      response: new Response("{}"),
    });
    const { client } = createFeatureEvidenceRefreshStub({
      photoRows: [{ position: 1, url: "https://example.test/photo.jpg" }],
    });

    try {
      const result = await backfillListingFeatureEvidence(client, {
        force: true,
        includeVision: true,
        limit: 1,
        maxPhotosPerListing: 3,
      });

      const request = openRouterMocks.fetchOpenRouterJson.mock.calls[0]?.[0] as
        | { body?: { model?: string } }
        | undefined;
      expect(request?.body?.model).toBe("google/gemini-2.5-flash-lite");
      expect(result.evidenceInserted).toBe(2);
      expect(result.visionPhotosChecked).toBe(1);
    } finally {
      if (originalOpenRouterKey === undefined) {
        delete process.env.OPENROUTER_API_KEY;
      } else {
        process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
      }
      if (originalVisionModel === undefined) {
        delete process.env.KINFOLK_LISTING_FEATURE_VISION_MODEL;
      } else {
        process.env.KINFOLK_LISTING_FEATURE_VISION_MODEL = originalVisionModel;
      }
    }
  });

  it("skips unsafe listing photo URLs before provider vision requests", async () => {
    const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    openRouterMocks.fetchOpenRouterJson.mockReset();
    openRouterMocks.fetchOpenRouterJson.mockResolvedValueOnce({
      data: {
        evidence: [
          {
            confidence: 0.7,
            excerpt: "Visible desk nook.",
            featureKey: "office_workspace",
            status: "likely",
          },
        ],
      },
      rawBody: "{}",
      response: new Response("{}"),
    });
    const { client } = createFeatureEvidenceRefreshStub({
      photoRows: [
        { position: 1, url: "http://images.example.test/plain-http.jpg" },
        { position: 2, url: "https://127.0.0.1/private.jpg" },
        { position: 3, url: "https://[::ffff:192.168.1.20]/private.jpg" },
        { position: 4, url: "https://user:pass@images.example.test/private.jpg" },
        { position: 5, url: "https://images.example.test/public.jpg" },
      ],
    });

    try {
      const result = await backfillListingFeatureEvidence(client, {
        force: true,
        includeVision: true,
        limit: 1,
        maxPhotosPerListing: 3,
      });

      expect(openRouterMocks.fetchOpenRouterJson).toHaveBeenCalledTimes(1);
      const request = openRouterMocks.fetchOpenRouterJson.mock.calls[0]?.[0] as
        | { body?: { messages?: Array<{ content?: unknown }> } }
        | undefined;
      expect(request?.body?.messages?.[1]?.content).toContainEqual({
        image_url: { url: "https://images.example.test/public.jpg" },
        type: "image_url",
      });
      expect(result.evidenceInserted).toBe(2);
      expect(result.visionPhotosChecked).toBe(1);
    } finally {
      if (originalOpenRouterKey === undefined) {
        delete process.env.OPENROUTER_API_KEY;
      } else {
        process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
      }
    }
  });

  it("ignores non-supporting and malformed vision evidence before persistence", async () => {
    const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    openRouterMocks.fetchOpenRouterJson.mockReset();
    openRouterMocks.fetchOpenRouterJson.mockResolvedValueOnce({
      data: {
        evidence: [
          {
            confidence: 0.95,
            excerpt: "No desk or office is visible.",
            featureKey: "office_workspace",
            status: "no",
          },
          {
            confidence: 0.6,
            excerpt: "Room purpose is unclear.",
            featureKey: "office_workspace",
            status: "unclear",
          },
          {
            confidence: 0.92,
            excerpt: "Visible outdoor pool.",
            featureKey: "pool",
            status: "explicit",
          },
          {
            confidence: 0.8,
            excerpt: "   ",
            featureKey: "office_workspace",
            status: "explicit",
          },
        ],
      },
      rawBody: "{}",
      response: new Response("{}"),
    });
    const { calls, client } = createFeatureEvidenceRefreshStub({
      photoRows: [{ position: 1, url: "https://example.test/photo.jpg" }],
    });

    try {
      const result = await backfillListingFeatureEvidence(client, {
        force: true,
        includeVision: true,
        limit: 1,
        maxPhotosPerListing: 1,
      });

      expect(openRouterMocks.fetchOpenRouterJson).toHaveBeenCalledTimes(1);
      expect(result.evidenceInserted).toBe(1);
      expect(result.visionPhotosChecked).toBe(1);
      const insertCall = calls.find(
        (call) =>
          call.table === "agent_context_evidence" && call.method === "insert",
      );
      const [insertRows] = insertCall?.args ?? [];
      expect(insertRows).toEqual([
        expect.objectContaining({
          claim_key: "office_workspace",
          metadata: expect.objectContaining({ source: "listing_text" }),
          source_column: "description",
        }),
      ]);
    } finally {
      if (originalOpenRouterKey === undefined) {
        delete process.env.OPENROUTER_API_KEY;
      } else {
        process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
      }
    }
  });

  it("does not advance documents or replace evidence when vision analysis fails", async () => {
    const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    openRouterMocks.fetchOpenRouterJson.mockReset();
    openRouterMocks.fetchOpenRouterJson.mockRejectedValueOnce(
      new Error("vision provider unavailable"),
    );
    const { calls, client } = createFeatureEvidenceRefreshStub({
      photoRows: [{ position: 1, url: "https://example.test/photo.jpg" }],
    });

    try {
      await expect(
        backfillListingFeatureEvidence(client, {
          force: true,
          includeVision: true,
          limit: 1,
          maxPhotosPerListing: 1,
        }),
      ).rejects.toThrow("vision provider unavailable");

      expect(
        calls.some((call) => call.table === "agent_context_documents"),
      ).toBe(false);
      expect(
        calls.some((call) => call.table === "agent_context_evidence"),
      ).toBe(false);
    } finally {
      if (originalOpenRouterKey === undefined) {
        delete process.env.OPENROUTER_API_KEY;
      } else {
        process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
      }
    }
  });

  it("does not delete previous evidence when replacement insert fails", async () => {
    const { calls, client } = createFeatureEvidenceRefreshStub({
      insertError: new Error("insert failed"),
    });

    await expect(
      backfillListingFeatureEvidence(client, {
        force: true,
        limit: 1,
      }),
    ).rejects.toThrow("insert failed");

    const evidenceMethods = calls
      .filter((call) => call.table === "agent_context_evidence")
      .map((call) => call.method);
    expect(evidenceMethods).toContain("insert");
    expect(evidenceMethods).not.toContain("delete");
  });

  it("deletes previous evidence by id only after replacement evidence inserts", async () => {
    const { calls, client } = createFeatureEvidenceRefreshStub();

    const result = await backfillListingFeatureEvidence(client, {
      force: true,
      limit: 1,
    });

    expect(result.evidenceInserted).toBe(1);
    const evidenceMethods = calls
      .filter((call) => call.table === "agent_context_evidence")
      .map((call) => call.method);
    expect(evidenceMethods.indexOf("insert")).toBeLessThan(
      evidenceMethods.indexOf("delete"),
    );
    expect(calls).toContainEqual({
      args: ["id", ["old-evidence-1"]],
      method: "in",
      table: "agent_context_evidence",
    });
  });
});

function createSupabaseStub(
  listingRows: unknown[],
  evidenceRows: unknown[] = [],
) {
  const calls: StubCall[] = [];
  const client = {
    from(table: string) {
      calls.push({ args: [table], method: "from", table });
      const result = {
        data:
          table === "apartment_listings"
            ? listingRows
            : table === "agent_context_evidence"
              ? evidenceRows
              : [],
        error: null,
      };
      const query: Record<string, unknown> = {};
      for (const method of [
        "delete",
        "eq",
        "in",
        "insert",
        "limit",
        "maybeSingle",
        "order",
        "select",
        "single",
        "update",
        "upsert",
      ]) {
        query[method] = (...args: unknown[]) => {
          calls.push({ args, method, table });
          return query;
        };
      }
      query.then = (
        resolve: (value: unknown) => unknown,
        reject: (reason: unknown) => unknown,
      ) => Promise.resolve(result).then(resolve, reject);
      return query;
    },
  };
  return { calls, client: client as never };
}

function createFeatureEvidenceRefreshStub({
  insertError = null,
  photoRows = [],
}: {
  insertError?: Error | null;
  photoRows?: unknown[];
} = {}) {
  const calls: StubCall[] = [];
  const listingRows = [
    {
      address_line: "123 Market St",
      amenities: [],
      bathrooms: 1,
      bedrooms: 1,
      description: "Bright apartment with a dedicated home office nook.",
      id: "listing-1",
      provider_detail_payload: null,
      provider_payload_hash: "hash-1",
      source_url: "https://example.test/listing-1",
      square_feet: 720,
    },
  ];
  const client = {
    from(table: string) {
      calls.push({ args: [table], method: "from", table });
      if (table === "apartment_listings") {
        return createChain(calls, table, { data: listingRows, error: null });
      }
      if (table === "agent_context_documents") {
        return createChain(calls, table, {
          data: {
            content_hash: "old-hash",
            id: "document-1",
          },
          error: null,
        });
      }
      if (table === "agent_context_evidence") {
        return createMutableResultChain(calls, table, {
          deleteResult: { data: null, error: null },
          insertResult: { data: null, error: insertError },
          selectResult: {
            data: [{ id: "old-evidence-1" }],
            error: null,
          },
        });
      }
      if (table === "apartment_listing_photos") {
        return createChain(calls, table, { data: photoRows, error: null });
      }
      return createChain(calls, table, { data: null, error: null });
    },
  };
  return { calls, client: client as never };
}

function createChain(
  calls: StubCall[],
  table: string,
  result: { data: unknown; error: Error | null },
) {
  const query: Record<string, unknown> = {};
  for (const method of [
    "delete",
    "eq",
    "in",
    "insert",
    "limit",
    "maybeSingle",
    "order",
    "select",
    "single",
    "update",
    "upsert",
  ]) {
    query[method] = (...args: unknown[]) => {
      calls.push({ args, method, table });
      return method === "maybeSingle" || method === "single"
        ? Promise.resolve(result)
        : query;
    };
  }
  query.then = (
    resolve: (value: unknown) => unknown,
    reject: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve, reject);
  return query;
}

function createMutableResultChain(
  calls: StubCall[],
  table: string,
  {
    deleteResult,
    insertResult,
    selectResult,
  }: {
    deleteResult: { data: unknown; error: Error | null };
    insertResult: { data: unknown; error: Error | null };
    selectResult: { data: unknown; error: Error | null };
  },
) {
  let currentResult = selectResult;
  const query = createChain(calls, table, currentResult);
  query["delete"] = (...args: unknown[]) => {
    calls.push({ args, method: "delete", table });
    currentResult = deleteResult;
    return query;
  };
  query["insert"] = (...args: unknown[]) => {
    calls.push({ args, method: "insert", table });
    currentResult = insertResult;
    return query;
  };
  query["select"] = (...args: unknown[]) => {
    calls.push({ args, method: "select", table });
    currentResult = selectResult;
    return query;
  };
  query.then = (
    resolve: (value: unknown) => unknown,
    reject: (reason: unknown) => unknown,
  ) => Promise.resolve(currentResult).then(resolve, reject);
  return query;
}
