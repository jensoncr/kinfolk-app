import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseJsonBody } from "./api-body";

const schema = z.object({
  listingId: z.string({ message: "Provide a listing id." }).min(1, "Provide a listing id."),
});

function jsonRequest(body: string) {
  return new Request("https://kinfolk.example.com/api/test", {
    body,
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

describe("parseJsonBody", () => {
  it("returns typed data for a valid body", async () => {
    const parsed = await parseJsonBody(jsonRequest('{"listingId":"abc"}'), schema);

    expect(parsed).toEqual({ ok: true, data: { listingId: "abc" } });
  });

  it("returns a 400 for malformed JSON", async () => {
    const parsed = await parseJsonBody(jsonRequest("{nope"), schema);

    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error("expected failure");
    expect(parsed.response.status).toBe(400);
    expect(await parsed.response.json()).toEqual({
      error: "Request body must be valid JSON.",
    });
  });

  it("returns the schema's first issue message for invalid bodies", async () => {
    const parsed = await parseJsonBody(jsonRequest('{"listingId":""}'), schema);

    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error("expected failure");
    expect(parsed.response.status).toBe(400);
    expect(await parsed.response.json()).toEqual({ error: "Provide a listing id." });
  });
});
