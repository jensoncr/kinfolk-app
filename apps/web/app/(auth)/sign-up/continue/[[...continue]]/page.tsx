import { ClerkAuthShell } from "@/components/auth/clerk-auth-shell";
import { redirectUrlFromSearchParams } from "@/lib/shared/redirect";

export const metadata = {
  title: "Continue Sign Up",
};

export default async function ContinueSignUpPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <ClerkAuthShell
      path="/sign-up/continue"
      redirectUrl={redirectUrlFromSearchParams(await searchParams)}
    />
  );
}
