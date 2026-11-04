import { ClerkProviderBoundary } from "@/components/auth/clerk-provider-boundary";

// The apartments map is publicly reachable (SMS shortlink previews land here),
// but signed-in features on it — the save-listing heart — need Clerk JS
// mounted to keep the short-lived session JWT refreshed, or client fetches to
// authed API routes start failing ~60s after page load.
export default function ApartmentsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ClerkProviderBoundary>{children}</ClerkProviderBoundary>;
}
