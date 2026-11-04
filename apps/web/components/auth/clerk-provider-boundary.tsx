"use client";

import { ClerkProvider } from "@clerk/nextjs";

export function ClerkProviderBoundary({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ClerkProvider>{children}</ClerkProvider>;
}
