"use client";

import { Heart, ImageOff } from "lucide-react";
import Image from "next/image";
import type { Ref } from "react";
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
import { FIT_TEXT, fitToneForScore } from "./fit-tone";
import { PreviewMemberAvatar } from "./preview-member-avatar";

type Props = {
  listing: ApartmentListing;
  selected: boolean;
  onSelect: () => void;
  onOpenDetail?: () => void;
  onPreviewIntent?: () => void;
  imagePriority?: boolean;
  roommatesOverride?: number | null;
  saved?: boolean;
  onToggleSave?: (listingId: string) => void;
  /** Marks the list's single best-fit listing with a badge on the photo. */
  topPick?: boolean;
  ref?: Ref<HTMLDivElement>;
};

export function PropertyListCard({
  listing,
  selected,
  onSelect,
  onOpenDetail,
  onPreviewIntent,
  imagePriority = false,
  roommatesOverride,
  saved = false,
  onToggleSave,
  topPick = false,
  ref,
}: Props) {
  const canRoommateSplit = canShowRoommateSplitForListing(listing);
  const usesFloorPlanRent = usesFloorPlanRentDisplay(listing);
  const roommatesActive = roommatesOverride != null && roommatesOverride >= 1;
  const showRoommatePrice =
    (roommatesActive && canRoommateSplit) ||
    (canRoommateSplit && !usesFloorPlanRent);
  const primaryRent = primaryListingRentForDisplay(listing, roommatesOverride);
  const displayHouseholdSize = householdSizeForRoommates(
    listing,
    roommatesOverride,
  );
  const bedroomLabel =
    formatBedroomRange(
      listing.floorPlanBedroomMin,
      listing.floorPlanBedroomMax,
    ) ?? formatBedrooms(listing.bedrooms);
  const groupCount = listing.formingGroups.length;
  const groupContextLabel = usesFloorPlanRent
    ? "floor plans"
    : `${displayHouseholdSize}-way`;
  const avatarPreview = uniqueRoommatePreviewMembers(listing.formingGroups, 3);
  const unitRangeMin = listing.unitEffectiveRentMin ?? listing.unitRentMin;
  const unitRangeMax = listing.unitEffectiveRentMax ?? listing.unitRentMax;
  const showingEffectiveUnitRent =
    listing.unitEffectiveRentMin != null &&
    listing.unitRentMin != null &&
    listing.unitEffectiveRentMin < listing.unitRentMin;
  const handleOpen = () => {
    onSelect();
    onOpenDetail?.();
  };

  return (
    // The heart is a real <button> SIBLING of the card button (interactive
    // content is invalid inside a button, and some screen readers won't
    // expose a nested control); the wrapper provides its positioning context.
    // The card itself is chromeless — a rounded photo over stacked meta lines;
    // selection reads as a ring on the photo, not a border on a panel.
    <div ref={ref} className="apartment-list-card group relative h-full w-full">
    <button
      type="button"
      onClick={handleOpen}
      onFocus={onPreviewIntent}
      onPointerEnter={onPreviewIntent}
      aria-pressed={selected}
      className="kin-focus flex h-full w-full select-none flex-col rounded-xl text-left text-[var(--ink-900)]"
    >
      <div
        className={[
          "relative min-h-0 w-full flex-1 overflow-hidden rounded-xl bg-[var(--surface-soft)]",
          selected
            ? "ring-2 ring-[var(--forest-700)] ring-offset-2 ring-offset-white"
            : "",
        ].join(" ")}
      >
        {listing.photoUrl ? (
          <Image
            src={listing.photoUrl}
            alt=""
            fill
            sizes="(max-width: 768px) 100vw, 320px"
            priority={imagePriority}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex size-full items-center justify-center text-[var(--ink-400)]">
            <ImageOff size={28} aria-hidden="true" />
          </div>
        )}
        <div className="absolute left-2.5 top-2.5 flex max-w-[calc(100%-48px)] flex-wrap gap-1">
          {topPick ? (
            <span className="rounded-full bg-white/95 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-[var(--forest-700)] shadow-sm">
              Best fit
            </span>
          ) : null}
          {listing.noFee ? (
            <span className="rounded-full bg-white/95 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-[var(--ink-800)] shadow-sm">
              No fee
            </span>
          ) : null}
          {listing.concessionMonths > 0 ? (
            // Caution tone from fit-tone — ochre itself fails AA on white.
            <span
              className={`rounded-full bg-white/95 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide shadow-sm ${FIT_TEXT.caution}`}
            >
              {formatConcession(listing.concessionMonths)}
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-[3px] pt-2.5">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-[14px] font-semibold leading-[19px]">
            {listing.address}
            {listing.unit ? (
              <span className="font-normal text-[var(--ink-600)]">
                {" "}
                {listing.unit}
              </span>
            ) : null}
          </p>
          <span
            className={`shrink-0 text-[12px] font-semibold leading-[19px] ${FIT_TEXT[fitToneForScore(listing.fitScore)]}`}
          >
            <span className="mono">{Math.round(listing.fitScore)}%</span> fit
          </span>
        </div>
        <p className="truncate text-[13px] leading-[18px] text-[var(--ink-600)]">
          {listing.neighborhood}
        </p>
        <p className="truncate text-[13px] leading-[18px] text-[var(--ink-600)]">
          {bedroomLabel} · {formatBathrooms(listing.bathrooms)}
          {listing.squareFeet
            ? ` · ${listing.squareFeet.toLocaleString()} sqft`
            : ""}
          {usesFloorPlanRent
            ? ` · ${listing.floorPlanTypeCount} floor plan${listing.floorPlanTypeCount === 1 ? "" : "s"}${listing.floorPlanMonthlyRent == null ? " · ask pricing" : ""}`
            : listing.availableUnitCount > 0
              ? ` · ${listing.availableUnitCount} unit${listing.availableUnitCount === 1 ? "" : "s"} open${
                  unitRangeMin != null && unitRangeMax != null
                    ? ` · ${showingEffectiveUnitRent ? "eff. " : ""}${formatMaybeMoney(unitRangeMin)}${
                        unitRangeMax > unitRangeMin
                          ? `-${formatMaybeMoney(unitRangeMax)}`
                          : ""
                      }`
                    : ""
                }`
              : ""}
        </p>
        <p className="pt-[3px]">
          <span className="mono text-[15px] font-semibold leading-none">
            {formatMaybeMoney(primaryRent)}
          </span>
          {primaryRent != null ? (
            <span className="text-[12px] text-[var(--ink-600)]">
              {showRoommatePrice ? " / mo each" : " / mo"}
            </span>
          ) : null}
        </p>

        <div className="mt-1 flex items-center gap-1.5">
          {groupCount > 0 ? (
            <>
              <div className="flex">
                {avatarPreview.map((member) => (
                  <PreviewMemberAvatar
                    key={`${listing.id}-avatar-${member.name}-${member.initials}`}
                    member={member}
                    ringClass="ring-white"
                  />
                ))}
              </div>
              <span className="text-[11px] font-semibold text-[var(--forest-700)]">
                {groupCount} group{groupCount === 1 ? "" : "s"} forming
                <span className="font-normal text-[var(--ink-600)]">
                  {" "}
                  · {groupContextLabel}
                </span>
              </span>
            </>
          ) : showRoommatePrice ? (
            <span className="text-[11px] text-[var(--ink-600)]">
              {displayHouseholdSize}-way split · be first
            </span>
          ) : (
            <span className="text-[11px] text-[var(--ink-600)]">
              {usesFloorPlanRent ? "Floor plans" : "Whole apartment"}
            </span>
          )}
        </div>
      </div>
    </button>
    <button
      type="button"
      aria-label={saved ? "Remove from saved places" : "Save this listing"}
      aria-pressed={saved}
      onClick={() => onToggleSave?.(listing.id)}
      className="kin-focus absolute right-2.5 top-2.5 z-10 grid size-8 place-items-center rounded-full bg-white/90 shadow-sm motion-safe:transition-transform motion-safe:hover:scale-110"
    >
      {/* Same treatment as the map popup's save chip: the white backdrop keeps
          the heart legible over any photo, and hollow vs solid keeps the two
          states apart without relying on hue. */}
      <Heart
        size={16}
        aria-hidden="true"
        fill={saved ? "var(--rust)" : "none"}
        className={saved ? "text-[var(--rust)]" : "text-[var(--ink-800)]"}
        strokeWidth={2}
      />
    </button>
    </div>
  );
}
