import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getActiveTextTransportProvider: vi.fn(),
  getTextTransportFromNumber: vi.fn(),
  readFile: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  readFile: mocks.readFile,
}));

vi.mock("@/lib/integrations/text-transport", () => ({
  getActiveTextTransportProvider: mocks.getActiveTextTransportProvider,
  getTextTransportFromNumber: mocks.getTextTransportFromNumber,
}));

import { GET } from "./route";

describe("/api/kinfolk/contact-card.vcf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mocks.getActiveTextTransportProvider.mockReturnValue("sendblue");
    mocks.getTextTransportFromNumber.mockReturnValue("+14155550147");
    mocks.readFile.mockResolvedValue(Buffer.from("logo"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns downloadable vCard content with normalized configured website URL", async () => {
    vi.stubEnv("NEXT_PUBLIC_KINFOLK_BASE_URL", " https://kinfolk.example.com/app ");
    vi.stubEnv("KINFOLK_CONTACT_WEBSITE_URL", " https://usekinfolk.com/contact?source=vcf ");

    const response = await GET(
      new Request("https://request.example/api/kinfolk/contact-card.vcf"),
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/vcard; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe(
      'inline; filename="Kinfolk.vcf"',
    );
    expect(body).toContain("BEGIN:VCARD\r\n");
    expect(body).toContain("TEL;TYPE=CELL:+14155550147\r\n");
    expect(body).toContain("URL:https://usekinfolk.com/contact?source=vcf\r\n");
    expect(body).toContain(`PHOTO;ENCODING=b;TYPE=PNG:${Buffer.from("logo").toString("base64")}`);
  });

  it("falls back to the request origin when contact website and public app config are not web URLs", async () => {
    vi.stubEnv("NEXT_PUBLIC_KINFOLK_BASE_URL", "file:///tmp");
    vi.stubEnv("KINFOLK_CONTACT_WEBSITE_URL", "javascript:alert(1)");

    const response = await GET(
      new Request("https://request.example/api/kinfolk/contact-card.vcf"),
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("URL:https://request.example\r\n");
    expect(body).not.toContain("javascript:");
    expect(body).not.toContain("file:///tmp");
  });
});
