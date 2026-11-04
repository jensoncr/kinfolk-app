import { ClerkAuthShell } from "@/components/auth/clerk-auth-shell";
import { redirectUrlFromSearchParams } from "@/lib/shared/redirect";

export const metadata = {
  title: "Sign Up",
};

export default async function SignUpPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <ClerkAuthShell
      path="/sign-up"
      redirectUrl={redirectUrlFromSearchParams(await searchParams)}
    />
  );
}
