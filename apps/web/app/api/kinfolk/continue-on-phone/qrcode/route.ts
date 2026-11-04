import QRCode from "qrcode";
import { normalizeContinueOnPhoneTarget } from "@/lib/integrations/continue-on-phone-targets";
import { ensureCurrentKinfolkUser } from "@/lib/shared/users";

export const runtime = "nodejs";

export async function POST(request: Request) {
  // The only consumer (use-phone-handoff) runs signed-in; anonymous exposure
  // just offered a free CPU endpoint.
  const { user } = await ensureCurrentKinfolkUser();
  if (!user) {
    return Response.json({ error: "Sign in first." }, { status: 401 });
  }

  try {
    const body = await readQrCodeRequestBody(request);
    const target = normalizeContinueOnPhoneTarget(body.url, [
      new URL(request.url).origin,
      process.env.NEXT_PUBLIC_KINFOLK_BASE_URL ?? "",
    ]);
    if (!target) {
      return Response.json({ error: "Unsupported QR target." }, { status: 400 });
    }

    const size = clampQrSize(body.size);
    const svg = await QRCode.toString(target, {
      color: {
        dark: "#0f1a14",
        light: "#ffffff",
      },
      errorCorrectionLevel: "M",
      margin: 1,
      type: "svg",
      width: size,
    });

    return Response.json({
      ok: true,
      qrcode: {
        url: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
      },
    });
  } catch (error) {
    console.error("[phone-handoff] QR code generation failed", { error });
    return Response.json({ error: "Could not generate QR code." }, { status: 500 });
  }
}

async function readQrCodeRequestBody(request: Request) {
  try {
    const body = (await request.json()) as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return {};
    }
    return body as { size?: unknown; url?: unknown };
  } catch {
    return {};
  }
}

function clampQrSize(value: unknown) {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) {
    return 250;
  }

  return Math.min(360, Math.max(160, Math.round(numberValue)));
}
