import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  buildKinfolkVCard,
  normalizeKinfolkContactCardBaseUrl,
} from "@/lib/contacts/contact-card";
import {
  getActiveTextTransportProvider,
  getTextTransportFromNumber,
} from "@/lib/integrations/text-transport";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const baseUrl =
    normalizeKinfolkContactCardBaseUrl(process.env.NEXT_PUBLIC_KINFOLK_BASE_URL) ||
    normalizeKinfolkContactCardBaseUrl(requestUrl.origin);
  const logoBase64 = await readContactLogoBase64();
  const vcard = buildKinfolkVCard({
    baseUrl,
    logoBase64,
    phoneNumber: getKinfolkTextPhoneNumber(),
    websiteUrl: process.env.KINFOLK_CONTACT_WEBSITE_URL ?? baseUrl,
  });

  return new Response(vcard, {
    headers: {
      "Cache-Control": "public, max-age=300",
      "Content-Disposition": 'inline; filename="Kinfolk.vcf"',
      "Content-Type": "text/vcard; charset=utf-8",
      "X-Robots-Tag": "noindex",
    },
  });
}

async function readContactLogoBase64() {
  try {
    const logo = await readFile(
      join(process.cwd(), "public", "assets", "kinfolk-contact-logo.png"),
    );
    return logo.toString("base64");
  } catch (error) {
    console.error("[text-agent] Could not read Kinfolk contact card logo.", error);
    return "";
  }
}

function getKinfolkTextPhoneNumber() {
  return getTextTransportFromNumber(getActiveTextTransportProvider());
}
