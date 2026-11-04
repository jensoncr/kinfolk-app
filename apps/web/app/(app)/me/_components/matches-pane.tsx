"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useState,
  useTransition,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { useRouter } from "next/navigation";
import Image, { getImageProps } from "next/image";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Expand,
  Home,
  MapPin,
  MessageCircle,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import type {
  ApartmentMatch,
  ApartmentPreview,
  MatchesSnapshot,
  PendingGroupRequest,
  RoommateCredential,
  RoommateMatch,
  RoommateMatchComponent,
  RoommateProfileDetail,
} from "@/lib/matching/matches";
import type { EvidencePoint } from "@/lib/shared/types";
import { Avatar } from "@/components/ui/avatar";
import {
  applySuccessfulRequestResponseState,
  buildGroupRequestResponsePayload,
  clampMatchesScore,
  createMatchesPaneState,
  formatEnrichmentReviewCountLabel,
  formatMatchesScoreLabel,
  formatRoommateMatchBadge,
  getNextMatchesTabFromKey,
  getProfileModalPhotoUrls,
  getVisibleRequestsForMatchesPane,
  getVisibleRoommatesForMatchesPane,
  matchesPaneReducer,
  type Tab,
} from "@/app/(app)/me/_components/matches-pane-state";

const MATCH_PHOTO_SIZES = "(max-width: 639px) calc(100vw - 2rem), 392px";
const MATCH_PHOTO_QUALITY = 72;
const MATCH_CARD_RENDER_CONTAINMENT: CSSProperties = {
  contentVisibility: "auto",
  containIntrinsicSize: "0 520px",
};
const MATCHES_TAB_IDS = {
  apartments: "matches-tab-apartments",
  roommates: "matches-tab-roommates",
};
const MATCHES_PANEL_IDS = {
  apartments: "matches-panel-apartments",
  roommates: "matches-panel-roommates",
};
const predecodedMatchPhotos = new Set<string>();

function formatRent(value: number | null): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return `$${Math.round(value).toLocaleString("en-US")}/mo`;
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}

function ComponentBar({ component, compact = false }: { component: RoommateMatchComponent; compact?: boolean }) {
  const score = clampMatchesScore(component.score);
  return (
    <div className="min-w-0" style={compact ? { maxWidth: 120 } : undefined}>
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-[0.08em] text-[#8d9690]">{component.label}</p>
        {compact ? null : (
          <span className="mono text-[11px] text-[#6b7a70]">{score}</span>
        )}
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[rgba(28,51,38,0.1)]">
        <div className="h-full rounded-full bg-[#c78b3e]" style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}

// ── Expandable profile ─────────────────────────────────────────
type ProfileViewData = {
  userId: string;
  name: string;
  initials: string;
  /** Identity is server-stripped; explain the unlock instead of "still filling in". */
  locked?: boolean;
  imageUrl: string | null;
  headline: string;
  score: number | null;
  detail: RoommateProfileDetail;
  evidence: EvidencePoint[];
  risks: EvidencePoint[];
};

function EvidenceList({ title, points, tone }: { title: string; points: EvidencePoint[]; tone: "good" | "warn" }) {
  if (points.length === 0) return null;
  const dot = tone === "good" ? "bg-[#3a9b66]" : "bg-[#c78b3e]";
  return (
    <div>
      <h4 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#8d9690]">{title}</h4>
      <ul className="mt-2.5 flex flex-col gap-2.5">
        {points.map((point) => (
          <li key={`${point.label}:${point.detail}`} className="flex gap-2.5">
            <span className={`mt-[7px] size-1.5 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
            <span className="text-[13px] leading-[1.5] text-[#2f4a3a]">
              <span className="font-semibold text-[#0f1a14]">{point.label}.</span>{" "}
              {point.detail}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CredentialLogo({
  logoUrl,
  label,
  onImage = false,
}: {
  logoUrl: string | null;
  label: string;
  onImage?: boolean;
}) {
  if (logoUrl) {
    return (
      <span className="relative size-5 shrink-0 overflow-hidden rounded-[5px] bg-white">
        <Image
          src={logoUrl}
          alt=""
          fill
          sizes="20px"
          unoptimized
          className="object-cover"
        />
      </span>
    );
  }
  return (
    <span
      className={`grid size-5 shrink-0 place-items-center rounded-[5px] text-[10px] font-bold ${
        onImage ? "bg-white/20 text-white" : "bg-[#eef2eb] text-[#264a36]"
      }`}
    >
      {label.charAt(0).toUpperCase()}
    </span>
  );
}

function CredentialChip({
  credential,
  onImage = false,
}: {
  credential: RoommateCredential;
  onImage?: boolean;
}) {
  return (
    <span
      className={`inline-flex max-w-full items-center gap-2 rounded-full py-1 pl-1.5 pr-3 text-[12.5px] ${
        onImage
          ? "border border-white/25 bg-white/15 text-white backdrop-blur-sm"
          : "border border-[rgba(28,51,38,0.12)] bg-white text-[#2f4a3a]"
      }`}
    >
      <CredentialLogo logoUrl={credential.logoUrl} label={credential.label} onImage={onImage} />
      <span className="truncate">{credential.label}</span>
    </span>
  );
}

function PhotoCarousel({
  photos,
  name,
  initials,
  seed,
}: {
  photos: string[];
  name: string;
  initials: string;
  seed: string;
}) {
  const [index, setIndex] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const count = photos.length;
  const hue = Array.from(seed).reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 360;
  const go = (delta: number) => setIndex((i) => (i + delta + count) % count);

  return (
    <div
      className="relative h-[440px] w-full shrink-0 overflow-hidden"
      style={{ background: `linear-gradient(150deg, hsl(${hue} 30% 38%), #15241b)` }}
    >
      {count > 0 ? (
        <button
          type="button"
          aria-label="Expand photo"
          onClick={() => setExpanded(true)}
          className="relative block size-full cursor-zoom-in"
        >
          <Image
            src={photos[index]}
            alt={name}
            fill
            sizes="(max-width: 639px) 100vw, 720px"
            unoptimized
            className="object-cover"
          />
        </button>
      ) : (
        <span className="serif grid size-full place-items-center text-[112px] text-white/85">
          {initials}
        </span>
      )}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(to bottom, rgba(13,16,15,0) 24%, rgba(13,16,15,0.5) 54%, rgba(13,16,15,0.78) 78%, rgba(13,16,15,0.92) 100%)",
        }}
      />
      {count > 0 ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-3 grid size-8 place-items-center rounded-full bg-[rgba(13,16,15,0.4)] text-white backdrop-blur-sm"
        >
          <Expand size={15} strokeWidth={2} />
        </span>
      ) : null}
      {count > 1 ? (
        <>
          <button
            type="button"
            aria-label="Previous photo"
            onClick={() => go(-1)}
            className="kin-focus absolute left-3 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full bg-[rgba(13,16,15,0.45)] text-white backdrop-blur-sm transition hover:bg-[rgba(13,16,15,0.7)]"
          >
            <ChevronLeft size={18} strokeWidth={2} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Next photo"
            onClick={() => go(1)}
            className="kin-focus absolute right-3 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full bg-[rgba(13,16,15,0.45)] text-white backdrop-blur-sm transition hover:bg-[rgba(13,16,15,0.7)]"
          >
            <ChevronRight size={18} strokeWidth={2} aria-hidden="true" />
          </button>
          <div className="absolute left-1/2 top-3 flex -translate-x-1/2 gap-1.5">
            {photos.map((photo, i) => (
              <button
                key={photo}
                type="button"
                aria-label={`Photo ${i + 1}`}
                onClick={() => setIndex(i)}
                className={`h-1.5 rounded-full transition-all ${
                  i === index ? "w-5 bg-white" : "w-1.5 bg-white/50 hover:bg-white/80"
                }`}
              />
            ))}
          </div>
        </>
      ) : null}

      {/* Lightbox — full image at its original aspect ratio */}
      {count > 0 ? (
        <Dialog.Root open={expanded} onOpenChange={setExpanded}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-[60] bg-[rgba(8,12,10,0.94)] backdrop-blur-sm" />
            <Dialog.Content
              aria-describedby={undefined}
              onClick={(event) => {
                if (event.target === event.currentTarget) setExpanded(false);
              }}
              className="fixed inset-0 z-[60] flex items-center justify-center p-4 outline-none sm:p-10"
            >
              <Dialog.Title className="sr-only">{name}&rsquo;s photo</Dialog.Title>
              <Image
                src={photos[index]}
                alt={name}
                width={1200}
                height={1200}
                unoptimized
                className="max-h-[92vh] max-w-[92vw] rounded-xl object-contain shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)]"
              />
              <Dialog.Close
                aria-label="Close"
                className="kin-focus absolute right-4 top-4 grid size-10 place-items-center rounded-full bg-white/15 text-white backdrop-blur-sm transition hover:bg-white/25"
              >
                <X size={20} strokeWidth={2} aria-hidden="true" />
              </Dialog.Close>
              {count > 1 ? (
                <>
                  <button
                    type="button"
                    aria-label="Previous photo"
                    onClick={(event) => {
                      event.stopPropagation();
                      go(-1);
                    }}
                    className="kin-focus absolute left-4 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-white/15 text-white backdrop-blur-sm transition hover:bg-white/25"
                  >
                    <ChevronLeft size={22} strokeWidth={2} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label="Next photo"
                    onClick={(event) => {
                      event.stopPropagation();
                      go(1);
                    }}
                    className="kin-focus absolute right-4 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-white/15 text-white backdrop-blur-sm transition hover:bg-white/25"
                  >
                    <ChevronRight size={22} strokeWidth={2} aria-hidden="true" />
                  </button>
                  <div className="absolute bottom-5 left-1/2 mono -translate-x-1/2 rounded-full bg-white/15 px-3 py-1 text-[12px] text-white backdrop-blur-sm">
                    {index + 1} / {count}
                  </div>
                </>
              ) : null}
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      ) : null}
    </div>
  );
}

function ListingPreview({ listing, openSpots }: { listing: ApartmentPreview; openSpots: number }) {
  const rent =
    listing.perPersonRent != null
      ? `$${listing.perPersonRent.toLocaleString("en-US")}/mo per person`
      : listing.monthlyRent != null
        ? `$${listing.monthlyRent.toLocaleString("en-US")}/mo`
        : null;
  return (
    <div>
      <h4 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#8d9690]">
        Wants to join
        {openSpots > 0 ? ` · ${openSpots} spot${openSpots === 1 ? "" : "s"} left` : " · group is full"}
      </h4>
      <div className="mt-2.5 flex items-center gap-3.5 rounded-2xl border border-[rgba(28,51,38,0.1)] bg-white p-2.5">
        <div className="relative size-[68px] shrink-0 overflow-hidden rounded-xl bg-[#dce7e2]">
          {listing.photoUrl ? (
            <Image
              src={listing.photoUrl}
              alt=""
              fill
              sizes="68px"
              unoptimized
              className="object-cover"
            />
          ) : (
            <span className="grid size-full place-items-center text-[#264a36]">
              <Home size={22} strokeWidth={1.6} aria-hidden="true" />
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="serif truncate text-[16px] leading-tight text-[#0f1a14]">{listing.address}</p>
          <p className="mt-0.5 truncate text-[12px] text-[#6b7a70]">
            {[listing.neighborhood, listing.beds].filter(Boolean).join(" · ")}
          </p>
          {rent ? <p className="mono mt-1 text-[12.5px] text-[#2f4a3a]">{rent}</p> : null}
        </div>
      </div>
    </div>
  );
}

function ProfileModal({
  actionError,
  data,
  listing,
  openSpots = 0,
  footer,
  onClose,
}: {
  actionError?: string | null;
  data: ProfileViewData;
  listing?: ApartmentPreview | null;
  openSpots?: number;
  footer: React.ReactNode;
  onClose: () => void;
}) {
  const { detail } = data;
  const displayScore = data.score == null ? null : clampMatchesScore(data.score);
  const photos = getProfileModalPhotoUrls(data);
  const hasBody =
    detail.about != null ||
    detail.interests.length > 0 ||
    detail.signals.length > 0 ||
    detail.breakdown.length > 0 ||
    data.evidence.length > 0 ||
    data.risks.length > 0;

  return (
    <Dialog.Root open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-[rgba(14,31,23,0.32)] backdrop-blur-[6px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[calc(100%-2rem)] max-w-[540px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-3xl border border-[rgba(28,51,38,0.1)] bg-[#fdfcf8] shadow-[0_30px_70px_-30px_rgba(14,31,23,0.5)] outline-none">
          {/* Hero: photo carousel with overlaid name + score */}
          <div className="relative shrink-0">
            <PhotoCarousel
              photos={photos}
              name={data.name}
              initials={data.initials}
              seed={data.userId}
            />
            <Dialog.Close
              aria-label="Close"
              className="kin-focus absolute right-3 top-3 grid size-9 place-items-center rounded-full bg-[rgba(13,16,15,0.45)] text-white backdrop-blur-sm transition hover:bg-[rgba(13,16,15,0.7)]"
            >
              <X size={17} strokeWidth={2} aria-hidden="true" />
            </Dialog.Close>
            <div className="absolute inset-x-0 bottom-0 flex flex-col gap-3 p-5">
              <div className="flex items-end justify-between gap-3">
                <div className="min-w-0">
                  <Dialog.Title className="serif text-[28px] leading-tight tracking-[-0.01em] text-white">
                    {data.name}
                    {detail.age != null ? (
                      <span className="font-normal text-white/70"> · {detail.age}</span>
                    ) : null}
                  </Dialog.Title>
                  <p className="mt-1 text-[13.5px] leading-snug text-white/85">{data.headline}</p>
                </div>
                {displayScore != null ? (
                  <span
                    className="mono grid size-[56px] shrink-0 place-items-center rounded-full text-[15px] font-medium text-[#c78b3e]"
                    style={{
                      background: `conic-gradient(#c78b3e ${displayScore}%, rgba(255,255,255,0.28) 0)`,
                    }}
                  >
                    <span className="grid size-[44px] place-items-center rounded-full bg-[#15241b] text-white">
                      {displayScore}
                    </span>
                  </span>
                ) : null}
              </div>

              {detail.company || detail.school || detail.hometown ? (
                <div className="flex flex-wrap items-center gap-2">
                  {detail.company ? <CredentialChip credential={detail.company} onImage /> : null}
                  {detail.school ? <CredentialChip credential={detail.school} onImage /> : null}
                  {detail.hometown ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-white/15 px-3 py-1 text-[12.5px] text-white backdrop-blur-sm">
                      <MapPin size={13} strokeWidth={1.8} aria-hidden="true" />
                      {detail.hometown}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          {/* Body (scrolls) */}
          <div className="flex flex-col gap-5 overflow-y-auto px-6 py-5">
            {data.locked ? (
              <p className="text-[13px] leading-[1.5] text-[var(--ink-500)]">
                Their full profile — name, photos, and work — unlocks when you both say yes.
              </p>
            ) : null}
            {listing ? <ListingPreview listing={listing} openSpots={openSpots} /> : null}

            {detail.about ? (
              <Dialog.Description asChild>
                <p className="text-[14px] leading-[1.6] text-[#2f4a3a]">{detail.about}</p>
              </Dialog.Description>
            ) : null}

            {detail.interests.length > 0 ? (
              <div>
                <h4 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#8d9690]">
                  Interests
                </h4>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {detail.interests.map((interest) => (
                    <span
                      key={interest}
                      className="rounded-full border border-[rgba(28,51,38,0.12)] bg-white px-3 py-1 text-[12.5px] text-[#2f4a3a]"
                    >
                      {interest}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {detail.signals.length > 0 ? (
              <div>
                <h4 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#8d9690]">
                  Living style
                </h4>
                <dl className="mt-2.5 grid gap-2.5">
                  {detail.signals.map((signal) => (
                    <div key={signal.label} className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
                      <dt className="shrink-0 pt-px text-[12px] font-medium text-[#264a36] sm:w-[110px]">
                        {signal.label}
                      </dt>
                      <dd className="text-[13px] leading-[1.5] text-[#2f4a3a]">{signal.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : null}

            {detail.breakdown.length > 0 ? (
              <div>
                <h4 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#8d9690]">
                  Compatibility breakdown
                </h4>
                <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3.5">
                  {detail.breakdown.map((component) => (
                    <ComponentBar key={component.key} component={component} />
                  ))}
                </div>
              </div>
            ) : null}

            <EvidenceList title="Why you'd click" points={data.evidence} tone="good" />
            <EvidenceList title="Worth a conversation" points={data.risks} tone="warn" />

            {!hasBody && !listing && !data.locked ? (
              <p className="text-[13px] leading-[1.5] text-[#8d9690]">
                This profile is still filling in. More detail appears as {data.name.split(" ")[0]}{" "}
                completes their Kinfolk profile.
              </p>
            ) : null}
          </div>

          {/* Footer actions */}
          <div className="border-t border-[rgba(28,51,38,0.08)] px-6 py-4">
            <RequestActionError message={actionError} />
            <div className={`flex items-center justify-end gap-2.5 ${actionError ? "mt-3" : ""}`}>
              {footer}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function RequestActionError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p
      className="rounded-xl border border-[rgba(185,76,63,0.3)] bg-[rgba(185,76,63,0.06)] px-3 py-2 text-[12.5px] leading-5 text-[#b94c3f]"
      // role=status is implicitly polite; pairing role=alert (assertive) with
      // aria-live=polite sends contradictory politeness and can double-announce.
      role="status"
    >
      {message}
    </p>
  );
}

function RequestRow({
  request,
  pending,
  onRespond,
  onOpen,
}: {
  request: PendingGroupRequest;
  pending: boolean;
  onRespond: (request: PendingGroupRequest, approve: boolean) => void;
  onOpen: (request: PendingGroupRequest) => void;
}) {
  return (
    <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:gap-4">
      <button
        type="button"
        onClick={() => onOpen(request)}
        className="kin-focus group flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left transition"
      >
        <Avatar
          imageUrl={request.requesterImageUrl}
          initials={request.requesterInitials}
          seed={request.requesterUserId}
          size={46}
          fontSize={46 * 0.3}
          className="shrink-0"
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-[15px] font-semibold text-[#0f1a14]">
            <span className="truncate group-hover:underline">{request.requesterName}</span>
            {request.fitScore != null ? (
              <span className="mono shrink-0 text-[12px] font-medium text-[#264a36]">
                {formatMatchesScoreLabel(request.fitScore, "fit")}
              </span>
            ) : null}
          </span>
          <span className="mt-0.5 block text-[12.5px] leading-5 text-[#6b7a70]">
            wants to join your{" "}
            <span className="font-medium text-[#2f4a3a]">{request.groupLabel}</span> group
            {request.requesterHeadline ? ` · ${request.requesterHeadline}` : ""}
            {request.openSpots > 0
              ? ` · ${request.openSpots} spot${request.openSpots === 1 ? "" : "s"} left`
              : ""}{" "}
            · {relativeTime(request.requestedAt)} · <span className="text-[#264a36]">view profile</span>
          </span>
        </span>
      </button>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => onRespond(request, true)}
          className="kin-focus inline-flex items-center gap-1.5 rounded-full bg-[#264a36] px-4 py-2 text-[12.5px] font-semibold text-white transition hover:bg-[#1c3526] disabled:opacity-50"
        >
          <Check size={14} strokeWidth={2.2} aria-hidden="true" /> Accept
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => onRespond(request, false)}
          className="kin-focus inline-flex items-center gap-1.5 rounded-full border border-[rgba(185,76,63,0.3)] px-4 py-2 text-[12.5px] font-semibold text-[#b94c3f] transition hover:bg-[rgba(185,76,63,0.06)] disabled:opacity-50"
        >
          <X size={14} strokeWidth={2.2} aria-hidden="true" /> Decline
        </button>
      </div>
    </div>
  );
}

// Bottom-weighted scrim so overlaid white text stays legible over any photo —
// mirrors the texted listing card the user sees when requesting apartments.
const MATCH_CARD_SCRIM =
  "linear-gradient(to bottom, rgba(13,16,15,0) 28%, rgba(13,16,15,0.38) 52%, rgba(13,16,15,0.76) 77%, rgba(13,16,15,0.94) 100%)";

// Translucent pills overlaid on a match photo — evidence/tradeoffs for an
// apartment, compatibility dimensions for a roommate. Shared by both cards.
function OverlayPills({ labels }: { labels: string[] }) {
  if (labels.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {labels.map((label) => (
        <span
          key={label}
          className="rounded-full border border-white/25 bg-white/[0.16] px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-sm"
        >
          {label}
        </span>
      ))}
    </div>
  );
}

function wrapPhotoIndex(index: number, count: number): number {
  return (index + count) % count;
}

function carouselPhotoWindow(photos: string[], index: number): { index: number; src: string }[] {
  if (photos.length === 0) return [];
  if (photos.length === 1) return [{ index: 0, src: photos[0] }];

  const visible = new Map<number, string>();
  for (const offset of [-1, 0, 1]) {
    const photoIndex = wrapPhotoIndex(index + offset, photos.length);
    visible.set(photoIndex, photos[photoIndex]);
  }
  return Array.from(visible, ([photoIndex, src]) => ({ index: photoIndex, src }));
}

function predecodeMatchPhoto(src: string) {
  if (typeof window === "undefined" || predecodedMatchPhotos.has(src)) return;
  predecodedMatchPhotos.add(src);

  const { props } = getImageProps({
    alt: "",
    fill: true,
    quality: MATCH_PHOTO_QUALITY,
    sizes: MATCH_PHOTO_SIZES,
    src,
  });
  const image = new window.Image();
  image.decoding = "async";
  if (props.srcSet) image.srcset = props.srcSet;
  if (props.sizes) image.sizes = props.sizes;
  image.src = props.src;
  if (typeof image.decode === "function") {
    void image.decode().catch(() => undefined);
  }
}

function scheduleIdleWork(callback: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const idleWindow = window as Window & {
    requestIdleCallback?: Window["requestIdleCallback"];
    cancelIdleCallback?: Window["cancelIdleCallback"];
  };
  if (
    typeof idleWindow.requestIdleCallback === "function" &&
    typeof idleWindow.cancelIdleCallback === "function"
  ) {
    const handle = idleWindow.requestIdleCallback(callback, { timeout: 700 });
    return () => idleWindow.cancelIdleCallback?.(handle);
  }
  const handle = globalThis.setTimeout(callback, 120);
  return () => globalThis.clearTimeout(handle);
}

// Image-forward carousel shared by the apartment + roommate match cards: a
// photo fills the card, a click anywhere advances it, and a bottom scrim
// carries the overlaid white content passed as children.
function MatchPhotoCarousel({
  photos,
  title,
  seed,
  badge,
  preloadFirstPhoto = false,
  fallback,
  children,
}: {
  photos: string[];
  title: string;
  seed: string;
  badge: string;
  preloadFirstPhoto?: boolean;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [index, setIndex] = useState(0);
  const count = photos.length;
  const visiblePhotos = useMemo(() => carouselPhotoWindow(photos, index), [index, photos]);
  const hue = Array.from(seed).reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 360;
  const predecodeNeighbors = useCallback(() => {
    if (count <= 1) return;
    predecodeMatchPhoto(photos[wrapPhotoIndex(index + 1, count)]);
    predecodeMatchPhoto(photos[wrapPhotoIndex(index - 1, count)]);
  }, [count, index, photos]);
  const go = (delta: number, event?: React.MouseEvent) => {
    event?.preventDefault();
    event?.stopPropagation();
    if (count === 0) return;
    setIndex((i) => (i + delta + count) % count);
  };

  useEffect(() => {
    if (count <= 1) return undefined;
    return scheduleIdleWork(predecodeNeighbors);
  }, [count, predecodeNeighbors]);

  return (
    <div
      className="relative flex aspect-[4/5] w-full flex-col overflow-hidden"
      style={{ background: `linear-gradient(150deg, hsl(${hue} 24% 30%), #15241b)` }}
    >
      {count > 1 ? (
        <button
          type="button"
          aria-label="Next photo"
          tabIndex={-1}
          onClick={(event) => go(1, event)}
          onFocus={predecodeNeighbors}
          onPointerEnter={predecodeNeighbors}
          className="absolute inset-0 block cursor-pointer"
        >
          {visiblePhotos.map((photo) => {
            const active = photo.index === index;
            const shouldPreload = preloadFirstPhoto && active && index === 0;
            return (
              <Image
                key={`${photo.index}-${photo.src}`}
                alt={active ? title : ""}
                aria-hidden={!active}
                className={`object-cover transition-opacity duration-150 ease-out ${
                  active ? "opacity-100" : "opacity-0"
                }`}
                decoding="async"
                fetchPriority={shouldPreload ? "high" : active ? "auto" : "low"}
                fill
                loading={shouldPreload ? "eager" : "lazy"}
                quality={MATCH_PHOTO_QUALITY}
                sizes={MATCH_PHOTO_SIZES}
                src={photo.src}
              />
            );
          })}
        </button>
      ) : count === 1 ? (
        <Image
          alt={title}
          className="object-cover"
          decoding="async"
          fetchPriority={preloadFirstPhoto ? "high" : "auto"}
          fill
          loading={preloadFirstPhoto ? "eager" : "lazy"}
          quality={MATCH_PHOTO_QUALITY}
          sizes={MATCH_PHOTO_SIZES}
          src={photos[0]}
        />
      ) : (
        <span className="absolute inset-0 grid place-items-center text-white/45" aria-hidden="true">
          {fallback ?? <Home size={56} strokeWidth={1.1} />}
        </span>
      )}

      <div className="pointer-events-none absolute inset-0" style={{ background: MATCH_CARD_SCRIM }} />

      <span className="mono pointer-events-none absolute left-3 top-3 rounded-full border border-white/25 bg-[rgba(13,16,15,0.5)] px-3 py-1 text-[12px] font-medium text-white backdrop-blur-sm">
        {badge}
      </span>

      {count > 1 ? (
        <>
          <button
            type="button"
            aria-label="Previous photo"
            onClick={(event) => go(-1, event)}
            onFocus={predecodeNeighbors}
            onPointerEnter={predecodeNeighbors}
            className="kin-focus absolute left-3 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full bg-[rgba(13,16,15,0.45)] text-white opacity-0 backdrop-blur-sm transition hover:bg-[rgba(13,16,15,0.7)] focus-visible:opacity-100 group-hover:opacity-100"
          >
            <ChevronLeft size={18} strokeWidth={2} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Next photo"
            onClick={(event) => go(1, event)}
            onFocus={predecodeNeighbors}
            onPointerEnter={predecodeNeighbors}
            className="kin-focus absolute right-3 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full bg-[rgba(13,16,15,0.45)] text-white opacity-0 backdrop-blur-sm transition hover:bg-[rgba(13,16,15,0.7)] focus-visible:opacity-100 group-hover:opacity-100"
          >
            <ChevronRight size={18} strokeWidth={2} aria-hidden="true" />
          </button>
          <div className="absolute left-1/2 top-3 flex max-w-[60%] -translate-x-1/2 flex-wrap justify-center gap-1.5">
            {photos.map((photo, i) => (
              <button
                key={photo}
                type="button"
                aria-label={`Photo ${i + 1}`}
                onClick={(event) => {
                  event.stopPropagation();
                  setIndex(i);
                }}
                onFocus={() => predecodeMatchPhoto(photo)}
                onPointerEnter={() => predecodeMatchPhoto(photo)}
                className={`h-1.5 rounded-full transition-all ${
                  i === index ? "w-5 bg-white" : "w-1.5 bg-white/50 hover:bg-white/80"
                }`}
              />
            ))}
          </div>
        </>
      ) : null}

      {/* Overlaid content, anchored to the bottom. pointer-events stay off so a
          click anywhere on the photo advances the carousel; interactive bits
          inside re-enable them. */}
      <div className="pointer-events-none relative z-10 mt-auto p-4">{children}</div>
    </div>
  );
}

function ApartmentCard({ match, eagerImage = false }: { match: ApartmentMatch; eagerImage?: boolean }) {
  const rent = formatRent(match.monthlyRent);
  const perPerson = formatRent(match.perPersonRent);
  const rentCaption =
    match.rentCaption ??
    (perPerson && perPerson !== rent ? `${perPerson} per person` : null);
  return (
    <article
      className="group relative overflow-hidden rounded-2xl border border-[rgba(28,51,38,0.1)] bg-[#15241b] shadow-[0_1px_2px_rgba(28,51,38,0.04)] transition hover:-translate-y-0.5 hover:shadow-[0_24px_46px_-26px_rgba(14,31,23,0.45)]"
      style={MATCH_CARD_RENDER_CONTAINMENT}
    >
      <MatchPhotoCarousel
        photos={match.photoUrls}
        title={match.title}
        seed={match.id}
        badge={formatMatchesScoreLabel(match.fitScore, "fit")}
        preloadFirstPhoto={eagerImage}
      >
        <div className="flex flex-col gap-2">
          <div className="flex items-end justify-between gap-3">
            <p className="serif text-[22px] leading-none tracking-[-0.01em] text-white">
              {rent ?? "Rent in Kinfolk"}
            </p>
            {match.beds ? <p className="text-[12.5px] text-white/80">{match.beds}</p> : null}
          </div>
          <div>
            <h3 className="serif text-[17px] leading-tight tracking-[-0.01em] text-white">
              {match.title}
            </h3>
            <p className="mt-0.5 text-[12.5px] text-white/75">
              {match.subtitle}
              {rentCaption ? <span className="text-white/60"> · {rentCaption}</span> : null}
            </p>
          </div>
          <OverlayPills
            labels={[
              ...match.evidence.slice(0, 2).map((point) => point.label),
              ...match.tradeoffs.slice(0, 1).map((point) => point.label),
            ].slice(0, 2)}
          />
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-white/12 px-2.5 py-1 text-[11.5px] font-semibold text-white/75">
              {match.nextAction}
            </span>
            {match.sourceUrl ? (
              <a
                aria-label={`View listing for ${match.title}`}
                href={match.sourceUrl}
                target="_blank"
                rel="noreferrer"
                onClick={(event) => event.stopPropagation()}
                className="kin-focus pointer-events-auto inline-flex w-fit items-center gap-1 text-[12px] font-semibold text-white/90 underline-offset-2 hover:underline"
              >
                View listing
                <ExternalLink size={13} strokeWidth={2} aria-hidden="true" />
              </a>
            ) : null}
          </div>
        </div>
      </MatchPhotoCarousel>
    </article>
  );
}

function RoommateCard({
  match,
  onOpen,
  eagerImage = false,
}: {
  match: RoommateMatch;
  onOpen: (match: RoommateMatch) => void;
  eagerImage?: boolean;
}) {
  const photos = getProfileModalPhotoUrls(match);
  // Compatibility dimensions read best on the photo; fall back to evidence
  // labels when a match has no scored components yet.
  const componentPills =
    match.components.length > 0
      ? match.components
          .slice(0, 3)
          .map((component) => `${component.label} · ${clampMatchesScore(component.score)}`)
      : match.evidence.slice(0, 3).map((point) => point.label);
  // Someone who already reached out leads with that — messaging back is the
  // one tap that opens the chat.
  const pills = match.incomingIntent
    ? ["Wants to connect", ...componentPills.slice(0, 2)]
    : componentPills;
  return (
    <article
      className="group relative overflow-hidden rounded-2xl border border-[rgba(28,51,38,0.1)] bg-[#15241b] shadow-[0_1px_2px_rgba(28,51,38,0.04)] transition hover:-translate-y-0.5 hover:shadow-[0_24px_46px_-26px_rgba(14,31,23,0.45)]"
      style={MATCH_CARD_RENDER_CONTAINMENT}
    >
      <MatchPhotoCarousel
        photos={photos}
        title={match.name}
        seed={match.userId}
        badge={formatRoommateMatchBadge(match)}
        preloadFirstPhoto={eagerImage}
        fallback={<span className="serif text-[88px] leading-none text-white/85">{match.initials}</span>}
      >
        <div className="flex flex-col gap-2.5">
          <div>
            <h3 className="serif text-[24px] leading-tight tracking-[-0.01em] text-white">
              {match.name}
            </h3>
            <p className="mt-0.5 text-[12.5px] leading-snug text-white/75">{match.headline}</p>
          </div>
          <OverlayPills labels={pills} />
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpen(match);
            }}
            className="kin-focus pointer-events-auto mt-1 inline-flex w-fit items-center gap-1 text-[12px] font-semibold text-white/90 underline-offset-2 hover:underline"
          >
            View profile →
          </button>
        </div>
      </MatchPhotoCarousel>
    </article>
  );
}

function EmptyState({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-[rgba(28,51,38,0.14)] bg-[#fdfcf8] px-6 py-12 text-center">
      <span className="grid size-11 place-items-center rounded-full bg-[#eef2eb] text-[#264a36]">
        {icon}
      </span>
      <p className="serif mt-4 text-[20px] text-[#2f4a3a]">{title}</p>
      <p className="mt-1.5 max-w-[44ch] text-[13.5px] leading-6 text-[#6b7a70]">{body}</p>
    </div>
  );
}

function matchToProfile(match: RoommateMatch): ProfileViewData {
  return {
    userId: match.userId,
    name: match.name,
    initials: match.initials,
    locked: match.locked,
    imageUrl: match.imageUrl,
    headline: match.headline,
    score: match.score,
    detail: match.detail,
    evidence: match.evidence,
    risks: match.risks,
  };
}

function requestToProfile(request: PendingGroupRequest): ProfileViewData {
  return {
    userId: request.requesterUserId,
    name: request.requesterName,
    initials: request.requesterInitials,
    imageUrl: request.requesterImageUrl,
    headline: request.requesterHeadline,
    score: request.fitScore,
    detail: request.detail,
    evidence: request.evidence,
    risks: request.risks,
  };
}

export function MatchesPane({ snapshot }: { snapshot: MatchesSnapshot }) {
  const { push, refresh } = useRouter();
  const [{ active, error, pendingIds, resolvedRequestIds, tab }, updatePane] = useReducer(
    matchesPaneReducer,
    undefined,
    createMatchesPaneState,
  );
  const [, startTransition] = useTransition();
  // Derived from the snapshot prop so requests arriving via router.refresh()
  // show up mid-session; locally resolved ones stay hidden.
  const requests = useMemo(
    () => getVisibleRequestsForMatchesPane(snapshot.requests, resolvedRequestIds),
    [snapshot.requests, resolvedRequestIds],
  );

  async function respond(request: PendingGroupRequest, approve: boolean) {
    if (pendingIds.includes(request.id)) return;
    updatePane((current) => ({
      error: null,
      pendingIds: [...current.pendingIds, request.id],
    }));
    try {
      const response = await fetch("/api/apartments/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildGroupRequestResponsePayload(request, approve)),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "Could not update the request.");
      }
      updatePane((current) => applySuccessfulRequestResponseState(current, request.id));
      startTransition(() => refresh());
    } catch (caught) {
      updatePane({
        error: caught instanceof Error ? caught.message : "Could not update the request.",
      });
    } finally {
      updatePane((current) => ({
        pendingIds: current.pendingIds.filter((id) => id !== request.id),
      }));
    }
  }

  const [messageNote, setMessageNote] = useState<string | null>(null);
  const [messagingId, setMessagingId] = useState<string | null>(null);

  async function messageMatch(match: RoommateMatch) {
    if (messagingId) return;
    setMessagingId(match.id);
    setMessageNote(null);
    try {
      const response = await fetch("/api/chats/match-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ compatibilityEdgeId: match.id }),
      });
      const data = (await response.json().catch(() => null)) as
        | { status?: string; roomId?: string; error?: string }
        | null;
      if (!response.ok) throw new Error(data?.error ?? "Could not open this chat.");
      if (data?.status === "opened" && data.roomId) {
        push(`/chats/${data.roomId}`);
        return;
      }
      setMessageNote("Interest sent — your chat opens here once they're in too.");
    } catch (caught) {
      setMessageNote(caught instanceof Error ? caught.message : "Could not open this chat.");
    } finally {
      setMessagingId(null);
    }
  }

  const visibleRoommates = useMemo(
    () => getVisibleRoommatesForMatchesPane(snapshot.roommates),
    [snapshot.roommates],
  );
  const aptCount = snapshot.apartments.length;
  const mateCount = visibleRoommates.length;
  const reqCount = requests.length;

  const activeRequest =
    active?.kind === "request" ? requests.find((item) => item.id === active.id) ?? null : null;
  const activeMatch =
    active?.kind === "match"
      ? visibleRoommates.find((item) => item.id === active.id) ?? null
      : null;
  const selectTab = useCallback((nextTab: Tab) => {
    updatePane({ tab: nextTab });
  }, []);
  const handleTabKeyDown = useCallback((currentTab: Tab, event: KeyboardEvent<HTMLButtonElement>) => {
    const nextTab = getNextMatchesTabFromKey(currentTab, event.key);
    if (!nextTab) return;
    event.preventDefault();
    updatePane({ tab: nextTab });
    requestAnimationFrame(() => {
      document.getElementById(MATCHES_TAB_IDS[nextTab])?.focus();
    });
  }, []);

  return (
    <section className="flex w-full flex-col">
      <h1 className="serif text-4xl leading-[1] tracking-[-0.02em] text-[#0f1a14] sm:text-[52px]">
        Matches
      </h1>
      <p className="mt-2 text-[15px] leading-6 text-[#6b7a70] sm:text-[16px]">
        {reqCount > 0
          ? `${reqCount} ${reqCount === 1 ? "person wants" : "people want"} to join your groups. Below, the apartments and roommates your agent matched to you.`
          : "The apartments and roommates your agent matched to you and your groups."}
      </p>

      {error && !activeRequest ? (
        <p className="mt-4 rounded-xl border border-[rgba(185,76,63,0.3)] bg-white px-4 py-2.5 text-[13px] text-[#b94c3f]">
          {error}
        </p>
      ) : null}

      {snapshot.enrichmentReview ? (
        <a
          href={snapshot.enrichmentReview.memoriesHref}
          className="kin-focus mt-4 inline-flex w-fit items-center gap-1.5 text-[13.5px] font-medium text-[#264a36] underline decoration-[rgba(38,74,54,0.3)] underline-offset-4 transition hover:decoration-[#264a36]"
        >
          {formatEnrichmentReviewCountLabel(snapshot.enrichmentReview)} — review in Memories →
        </a>
      ) : null}

      {/* Pinned: needs your response */}
      {reqCount > 0 ? (
        <div className="mt-6 overflow-hidden rounded-2xl border border-[rgba(185,76,63,0.25)] bg-white">
          <div className="flex items-center gap-2.5 border-b border-[rgba(28,51,38,0.06)] px-5 py-3.5">
            <span className="size-[7px] animate-pulse rounded-full bg-[#b94c3f]" aria-hidden="true" />
            <span className="mono text-[10.5px] uppercase tracking-[0.14em] text-[#b94c3f]">
              Needs your response
            </span>
            <span className="mono rounded-full bg-[#b94c3f] px-2 py-0.5 text-[11px] text-white">
              {reqCount}
            </span>
          </div>
          <div className="divide-y divide-[rgba(28,51,38,0.06)]">
            {requests.map((request) => (
              <RequestRow
                key={request.id}
                request={request}
                pending={pendingIds.includes(request.id)}
                onRespond={respond}
                onOpen={(item) => updatePane({ active: { kind: "request", id: item.id } })}
              />
            ))}
          </div>
        </div>
      ) : null}

      {/* Tabs */}
      <div
        aria-label="Match categories"
        className="mt-7 inline-flex w-fit gap-1 rounded-2xl border border-[rgba(28,51,38,0.08)] bg-white p-1.5"
        role="tablist"
      >
        <TabButton
          active={tab === "apartments"}
          controlsId={MATCHES_PANEL_IDS.apartments}
          id={MATCHES_TAB_IDS.apartments}
          onClick={() => selectTab("apartments")}
          onKeyDown={(event) => handleTabKeyDown("apartments", event)}
        >
          Apartments <span className="mono text-[11px] opacity-70">{aptCount}</span>
        </TabButton>
        <TabButton
          active={tab === "roommates"}
          controlsId={MATCHES_PANEL_IDS.roommates}
          id={MATCHES_TAB_IDS.roommates}
          onClick={() => selectTab("roommates")}
          onKeyDown={(event) => handleTabKeyDown("roommates", event)}
        >
          Roommates <span className="mono text-[11px] opacity-70">{mateCount}</span>
        </TabButton>
      </div>

      {/* Panels */}
      <div className="mt-5">
        {tab === "apartments" ? (
          <div
            aria-labelledby={MATCHES_TAB_IDS.apartments}
            id={MATCHES_PANEL_IDS.apartments}
            role="tabpanel"
          >
            {aptCount > 0 ? (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {snapshot.apartments.map((match, index) => (
                  <ApartmentCard key={match.id} match={match} eagerImage={index < 2} />
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<Home size={20} strokeWidth={1.8} aria-hidden="true" />}
                title="No apartment matches yet"
                body="Your agent is reviewing listings against your budget and preferences. New apartment matches will land here."
              />
            )}
          </div>
        ) : mateCount > 0 ? (
          <div
            aria-labelledby={MATCHES_TAB_IDS.roommates}
            id={MATCHES_PANEL_IDS.roommates}
            role="tabpanel"
          >
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {visibleRoommates.map((match, index) => (
                <RoommateCard
                  key={match.id}
                  match={match}
                  eagerImage={index < 2}
                  onOpen={(item) => updatePane({ active: { kind: "match", id: item.id } })}
                />
              ))}
            </div>
          </div>
        ) : (
          <div
            aria-labelledby={MATCHES_TAB_IDS.roommates}
            id={MATCHES_PANEL_IDS.roommates}
            role="tabpanel"
          >
            <EmptyState
              icon={<Users size={20} strokeWidth={1.8} aria-hidden="true" />}
              title="No roommate matches yet"
              body="Once a few more people complete their profiles in your market, compatible roommates will show up here ranked by fit."
            />
          </div>
        )}
      </div>

      {snapshot.status !== "connected" ? (
        <p className="mono mt-6 flex items-center gap-2 text-[12px] text-[#8d9690]">
          <Sparkles size={13} strokeWidth={1.8} aria-hidden="true" />
          {snapshot.detail}
        </p>
      ) : null}

      {/* Expanded profile — requester (Accept / Decline) */}
      {activeRequest ? (
        <ProfileModal
          actionError={error}
          key={activeRequest.id}
          data={requestToProfile(activeRequest)}
          listing={activeRequest.listing}
          openSpots={activeRequest.openSpots}
          onClose={() => updatePane({ active: null })}
          footer={
            <>
              <button
                type="button"
                disabled={pendingIds.includes(activeRequest.id)}
                onClick={() => respond(activeRequest, false)}
                className="kin-focus inline-flex items-center gap-1.5 rounded-full border border-[rgba(185,76,63,0.3)] px-5 py-2.5 text-[13px] font-semibold text-[#b94c3f] transition hover:bg-[rgba(185,76,63,0.06)] disabled:opacity-50"
              >
                <X size={15} strokeWidth={2.2} aria-hidden="true" /> Decline
              </button>
              <button
                type="button"
                disabled={pendingIds.includes(activeRequest.id)}
                onClick={() => respond(activeRequest, true)}
                className="kin-focus inline-flex items-center gap-1.5 rounded-full bg-[#264a36] px-5 py-2.5 text-[13px] font-semibold text-white transition hover:bg-[#1c3526] disabled:opacity-50"
              >
                <Check size={15} strokeWidth={2.2} aria-hidden="true" /> Accept into group
              </button>
            </>
          }
        />
      ) : null}

      {/* Expanded profile — roommate match (Invite) */}
      {activeMatch ? (
        <ProfileModal
          key={activeMatch.id}
          data={matchToProfile(activeMatch)}
          onClose={() => {
            setMessageNote(null);
            updatePane({ active: null });
          }}
          footer={
            <div className="flex w-full flex-col gap-2">
              {messageNote ? (
                <p className="text-center text-[12.5px] leading-5 text-[#4b5d52]">
                  {messageNote}
                </p>
              ) : null}
              <div className="flex items-center justify-end gap-2">
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="kin-focus rounded-full border border-[rgba(28,51,38,0.16)] px-5 py-2.5 text-[13px] font-semibold text-[#2f4a3a] transition hover:border-[#264a36]"
                  >
                    Close
                  </button>
                </Dialog.Close>
                <button
                  type="button"
                  disabled={messagingId === activeMatch.id}
                  onClick={() => messageMatch(activeMatch)}
                  className="kin-focus inline-flex items-center gap-1.5 rounded-full bg-[#264a36] px-5 py-2.5 text-[13px] font-semibold text-white transition hover:bg-[#1c3526] disabled:opacity-50"
                >
                  <MessageCircle size={15} strokeWidth={2.1} aria-hidden="true" />
                  {messagingId === activeMatch.id
                    ? "Opening…"
                    : activeMatch.incomingIntent
                      ? "Message back"
                      : "Message"}
                </button>
              </div>
            </div>
          }
        />
      ) : null}
    </section>
  );
}

function TabButton({
  active,
  controlsId,
  id,
  onClick,
  onKeyDown,
  children,
}: {
  active: boolean;
  controlsId: string;
  id: string;
  onClick: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-controls={controlsId}
      aria-selected={active}
      id={id}
      onClick={onClick}
      onKeyDown={onKeyDown}
      role="tab"
      tabIndex={active ? 0 : -1}
      className={`kin-focus inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-[14px] font-medium transition ${
        active ? "bg-[#264a36] text-white" : "text-[#4b5d52] hover:bg-[rgba(28,51,38,0.04)]"
      }`}
    >
      {children}
    </button>
  );
}
