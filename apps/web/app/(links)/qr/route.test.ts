import { describe, expect, it } from "vitest";
import { GET } from "./route";

async function readBody(response: Response) {
  return response.text();
}

describe("/qr redirect route", () => {
  it("redirects local relative targets to the current origin", () => {
    const response = GET(new Request("https://kinfolk.test/qr?link=/me"));

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://kinfolk.test/me");
  });

  it("redirects nested local dashboard targets to the current origin", () => {
    const response = GET(new Request("https://kinfolk.test/qr?link=/me/matches"));

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://kinfolk.test/me/matches");
  });

  it("redirects SMS handoff targets for mobile scanners", () => {
    const response = GET(
      new Request("https://kinfolk.test/qr?link=sms:%2B15551234567%3Fbody%3DSTART"),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("sms:+15551234567?body=START");
  });

  it("normalizes uppercase SMS handoff targets for mobile scanners", () => {
    const response = GET(
      new Request("https://kinfolk.test/qr?link=SMS:%2B15551234567%3Fbody%3DSTART"),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("sms:+15551234567?body=START");
  });

  it("rejects SMS handoff targets without a phone-like recipient", async () => {
    for (const link of ["sms:%3Fbody%3DSTART", "sms:kinfolk-agent%3Fbody%3DSTART"]) {
      const response = GET(new Request(`https://kinfolk.test/qr?link=${link}`));

      expect(response.status).toBe(400);
      await expect(readBody(response)).resolves.toBe("Unsupported QR link.");
    }
  });

  it("fails closed for unsupported external targets", async () => {
    const response = GET(
      new Request("https://kinfolk.test/qr?link=https%3A%2F%2Fexample.com%2Fme"),
    );

    expect(response.status).toBe(400);
    await expect(readBody(response)).resolves.toBe("Unsupported QR link.");
  });

  it("fails closed for external messaging targets", async () => {
    for (const link of [
      "https://wa.me/15551234567?text=START",
      "https://api.whatsapp.com/send?phone=15551234567&text=START",
    ]) {
      const response = GET(
        new Request(`https://kinfolk.test/qr?link=${encodeURIComponent(link)}`),
      );

      expect(response.status).toBe(400);
      await expect(readBody(response)).resolves.toBe("Unsupported QR link.");
    }
  });

  it("fails closed for local paths that only look like dashboard targets", async () => {
    for (const link of ["/meevil", "/messages"]) {
      const response = GET(
        new Request(`https://kinfolk.test/qr?link=${encodeURIComponent(link)}`),
      );

      expect(response.status).toBe(400);
      await expect(readBody(response)).resolves.toBe("Unsupported QR link.");
    }
  });

  it("does not redirect through nested unsupported QR links", async () => {
    const response = GET(
      new Request(
        "https://kinfolk.test/qr?link=%2Fqr%3Flink%3Dhttps%253A%252F%252Fexample.com%252Fme",
      ),
    );

    expect(response.status).toBe(400);
    await expect(readBody(response)).resolves.toBe("Unsupported QR link.");
  });
});
