import { NextResponse } from "next/server";
import { normalizeContinueOnPhoneTarget } from "@/lib/integrations/continue-on-phone-targets";

export function GET(request: Request) {
  const url = new URL(request.url);
  const target = normalizeContinueOnPhoneTarget(url.searchParams.get("link"), url.origin);

  if (!target) {
    return new Response("Unsupported QR link.", { status: 400 });
  }

  return NextResponse.redirect(target, { status: 302 });
}

