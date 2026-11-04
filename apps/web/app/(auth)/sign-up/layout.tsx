import { ClerkProviderBoundary } from "@/components/auth/clerk-provider-boundary";

export default function SignUpLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ClerkProviderBoundary>{children}</ClerkProviderBoundary>;
}
