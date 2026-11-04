import { ClerkProviderBoundary } from "@/components/auth/clerk-provider-boundary";

export default function SsoCallbackLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ClerkProviderBoundary>{children}</ClerkProviderBoundary>;
}
