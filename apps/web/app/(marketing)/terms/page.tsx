import { LegalPlaceholderPage } from "@/app/(marketing)/_components/legal/legal-placeholder";

export const metadata = {
  title: "Terms",
};

export default function TermsPage() {
  return (
    <LegalPlaceholderPage title="Terms">
      <p className="mt-5 text-[15px] leading-7 text-[var(--ink-600)]">
        Kinfolk is in private development. These terms will be replaced before public launch with
        the full agreement that governs accounts, matching, approvals, and communications.
      </p>
      <p className="mt-4 text-[15px] leading-7 text-[var(--ink-600)]">
        Until then, use Kinfolk only with information you are comfortable sharing with the product
        team, and do not rely on any match, listing, price, or availability as final.
      </p>
    </LegalPlaceholderPage>
  );
}
