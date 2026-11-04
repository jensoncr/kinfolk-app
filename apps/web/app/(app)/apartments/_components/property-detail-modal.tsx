"use client";

import {
  CalendarDays,
  Car,
  Cat,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Dog,
  ExternalLink,
  FileText,
  Heart,
  ImageOff,
  Info,
  LayoutGrid,
  Mail,
  Phone,
  PlayCircle,
  Share2,
  ShoppingCart,
  Tag,
  Train,
  Trees,
  UtensilsCrossed,
  X,
} from "lucide-react";
import Image from "next/image";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type RefObject,
  type SetStateAction,
} from "react";
import { createPortal } from "react-dom";
import {
  compareFloorPlansByAvailabilityAndPrice,
  displayFloorPlans,
  floorPlanEffectiveRentRange,
  floorPlanHasEffectiveDiscount,
  floorPlanUnitEffectiveRent,
} from "@/lib/apartments/floor-plan-pricing";
import {
  canSplitByRoommates,
  canShowRoommateSplitForListing,
  clampRoommateSplitSize,
  householdSizeForRoommates,
  householdSizeLimitFromBedrooms,
  primaryListingRentForDisplay,
  usesFloorPlanRentDisplay,
} from "@/lib/apartments/roommate-splits";
import type {
  ApartmentListing,
  ApartmentSearchSnapshot,
  FloorPlanType,
  RoommateGroupMemberColor,
} from "@/lib/apartments/types";
import { apartmentListingSurfaceFitBreakdown } from "@/lib/apartments/match-surface";
import type { FitBreakdown } from "@/lib/matching/apartment-fit-core";
// String equality with the persistence layer's key is load-bearing — import
// it instead of redeclaring the literal.
import { WHOLE_UNIT_GROUP_KEY } from "@/lib/apartments/persisted-roommate-groups";
import { useUserGroups } from "@/lib/apartments/use-user-groups";
import { useSavedListings } from "./use-saved-listings";
import { FloorPlanAvatarStack, MemberAvatar } from "./floor-plan-avatar-stack";
import { FloorPlanGroupsModal } from "./floor-plan-groups-modal";
import { roommateGroupMemberKey } from "./group-member-identity";
import { GroupPreferencesModal } from "./group-preferences-modal";
import {
  wholeUnitGroupActionLabel,
  wholeUnitGroupSummaryText,
} from "./property-detail-modal-state";
import {
  IconBtn,
  Row,
  Section,
  SkeletonSection,
} from "./property-detail-parts";
import {
  formatBathrooms,
  formatBedroomRange,
  formatBedrooms,
  formatConcession,
  formatMaybeMoney,
} from "./listing-format";
import { formatCurrency } from "@/lib/shared/currency";
import {
  buildAmenityChipItems,
  collapsedFloorPlanCount,
  floorPlanKey,
  formatDate,
  formatFloorPlanAvailability,
  formatRentRange,
  formatSqftRange,
  shortDate,
  sourceLabel,
} from "./property-detail-format";


// Non-floor-plan listings split rent across the whole unit. They have no
// FloorPlanType to hang a group on, so we synthesize one keyed by this id —
// distinct from any real floor plan key (those always carry a "-<index>").
const WHOLE_UNIT_MEMBER_COLORS: RoommateGroupMemberColor[] = [
  "warm",
  "mint",
  "sage",
  "rust",
];
const NEARBY_POI_CATEGORIES = [
  { key: "transit", icon: Train, label: "Transit" },
  { key: "restaurant", icon: UtensilsCrossed, label: "Dining" },
  { key: "parks", icon: Trees, label: "Parks" },
  { key: "grocery", icon: ShoppingCart, label: "Grocery" },
] as const;


type Props = {
  listing: ApartmentListing;
  enrichedLoading?: boolean;
  onClose: () => void;
  onListingUpdated?: (listing: ApartmentListing) => void;
  roommatesOverride?: number | null;
  activeProfile?: ApartmentSearchSnapshot["activeProfile"];
};

type FloorPlanSelection = {
  listingId: string;
  key: string;
  unitName: string | null;
};

type GroupPrefsTarget = {
  plan: FloorPlanType;
  groupsKey: string;
};

type PropertyDetailModalState = {
  descriptionExpanded: boolean;
  floorPlansExpanded: boolean;
  groupPrefsTarget: GroupPrefsTarget | null;
  groupsModalKey: string | null;
  lightbox: boolean;
  openedAt: number;
  photoIndex: number;
  selectedFloorPlanSelection: FloorPlanSelection | null;
  show: boolean;
};

type PropertyDetailModalUpdate =
  | Partial<PropertyDetailModalState>
  | ((state: PropertyDetailModalState) => Partial<PropertyDetailModalState>);

const initialPropertyDetailModalState: PropertyDetailModalState = {
  descriptionExpanded: false,
  floorPlansExpanded: false,
  groupPrefsTarget: null,
  groupsModalKey: null,
  lightbox: false,
  openedAt: 0,
  photoIndex: 0,
  selectedFloorPlanSelection: null,
  show: false,
};

function propertyDetailModalReducer(
  state: PropertyDetailModalState,
  update: PropertyDetailModalUpdate,
) {
  const patch = typeof update === "function" ? update(state) : update;
  return { ...state, ...patch };
}

function createInitialPropertyDetailModalState() {
  return {
    ...initialPropertyDetailModalState,
    openedAt: Date.now(),
  };
}

function resolveStateAction<T>(current: T, action: SetStateAction<T>) {
  return typeof action === "function"
    ? (action as (value: T) => T)(current)
    : action;
}

function usePropertyDetailDerivedModel({
  floorPlansExpanded,
  groupsModalKey,
  listing,
  openedAt,
  roommatesOverride,
  selectedFloorPlanSelection,
}: {
  floorPlansExpanded: boolean;
  groupsModalKey: string | null;
  listing: ApartmentListing;
  openedAt: number;
  roommatesOverride?: number | null;
  selectedFloorPlanSelection: FloorPlanSelection | null;
}) {
  const canRoommateSplit = canShowRoommateSplitForListing(listing);
  const usesFloorPlanRent = usesFloorPlanRentDisplay(listing);
  const displayHouseholdSize = householdSizeForRoommates(listing, roommatesOverride);
  const floorPlanConcession = {
    concessionMonths: listing.concessionMonths,
    concessionLeaseMonths: listing.concessionLeaseMonths,
  };
  const hasEffective =
    (listing.effectiveMonthlyRent != null &&
      listing.monthlyRent != null &&
      listing.effectiveMonthlyRent < listing.monthlyRent) ||
    (usesFloorPlanRent &&
      listing.floorPlanMonthlyRent != null &&
      listing.unitRentMin != null &&
      listing.floorPlanMonthlyRent < listing.unitRentMin);
  const canShowSummaryGroupAction = !usesFloorPlanRent && canRoommateSplit;
  const hasRoommateSplit = canShowSummaryGroupAction && displayHouseholdSize > 1;
  const primaryRent = primaryListingRentForDisplay(listing, roommatesOverride);
  const bedroomLabel =
    formatBedroomRange(listing.floorPlanBedroomMin, listing.floorPlanBedroomMax) ??
    formatBedrooms(listing.bedrooms);

  const floorPlanEntries = useMemo(() => {
    const groups = listing.enriched?.floorPlans ?? [];
    if (groups.length === 0) return [];
    const types = displayFloorPlans(groups);
    return types
      .map((type, index) => ({
        key: floorPlanKey(type, index),
        type,
      }))
      .sort((a, b) => compareFloorPlansByAvailabilityAndPrice(a.type, b.type));
  }, [listing.enriched?.floorPlans]);

  // Synthetic "floor plan" for whole-unit listings so the same group machinery works.
  const wholeUnitPlan = useMemo<FloorPlanType | null>(() => {
    if (!canShowSummaryGroupAction) return null;
    const splitSize = clampRoommateSplitSize(
      displayHouseholdSize,
      listing.bedrooms,
    );
    const unitCount = Math.max(1, listing.availableUnitCount);
    // Plan rent fields are WHOLE-UNIT, matching real floor plans: startGroup
    // persists them as the group's monthly_rent, and every consumer divides by
    // maxSize for per-person math. Feeding the per-person display figure here
    // (primaryRent) made downstream split the rent twice.
    const wholeUnitRent = listing.effectiveMonthlyRent ?? listing.monthlyRent;
    return {
      id: WHOLE_UNIT_GROUP_KEY,
      name: listing.address,
      bedrooms: splitSize,
      bathrooms: listing.bathrooms,
      sqftMin: listing.squareFeet,
      sqftMax: listing.squareFeet,
      rentPriceMin: wholeUnitRent,
      rentPriceMax: wholeUnitRent,
      availableAt: listing.availableAt,
      totalUnits: unitCount,
      availableUnits: unitCount,
      units: [],
      specificAmenities: [],
      leaseTerms: [],
      imageUrl: listing.photoUrl,
      groups: listing.formingGroups.map((group) => ({
        id: group.id,
        members: group.members.map((member, index) => ({
          userId: member.userId,
          name: member.name,
          initials: member.initials,
          imageUrl: member.imageUrl,
          headline: member.headline,
          matchScore: member.matchScore,
          occupationTitle: member.occupationTitle,
          occupationCompany: member.occupationCompany,
          educationSchool: member.educationSchool,
          educationDegree: member.educationDegree,
          educationMajor: member.educationMajor,
          educationYear: member.educationYear,
          color:
            WHOLE_UNIT_MEMBER_COLORS[index % WHOLE_UNIT_MEMBER_COLORS.length]!,
          flex: false,
        })),
        targetUnitName: null,
        maxSize: group.spotsTotal,
        viewerMembershipStatus: group.viewerMembershipStatus ?? null,
        preferences: group.preferences ?? null,
        matchSummary: group.summary,
      })),
    };
  }, [canShowSummaryGroupAction, displayHouseholdSize, listing]);

  const groupsModalEntry = useMemo(() => {
    if (!groupsModalKey) return null;
    if (groupsModalKey === WHOLE_UNIT_GROUP_KEY) {
      return wholeUnitPlan
        ? { key: WHOLE_UNIT_GROUP_KEY, type: wholeUnitPlan }
        : null;
    }
    return (
      floorPlanEntries.find((entry) => entry.key === groupsModalKey) ?? null
    );
  }, [floorPlanEntries, groupsModalKey, wholeUnitPlan]);

  const selectedKey =
    selectedFloorPlanSelection?.listingId === listing.id
      ? selectedFloorPlanSelection.key
      : null;
  const selectedUnitName =
    selectedFloorPlanSelection?.listingId === listing.id
      ? selectedFloorPlanSelection.unitName
      : null;

  const selectedFloorPlan = useMemo(
    () =>
      floorPlanEntries.find((entry) => entry.key === selectedKey)?.type ?? null,
    [floorPlanEntries, selectedKey],
  );

  const selectedUnit = useMemo(
    () =>
      selectedFloorPlan && selectedUnitName
        ? selectedFloorPlan.units.find((unit) => unit.name === selectedUnitName) ?? null
        : null,
    [selectedFloorPlan, selectedUnitName],
  );

  const hasActiveSelection = selectedFloorPlan != null;
  const fpEffectiveRentRange = selectedFloorPlan
    ? floorPlanEffectiveRentRange(selectedFloorPlan, floorPlanConcession)
    : null;
  const fpPrimaryGrossRent =
    selectedUnit?.rentPrice ??
    selectedFloorPlan?.rentPriceMin ??
    selectedFloorPlan?.rentPriceMax ??
    null;
  const fpPrimaryRent = selectedUnit
    ? floorPlanUnitEffectiveRent(selectedUnit, floorPlanConcession)
    : (fpEffectiveRentRange?.min ?? fpEffectiveRentRange?.max ?? null);
  const fpRentRange = selectedUnit
    ? null
    : selectedFloorPlan
      ? formatRentRange(fpEffectiveRentRange?.min ?? null, fpEffectiveRentRange?.max ?? null)
      : null;
  const fpHasEffective = selectedUnit
    ? fpPrimaryRent != null &&
      selectedUnit.rentPrice != null &&
      fpPrimaryRent < selectedUnit.rentPrice
    : selectedFloorPlan
      ? floorPlanHasEffectiveDiscount(selectedFloorPlan, floorPlanConcession)
      : false;
  const fpBedrooms = selectedUnit?.bedrooms ?? selectedFloorPlan?.bedrooms ?? null;
  const fpBathrooms = selectedUnit?.bathrooms ?? selectedFloorPlan?.bathrooms ?? null;
  const fpSqftLabel = selectedUnit
    ? selectedUnit.sqft != null
      ? `${selectedUnit.sqft.toLocaleString()} sqft`
      : null
    : selectedFloorPlan
      ? formatSqftRange(selectedFloorPlan.sqftMin, selectedFloorPlan.sqftMax)
      : null;
  const displayPrimaryRent = hasActiveSelection ? fpPrimaryRent : primaryRent;
  const displayBedroomLabel = hasActiveSelection
    ? formatBedrooms(fpBedrooms)
    : bedroomLabel;

  // Listing-level bath/sqft are ranges across floor plans — a single value is
  // misleading when the property spans several plans (e.g. Studio–2 bd).
  const fpBathValues: number[] = [];
  const fpSqftValues: number[] = [];
  for (const entry of floorPlanEntries) {
    const { bathrooms, sqftMin, sqftMax } = entry.type;
    if (bathrooms != null && bathrooms > 0) {
      fpBathValues.push(bathrooms);
    }
    for (const sqft of [sqftMin, sqftMax]) {
      if (sqft != null && sqft > 0) fpSqftValues.push(sqft);
    }
  }
  const listingBathLabel = fpBathValues.length
    ? (() => {
        const min = Math.min(...fpBathValues);
        const max = Math.max(...fpBathValues);
        return min === max ? formatBathrooms(min) : `${min}–${max} ba`;
      })()
    : listing.bathrooms != null && listing.bathrooms > 0
      ? formatBathrooms(listing.bathrooms)
      : null;
  const listingSqftLabel = fpSqftValues.length
    ? formatSqftRange(Math.min(...fpSqftValues), Math.max(...fpSqftValues))
    : formatSqftRange(listing.squareFeet, listing.squareFeet);

  const displaySpecSegments = (
    hasActiveSelection
      ? [
          displayBedroomLabel,
          fpBathrooms != null && fpBathrooms > 0
            ? formatBathrooms(fpBathrooms)
            : null,
          fpSqftLabel,
        ]
      : [displayBedroomLabel, listingBathLabel, listingSqftLabel]
  ).filter((value): value is string => !!value);

  const splitBedroomCount = hasActiveSelection ? fpBedrooms : listing.bedrooms;
  const displayCanSplit = canSplitByRoommates(splitBedroomCount);
  const displaySplitSize = clampRoommateSplitSize(displayHouseholdSize, splitBedroomCount);
  const displayHasRoommateSplit = hasActiveSelection
    ? displayCanSplit && displaySplitSize > 1
    : hasRoommateSplit;
  const displayPerPersonRent = hasActiveSelection
    ? displayCanSplit && displayPrimaryRent != null
      ? Math.round(displayPrimaryRent / displaySplitSize)
      : null
    : primaryRent;
  const displayGrossPerPersonRent =
    displayHasRoommateSplit
      ? hasActiveSelection
        ? fpPrimaryGrossRent != null &&
          displayPrimaryRent != null &&
          displayPrimaryRent < fpPrimaryGrossRent
          ? Math.round(fpPrimaryGrossRent / displaySplitSize)
          : null
        : listing.monthlyRent != null
          ? Math.round(listing.monthlyRent / displaySplitSize)
          : null
      : null;
  const selectionLabel = selectedUnit
    ? `Unit ${selectedUnit.name} · ${selectedFloorPlan?.name ?? ""}`.trim()
    : selectedFloorPlan?.name ?? null;

  const unitAmenities =
    listing.enriched?.unitAmenities && listing.enriched.unitAmenities.length > 0
      ? listing.enriched.unitAmenities
      : [];
  const communityAmenities =
    listing.enriched?.communityAmenities && listing.enriched.communityAmenities.length > 0
      ? listing.enriched.communityAmenities
      : [];
  const otherAmenities = listing.enriched?.otherAmenities ?? [];
  const fallbackAmenities =
    unitAmenities.length === 0 && communityAmenities.length === 0 ? listing.amenities : [];
  const unitAmenitiesFinal = unitAmenities.length > 0 ? unitAmenities : fallbackAmenities;
  const communityAmenitiesFinal = communityAmenities;

  const videoTour = listing.enriched?.videoTours?.[0]?.url ?? null;
  const parking = listing.enriched?.parking ?? [];
  const agent = listing.enriched?.agent ?? null;
  const brokerage = listing.enriched?.brokerage ?? null;
  const mlsId = listing.enriched?.mlsId ?? null;
  const source = sourceLabel(listing.source);
  const isPreLeasing = listing.availableAt
    ? new Date(listing.availableAt).getTime() > openedAt
    : false;
  const noGroup = listing.formingGroups.length === 0;
  const viewerHasGroupOnListing = listing.formingGroups.some(
    (group) =>
      group.viewerMembershipStatus === "member" ||
      group.viewerMembershipStatus === "requested",
  );
  const hasFees =
    parking.length > 0 ||
    (listing.enriched?.petPolicies.length ?? 0) > 0 ||
    listing.enriched?.applicationFee != null ||
    listing.leaseTerms.length > 0;
  const hasListedBy =
    !!listing.enriched?.managementCompany ||
    !!agent ||
    !!brokerage ||
    !!listing.enriched?.phone ||
    !!listing.enriched?.email ||
    (listing.enriched?.leasingOfficeSchedules.length ?? 0) > 0;

  return {
    agent,
    bedroomLabel,
    brokerage,
    canShowSummaryGroupAction,
    communityAmenitiesFinal,
    displayBedroomLabel,
    displayGrossPerPersonRent,
    displayHasRoommateSplit,
    displayPerPersonRent,
    displayPrimaryRent,
    displaySplitSize,
    displaySpecSegments,
    floorPlanConcession,
    floorPlanEntries,
    floorPlansExpanded,
    fpHasEffective,
    fpPrimaryGrossRent,
    fpRentRange,
    groupsModalEntry,
    hasActiveSelection,
    hasEffective,
    hasFees,
    hasListedBy,
    hasRoommateSplit,
    isPreLeasing,
    mlsId,
    noGroup,
    otherAmenities,
    parking,
    primaryRent,
    selectedFloorPlan,
    selectedKey,
    selectedUnit,
    selectedUnitName,
    selectionLabel,
    source,
    unitAmenitiesFinal,
    usesFloorPlanRent,
    videoTour,
    viewerHasGroupOnListing,
    wholeUnitPlan,
  };
}

export function PropertyDetailModal({
  listing,
  enrichedLoading = false,
  onClose,
  onListingUpdated,
  roommatesOverride,
  activeProfile,
}: Props) {
  const [modalState, updateModalState] = useReducer(
    propertyDetailModalReducer,
    undefined,
    createInitialPropertyDetailModalState,
  );
  const {
    descriptionExpanded,
    floorPlansExpanded,
    groupPrefsTarget,
    groupsModalKey,
    lightbox,
    openedAt,
    photoIndex,
    selectedFloorPlanSelection,
    show,
  } = modalState;
  const { savedListingIds, toggleSavedListing } = useSavedListings();
  const saved = savedListingIds.has(listing.id);
  const setShow = (show: boolean) => updateModalState({ show });
  const setPhotoIndex = (action: SetStateAction<number>) =>
    updateModalState((state) => ({
      photoIndex: resolveStateAction(state.photoIndex, action),
    }));
  const setLightbox = (lightbox: boolean) => updateModalState({ lightbox });
  const setDescriptionExpanded = (action: SetStateAction<boolean>) =>
    updateModalState((state) => ({
      descriptionExpanded: resolveStateAction(state.descriptionExpanded, action),
    }));
  const setFloorPlansExpanded = (action: SetStateAction<boolean>) =>
    updateModalState((state) => ({
      floorPlansExpanded: resolveStateAction(state.floorPlansExpanded, action),
    }));
  const setSelectedFloorPlanSelection = (
    action: SetStateAction<FloorPlanSelection | null>,
  ) =>
    updateModalState((state) => ({
      selectedFloorPlanSelection: resolveStateAction(
        state.selectedFloorPlanSelection,
        action,
      ),
    }));
  const setGroupsModalKey = (groupsModalKey: string | null) =>
    updateModalState({ groupsModalKey });
  const setGroupPrefsTarget = (groupPrefsTarget: GroupPrefsTarget | null) =>
    updateModalState({ groupPrefsTarget });
  const photos = useMemo(() => listing.photoUrls, [listing.photoUrls]);
  const showEnrichedSkeletons = enrichedLoading && listing.enriched == null;
  const handleListingUpdated = useCallback(
    (updatedListing: ApartmentListing) => {
      onListingUpdated?.(updatedListing);
    },
    [onListingUpdated],
  );
  const {
    error: groupActionError,
    pendingAction,
    membershipFor,
    requestJoinGroup,
    startGroup,
    leaveGroup,
  } = useUserGroups({
    listingId: listing.id,
    onListingUpdated: handleListingUpdated,
  });
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const id = requestAnimationFrame(() => setShow(true));
    return () => {
      cancelAnimationFrame(id);
      document.body.style.overflow = original;
    };
  }, []);

  const handleClose = useCallback(() => {
    setShow(false);
    window.setTimeout(onClose, 180);
  }, [onClose]);

  useEffect(() => {
    function handleKey(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        // The nested groups/preferences modals own Escape while open (their
        // own window listeners close them); closing the whole property view
        // underneath would lose the user's place.
        if (groupsModalKey || groupPrefsTarget) return;
        event.preventDefault();
        if (lightbox) updateModalState({ lightbox: false });
        else handleClose();
      }
      if (lightbox && photos.length > 0) {
        if (event.key === "ArrowLeft")
          updateModalState((state) => ({
            photoIndex: (state.photoIndex - 1 + photos.length) % photos.length,
          }));
        if (event.key === "ArrowRight")
          updateModalState((state) => ({
            photoIndex: (state.photoIndex + 1) % photos.length,
          }));
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [groupPrefsTarget, groupsModalKey, handleClose, lightbox, photos.length]);

  const goPrev = () => {
    if (photos.length === 0) return;
    setPhotoIndex((i) => (i - 1 + photos.length) % photos.length);
  };
  const goNext = () => {
    if (photos.length === 0) return;
    setPhotoIndex((i) => (i + 1) % photos.length);
  };
  const openLightbox = (index = 0) => {
    if (photos.length === 0) return;
    setPhotoIndex(index);
    setLightbox(true);
  };

  const toggleFloorPlanSelection = useCallback(
    (key: string, unitName: string | null) => {
      setSelectedFloorPlanSelection((prev) =>
        prev?.listingId === listing.id &&
        prev?.key === key &&
        prev?.unitName === unitName
          ? null
          : { listingId: listing.id, key, unitName },
      );
    },
    [listing.id],
  );

  const clearSelectedFloorPlan = useCallback(() => {
    setSelectedFloorPlanSelection(null);
  }, []);

  // Starting a group routes through the preferences modal first; the group
  // is only created once the user submits (or skips) those preferences.
  const beginStartGroup = useCallback((plan: FloorPlanType, groupsKey: string) => {
    setGroupPrefsTarget({ plan, groupsKey });
  }, []);

  const detail = usePropertyDetailDerivedModel({
    floorPlansExpanded,
    groupsModalKey,
    listing,
    openedAt,
    roommatesOverride,
    selectedFloorPlanSelection,
  });
  if (typeof document === "undefined") return null;

  // Whole-unit group state for the right-rail summary action.
  const wholeUnitMembership = detail.wholeUnitPlan
    ? membershipFor(detail.wholeUnitPlan)
    : null;
  const wholeUnitMembershipStatus = wholeUnitMembership?.status ?? null;
  const wholeUnitGroupLabel = wholeUnitGroupActionLabel({
    hasFormingGroups: (detail.wholeUnitPlan?.groups.length ?? 0) > 0,
    viewerMembershipStatus: wholeUnitMembershipStatus,
  });

  return createPortal(
    <dialog
      open
      aria-modal="true"
      aria-labelledby="property-modal-title"
      className={[
        "fixed inset-0 z-[60] m-0 flex h-screen w-screen max-h-none max-w-none items-center justify-center border-0 bg-transparent p-0 px-2 py-2 sm:px-4 sm:py-6",
        "transition-opacity duration-200",
        show ? "opacity-100" : "opacity-0",
      ].join(" ")}
    >
      <button
        type="button"
        onClick={handleClose}
        aria-hidden="true"
        tabIndex={-1}
        className="absolute inset-0 -z-10 bg-[rgba(14,31,23,0.55)] backdrop-blur-[6px]"
      />

      <PropertyDetailPanel
        descriptionExpanded={descriptionExpanded}
        detail={detail}
        groupActionError={groupActionError}
        listing={listing}
        photos={photos}
        saved={saved}
        activeProfile={activeProfile}
        roommatesOverride={roommatesOverride}
        scrollContainerRef={scrollContainerRef}
        show={show}
        showEnrichedSkeletons={showEnrichedSkeletons}
        wholeUnitGroupLabel={wholeUnitGroupLabel}
        wholeUnitMembership={wholeUnitMembership}
        onClearSelectedFloorPlan={clearSelectedFloorPlan}
        onClose={handleClose}
        onOpenGroups={setGroupsModalKey}
        onOpenLightbox={openLightbox}
        onOpenWholeUnitGroups={() => setGroupsModalKey(WHOLE_UNIT_GROUP_KEY)}
        onStartGroup={beginStartGroup}
        onStartWholeUnitGroup={() => {
          if (detail.wholeUnitPlan) {
            beginStartGroup(detail.wholeUnitPlan, WHOLE_UNIT_GROUP_KEY);
          }
        }}
        onToggleDescription={() => setDescriptionExpanded((current) => !current)}
        onToggleFloorPlanSelection={toggleFloorPlanSelection}
        onToggleFloorPlans={() => setFloorPlansExpanded((current) => !current)}
        onToggleSaved={() => toggleSavedListing(listing.id)}
      />

      <PropertyLightbox
        isOpen={lightbox}
        photoIndex={photoIndex}
        photos={photos}
        onClose={() => setLightbox(false)}
        onNext={goNext}
        onPrev={goPrev}
      />

      {detail.groupsModalEntry ? (
        <FloorPlanGroupsModal
          actionError={groupActionError}
          floorPlan={detail.groupsModalEntry.type}
          userGroupId={membershipFor(detail.groupsModalEntry.type)?.groupId ?? null}
          userStatus={membershipFor(detail.groupsModalEntry.type)?.status ?? null}
          canStartGroup={!detail.viewerHasGroupOnListing}
          onClose={() => setGroupsModalKey(null)}
          onRequestJoin={(groupId) => void requestJoinGroup(groupId)}
          onLeave={() => {
            const membership = membershipFor(detail.groupsModalEntry!.type);
            if (membership) void leaveGroup(membership.groupId);
          }}
          onStartGroup={() => {
            beginStartGroup(detail.groupsModalEntry!.type, detail.groupsModalEntry!.key);
          }}
          pendingAction={pendingAction}
        />
      ) : null}

      {groupPrefsTarget ? (
        <GroupPreferencesModal
          planName={groupPrefsTarget.plan.name}
          onClose={() => setGroupPrefsTarget(null)}
          onSubmit={async (preferences) => {
            await startGroup(
              groupPrefsTarget.plan,
              groupPrefsTarget.groupsKey,
              preferences,
            );
            setGroupsModalKey(groupPrefsTarget.groupsKey);
            setGroupPrefsTarget(null);
          }}
        />
      ) : null}
    </dialog>,
    document.body,
  );
}

type PropertyDetailPanelProps = {
  descriptionExpanded: boolean;
  detail: PropertyDetailDerivedModel;
  groupActionError: string | null;
  listing: ApartmentListing;
  photos: string[];
  saved: boolean;
  activeProfile?: ApartmentSearchSnapshot["activeProfile"];
  roommatesOverride?: number | null;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  show: boolean;
  showEnrichedSkeletons: boolean;
  wholeUnitGroupLabel: string;
  wholeUnitMembership: ReturnType<ReturnType<typeof useUserGroups>["membershipFor"]>;
  onClearSelectedFloorPlan: () => void;
  onClose: () => void;
  onOpenGroups: (key: string | null) => void;
  onOpenLightbox: (index?: number) => void;
  onOpenWholeUnitGroups: () => void;
  onStartGroup: (plan: FloorPlanType, groupsKey: string) => void;
  onStartWholeUnitGroup: () => void;
  onToggleDescription: () => void;
  onToggleFloorPlanSelection: (key: string, unitName: string | null) => void;
  onToggleFloorPlans: () => void;
  onToggleSaved: () => void;
};

function PropertyDetailPanel({
  descriptionExpanded,
  detail,
  groupActionError,
  listing,
  photos,
  saved,
  activeProfile,
  roommatesOverride,
  scrollContainerRef,
  show,
  showEnrichedSkeletons,
  wholeUnitGroupLabel,
  wholeUnitMembership,
  onClearSelectedFloorPlan,
  onClose,
  onOpenGroups,
  onOpenLightbox,
  onOpenWholeUnitGroups,
  onStartGroup,
  onStartWholeUnitGroup,
  onToggleDescription,
  onToggleFloorPlanSelection,
  onToggleFloorPlans,
  onToggleSaved,
}: PropertyDetailPanelProps) {
  return (
    <div
      className={[
        "relative flex h-full w-full max-w-[1180px] flex-col overflow-hidden rounded-2xl bg-white text-[var(--ink-900)] shadow-[0_40px_120px_-30px_rgba(8,18,12,0.6)]",
        "transition-all duration-200",
        show ? "translate-y-0 scale-100" : "translate-y-2 scale-[0.985]",
      ].join(" ")}
    >
      <PropertyModalHeader
        detail={detail}
        listing={listing}
        saved={saved}
        activeProfile={activeProfile}
        roommatesOverride={roommatesOverride}
        onClose={onClose}
        onToggleSaved={onToggleSaved}
      />

      {groupActionError ? (
        <p
          role="alert"
          className="border-b border-[rgba(199,139,62,0.28)] bg-[rgba(199,139,62,0.12)] px-4 py-2 text-sm font-semibold text-[var(--ink-800)] sm:px-6"
        >
          {groupActionError}
        </p>
      ) : null}

      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
        <PropertyGallery
          detail={detail}
          photos={photos}
          onOpenLightbox={onOpenLightbox}
        />
        <PropertyHeadline
          detail={detail}
          listing={listing}
          wholeUnitMembership={wholeUnitMembership}
          onOpenWholeUnitGroups={onOpenWholeUnitGroups}
        />
        <section className="mx-auto grid w-full max-w-[1140px] gap-10 px-4 py-8 sm:px-8 lg:grid-cols-[1.5fr_1fr] lg:gap-12">
          <PropertyMainColumn
            detail={detail}
            descriptionExpanded={descriptionExpanded}
            listing={listing}
            showEnrichedSkeletons={showEnrichedSkeletons}
            onOpenGroups={onOpenGroups}
            onStartGroup={onStartGroup}
            onToggleDescription={onToggleDescription}
            onToggleFloorPlanSelection={onToggleFloorPlanSelection}
            onToggleFloorPlans={onToggleFloorPlans}
          />
          <PropertySummaryRail
            detail={detail}
            listing={listing}
            wholeUnitGroupLabel={wholeUnitGroupLabel}
            wholeUnitMembership={wholeUnitMembership}
            onClearSelectedFloorPlan={onClearSelectedFloorPlan}
            onOpenWholeUnitGroups={onOpenWholeUnitGroups}
            onStartWholeUnitGroup={onStartWholeUnitGroup}
          />
        </section>
      </div>
    </div>
  );
}

type PropertyDetailDerivedModel = ReturnType<typeof usePropertyDetailDerivedModel>;

function PropertyModalHeader({
  detail,
  listing,
  saved,
  activeProfile,
  roommatesOverride,
  onClose,
  onToggleSaved,
}: {
  detail: PropertyDetailDerivedModel;
  listing: ApartmentListing;
  saved: boolean;
  activeProfile?: ApartmentSearchSnapshot["activeProfile"];
  roommatesOverride?: number | null;
  onClose: () => void;
  onToggleSaved: () => void;
}) {
  // When we have the active profile, recompute the fit as an itemized
  // breakdown so the pill number and the tooltip rows always agree. Fall back
  // to the persisted score (no breakdown) when the profile isn't available.
  const breakdown = useMemo(
    () =>
      activeProfile
        ? apartmentListingSurfaceFitBreakdown({
            listing,
            profile: activeProfile,
            roommatesOverride: roommatesOverride ?? null,
          })
        : null,
    [activeProfile, listing, roommatesOverride],
  );
  const fit = breakdown ? breakdown.total : Math.round(listing.fitScore);
  return (
    <header className="relative z-30 flex shrink-0 items-center gap-3 border-b border-[var(--border)] bg-white/90 px-4 py-3 backdrop-blur sm:px-6">
      <div className="min-w-0 flex-1">
        <h2
          id="property-modal-title"
          className="truncate text-[17px] font-semibold tracking-[-0.01em] sm:text-lg"
        >
          {listing.address}
          {listing.unit ? (
            <span className="text-[var(--ink-500)]"> · {listing.unit}</span>
          ) : null}
        </h2>
        <p className="truncate text-[12.5px] text-[var(--ink-500)]">
          {listing.neighborhood}
          {listing.city && listing.neighborhood !== listing.city
            ? ` · ${listing.city}, ${listing.state}`
            : ""}
          {listing.postalCode ? ` ${listing.postalCode}` : ""}
        </p>
      </div>
      <div className="group relative hidden shrink-0 sm:block">
        <button
          type="button"
          className="kin-focus inline-flex cursor-help items-center gap-2.5 rounded-full border border-[var(--border-strong)] bg-white py-1.5 pl-2.5 pr-3 transition hover:border-[var(--forest-600)]"
          aria-describedby="property-fit-breakdown"
        >
          <span
            className="h-1.5 w-[46px] overflow-hidden rounded-full bg-[var(--bg-soft)]"
            aria-hidden="true"
          >
            <span
              className="block h-full rounded-full bg-[linear-gradient(90deg,var(--mint-400),var(--forest-600))]"
              style={{ width: `${Math.max(6, Math.min(100, fit))}%` }}
            />
          </span>
          <b className="text-[13px] font-bold text-[var(--forest-700)]">{fit}% fit</b>
        </button>
        <FitBreakdownTooltip fit={fit} breakdown={breakdown} />
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <IconBtn
          label="Share"
          onClick={() => {
            if (navigator.share) {
              navigator
                .share({
                  title: listing.address,
                  text: `${listing.address} — ${formatMaybeMoney(detail.primaryRent)}${
                    detail.primaryRent != null ? "/mo" : ""
                  }${detail.hasRoommateSplit ? " each" : ""} on Kinfolk`,
                })
                .catch(() => {});
            }
          }}
        >
          <Share2 size={15} aria-hidden="true" />
        </IconBtn>
        <IconBtn label={saved ? "Saved" : "Save"} pressed={saved} onClick={onToggleSaved}>
          <Heart
            size={15}
            aria-hidden="true"
            fill={saved ? "var(--rust)" : "none"}
            color={saved ? "var(--rust)" : "currentColor"}
          />
        </IconBtn>
        <IconBtn label="Close" onClick={onClose}>
          <X size={15} aria-hidden="true" />
        </IconBtn>
      </div>
    </header>
  );
}

function FitBreakdownTooltip({
  fit,
  breakdown,
}: {
  fit: number;
  breakdown: FitBreakdown | null;
}) {
  return (
    <div
      id="property-fit-breakdown"
      role="tooltip"
      className="pointer-events-none absolute right-0 top-[calc(100%+8px)] z-40 w-72 translate-y-1.5 rounded-2xl border border-[var(--border-strong)] bg-white p-4 text-left opacity-0 shadow-[0_26px_52px_-22px_rgba(14,31,23,0.45)] transition duration-200 group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:translate-y-0 group-focus-within:opacity-100"
    >
      <p className="text-xs font-semibold text-[var(--ink-500)]">
        How we get {fit}% fit
      </p>
      {breakdown ? (
        <>
          <dl className="mt-2.5">
            {breakdown.rows.map((row) => (
              <div
                key={row.key}
                className="flex items-center justify-between gap-4 py-1 text-[13px]"
              >
                <dt className="text-[var(--ink-600)]">{row.label}</dt>
                <dd
                  className={[
                    "tnum font-semibold",
                    row.key === "base"
                      ? "text-[var(--ink-700)]"
                      : row.points > 0
                        ? "text-[var(--forest-700)]"
                        : row.points < 0
                          ? "text-[var(--rust)]"
                          : "text-[var(--ink-400)]",
                  ].join(" ")}
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {row.key === "base"
                    ? row.points
                    : row.points > 0
                      ? `+${row.points}`
                      : row.points}
                </dd>
              </div>
            ))}
            <div className="mt-1 flex items-center justify-between gap-4 border-t border-[var(--border-strong)] pt-2 text-[13px]">
              <dt className="font-semibold text-[var(--ink-900)]">
                Fit score{breakdown.total !== breakdown.raw ? " (capped)" : ""}
              </dt>
              <dd
                className="tnum text-[15px] font-bold text-[var(--forest-700)]"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {breakdown.total}%
              </dd>
            </div>
          </dl>
          <p className="mt-2.5 text-[12px] leading-snug text-[var(--ink-500)]">
            Scored against your saved budget, neighborhoods, and must-haves.
            Scores are capped at 50–96%.
          </p>
        </>
      ) : (
        <p className="mt-2 text-[13px] leading-snug text-[var(--ink-600)]">
          Scored against your saved budget, neighborhoods, and must-haves.
        </p>
      )}
    </div>
  );
}

function PropertyGallery({
  detail,
  photos,
  onOpenLightbox,
}: {
  detail: PropertyDetailDerivedModel;
  photos: string[];
  onOpenLightbox: (index?: number) => void;
}) {
  // On phones the hero is the whole gallery, so it swipes through the photos
  // in place; tapping still opens the lightbox at the photo being viewed. A
  // drag that navigated must not also count as the tap.
  const [heroIndex, setHeroIndex] = useState(0);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const suppressTap = useRef(false);
  const heroPhotoIndex = Math.min(heroIndex, Math.max(0, photos.length - 1));
  const handleTouchStart = (event: React.TouchEvent) => {
    const touch = event.touches[0];
    touchStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
    suppressTap.current = false;
  };
  const handleTouchEnd = (event: React.TouchEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    const touch = event.changedTouches[0];
    if (!start || !touch || photos.length < 2) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    suppressTap.current = true;
    setHeroIndex((index) =>
      dx < 0
        ? (index + 1) % photos.length
        : (index - 1 + photos.length) % photos.length,
    );
  };
  // Corners are rounded per tile instead of clipping the whole grid — an
  // overflow-hidden grid swallows the tiles' focus outlines (below sm the
  // hero fills the grid and would lose its outline entirely).
  const thumbSlots = Array.from(
    { length: 4 },
    (_, i) => photos[i + 1] ?? null,
  );
  const thumbCorner = ["", "sm:rounded-tr-2xl", "", "sm:rounded-br-2xl"];
  const heroCorner =
    "overflow-hidden rounded-2xl sm:rounded-none sm:rounded-l-2xl";
  return (
    <section className="relative mx-auto w-full max-w-[1140px] px-4 pt-4 sm:px-8 sm:pt-6">
      <div
        className="grid w-full gap-2 sm:grid-cols-4"
        style={{ aspectRatio: "16 / 8" }}
      >
        {photos[heroPhotoIndex] ? (
          <button
            type="button"
            onClick={() => {
              if (suppressTap.current) {
                suppressTap.current = false;
                return;
              }
              onOpenLightbox(heroPhotoIndex);
            }}
            aria-label={`Open photo gallery (${photos.length} photo${photos.length === 1 ? "" : "s"})`}
            className={`kin-focus group relative sm:col-span-2 sm:row-span-2 ${heroCorner}`}
            style={{ touchAction: "pan-y" }}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          >
            <Image
              key={photos[heroPhotoIndex]}
              src={photos[heroPhotoIndex]}
              alt=""
              fill
              priority
              sizes="(max-width: 640px) 100vw, 50vw"
              className="object-cover transition-transform duration-300 group-hover:scale-[1.01]"
            />
          </button>
        ) : (
          <div
            className={`relative flex items-center justify-center bg-[var(--surface-soft)] text-[var(--ink-400)] sm:col-span-2 sm:row-span-2 ${heroCorner}`}
          >
            <ImageOff size={34} aria-hidden="true" />
          </div>
        )}

        {thumbSlots.map((url, i) =>
          url ? (
            <button
              key={`thumb-${url}`}
              type="button"
              onClick={() => onOpenLightbox(i + 1)}
              className={`kin-focus relative hidden overflow-hidden sm:block ${thumbCorner[i]}`}
              aria-label={`Open photo ${i + 2}`}
            >
              <Image
                src={url}
                alt=""
                fill
                sizes="25vw"
                className="object-cover transition-transform duration-300 hover:scale-[1.03]"
              />
            </button>
          ) : (
            <div
              key={`empty-${i}`}
              className={`relative hidden bg-[var(--bg-soft)] sm:block ${thumbCorner[i]}`}
              aria-hidden="true"
            />
          ),
        )}
      </div>

      <div className="pointer-events-none absolute left-7 top-7 z-10 flex flex-wrap items-center gap-2 sm:left-11 sm:top-9">
        {detail.isPreLeasing ? (
          <span className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-1 text-[12px] font-semibold text-[var(--forest-800)] shadow-sm">
            <span className="size-1.5 rounded-full bg-[var(--forest-700)]" aria-hidden="true" />
            Pre-leasing
          </span>
        ) : null}
        {detail.videoTour ? (
          <a
            href={detail.videoTour}
            target="_blank"
            rel="noreferrer"
            className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full bg-[rgba(15,26,20,0.85)] px-3 py-1 text-[12px] font-semibold text-white transition hover:bg-[rgba(15,26,20,1)]"
          >
            <PlayCircle size={13} aria-hidden="true" />
            Video tour
          </a>
        ) : null}
      </div>

      {photos.length > 1 ? (
        <button
          type="button"
          onClick={() => onOpenLightbox(0)}
          className="kin-focus absolute bottom-3 right-7 z-10 hidden items-center gap-2 rounded-lg border border-[var(--ink-900)] bg-white px-3.5 py-2 text-[13px] font-semibold text-[var(--ink-900)] shadow-sm transition hover:bg-[var(--bg-soft)] sm:right-11 sm:bottom-4 sm:inline-flex"
        >
          <LayoutGrid size={14} aria-hidden="true" />
          Show all {photos.length} photos
        </button>
      ) : null}

      {photos.length > 0 ? (
        <span className="pointer-events-none absolute bottom-3 right-7 z-10 rounded-full bg-[rgba(15,26,20,0.7)] px-3 py-1.5 text-[11.5px] font-medium text-white sm:hidden">
          {photos.length === 1 ? (
            <>
              <span className="mono">1</span> photo
            </>
          ) : (
            <span className="mono">
              {heroPhotoIndex + 1} / {photos.length}
            </span>
          )}
        </span>
      ) : null}
    </section>
  );
}

type BreakdownRow = {
  label: string;
  value: string;
  kind?: "neg" | "sub" | "total";
};

// Per-person rent is the hero. The supporting math (listed → concession →
// split → your share) collapses into a hover/focus popover so the headline
// stays minimal. Mirrors the rail's gross-vs-effective logic so the two
// surfaces can never disagree.
function buildHeadlineRent(
  detail: PropertyDetailDerivedModel,
  listing: ApartmentListing,
) {
  const split = detail.displayHasRoommateSplit;
  const perPerson = detail.displayPerPersonRent;
  const splitSize = detail.displaySplitSize;
  const heroValue = split ? perPerson : detail.displayPrimaryRent;
  const heroSuffix = heroValue == null ? null : split ? "/ mo each" : "/ mo";

  // Effective + gross are unit/group TOTALS, never per-person. For a whole-unit
  // splittable listing, displayPrimaryRent is already the per-person figure, so
  // the total comes from the listing's effective/gross monthly rent instead.
  let effectiveTotal: number | null;
  let grossTotal: number | null;
  let hasEff: boolean;
  if (detail.hasActiveSelection) {
    effectiveTotal = detail.displayPrimaryRent;
    grossTotal = detail.fpPrimaryGrossRent;
    hasEff = detail.fpHasEffective;
  } else if (detail.usesFloorPlanRent) {
    effectiveTotal = detail.displayPrimaryRent;
    grossTotal = listing.unitRentMin ?? listing.monthlyRent;
    hasEff = detail.hasEffective;
  } else {
    effectiveTotal = listing.effectiveMonthlyRent ?? listing.monthlyRent;
    grossTotal = listing.monthlyRent;
    hasEff = detail.hasEffective;
  }

  const realDiscount =
    hasEff &&
    grossTotal != null &&
    effectiveTotal != null &&
    grossTotal > effectiveTotal;
  const showBreakdown =
    realDiscount || (split && perPerson != null && effectiveTotal != null);

  if (!showBreakdown) {
    return { heroValue, heroSuffix, breakdown: null as null | {
      title: string;
      rows: BreakdownRow[];
    }, triggerLabel: null as string | null };
  }

  const rows: BreakdownRow[] = [];
  if (realDiscount) {
    rows.push({ label: "Listed rent", value: `${formatCurrency(grossTotal!)}/mo` });
    rows.push({
      label:
        listing.concessionMonths > 0
          ? formatConcession(listing.concessionMonths, "long")
          : "Discount applied",
      value: `−${formatCurrency(grossTotal! - effectiveTotal!)}/mo`,
      kind: "neg",
    });
    rows.push({
      label: "Effective rent",
      value: `${formatCurrency(effectiveTotal!)}/mo`,
      kind: "sub",
    });
  } else if (split && effectiveTotal != null) {
    rows.push({ label: "Monthly rent", value: `${formatCurrency(effectiveTotal)}/mo` });
  }
  if (split && perPerson != null) {
    rows.push({ label: "Split across the group", value: `÷ ${splitSize}` });
    rows.push({ label: "Your share", value: `${formatCurrency(perPerson)}/mo`, kind: "total" });
  }

  const triggerLabel = hasEff
    ? split
      ? "Effective per-person rate"
      : "Effective rate"
    : "Per-person rate";
  const title =
    split && perPerson != null
      ? `How your ${formatCurrency(perPerson)} share is calculated`
      : "How this rate is calculated";

  return { heroValue, heroSuffix, breakdown: { title, rows }, triggerLabel };
}

function PropertyHeadline({
  detail,
  listing,
  wholeUnitMembership,
  onOpenWholeUnitGroups,
}: {
  detail: PropertyDetailDerivedModel;
  listing: ApartmentListing;
  wholeUnitMembership: ReturnType<ReturnType<typeof useUserGroups>["membershipFor"]>;
  onOpenWholeUnitGroups: () => void;
}) {
  const { heroValue, heroSuffix, breakdown, triggerLabel } = buildHeadlineRent(
    detail,
    listing,
  );
  const formingGroup =
    detail.canShowSummaryGroupAction &&
    detail.wholeUnitPlan &&
    detail.wholeUnitPlan.groups.length > 0
      ? detail.wholeUnitPlan.groups[0]!
      : null;

  return (
    // Same width shell as the gallery and body columns so the price lines up
    // with the photo edge on wide viewports.
    <div className="mx-auto grid w-full max-w-[1140px] grid-cols-1 items-center gap-6 border-b border-[var(--border)] px-4 py-7 sm:px-8 md:grid-cols-[1fr_auto] md:gap-8">
      <div className="relative min-w-0">
        <p
          className="serif text-[36px] font-semibold leading-none tracking-[-0.02em] text-[var(--ink-900)] sm:text-[44px]"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {formatMaybeMoney(heroValue)}
          {heroSuffix ? (
            <span className="ml-1 font-sans text-lg font-medium text-[var(--ink-500)] sm:text-xl">
              {heroSuffix}
            </span>
          ) : null}
        </p>
        {detail.displaySpecSegments.length > 0 ? (
          <p
            className="mt-2.5 text-[14px] font-medium text-[var(--ink-600)]"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            <span className="font-semibold text-[var(--ink-900)]">
              {detail.displaySpecSegments[0]}
            </span>
            {detail.displaySpecSegments.slice(1).map((segment) => (
              <span key={segment}>
                <span className="mx-2 text-[var(--ink-400)]">·</span>
                {segment}
              </span>
            ))}
          </p>
        ) : null}
        {breakdown ? (
          <div className="group relative mt-2.5 inline-block">
            <button
              type="button"
              className="kin-focus inline-flex cursor-help items-center gap-1.5 py-2.5 -my-2.5 text-[13.5px] font-medium text-[var(--ink-500)] transition hover:text-[var(--ink-700)]"
              aria-describedby="property-rent-breakdown"
            >
              <span className="border-b border-dotted border-[var(--ink-400)]">
                {triggerLabel}
              </span>
              <Info size={14} aria-hidden="true" className="opacity-70" />
            </button>
            <div
              id="property-rent-breakdown"
              role="tooltip"
              className="pointer-events-none absolute left-0 top-[calc(100%+8px)] z-40 w-72 translate-y-1.5 rounded-2xl border border-[var(--border-strong)] bg-white p-4 opacity-0 shadow-[0_26px_52px_-22px_rgba(14,31,23,0.45)] transition duration-200 group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:translate-y-0 group-focus-within:opacity-100"
            >
              <p className="text-xs font-semibold text-[var(--ink-500)]">{breakdown.title}</p>
              <dl className="mt-2.5">
                {breakdown.rows.map((row) => (
                  <div
                    key={row.label}
                    className={[
                      "flex items-center justify-between gap-4 py-1.5 text-[13.5px]",
                      row.kind === "sub"
                        ? "mt-0.5 border-t border-[var(--border)] pt-2.5"
                        : "",
                      row.kind === "total"
                        ? "mt-0.5 border-t border-[var(--border-strong)] pt-2.5"
                        : "",
                    ].join(" ")}
                  >
                    <dt className="text-[var(--ink-600)]">{row.label}</dt>
                    <dd
                      className={[
                        "tnum font-semibold text-[var(--ink-900)]",
                        row.kind === "neg" ? "text-[var(--forest-700)]" : "",
                        row.kind === "total" ? "text-[15px]" : "",
                      ].join(" ")}
                      style={{ fontVariantNumeric: "tabular-nums" }}
                    >
                      {row.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        ) : detail.isPreLeasing ? (
          <p className="mt-2 text-[13.5px] font-medium text-[var(--forest-700)]">Pre-leasing</p>
        ) : null}
      </div>

      {formingGroup ? (
        <button
          type="button"
          onClick={onOpenWholeUnitGroups}
          className="kin-focus flex items-center gap-4 rounded-2xl border border-[var(--border-strong)] bg-white p-4 text-left transition hover:bg-[var(--bg-soft)] md:max-w-[360px]"
        >
          <span className="flex shrink-0">
            {formingGroup.members.slice(0, 3).map((member, index) => (
              <span
                key={roommateGroupMemberKey(member)}
                className={index === 0 ? "" : "-ml-2"}
              >
                <MemberAvatar member={member} />
              </span>
            ))}
          </span>
          <span className="min-w-0 text-[13.5px] leading-snug text-[var(--ink-700)]">
            <span className="font-semibold text-[var(--ink-900)]">
              {formingGroup.members.slice(0, 2).map((m) => m.name).join(" & ") || "A group"}
            </span>{" "}
            {wholeUnitGroupSummaryText(wholeUnitMembership?.status ?? null)}
            {(() => {
              const spots = Math.max(0, formingGroup.maxSize - formingGroup.members.length);
              return spots > 0 ? (
                <span className="mt-1 block font-semibold text-[var(--forest-700)]">
                  {spots} spot{spots === 1 ? "" : "s"} left
                </span>
              ) : null;
            })()}
          </span>
        </button>
      ) : null}
    </div>
  );
}

function PropertyLightbox({
  isOpen,
  photoIndex,
  photos,
  onClose,
  onNext,
  onPrev,
}: {
  isOpen: boolean;
  photoIndex: number;
  photos: string[];
  onClose: () => void;
  onNext: () => void;
  onPrev: () => void;
}) {
  // Touch swipe: a mostly-horizontal drag advances the gallery. The image is
  // full-bleed on phones, so swiping is the primary navigation there.
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  if (!isOpen || !photos[photoIndex]) return null;
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
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < 0) onNext();
    else onPrev();
  };
  return (
    <div
      className="absolute inset-0 z-[70] grid place-items-center bg-black/90 p-4"
      style={{ touchAction: "pan-y" }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div className="relative size-full max-h-[88vh] max-w-[1200px]">
        <Image
          src={photos[photoIndex]}
          alt=""
          fill
          sizes="100vw"
          className="object-contain"
          priority
        />
      </div>
      <button
        type="button"
        onClick={onClose}
        className="kin-focus absolute right-4 top-4 z-10 grid size-11 place-items-center rounded-full bg-white/95 text-black shadow-md transition hover:bg-white"
        aria-label="Close gallery"
      >
        <X size={18} aria-hidden="true" />
      </button>
      {photos.length > 1 ? (
        <>
          <button
            type="button"
            onClick={onPrev}
            className="kin-focus absolute left-4 top-1/2 z-10 grid size-12 -translate-y-1/2 place-items-center rounded-full bg-white/95 text-black shadow-md transition hover:bg-white"
            aria-label="Previous photo"
          >
            <ChevronLeft size={20} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onNext}
            className="kin-focus absolute right-4 top-1/2 z-10 grid size-12 -translate-y-1/2 place-items-center rounded-full bg-white/95 text-black shadow-md transition hover:bg-white"
            aria-label="Next photo"
          >
            <ChevronRight size={20} aria-hidden="true" />
          </button>
        </>
      ) : null}
      <p className="pointer-events-none absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full bg-black/65 px-3 py-1.5 text-xs font-semibold text-white">
        {photoIndex + 1} / {photos.length}
      </p>
    </div>
  );
}

function PropertyMainColumn({
  detail,
  descriptionExpanded,
  listing,
  showEnrichedSkeletons,
  onOpenGroups,
  onStartGroup,
  onToggleDescription,
  onToggleFloorPlanSelection,
  onToggleFloorPlans,
}: {
  detail: PropertyDetailDerivedModel;
  descriptionExpanded: boolean;
  listing: ApartmentListing;
  showEnrichedSkeletons: boolean;
  onOpenGroups: (key: string) => void;
  onStartGroup: (plan: FloorPlanType, key: string) => void;
  onToggleDescription: () => void;
  onToggleFloorPlanSelection: (key: string, unitName: string | null) => void;
  onToggleFloorPlans: () => void;
}) {
  const hasDescription =
    listing.description &&
    listing.description.length > 20 &&
    !/^imported\b/i.test(listing.description.trim());

  return (
    // Airbnb-style sectioning: hairline rules with generous padding are the
    // only division device — no cards or tinted bands between sections.
    <div className="divide-y divide-[var(--border-strong)] [&>*]:py-8 [&>:first-child]:pt-0 [&>:last-child]:pb-0">
      {hasDescription ? (
        <PropertyDescription
          description={listing.description}
          expanded={descriptionExpanded}
          onToggle={onToggleDescription}
        />
      ) : null}

      {listing.concessionNote ? (
        <div className="flex items-start gap-3">
          <Tag size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-[var(--ochre)]" />
          <div>
            <p className="font-semibold text-[var(--ink-900)]">
              {formatConcession(listing.concessionMonths, "long")}
            </p>
            <p className="text-sm text-[var(--ink-700)]">{listing.concessionNote}</p>
          </div>
        </div>
      ) : null}

      <FloorPlanInventorySection
        detail={detail}
        listing={listing}
        showEnrichedSkeletons={showEnrichedSkeletons}
        onOpenGroups={onOpenGroups}
        onStartGroup={onStartGroup}
        onToggleFloorPlanSelection={onToggleFloorPlanSelection}
        onToggleFloorPlans={onToggleFloorPlans}
      />
      <PropertyEnrichedSections
        detail={detail}
        listing={listing}
        showEnrichedSkeletons={showEnrichedSkeletons}
      />
    </div>
  );
}

function PropertyDescription({
  description,
  expanded,
  onToggle,
}: {
  description: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const isLong = description.length > 400;
  const collapsed = isLong && !expanded;

  return (
    <div>
      <p
        className={[
          "max-w-[64ch] text-[15.5px] leading-relaxed text-[var(--ink-700)]",
          collapsed ? "line-clamp-6" : "",
        ].join(" ")}
      >
        {description}
      </p>
      {isLong ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="kin-focus mt-2 text-xs font-medium text-[var(--forest-700)] hover:underline"
        >
          {expanded ? "Show less" : "Show more"}
          <ChevronDown
            size={12}
            aria-hidden="true"
            className={[
              "ml-0.5 inline transition-transform duration-200",
              expanded ? "rotate-180" : "",
            ].join(" ")}
          />
        </button>
      ) : null}
    </div>
  );
}

function FloorPlanInventorySection({
  detail,
  listing,
  showEnrichedSkeletons,
  onOpenGroups,
  onStartGroup,
  onToggleFloorPlanSelection,
  onToggleFloorPlans,
}: {
  detail: PropertyDetailDerivedModel;
  listing: ApartmentListing;
  showEnrichedSkeletons: boolean;
  onOpenGroups: (key: string) => void;
  onStartGroup: (plan: FloorPlanType, key: string) => void;
  onToggleFloorPlanSelection: (key: string, unitName: string | null) => void;
  onToggleFloorPlans: () => void;
}) {
  const { concessionMonths, concessionLeaseMonths } = detail.floorPlanConcession;
  const floorPlanEntries = detail.floorPlanEntries;

  const bedroomGroups = useMemo(
    () =>
      buildBedroomGroups(floorPlanEntries, {
        concessionMonths,
        concessionLeaseMonths,
      }),
    [floorPlanEntries, concessionMonths, concessionLeaseMonths],
  );

  // The viewer's explicit tab choice (null until they pick one).
  const [userBedroomKey, setUserBedroomKey] = useState<string | null>(null);

  if (bedroomGroups.length === 0) {
    if (
      listing.availableUnitCount > 0 &&
      (listing.unitRentMin != null || listing.unitEffectiveRentMin != null)
    ) {
      return <AvailableUnitsSection listing={listing} />;
    }
    return showEnrichedSkeletons ? (
      <SkeletonSection eyebrow="Floor plans" lineCount={3} />
    ) : null;
  }

  const isValidBedroomKey = (key: string | null) =>
    key != null && bedroomGroups.some((group) => group.key === key);

  // Seed from the plan/unit the viewer already selected, else the listing's
  // headline bedroom count, else the cheapest (first) group. An explicit tab
  // choice always wins.
  const selectionBedroomKey = detail.selectedFloorPlan
    ? bedroomGroupKey(detail.selectedFloorPlan.bedrooms)
    : null;
  const headlineBedroomKey = bedroomGroupKey(listing.bedrooms);
  const activeKey = isValidBedroomKey(userBedroomKey)
    ? userBedroomKey
    : ([selectionBedroomKey, headlineBedroomKey].find(isValidBedroomKey) ??
      bedroomGroups[0]!.key);

  const activeGroup =
    bedroomGroups.find((group) => group.key === activeKey) ?? bedroomGroups[0]!;
  const groupEntries = activeGroup.entries;
  const visibleEntries = detail.floorPlansExpanded
    ? groupEntries
    : groupEntries.slice(0, collapsedFloorPlanCount);
  const hiddenCount = groupEntries.length - visibleEntries.length;
  const hasMultipleBedrooms = bedroomGroups.length > 1;

  const eyebrow = hasMultipleBedrooms
    ? "Pick a bedroom count, then a plan to price your split."
    : groupEntries.length > 1
      ? `${groupEntries.length} plans available. Pick one to price your split.`
      : activeGroup.canSplit
        ? "Available now. Start a group to split it."
        : "Available now.";

  return (
    <Section title="Floor plans" eyebrow={eyebrow}>
      {hasMultipleBedrooms ? (
        <FloorPlanBedroomFilter
          groups={bedroomGroups}
          selectedKey={activeGroup.key}
          onSelect={setUserBedroomKey}
        />
      ) : null}
      <ul className="space-y-2.5">
        {visibleEntries.map((entry) => (
          <FloorPlanOptionRow
            key={entry.key}
            detail={detail}
            entry={entry}
            onOpenGroups={onOpenGroups}
            onStartGroup={onStartGroup}
            onToggleFloorPlanSelection={onToggleFloorPlanSelection}
          />
        ))}
      </ul>
      {groupEntries.length > collapsedFloorPlanCount ? (
        <div className="mt-3 text-center">
          <button
            type="button"
            onClick={onToggleFloorPlans}
            aria-expanded={detail.floorPlansExpanded}
            className="kin-focus inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-[var(--forest-700)] transition hover:text-[var(--forest-900)]"
          >
            {detail.floorPlansExpanded
              ? "Show fewer plans"
              : `Show ${hiddenCount} more plan${hiddenCount === 1 ? "" : "s"}`}
            <ChevronDown
              size={15}
              className={[
                "transition-transform",
                detail.floorPlansExpanded ? "rotate-180" : "",
              ].join(" ")}
              aria-hidden="true"
            />
          </button>
        </div>
      ) : null}
    </Section>
  );
}

type FloorPlanInventoryEntry =
  PropertyDetailDerivedModel["floorPlanEntries"][number];

type FloorPlanBedroomGroup = {
  key: string;
  bedrooms: number | null;
  label: string;
  entries: FloorPlanInventoryEntry[];
  canSplit: boolean;
  fromPerPerson: number | null;
  fromWhole: number | null;
};

function bedroomGroupKey(bedrooms: number | null | undefined) {
  return bedrooms == null ? "na" : String(bedrooms);
}

function buildBedroomGroups(
  entries: FloorPlanInventoryEntry[],
  concession: { concessionMonths: number; concessionLeaseMonths: number },
): FloorPlanBedroomGroup[] {
  const byBedroom = new Map<
    string,
    { bedrooms: number | null; entries: FloorPlanInventoryEntry[] }
  >();
  for (const entry of entries) {
    const key = bedroomGroupKey(entry.type.bedrooms);
    const bucket = byBedroom.get(key);
    if (bucket) {
      bucket.entries.push(entry);
    } else {
      byBedroom.set(key, { bedrooms: entry.type.bedrooms, entries: [entry] });
    }
  }

  const groups = [...byBedroom.entries()].map(([key, bucket]) => {
    const canSplit = canSplitByRoommates(bucket.bedrooms);
    const splitSize = householdSizeLimitFromBedrooms(bucket.bedrooms);
    let fromWhole: number | null = null;
    let fromPerPerson: number | null = null;
    for (const entry of bucket.entries) {
      const range = floorPlanEffectiveRentRange(entry.type, concession);
      const whole = range.min ?? range.max;
      if (whole == null) continue;
      fromWhole = fromWhole == null ? whole : Math.min(fromWhole, whole);
      if (canSplit) {
        const perPerson = Math.round(whole / splitSize);
        fromPerPerson =
          fromPerPerson == null ? perPerson : Math.min(fromPerPerson, perPerson);
      }
    }
    return {
      key,
      bedrooms: bucket.bedrooms,
      label:
        bucket.bedrooms == null ? "Other" : formatBedrooms(bucket.bedrooms),
      entries: bucket.entries,
      canSplit,
      fromPerPerson,
      fromWhole,
    };
  });

  groups.sort((a, b) => {
    if (a.bedrooms == null) return 1;
    if (b.bedrooms == null) return -1;
    return a.bedrooms - b.bedrooms;
  });
  return groups;
}

function FloorPlanBedroomFilter({
  groups,
  selectedKey,
  onSelect,
}: {
  groups: FloorPlanBedroomGroup[];
  selectedKey: string;
  onSelect: (key: string) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Filter floor plans by bedroom count"
      className="mb-5 flex gap-8 overflow-x-auto border-b border-[var(--border)]"
    >
      {groups.map((group) => {
        const active = group.key === selectedKey;
        const priceLabel =
          group.canSplit && group.fromPerPerson != null
            ? `${formatCurrency(group.fromPerPerson)}/ea`
            : group.fromWhole != null
              ? `${formatCurrency(group.fromWhole)}/mo`
              : "Ask";
        return (
          <button
            key={group.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(group.key)}
            className={[
              "kin-focus -mb-px shrink-0 border-b-2 px-0.5 pb-2.5 pt-0.5 text-left transition",
              active
                ? "border-[var(--forest-700)]"
                : "border-transparent hover:border-[var(--border-strong)]",
            ].join(" ")}
          >
            <span
              className={[
                "block text-sm font-semibold",
                active ? "text-[var(--ink-900)]" : "text-[var(--ink-500)]",
              ].join(" ")}
            >
              {group.label}
            </span>
            <span
              className={[
                "mt-1 block whitespace-nowrap text-[12px]",
                active ? "text-[var(--ink-600)]" : "text-[var(--ink-400)]",
              ].join(" ")}
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {priceLabel}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function FloorPlanOptionRow({
  detail,
  entry,
  onOpenGroups,
  onStartGroup,
  onToggleFloorPlanSelection,
}: {
  detail: PropertyDetailDerivedModel;
  entry: PropertyDetailDerivedModel["floorPlanEntries"][number];
  onOpenGroups: (key: string) => void;
  onStartGroup: (plan: FloorPlanType, key: string) => void;
  onToggleFloorPlanSelection: (key: string, unitName: string | null) => void;
}) {
  const { key, type } = entry;
  const sqftLabel = formatSqftRange(type.sqftMin, type.sqftMax);
  const effectiveRentRange = floorPlanEffectiveRentRange(
    type,
    detail.floorPlanConcession,
  );
  const wholeFrom = effectiveRentRange.min ?? effectiveRentRange.max ?? null;
  const rentLabel = formatRentRange(effectiveRentRange.min, effectiveRentRange.max);
  const grossRentLabel = formatRentRange(type.rentPriceMin, type.rentPriceMax);
  const planHasEffectiveDiscount = floorPlanHasEffectiveDiscount(
    type,
    detail.floorPlanConcession,
  );
  // Per-person split is the hero number: lead with it whenever the plan can
  // actually be shared, at full occupancy (one renter per bedroom).
  const canSplit = canSplitByRoommates(type.bedrooms);
  const perPerson =
    canSplit && wholeFrom != null
      ? Math.round(wholeFrom / householdSizeLimitFromBedrooms(type.bedrooms))
      : null;

  const bathLabel = type.bathrooms != null ? `${type.bathrooms} ba` : null;
  const availLabel =
    type.totalUnits > 0 && type.totalUnits !== type.availableUnits
      ? `${type.availableUnits} of ${type.totalUnits}`
      : formatFloorPlanAvailability(type);

  // A plan with one unit collapses inline (no redundant child row); a plan with
  // several keeps its expandable unit list.
  const hasMultipleUnits = type.units.length > 1;
  const singleUnit = type.units.length === 1 ? type.units[0]! : null;
  const metaLabel = [
    bathLabel,
    sqftLabel,
    singleUnit ? `Unit ${singleUnit.name}` : null,
    singleUnit ? singleUnit.status : availLabel,
  ]
    .filter(Boolean)
    .join(" · ");

  const isPlanActive = detail.selectedKey === key;
  const isPlanRangeSelected = isPlanActive && detail.selectedUnitName == null;
  // Multi-unit plans defer selection to their unit rows; a lone plan has nothing
  // to compare against, so its header is static too.
  const showAsStatic = hasMultipleUnits || detail.floorPlanEntries.length === 1;
  const isSelected = hasMultipleUnits ? isPlanActive : isPlanRangeSelected;
  const canStart = !detail.viewerHasGroupOnListing;

  const priceBlock = (
    <span className="flex flex-col items-end leading-tight">
      {perPerson != null ? (
        <>
          <span
            className="serif text-lg font-semibold text-[var(--ink-900)] sm:text-xl"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {formatCurrency(perPerson)}
            <span className="ml-1 font-sans text-xs font-medium text-[var(--ink-500)]">
              /person
            </span>
          </span>
          {rentLabel ? (
            <span
              className="mt-0.5 text-xs text-[var(--ink-500)]"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {planHasEffectiveDiscount && grossRentLabel ? (
                <span className="mr-1 text-[var(--ink-400)] line-through decoration-[var(--ink-400)]/60">
                  {grossRentLabel}
                </span>
              ) : null}
              {rentLabel}/mo
            </span>
          ) : null}
        </>
      ) : (
        <>
          <span
            className="serif text-lg font-semibold text-[var(--ink-900)] sm:text-xl"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {rentLabel ?? "Ask"}
            {rentLabel ? (
              <span className="ml-1 font-sans text-xs font-medium text-[var(--ink-500)]">
                /mo
              </span>
            ) : null}
          </span>
          {planHasEffectiveDiscount && grossRentLabel ? (
            <span className="text-xs font-medium text-[var(--ink-400)] line-through decoration-[var(--ink-400)]/60">
              {grossRentLabel}
            </span>
          ) : null}
        </>
      )}
    </span>
  );

  const identityNode = (
    <div className="min-w-0">
      <p className="flex items-center gap-2 text-[15px] font-semibold text-[var(--ink-900)]">
        {!showAsStatic ? (
          <span
            className={[
              "grid size-5 shrink-0 place-items-center rounded-[7px] border transition",
              isSelected
                ? "border-[var(--forest-700)] bg-[var(--forest-700)] text-white"
                : "border-[var(--border-strong)] bg-white text-transparent",
            ].join(" ")}
            aria-hidden="true"
          >
            <Check size={12} strokeWidth={3} />
          </span>
        ) : null}
        <span className="truncate">{type.name}</span>
      </p>
      {metaLabel ? (
        <p
          className={[
            "mt-1 text-[12.5px] text-[var(--ink-500)]",
            !showAsStatic ? "pl-[28px]" : "",
          ].join(" ")}
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {metaLabel}
        </p>
      ) : null}
    </div>
  );

  const selectLabel = isSelected
    ? `Clear selection of ${type.name}`
    : `Select ${type.name}`;

  return (
    <li
      className={[
        "rounded-2xl border transition",
        isSelected
          ? "border-[var(--mint-400)] bg-[var(--mint-100)]"
          : "border-[var(--border-strong)] bg-white hover:bg-[#fbfaf5]",
      ].join(" ")}
    >
      <div className="grid gap-x-4 gap-y-3 p-4 sm:grid-cols-[1fr_auto_auto] sm:items-center">
        {showAsStatic ? (
          identityNode
        ) : (
          <button
            type="button"
            onClick={() => onToggleFloorPlanSelection(key, null)}
            className="kin-focus min-w-0 text-left"
            aria-pressed={isSelected}
            aria-label={selectLabel}
          >
            {identityNode}
          </button>
        )}

        {showAsStatic ? (
          <div className="justify-self-end">{priceBlock}</div>
        ) : (
          <button
            type="button"
            onClick={() => onToggleFloorPlanSelection(key, null)}
            className="kin-focus justify-self-end"
            aria-pressed={isSelected}
            aria-label={selectLabel}
          >
            {priceBlock}
          </button>
        )}

        <div className="flex justify-end sm:w-[150px]">
          <FloorPlanAvatarStack
            floorPlan={type}
            canStart={canStart}
            onOpenGroups={() => onOpenGroups(key)}
            onStart={() => onStartGroup(type, key)}
          />
        </div>
      </div>

      {hasMultipleUnits ? (
        <ul className="divide-y divide-[var(--border)] border-t border-[var(--border)] bg-[#fbfaf5]/60">
          {type.units.map((unit) => (
            <FloorPlanUnitRow
              key={`${type.name}-${unit.name}`}
              detail={detail}
              planKey={key}
              unit={unit}
              onToggleFloorPlanSelection={onToggleFloorPlanSelection}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function FloorPlanUnitRow({
  detail,
  planKey,
  unit,
  onToggleFloorPlanSelection,
}: {
  detail: PropertyDetailDerivedModel;
  planKey: string;
  unit: FloorPlanType["units"][number];
  onToggleFloorPlanSelection: (key: string, unitName: string | null) => void;
}) {
  const isUnitSelected = detail.selectedKey === planKey && detail.selectedUnitName === unit.name;
  const unitEffectiveRent = floorPlanUnitEffectiveRent(unit, detail.floorPlanConcession);
  const unitHasEffectiveDiscount =
    unitEffectiveRent != null &&
    unit.rentPrice != null &&
    unitEffectiveRent < unit.rentPrice;

  return (
    <li
      className={["transition", isUnitSelected ? "bg-[var(--mint-100)]" : "hover:bg-white"].join(" ")}
      aria-current={isUnitSelected ? "true" : undefined}
    >
      <button
        type="button"
        onClick={() => onToggleFloorPlanSelection(planKey, unit.name)}
        className="kin-focus flex w-full items-center justify-between gap-3 px-[18px] py-2.5 text-left"
        aria-label={isUnitSelected ? `Clear selection of unit ${unit.name}` : `Select unit ${unit.name}`}
        aria-pressed={isUnitSelected}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={[
              "grid size-5 shrink-0 place-items-center rounded-[7px] border transition",
              isUnitSelected
                ? "border-[var(--forest-700)] bg-[var(--forest-700)] text-white"
                : "border-[var(--border-strong)] bg-white text-transparent",
            ].join(" ")}
            aria-hidden="true"
          >
            <Check size={11} strokeWidth={3} />
          </span>
          <div className="min-w-0">
            <p
              className={[
                "text-sm font-semibold",
                isUnitSelected ? "text-[var(--forest-800)]" : "text-[var(--ink-900)]",
              ].join(" ")}
            >
              Unit {unit.name}
            </p>
            <p className="text-[11.5px] text-[var(--ink-500)]">
              {unit.sqft ? `${unit.sqft.toLocaleString()} sqft · ` : ""}
              <span
                className={
                  unit.status === "available"
                    ? "text-[var(--forest-700)]"
                    : "text-[var(--ink-500)]"
                }
              >
                {unit.status}
              </span>
              {unit.availableAt ? ` · ${formatDate(unit.availableAt, shortDate)}` : ""}
            </p>
          </div>
        </div>
        <p
          className="text-right text-sm font-semibold text-[var(--ink-900)]"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {unitEffectiveRent != null ? formatCurrency(unitEffectiveRent) : "Ask"}
          {unitHasEffectiveDiscount ? (
            <span className="mt-0.5 block text-[11px] font-medium text-[var(--ink-400)] line-through decoration-[var(--ink-400)]/60">
              {formatCurrency(unit.rentPrice!)}
            </span>
          ) : null}
        </p>
      </button>
    </li>
  );
}

function AvailableUnitsSection({ listing }: { listing: ApartmentListing }) {
  const effectiveRange =
    formatMaybeMoney(listing.unitEffectiveRentMin) +
    (listing.unitEffectiveRentMax &&
    listing.unitEffectiveRentMax > (listing.unitEffectiveRentMin ?? 0)
      ? ` – ${formatMaybeMoney(listing.unitEffectiveRentMax)}`
      : "");
  const grossRange =
    formatMaybeMoney(listing.unitRentMin) +
    (listing.unitRentMax && listing.unitRentMax > (listing.unitRentMin ?? 0)
      ? ` – ${formatMaybeMoney(listing.unitRentMax)}`
      : "");
  // The strikethrough only means something when a concession makes the
  // effective rent cheaper than gross; otherwise the two ranges are identical.
  const hasDiscount = grossRange !== effectiveRange;
  return (
    <Section
      eyebrow={`${listing.availableUnitCount} unit${listing.availableUnitCount === 1 ? "" : "s"} available now in this building.`}
      title="Available units"
    >
      <div className="overflow-hidden rounded-2xl border border-[var(--border-strong)] bg-white">
        <div className="hidden grid-cols-[1fr_auto_auto] items-center gap-3 border-b border-[var(--border)] bg-[#fbfaf5] px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--ink-500)] sm:grid">
          <span>Range</span>
          <span>Effective</span>
          {hasDiscount ? <span>Gross</span> : null}
        </div>
        <div className="flex flex-col gap-2 p-4 sm:grid sm:grid-cols-[1fr_auto_auto] sm:items-baseline sm:gap-3">
          <div className="text-sm text-[var(--ink-700)]">
            <p className="text-[var(--ink-900)]">
              <span className="font-semibold">
                {formatBedrooms(listing.bedrooms)} · {formatBathrooms(listing.bathrooms)}
              </span>
            </p>
            <p className="text-xs text-[var(--ink-500)]">
              {listing.availableUnitCount} unit{listing.availableUnitCount === 1 ? "" : "s"} available now
            </p>
          </div>
          <p className="flex flex-wrap items-baseline gap-x-2 text-lg font-semibold text-[var(--ink-900)] sm:block">
            {effectiveRange}
            {hasDiscount ? (
              <span className="text-xs font-medium text-[var(--ink-500)] sm:hidden">
                was <span className="line-through decoration-[var(--ink-400)]/60">{grossRange}</span>
              </span>
            ) : null}
          </p>
          {hasDiscount ? (
            <p className="hidden text-sm text-[var(--ink-500)] line-through decoration-[var(--ink-400)]/60 sm:block">
              {grossRange}
            </p>
          ) : null}
        </div>
      </div>
    </Section>
  );
}

// Stable empty reference so the amenities useMemo deps don't churn each render.
const EMPTY_AMENITIES: string[] = [];
// Two grid columns × six rows before the "Show all" affordance takes over.
const AMENITY_PREVIEW_COUNT = 12;

function PropertyEnrichedSections({
  detail,
  listing,
  showEnrichedSkeletons,
}: {
  detail: PropertyDetailDerivedModel;
  listing: ApartmentListing;
  showEnrichedSkeletons: boolean;
}) {
  const propertyAmenities = useMemo(
    () => [
      ...detail.unitAmenitiesFinal,
      ...detail.communityAmenitiesFinal,
      ...detail.otherAmenities,
    ],
    [detail.unitAmenitiesFinal, detail.communityAmenitiesFinal, detail.otherAmenities],
  );

  // Unit/plan amenities are additive. They are not an exhaustive allowlist:
  // common/property amenities still apply unless the source explicitly says not to.
  const selectedAmenities = useMemo(
    () =>
      detail.hasActiveSelection
        ? [
            ...(detail.selectedUnit?.specificAmenities ?? EMPTY_AMENITIES),
            ...(detail.selectedFloorPlan?.specificAmenities ?? EMPTY_AMENITIES),
          ]
        : EMPTY_AMENITIES,
    [
      detail.hasActiveSelection,
      detail.selectedFloorPlan?.specificAmenities,
      detail.selectedUnit?.specificAmenities,
    ],
  );
  const amenitiesView = useMemo(() => {
    return buildAmenityChipItems({
      hasActiveSelection: detail.hasActiveSelection,
      selectedAmenities,
      propertyAmenities,
    });
  }, [detail.hasActiveSelection, selectedAmenities, propertyAmenities]);

  const hasHighlightedAmenities =
    detail.hasActiveSelection && amenitiesView.some((item) => item.highlighted);
  const amenityContext = detail.hasActiveSelection
    ? hasHighlightedAmenities
      ? `Bold entries are specific to ${detail.selectionLabel ?? "the selected layout"}; the rest are property-wide.`
      : `No layout-specific amenities are called out for ${detail.selectionLabel ?? "the selected layout"}. Property amenities stay visible.`
    : null;
  const [amenitiesExpanded, setAmenitiesExpanded] = useState(false);
  const visibleAmenities = amenitiesExpanded
    ? amenitiesView
    : amenitiesView.slice(0, AMENITY_PREVIEW_COUNT);

  return (
    <>
      {amenitiesView.length > 0 ? (
        <div>
          <h3 className="text-[19px] font-semibold tracking-[-0.01em] text-[var(--ink-900)]">
            What you get
          </h3>
          {amenityContext ? (
            <p className="mt-1 text-[13px] text-[var(--ink-500)]">
              {amenityContext}
            </p>
          ) : null}
          <ul className="mt-4 grid gap-x-10 gap-y-3 sm:grid-cols-2">
            {visibleAmenities.map(({ amenity, highlighted }) => (
              <li
                key={amenity}
                className="flex items-center gap-3 text-[15px] leading-snug"
              >
                <Check
                  size={16}
                  strokeWidth={highlighted ? 3 : 2}
                  aria-hidden="true"
                  className={
                    highlighted
                      ? "shrink-0 text-[var(--forest-700)]"
                      : "shrink-0 text-[var(--ink-400)]"
                  }
                />
                <span
                  className={
                    highlighted
                      ? "font-semibold text-[var(--ink-900)]"
                      : "text-[var(--ink-800)]"
                  }
                >
                  {amenity}
                </span>
              </li>
            ))}
          </ul>
          {amenitiesView.length > AMENITY_PREVIEW_COUNT ? (
            <button
              type="button"
              onClick={() => setAmenitiesExpanded((current) => !current)}
              aria-expanded={amenitiesExpanded}
              className="kin-focus mt-5 rounded-lg border border-[var(--ink-900)] bg-white px-5 py-2.5 text-sm font-semibold text-[var(--ink-900)] transition hover:bg-[var(--bg-soft)]"
            >
              {amenitiesExpanded
                ? "Show fewer amenities"
                : `Show all ${amenitiesView.length} amenities`}
            </button>
          ) : null}
        </div>
      ) : showEnrichedSkeletons ? (
        <SkeletonSection eyebrow="Amenities" lineCount={2} />
      ) : null}

      <NearbySection listing={listing} showSkeleton={showEnrichedSkeletons} />
      <PoliciesSection
        detail={detail}
        listing={listing}
        showSkeleton={showEnrichedSkeletons}
      />
      <TradeoffsSection listing={listing} />
      <ContactSection
        detail={detail}
        listing={listing}
        showSkeleton={showEnrichedSkeletons}
      />
    </>
  );
}

function NearbySection({
  listing,
  showSkeleton,
}: {
  listing: ApartmentListing;
  showSkeleton: boolean;
}) {
  if (!listing.enriched?.poiSummary) {
    return showSkeleton ? <SkeletonSection eyebrow="Nearby" lineCount={2} /> : null;
  }

  const visibleCategories = NEARBY_POI_CATEGORIES.filter(
    ({ key }) => (listing.enriched?.poiSummary?.[key] ?? []).length > 0,
  );

  if (visibleCategories.length === 0) return null;

  return (
    <div>
      <h3 className="text-[19px] font-semibold tracking-[-0.01em] text-[var(--ink-900)]">
        The neighborhood
      </h3>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {visibleCategories.map(({ key, icon: Icon, label }) => {
          const items = listing.enriched?.poiSummary?.[key] ?? [];
          return (
            <div
              key={key}
              className="rounded-2xl border border-[var(--border-strong)] bg-white p-4"
            >
              <p className="flex items-center gap-1.5 text-xs font-semibold text-[var(--ink-500)]">
                <Icon size={13} aria-hidden="true" />
                {label}
              </p>
              <ul className="mt-3">
                {items.slice(0, 3).map((poi, index) => (
                  <li
                    key={`${key}-${poi.name}-${poi.distance ?? "na"}`}
                    className={[
                      "flex items-baseline justify-between gap-2 py-1.5 text-sm",
                      index > 0 ? "border-t border-[var(--border)]" : "",
                    ].join(" ")}
                  >
                    <span className="truncate text-[var(--ink-800)]">{poi.name}</span>
                    {poi.distance != null ? (
                      <span className="mono shrink-0 text-[11px] text-[var(--ink-500)]">
                        {poi.distance} mi
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PoliciesSection({
  detail,
  listing,
  showSkeleton,
}: {
  detail: PropertyDetailDerivedModel;
  listing: ApartmentListing;
  showSkeleton: boolean;
}) {
  if (!detail.hasFees) {
    return showSkeleton ? <SkeletonSection eyebrow="Policies & fees" lineCount={2} /> : null;
  }

  return (
    <div>
      <h3 className="text-[19px] font-semibold tracking-[-0.01em] text-[var(--ink-900)]">
        Policies &amp; fees
      </h3>
      <dl className="mt-2 text-sm">
        {detail.parking.length > 0 ? (
          <PolicyRow
            icon={<Car size={14} aria-hidden="true" className="shrink-0" />}
            label="Parking"
          >
            {detail.parking[0].type}
            {detail.parking[0].spaces != null
              ? ` · ${detail.parking[0].spaces} space${detail.parking[0].spaces === 1 ? "" : "s"}`
              : ""}
          </PolicyRow>
        ) : null}
        {listing.enriched?.petPolicies.map((pet) => {
          const isDog = pet.type.toLowerCase().includes("dog");
          return (
            <PolicyRow
              key={pet.type}
              icon={
                isDog ? (
                  <Dog size={14} aria-hidden="true" className="shrink-0" />
                ) : (
                  <Cat size={14} aria-hidden="true" className="shrink-0" />
                )
              }
              label={pet.type}
              muted={!pet.allowed}
            >
              {pet.allowed ? "Allowed" : "Not allowed"}
            </PolicyRow>
          );
        })}
        {listing.enriched?.applicationFee != null ? (
          <PolicyRow
            icon={<FileText size={14} aria-hidden="true" className="shrink-0" />}
            label="Application fee"
          >
            {formatCurrency(listing.enriched.applicationFee)}
            {detail.hasRoommateSplit ? (
              <span className="ml-1 font-normal text-[var(--ink-500)]">per person</span>
            ) : null}
          </PolicyRow>
        ) : null}
        {listing.leaseTerms.length > 0 ? (
          <PolicyRow
            icon={<CalendarDays size={14} aria-hidden="true" className="shrink-0" />}
            label="Lease"
          >
            {listing.leaseTerms.join(" or ")}
          </PolicyRow>
        ) : null}
      </dl>
    </div>
  );
}

function PolicyRow({
  children,
  icon,
  label,
  muted,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  label: string;
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-[var(--border)] py-2.5 last:border-b-0">
      <dt className="flex items-center gap-2 text-[var(--ink-700)]">
        {icon}
        {label}
      </dt>
      <dd className={muted ? "text-[var(--ink-500)]" : "font-semibold text-[var(--ink-900)]"}>
        {children}
      </dd>
    </div>
  );
}

function TradeoffsSection({ listing }: { listing: ApartmentListing }) {
  if (listing.tradeoffs.length === 0) return null;

  return (
    <div>
      <h3 className="text-[19px] font-semibold tracking-[-0.01em] text-[var(--ink-900)]">
        Things to know
      </h3>
      <p className="mt-1 text-sm text-[var(--ink-600)]">
        Caveats we flagged for your group, based on what you&rsquo;ve told us.
      </p>
      <div className="mt-4 rounded-2xl border border-[var(--border-strong)] bg-white px-[18px]">
        <ul>
          {listing.tradeoffs.map((tradeoff, index) => (
            <li
              key={`${tradeoff.label}-${tradeoff.detail}`}
              className={[
                "flex gap-3.5 py-3.5",
                index > 0 ? "border-t border-[var(--border)]" : "",
              ].join(" ")}
            >
              <span
                className="mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-md bg-[rgba(169,106,34,0.10)] text-[var(--ochre)]"
                aria-hidden="true"
              >
                <CircleAlert size={12} strokeWidth={2.4} />
              </span>
              <div>
                <p className="text-[14.5px] font-semibold text-[var(--ink-900)]">
                  {tradeoff.label}
                </p>
                <p className="mt-0.5 text-[13.5px] text-[var(--ink-600)]">{tradeoff.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ContactSection({
  detail,
  listing,
  showSkeleton,
}: {
  detail: PropertyDetailDerivedModel;
  listing: ApartmentListing;
  showSkeleton: boolean;
}) {
  if (!detail.hasListedBy) {
    return showSkeleton ? <SkeletonSection eyebrow="Contact" lineCount={1} /> : null;
  }

  return (
    <div>
      <h3 className="text-[19px] font-semibold tracking-[-0.01em] text-[var(--ink-900)]">
        {listing.enriched?.managementCompany ?? detail.brokerage ?? "Contact"}
      </h3>
      <div className="mt-4 space-y-2 text-sm">
        {detail.agent ? (
          <p className="text-[var(--ink-700)]">
            {detail.agent.name}
            {detail.brokerage && detail.brokerage !== (listing.enriched?.managementCompany ?? "") ? (
              <span className="text-[var(--ink-500)]"> · {detail.brokerage}</span>
            ) : null}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {listing.enriched?.phone ? (
            <a
              href={`tel:${listing.enriched.phone.replace(/\D/g, "")}`}
              className="inline-flex items-center gap-1.5 text-[var(--ink-900)] hover:underline"
            >
              <Phone size={13} aria-hidden="true" className="text-[var(--ink-500)]" />
              {listing.enriched.phone}
            </a>
          ) : null}
          {listing.enriched?.email ? (
            <a
              href={`mailto:${listing.enriched.email}`}
              className="inline-flex items-center gap-1.5 text-[var(--ink-900)] hover:underline"
            >
              <Mail size={13} aria-hidden="true" className="text-[var(--ink-500)]" />
              {listing.enriched.email}
            </a>
          ) : null}
        </div>
        {listing.enriched && listing.enriched.leasingOfficeSchedules.length > 0 ? (
          <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-[var(--ink-600)] sm:grid-cols-4">
            {listing.enriched.leasingOfficeSchedules.map((hours) => (
              <p key={hours.day}>
                <span className="font-medium text-[var(--ink-800)]">{hours.day}</span>{" "}
                {hours.open && hours.close ? `${hours.open}–${hours.close}` : "Closed"}
              </p>
            ))}
          </div>
        ) : null}
        {detail.mlsId ? (
          <p className="text-xs text-[var(--ink-500)]">MLS #{detail.mlsId}</p>
        ) : null}
      </div>
    </div>
  );
}

function PropertySummaryRail({
  detail,
  listing,
  wholeUnitGroupLabel,
  wholeUnitMembership,
  onClearSelectedFloorPlan,
  onOpenWholeUnitGroups,
  onStartWholeUnitGroup,
}: {
  detail: PropertyDetailDerivedModel;
  listing: ApartmentListing;
  wholeUnitGroupLabel: string;
  wholeUnitMembership: unknown;
  onClearSelectedFloorPlan: () => void;
  onOpenWholeUnitGroups: () => void;
  onStartWholeUnitGroup: () => void;
}) {
  const { heroValue, heroSuffix, breakdown } = buildHeadlineRent(detail, listing);
  return (
    <aside className="space-y-5 lg:sticky lg:top-[104px] lg:self-start">
      <div className="rounded-2xl border border-[var(--border-strong)] bg-white p-6 shadow-[0_24px_50px_-34px_rgba(14,31,23,0.4)]">
        <div className="flex items-baseline gap-2">
          <span
            className="serif text-[30px] font-semibold leading-none tracking-[-0.02em] text-[var(--ink-900)]"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {formatMaybeMoney(heroValue)}
          </span>
          {heroSuffix ? (
            <span className="text-sm font-medium text-[var(--ink-500)]">{heroSuffix}</span>
          ) : null}
        </div>

        <dl className="mt-[18px] grid gap-2.5 text-sm">
          {breakdown ? (
            breakdown.rows.map((row) => (
              <div
                key={row.label}
                className={[
                  "flex items-center justify-between gap-4",
                  row.kind === "sub"
                    ? "border-t border-[var(--border)] pt-2.5"
                    : "",
                  row.kind === "total"
                    ? "border-t border-[var(--border-strong)] pt-2.5"
                    : "",
                ].join(" ")}
              >
                <dt className="text-[var(--ink-600)]">{row.label}</dt>
                <dd
                  className={[
                    "font-semibold text-[var(--ink-900)]",
                    row.kind === "neg" ? "text-[var(--forest-700)]" : "",
                    row.kind === "total" ? "text-[15px]" : "",
                  ].join(" ")}
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {row.value}
                </dd>
              </div>
            ))
          ) : (
            <Row
              label={
                detail.selectedUnit
                  ? "Unit rent"
                  : detail.selectedFloorPlan || detail.usesFloorPlanRent
                    ? "Floor plan rent"
                    : "Monthly total"
              }
            >
              {detail.selectedFloorPlan && detail.fpRentRange
                ? detail.fpRentRange
                : formatMaybeMoney(detail.displayPrimaryRent)}
            </Row>
          )}
        </dl>

        {detail.selectedFloorPlan ? (
          <button
            type="button"
            onClick={onClearSelectedFloorPlan}
            className="kin-focus mt-3.5 inline-flex items-center gap-1 text-[12.5px] font-medium text-[var(--forest-700)] hover:underline"
          >
            Clear selection
            <X size={12} aria-hidden="true" />
          </button>
        ) : null}

        {detail.canShowSummaryGroupAction && detail.wholeUnitPlan ? (
          <button
            type="button"
            onClick={() => {
              if (!wholeUnitMembership && detail.wholeUnitPlan!.groups.length === 0) {
                onStartWholeUnitGroup();
              } else {
                onOpenWholeUnitGroups();
              }
            }}
            className="kin-focus mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--forest-700)] px-4 py-3.5 text-[15px] font-semibold text-white transition hover:bg-[var(--forest-800)]"
          >
            {wholeUnitGroupLabel}
          </button>
        ) : null}
        {detail.canShowSummaryGroupAction && detail.wholeUnitPlan ? (
          <p className="mt-2.5 text-center text-xs text-[var(--ink-600)]">
            You&apos;re not committing to anything yet.
          </p>
        ) : null}
        {listing.sourceUrl ? (
          <a
            href={listing.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-3.5 inline-flex items-center gap-1 rounded-lg px-2 py-2.5 -mx-2 -my-1 text-[12.5px] font-medium text-[var(--forest-700)] hover:text-[var(--forest-900)]"
          >
            View on {detail.source}
            <ExternalLink size={12} aria-hidden="true" />
          </a>
        ) : null}
      </div>

      <StreetViewCard listing={listing} />
      <p className="text-xs text-[var(--ink-500)]">
        Data via {detail.source} · {listing.providerMarket}
      </p>
    </aside>
  );
}

function StreetViewCard({ listing }: { listing: ApartmentListing }) {
  // The pano swallows scroll/drag gestures, so it stays inert until the user
  // explicitly opts in — otherwise it's a scroll trap mid-modal on touch.
  const [panoActive, setPanoActive] = useState(false);
  if (listing.latitude != null && listing.longitude != null) {
    return (
      <div className="overflow-hidden rounded-2xl border border-[var(--border-strong)] bg-white">
        <div className="relative">
          <iframe
            title={`Street view of ${listing.address}`}
            src={`https://maps.google.com/maps?q=&layer=c&cbll=${listing.latitude},${listing.longitude}&cbp=11,0,0,0,0&output=svembed`}
            loading="lazy"
            sandbox="allow-scripts allow-popups allow-forms"
            referrerPolicy="no-referrer-when-downgrade"
            className={`block h-80 w-full border-0 ${panoActive ? "" : "pointer-events-none"}`}
          />
          {panoActive ? null : (
            <button
              type="button"
              onClick={() => setPanoActive(true)}
              className="kin-focus absolute inset-0 flex items-end justify-center pb-4"
              aria-label="Activate street view"
            >
              <span className="pointer-events-none rounded-full bg-black/70 px-3.5 py-2 text-xs font-semibold text-white shadow-md">
                Tap to look around
              </span>
            </button>
          )}
        </div>
        <div className="flex items-center justify-between gap-3 px-4 py-2.5">
          <p className="truncate text-xs text-[var(--ink-500)]">{listing.neighborhood}</p>
          <a
            href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${listing.latitude},${listing.longitude}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-2.5 -mx-2 -my-2 text-xs text-[var(--forest-700)] hover:underline"
          >
            Open in Maps
            <ExternalLink size={11} aria-hidden="true" />
          </a>
        </div>
      </div>
    );
  }

  if (!listing.enriched?.streetViewUrl) return null;

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--border-strong)] bg-white">
      <div className="relative">
        <Image
          src={listing.enriched.streetViewUrl}
          alt={`Street view of ${listing.address}`}
          width={730}
          height={440}
          sizes="(max-width: 1024px) 100vw, 360px"
          className="h-44 w-full object-cover"
          unoptimized
        />
        <p className="absolute bottom-2 left-3 text-[11.5px] font-semibold text-white">
          Street view
        </p>
      </div>
      <div className="px-4 py-2.5">
        <p className="text-xs text-[var(--ink-500)]">{listing.neighborhood}</p>
      </div>
    </div>
  );
}
