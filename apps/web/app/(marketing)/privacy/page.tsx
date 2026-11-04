import { LegalPlaceholderPage } from "@/app/(marketing)/_components/legal/legal-placeholder";

export const metadata = {
  title: "Privacy",
};

export default function PrivacyPage() {
  return (
    <LegalPlaceholderPage title="Privacy">
      <p className="mt-5 text-[15px] leading-7 text-[var(--ink-600)]">
        Kinfolk is in private development. A full privacy policy will replace this page before
        public launch and will explain how identity, housing preferences, listing activity, and
        approval decisions are handled.
      </p>
      <p className="mt-4 text-[15px] leading-7 text-[var(--ink-600)]">
        The product should keep identity and contact details hidden until the user approves a
        reveal. Treat this page as a placeholder for that launch policy.
      </p>
    </LegalPlaceholderPage>
  );
}
