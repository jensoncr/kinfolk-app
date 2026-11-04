import { ClerkProviderBoundary } from "@/components/auth/clerk-provider-boundary";

export default function MeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ClerkProviderBoundary>{children}</ClerkProviderBoundary>;
}
