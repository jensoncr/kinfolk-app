"use client";

import {
  Bath,
  BedDouble,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Heart,
  ImageOff,
  MapPin,
  Users,
  X,
} from "lucide-react";
import Image from "next/image";
import { useRef, useState } from "react";
import { uniqueRoommatePreviewMembers } from "@/lib/apartments/roommate-group-preview";
import {
  canShowRoommateSplitForListing,
  householdSizeForRoommates,
  primaryListingRentForDisplay,
  usesFloorPlanRentDisplay,
} from "@/lib/apartments/roommate-splits";
import type { ApartmentListing } from "@/lib/apartments/types";
import {
  formatBathrooms,
  formatBedroomRange,
  formatBedrooms,
  formatConcession,
  formatMaybeMoney,
} from "./listing-format";
import { PreviewMemberAvatar } from "./preview-member-avatar";
import { useSavedListings } from "./use-saved-listings";

const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

function formatDate(value: string | null) {
  if (!value) return "Ask";
  return shortDate.format(new Date(value));
}

type Props = {
  listing: ApartmentListing;
  onClose: () => void;
  onOpenDetails: () => void;
  roommatesOverride?: number | null;
};

export function PropertyPopupCard({ listing, onClose, onOpenDetails, roommatesOverride }: Props) {
  const photos = listing.photoUrls;
  const [photoIndex, setPhotoIndex] = useState(0);
  const { savedListingIds, toggleSavedListing } = useSavedListings();
  const saved = savedListingIds.has(listing.id);
  const canRoommateSplit = canShowRoommateSplitForListing(listing);
  const usesFloorPlanRent = usesFloorPlanRentDisplay(listing);
  const roommatesActive = roommatesOverride != null && roommatesOverride >= 1;
  const showRoommatePrice =
    (roommatesActive && canRoommateSplit) || (canRoommateSplit && !usesFloorPlanRent);
  const primaryRent = primaryListingRentForDisplay(listing, roommatesOverride);
  const displayHouseholdSize = householdSizeForRoommates(listing, roommatesOverride);
  const bedroomLabel =
    formatBedroomRange(listing.floorPlanBedroomMin, listing.floorPlanBedroomMax) ??
    formatBedrooms(listing.bedrooms);
  const hasEffectiveTotal =
    listing.effectiveMonthlyRent != null &&
    listing.monthlyRent != null &&
    listing.effectiveMonthlyRent < listing.monthlyRent;

  const formingCount = listing.formingGroups.length;
  const readyCount = listing.formingGroups.filter((g) => g.status === "ready").length;
  const previewMembers = uniqueRoommatePreviewMembers(listing.formingGroups, 4);
  const previewGroupSummary = listing.formingGroups[0]?.summary;
  const groupContextLabel = usesFloorPlanRent
    ? "floor plans"
    : `${displayHouseholdSize}-way`;

  const goPrev = () => setPhotoIndex((i) => (i - 1 + photos.length) % photos.length);
  const goNext = () => setPhotoIndex((i) => (i + 1) % photos.length);

  return (
    <article
      aria-label={"Apartment preview for " + listing.address + (listing.unit ? " " + listing.unit : "")}
      className={[
        "group/card relative flex w-[340px] flex-col",
        "max-h-[min(460px,calc(100dvh-200px))]",
        "overflow-hidden rounded-2xl border border-[var(--border-strong)] bg-white text-[var(--ink-900)]",
        "shadow-[0_24px_60px_-20px_rgba(14,31,23,0.45),0_8px_20px_-12px_rgba(14,31,23,0.25)]",
      ].join(" ")}
    >
      <PopupGallery
        fitScore={listing.fitScore}
        photos={photos}
        photoIndex={photoIndex}
        saved={saved}
        noFee={listing.noFee}
        concessionMonths={listing.concessionMonths}
        onClose={onClose}
        onNext={goNext}
        onPrev={goPrev}
        onToggleSaved={() => toggleSavedListing(listing.id)}
      />
      <PopupBody
        bedroomLabel={bedroomLabel}
        canRoommateSplit={canRoommateSplit}
        displayHouseholdSize={displayHouseholdSize}
        formingCount={formingCount}
        groupContextLabel={groupContextLabel}
        hasEffectiveTotal={hasEffectiveTotal}
        listing={listing}
        previewGroupSummary={previewGroupSummary}
        previewMembers={previewMembers}
        primaryRent={primaryRent}
        readyCount={readyCount}
        showRoommatePrice={showRoommatePrice}
        usesFloorPlanRent={usesFloorPlanRent}
        onOpenDetails={onOpenDetails}
      />
    </article>
  );
}

function PopupGallery({
  concessionMonths,
  fitScore,
  noFee,
  photoIndex,
  photos,
  saved,
  onClose,
  onNext,
  onPrev,
  onToggleSaved,
}: {
  concessionMonths: number;
  fitScore: number;
  noFee: boolean;
  photoIndex: number;
  photos: string[];
  saved: boolean;
  onClose: () => void;
  onNext: () => void;
  onPrev: () => void;
  onToggleSaved: () => void;
}) {
  const activePhoto = photos[photoIndex] ?? photos[0] ?? null;
  // Hover arrows don't exist on touch, so a horizontal swipe on the photo is
  // the primary way to browse popup photos on phones.
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const handleTouchStart = (event: React.TouchEvent) => {
    const touch = event.touches[0];
    touchStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
  };
  const handleTouchEnd = (event: React.TouchEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    const touch = event.changedTouches[0];
    if (!start || !touch || photos.length < 2) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < 0) onNext();
    else onPrev();
  };

  return (
    <div
      className="relative shrink-0"
      style={{ touchAction: "pan-y" }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-[var(--surface-soft)]">
        {activePhoto ? (
          <Image
            key={activePhoto}
            src={activePhoto}
            alt=""
            width={720}
            height={450}
            sizes="340px"
            priority={photoIndex === 0}
            className="absolute inset-0 size-full object-cover"
          />
        ) : (
          <div className="flex size-full items-center justify-center text-[var(--ink-400)]">
            <ImageOff size={30} aria-hidden="true" />
          </div>
        )}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/35 to-transparent"
          aria-hidden="true"
        />
      </div>

      <div className="absolute left-2.5 top-2.5 flex max-w-[calc(100%-90px)] flex-wrap gap-1.5">
        {noFee ? (
          <span className="rounded-full bg-white/95 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--forest-700)] shadow-sm backdrop-blur-sm">
            No fee
          </span>
        ) : null}
        {concessionMonths > 0 ? (
          <span className="rounded-full bg-[var(--ochre)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white shadow-sm">
            {formatConcession(concessionMonths)}
          </span>
        ) : null}
      </div>

      <div className="absolute right-2.5 top-2.5 flex flex-col items-end gap-1.5">
        <button
          type="button"
          onClick={onClose}
          className="kin-focus grid size-10 place-items-center rounded-full bg-white/95 text-[var(--ink-800)] shadow-sm transition hover:bg-white sm:size-7"
          aria-label="Close"
        >
          <X size={13} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onToggleSaved}
          className={[
            "kin-focus grid size-10 place-items-center rounded-full shadow-sm transition sm:size-7",
            saved
              ? "bg-[var(--rust)] text-white hover:bg-[var(--rust)]/90"
              : "bg-white/95 text-[var(--ink-800)] hover:bg-white",
          ].join(" ")}
          aria-label={saved ? "Saved" : "Save"}
          aria-pressed={saved}
        >
          <Heart
            size={13}
            aria-hidden="true"
            fill={saved ? "currentColor" : "none"}
            strokeWidth={2}
          />
        </button>
      </div>

      {photos.length > 1 ? (
        <>
          <button
            type="button"
            onClick={onPrev}
            className="kin-focus pointer-events-none absolute left-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-[var(--ink-900)] opacity-0 shadow-md transition group-hover/card:pointer-events-auto group-hover/card:opacity-100 hover:bg-white focus-visible:pointer-events-auto focus-visible:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100"
            aria-label="Previous photo"
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onNext}
            className="kin-focus pointer-events-none absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-[var(--ink-900)] opacity-0 shadow-md transition group-hover/card:pointer-events-auto group-hover/card:opacity-100 hover:bg-white focus-visible:pointer-events-auto focus-visible:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100"
            aria-label="Next photo"
          >
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </>
      ) : null}

      {photos.length > 1 ? (
        <div className="absolute bottom-2.5 left-1/2 flex -translate-x-1/2 gap-1">
          {photos.map((url, i) => (
            <span
              key={`dot-${url}`}
              className={[
                "block h-1.5 rounded-full transition-all",
                i === photoIndex ? "w-4 bg-white" : "w-1.5 bg-white/55",
              ].join(" ")}
              aria-hidden="true"
            />
          ))}
        </div>
      ) : null}

      <div className="absolute bottom-2.5 right-2.5 flex items-center gap-1.5 rounded-full bg-white/95 py-1 pl-2 pr-2.5 shadow-md backdrop-blur-sm">
        <span className="grid size-4 place-items-center rounded-full bg-[var(--mint-300)] text-[8px] font-bold text-[var(--forest-700)]">
          ✓
        </span>
        <span className="text-[11.5px] font-semibold text-[var(--forest-700)]">
          {Math.round(fitScore)}% fit
        </span>
      </div>
    </div>
  );
}

function PopupBody({
  bedroomLabel,
  canRoommateSplit,
  displayHouseholdSize,
  formingCount,
  groupContextLabel,
  hasEffectiveTotal,
  listing,
  previewGroupSummary,
  previewMembers,
  primaryRent,
  readyCount,
  showRoommatePrice,
  usesFloorPlanRent,
  onOpenDetails,
}: {
  bedroomLabel: string;
  canRoommateSplit: boolean;
  displayHouseholdSize: number;
  formingCount: number;
  groupContextLabel: string;
  hasEffectiveTotal: boolean;
  listing: ApartmentListing;
  previewGroupSummary?: string;
  previewMembers: ReturnType<typeof uniqueRoommatePreviewMembers>;
  primaryRent: number | null;
  readyCount: number;
  showRoommatePrice: boolean;
  usesFloorPlanRent: boolean;
  onOpenDetails: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 px-4 pb-3.5 pt-3">
      <div className="flex items-baseline gap-2">
        <span
          className="serif text-[26px] font-semibold leading-none tracking-tight text-[var(--ink-900)]"
          style={{ fontFeatureSettings: '"ss01" 1, "tnum" 1' }}
        >
          {formatMaybeMoney(primaryRent)}
        </span>
        {primaryRent != null ? (
          <span className="text-xs font-medium text-[var(--ink-500)]">
            {showRoommatePrice ? "/mo each" : "/mo"}
          </span>
        ) : null}
        {!usesFloorPlanRent ? (
          <span className="ml-auto text-[11.5px] text-[var(--ink-600)]">
            {canRoommateSplit
              ? hasEffectiveTotal
                ? `eff ${formatMaybeMoney(listing.effectiveMonthlyRent)}`
                : `${formatMaybeMoney(listing.monthlyRent)} total`
              : hasEffectiveTotal
                ? `${formatMaybeMoney(listing.monthlyRent)} gross`
                : "whole unit"}
          </span>
        ) : null}
      </div>

      <PopupStats
        bedroomLabel={bedroomLabel}
        displayHouseholdSize={displayHouseholdSize}
        listing={listing}
        showRoommatePrice={showRoommatePrice}
      />
      <PopupAddress listing={listing} />
      <PopupGroupSummary
        displayHouseholdSize={displayHouseholdSize}
        formingCount={formingCount}
        groupContextLabel={groupContextLabel}
        listing={listing}
        previewGroupSummary={previewGroupSummary}
        previewMembers={previewMembers}
        readyCount={readyCount}
        showRoommatePrice={showRoommatePrice}
        usesFloorPlanRent={usesFloorPlanRent}
        onOpenDetails={onOpenDetails}
      />
    </div>
  );
}

function PopupStats({
  bedroomLabel,
  displayHouseholdSize,
  listing,
  showRoommatePrice,
}: {
  bedroomLabel: string;
  displayHouseholdSize: number;
  listing: ApartmentListing;
  showRoommatePrice: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--ink-800)]">
      <span className="inline-flex items-center gap-1">
        <BedDouble size={12} aria-hidden="true" className="text-[var(--ink-500)]" />
        {bedroomLabel}
      </span>
      <span className="text-[var(--ink-300)]">|</span>
      <span className="inline-flex items-center gap-1">
        <Bath size={12} aria-hidden="true" className="text-[var(--ink-500)]" />
        {formatBathrooms(listing.bathrooms)}
      </span>
      <span className="text-[var(--ink-300)]">|</span>
      <span className="inline-flex items-center gap-1">
        <CalendarDays size={12} aria-hidden="true" className="text-[var(--ink-500)]" />
        {formatDate(listing.availableAt)}
      </span>
      {showRoommatePrice ? (
        <>
          <span className="text-[var(--ink-300)]">|</span>
          <span className="inline-flex items-center gap-1">
            <Users size={12} aria-hidden="true" className="text-[var(--ink-500)]" />
            {displayHouseholdSize}-way
          </span>
        </>
      ) : null}
    </div>
  );
}

function PopupAddress({ listing }: { listing: ApartmentListing }) {
  return (
    <div className="-mt-0.5">
      <p className="flex items-center gap-1 text-[13px] font-semibold text-[var(--ink-900)]">
        <MapPin size={12} aria-hidden="true" className="text-[var(--ink-500)]" />
        <span className="truncate">
          {listing.address}
          {listing.unit ? (
            <span className="text-[var(--ink-500)]"> · {listing.unit}</span>
          ) : null}
        </span>
      </p>
      <p className="ml-[18px] text-[11px] text-[var(--ink-500)]">
        {listing.neighborhood}
        {listing.city ? ` · ${listing.city}` : ""}
      </p>
    </div>
  );
}

function PopupGroupSummary({
  displayHouseholdSize,
  formingCount,
  groupContextLabel,
  listing,
  previewGroupSummary,
  previewMembers,
  readyCount,
  showRoommatePrice,
  usesFloorPlanRent,
  onOpenDetails,
}: {
  displayHouseholdSize: number;
  formingCount: number;
  groupContextLabel: string;
  listing: ApartmentListing;
  previewGroupSummary?: string;
  previewMembers: ReturnType<typeof uniqueRoommatePreviewMembers>;
  readyCount: number;
  showRoommatePrice: boolean;
  usesFloorPlanRent: boolean;
  onOpenDetails: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpenDetails}
      className="kin-focus mt-1 flex w-full items-center gap-2 rounded-lg border border-[var(--border)] bg-[#fbfaf5] px-2.5 py-2 text-left transition hover:bg-[var(--bg-soft)]"
    >
      {formingCount > 0 ? (
        <>
          <div className="flex">
            {previewMembers.map((member) => (
              <PreviewMemberAvatar
                key={`${listing.id}-preview-${member.name}-${member.initials}`}
                member={member}
                ringClass="ring-[#fbfaf5]"
              />
            ))}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11px] font-semibold text-[var(--ink-900)]">
              {formingCount} group{formingCount === 1 ? "" : "s"} forming
              <span className="ml-1 text-[var(--ink-500)]">· {groupContextLabel}</span>
              {readyCount > 0 ? (
                <span className="ml-1 text-[var(--forest-700)]">· {readyCount} ready</span>
              ) : null}
            </p>
            <p className="truncate text-[10px] text-[var(--ink-500)]">
              {previewGroupSummary ?? "Click for full breakdown"}
            </p>
          </div>
        </>
      ) : showRoommatePrice ? (
        <>
          <span className="grid size-5 place-items-center rounded-full border border-dashed border-[var(--ink-400)] text-[9px] font-bold text-[var(--ink-500)]">
            +
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11px] font-semibold text-[var(--ink-900)]">
              No groups yet · {displayHouseholdSize}-way split
            </p>
            <p className="truncate text-[10px] text-[var(--ink-500)]">
              Start one, Kinfolk matches you
            </p>
          </div>
        </>
      ) : (
        <>
          <span className="grid size-5 place-items-center rounded-full bg-white text-[var(--forest-700)]">
            <BedDouble size={12} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11px] font-semibold text-[var(--ink-900)]">
              {usesFloorPlanRent ? "Floor plans" : "Whole apartment"}
            </p>
            <p className="truncate text-[10px] text-[var(--ink-500)]">
              {usesFloorPlanRent
                ? `${listing.floorPlanTypeCount} plan${listing.floorPlanTypeCount === 1 ? "" : "s"} in this building`
                : "Full-unit rent for this layout"}
            </p>
          </div>
        </>
      )}
      <span
        aria-hidden="true"
        className="text-[11.5px] font-semibold text-[var(--forest-700)]"
      >
        View →
      </span>
    </button>
  );
}
