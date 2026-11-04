import Link from "next/link";
import { UsersRound } from "lucide-react";
import { getContactInviteLanding } from "@/lib/contacts/network";

export const metadata = {
  title: "Kinfolk Invite",
};

type PageProps = {
  params: Promise<{ token: string }>;
};

export default async function InvitePage({ params }: PageProps) {
  const { token } = await params;
  const invite = await getContactInviteLanding(token);
  const signUpHref = `/sign-up?invite=${encodeURIComponent(token)}`;
  const signInHref = `/me?invite=${encodeURIComponent(token)}`;

  if (invite.status !== "found") {
    return (
      <main className="kin-dotted-bg grid min-h-screen place-items-center px-5 py-10 text-[#0f1a14]">
        <section className="w-full max-w-[520px] rounded-3xl border border-[rgba(28,51,38,0.08)] bg-white p-8 text-center shadow-[0_24px_60px_-40px_rgba(14,31,23,0.35)]">
          <p className="text-[13px] font-semibold uppercase tracking-[0.18em] text-[#8d9690]">
            Invite not found
          </p>
          <h1 className="serif mt-3 text-[42px] leading-[1.05] text-[#0f1a14]">
            This Kinfolk invite is no longer active.
          </h1>
          <Link
            href="/"
            className="kin-focus mt-7 inline-flex items-center justify-center rounded-full bg-[#264a36] px-5 py-3 text-[14px] font-semibold text-white"
          >
            Open Kinfolk
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="kin-dotted-bg grid min-h-screen place-items-center px-5 py-10 text-[#0f1a14]">
      <section className="w-full max-w-[620px] overflow-hidden rounded-3xl border border-[rgba(28,51,38,0.08)] bg-white shadow-[0_24px_60px_-40px_rgba(14,31,23,0.35)]">
        <div className="border-b border-[rgba(28,51,38,0.08)] bg-[#fdfcf8] px-7 py-6">
          <div className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-full bg-[#eef2eb] text-[#264a36]">
              <UsersRound size={19} strokeWidth={1.8} aria-hidden="true" />
            </span>
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-[#8d9690]">
                Roommate invite
              </p>
              <h1 className="serif text-[34px] leading-[1.05] text-[#0f1a14]">
                {invite.groupLabel}
              </h1>
            </div>
          </div>
        </div>

        <div className="space-y-5 p-7">
          <p className="text-[16px] leading-7 text-[#314338]">
            {invite.inviterName} invited you to compare apartments as a Kinfolk roommate group. You
            can review the group, add your preferences, and see apartments together.
          </p>
          <p className="border-t border-[rgba(28,51,38,0.08)] pt-4 text-[14px] leading-6 text-[#4b5d52]">
            Kinfolk keeps contact details private until both sides choose to move forward — nothing
            personal is shared until you approve it.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              href={signUpHref}
              className="kin-focus inline-flex flex-1 items-center justify-center rounded-full bg-[#264a36] px-5 py-3 text-[14px] font-semibold text-white transition hover:bg-[#1c3526]"
            >
              Join the group
            </Link>
            <Link
              href={signInHref}
              className="kin-focus inline-flex flex-1 items-center justify-center rounded-full border border-[rgba(28,51,38,0.14)] px-5 py-3 text-[14px] font-semibold text-[#264a36] transition hover:border-[#264a36]"
            >
              I already have Kinfolk
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
