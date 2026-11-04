import { createHash, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

export function isAuthorizedJobRequest(request: NextRequest) {
  const secret = process.env.KINFOLK_JOBS_SECRET?.trim();

  if (!secret) {
    throw new Error("KINFOLK_JOBS_SECRET must be set before job routes can run.");
  }

  const headerSecret = request.headers.get("x-kinfolk-job-secret");
  const authorization = request.headers.get("authorization");
  const bearerSecret = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : null;

  return [headerSecret, bearerSecret].some((candidate) =>
    candidate ? secureCompare(candidate, secret) : false,
  );
}

function secureCompare(candidate: string, expected: string) {
  const candidateDigest = createHash("sha256").update(candidate).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(candidateDigest, expectedDigest);
}
