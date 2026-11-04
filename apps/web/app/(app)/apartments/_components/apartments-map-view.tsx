"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import {
  ArrowLeft,
  List as ListIcon,
  Map as MapIcon,
  PanelRightClose,
  PanelRightOpen,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import type {
  GeoJSONSource,
  LngLatBounds,
  Map as MapboxMap,
  MapMouseEvent,
  MapboxGeoJSONFeature,
  Popup as MapboxPopup,
} from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { FeatureCollection } from "geojson";
import { apartmentListingSurfaceFitScore } from "@/lib/apartments/match-surface";
import { propertyMarkerRentForDisplay } from "@/lib/apartments/roommate-splits";
import type {
  ApartmentListing,
  ApartmentSearchSnapshot,
} from "@/lib/apartments/types";
import { PropertyPopupCard } from "./property-popup-card";
import { PropertyListCard } from "./property-list-card";
import { fitToneForScore } from "./fit-tone";
import { geocodeSearchQuery, type MarketBbox } from "./search-geocode";
import {
  retrievePlace,
  type PlaceSuggestion,
} from "./place-suggest";
import { useSavedListings } from "./use-saved-listings";
import { RoommatesControl } from "./roommates-control";
import { BedBathControl, type BedBathFilter } from "./bed-bath-control";
import { WhereControl } from "./where-control";
import { SortControl } from "./sort-control";
import { sortListingsForPanel, type ApartmentSortOrder } from "./listing-sort";
import { freshnessBadgeState } from "./freshness-badge-state";
import { BudgetRangeControl } from "./budget-range/budget-range-control";
import {
  apartmentFilterDefaultsFromProfile,
  budgetRangesEqual,
  maxRoommatesForListings,
  type ApartmentFilterDefaults,
} from "./filter-defaults";
import {
  listingMatchesToolbarFilters,
  neighborhoodFilterOptionsForListings,
  neighborhoodFilterOptionsWithCounts,
  normalizeNeighborhoodFilterValue,
  type NeighborhoodFilterOption,
} from "./apartment-listing-filters";
import {
  buildBudgetHistogram,
  listingMatchesBudgetRange,
  type BudgetHistogramBucket,
  type BudgetRange,
} from "./budget-range/types";
import {
  resolveApartmentMapInitialView,
  type ApartmentMapBounds,
} from "./map-initial-view";
import { useApartmentListingDetails } from "./use-apartment-listing-details";
import { formatCurrency } from "@/lib/shared/currency";

const PropertyDetailModal = dynamic(
  () => import("./property-detail-modal").then((mod) => mod.PropertyDetailModal),
  { ssr: false },
);

const MAP_STYLE = "mapbox://styles/mapbox/light-v11";
const PROPERTY_SOURCE_ID = "kinfolk-apartment-listings";
const PROPERTY_MARKER_LAYER_ID = "kinfolk-apartment-price-pins";
const PROPERTY_INTERACTIVE_LAYER_IDS = [PROPERTY_MARKER_LAYER_ID] as const;
const MAP_VIEW_STORAGE_KEY = "kinfolk:apartments-map-view:v1";
const DEFAULT_MARKET_CENTER: [number, number] = [-122.4194, 37.7749];
const LISTING_BOUNDS_PADDING = 80;
const LISTING_BOUNDS_MAX_ZOOM = 13;

// Zoom band over which listings progressively reveal. The highest-signal pins
// appear from REVEAL_ZOOM_MIN; the lowest-signal only by REVEAL_ZOOM_MAX. A
// listing's reveal zoom is interpolated across this band by its signal rank, so
// zooming in surfaces more pins while panning at a fixed zoom stays stable —
// no collision churn, no flicker. Tune the band to trade density vs. clutter.
const REVEAL_ZOOM_MIN = 10.5;
const REVEAL_ZOOM_MAX = 16;
// The top-ranked listings always show, so zooming out never blanks the map.
const ALWAYS_VISIBLE_COUNT = 10;
// Phones show the same map area in ~1/3 the pixels, so the same pin density
// collides. Fewer always-visible pins + a later reveal keep pills legible.
const COMPACT_ALWAYS_VISIBLE_COUNT = 6;
const COMPACT_REVEAL_ZOOM_BIAS = 0.75;
const COMPACT_MAP_MAX_WIDTH = 640;

const compactViewportQuery = `(max-width: ${COMPACT_MAP_MAX_WIDTH - 1}px)`;
function subscribeCompactViewport(onChange: () => void) {
  const mql = window.matchMedia(compactViewportQuery);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}
function getCompactViewportSnapshot() {
  return window.matchMedia(compactViewportQuery).matches;
}
function getCompactViewportServerSnapshot() {
  return false;
}
// Only re-apply the zoom filter past this delta, so a smooth zoom reveals pins
// in small batches instead of thrashing setFilter every frame.
const REVEAL_ZOOM_EPSILON = 0.08;

const AVATAR_COLORS = ["#1c3526", "#3a6b4d", "#557a47"] as const;
const AVATAR_MAX_VISIBLE = 3;
const AVATAR_RADIUS = 8;
const AVATAR_RING = 1.5;
const AVATAR_GAP = 12;
const AVATAR_TO_PILL_GAP = 4;
const LIST_PANEL_CARD_HEIGHT = 338;
const LIST_PANEL_ROW_GAP = 24;
const LIST_PANEL_OVERSCAN_ROWS = 2;
const LIST_PANEL_INITIAL_HEIGHT = 900;
const LIST_PANEL_INITIAL_WIDTH = 585;
const LIST_PANEL_DEFAULT_VIEWPORT = {
  height: LIST_PANEL_INITIAL_HEIGHT,
  scrollTop: 0,
  width: LIST_PANEL_INITIAL_WIDTH,
};

type MarkerAvatar = { initials: string; color: string; isOverflow: boolean };

type ListingWithCoords = ApartmentListing & {
  latitude: number;
  longitude: number;
};
type ActiveApartmentProfile = ApartmentSearchSnapshot["activeProfile"];

function surfaceFitScoreForListing({
  listing,
  profile,
  profileRoommates,
  roommates,
}: {
  listing: ApartmentListing;
  profile: ActiveApartmentProfile;
  profileRoommates: number | null;
  roommates: number | null;
}) {
  if (
    roommates === profileRoommates &&
    typeof listing.surfaceFitScore === "number"
  ) {
    return listing.surfaceFitScore;
  }

  return apartmentListingSurfaceFitScore({
    listing,
    profile,
    roommatesOverride: roommates,
  });
}
type SavedMapView = {
  market: string;
  center: [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
  updatedAt: number;
};

type Bounds = { west: number; south: number; east: number; north: number };
type SearchedPlace = {
  center: [number, number];
  /** What the user asked for. */
  name: string;
  /** Street context under the name, when the feature carries one. */
  address: string;
};

type VirtualListViewport = typeof LIST_PANEL_DEFAULT_VIEWPORT;
type VirtualListStore = ReturnType<typeof createVirtualApartmentListStore>;
type PropertyFeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    id: string;
    properties: {
      id: string;
      label: string;
      hasGroups: boolean;
      fitScore: number;
      // Draw order among overlapping pins: higher draws on top. Holds the signal
      // score (selected pins sit highest). Visibility is handled separately by
      // revealZoom, not collision.
      sortKey: number;
      // Zoom level at/above which this pin appears — derived from signal rank.
      revealZoom: number;
      selected: boolean;
      icon: string;
      selectedIcon: string;
      avatars: MarkerAvatar[];
    };
    geometry: {
      type: "Point";
      coordinates: [number, number];
    };
  }>;
};

type Props = {
  initialListing?: ApartmentListing | null;
  initialListingId?: string | null;
  snapshot: ApartmentSearchSnapshot;
};

type ApartmentsViewState = {
  budgetRange: BudgetRange;
  budgetIncludeUnpriced: boolean;
  detailListing: ApartmentListing | null;
  detailLoadingId: string | null;
  map: MapboxMap | null;
  minBeds: number | null;
  minBaths: number | null;
  selectedNeighborhoods: Set<string>;
  roommates: number | null;
  searchValue: string;
  selectedId: string | null;
  sortOrder: ApartmentSortOrder;
  viewportBounds: Bounds | null;
};

type ApartmentsViewAction =
  | { type: "clear-detail-loading" }
  | { type: "close-detail" }
  | { type: "clear-selected" }
  | { type: "select"; id: string }
  | { type: "set-budget-range"; range: BudgetRange }
  | { type: "set-budget-include-unpriced"; value: boolean }
  | { type: "set-detail"; listing: ApartmentListing | null }
  | { type: "set-detail-loading"; id: string | null }
  | { type: "set-map"; map: MapboxMap | null }
  | { type: "set-bed-bath"; minBeds: number | null; minBaths: number | null }
  | { type: "toggle-neighborhood"; value: string }
  | { type: "clear-neighborhoods" }
  | {
      type: "reset-to-profile";
      defaults: ApartmentFilterDefaults;
      neighborhoods: ReadonlySet<string>;
    }
  | { type: "set-roommates"; value: number | null }
  | { type: "set-search"; value: string }
  | { type: "set-sort-order"; value: ApartmentSortOrder }
  | { type: "set-viewport-bounds"; bounds: Bounds }

type InitialApartmentsViewStateArgs = {
  defaults: ApartmentFilterDefaults,
  initialDetailListing: ApartmentListing | null,
};

function createInitialApartmentsViewState({
  defaults,
  initialDetailListing,
}: InitialApartmentsViewStateArgs): ApartmentsViewState {
  return {
    budgetRange: defaults.budgetRange,
    budgetIncludeUnpriced: false,
    detailListing: initialDetailListing,
    detailLoadingId: null,
    map: null,
    minBeds: null,
    minBaths: null,
    selectedNeighborhoods: new Set(),
    roommates: defaults.roommates,
    searchValue: "",
    selectedId: null,
    sortOrder: "best-fit",
    viewportBounds: null,
  };
}

function setsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>) {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

function areBoundsClose(a: Bounds | null, b: Bounds) {
  if (!a) return false;
  const epsilon = 0.0001;
  return (
    Math.abs(a.west - b.west) < epsilon &&
    Math.abs(a.south - b.south) < epsilon &&
    Math.abs(a.east - b.east) < epsilon &&
    Math.abs(a.north - b.north) < epsilon
  );
}

function apartmentsViewReducer(
  state: ApartmentsViewState,
  action: ApartmentsViewAction,
): ApartmentsViewState {
  switch (action.type) {
    case "clear-detail-loading":
      return { ...state, detailLoadingId: null };
    case "close-detail":
      return { ...state, detailListing: null, detailLoadingId: null };
    case "clear-selected":
      return { ...state, selectedId: null };
    case "select":
      return { ...state, selectedId: action.id };
    case "set-budget-range":
      return { ...state, budgetRange: action.range };
    case "set-budget-include-unpriced":
      return { ...state, budgetIncludeUnpriced: action.value };
    case "set-bed-bath":
      return { ...state, minBeds: action.minBeds, minBaths: action.minBaths };
    case "set-roommates":
      return { ...state, roommates: action.value };
    case "set-detail":
      return { ...state, detailListing: action.listing, selectedId: null };
    case "set-detail-loading":
      return { ...state, detailLoadingId: action.id };
    case "set-map":
      return { ...state, map: action.map };
    case "set-search":
      return { ...state, searchValue: action.value };
    case "set-sort-order":
      return { ...state, sortOrder: action.value };
    case "toggle-neighborhood": {
      const selectedNeighborhoods = new Set(state.selectedNeighborhoods);
      if (selectedNeighborhoods.has(action.value))
        selectedNeighborhoods.delete(action.value);
      else selectedNeighborhoods.add(action.value);
      return { ...state, selectedNeighborhoods };
    }
    case "clear-neighborhoods":
      return state.selectedNeighborhoods.size === 0
        ? state
        : { ...state, selectedNeighborhoods: new Set() };
    case "reset-to-profile":
      return {
        ...state,
            budgetRange: action.defaults.budgetRange,
        budgetIncludeUnpriced: false,
        minBeds: null,
        minBaths: null,
        roommates: action.defaults.roommates,
        selectedNeighborhoods: new Set(action.neighborhoods),
      };
    case "set-viewport-bounds":
      return {
        ...state,
        viewportBounds: areBoundsClose(state.viewportBounds, action.bounds)
          ? state.viewportBounds
          : action.bounds,
      };
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function applyMapCursor(map: MapboxMap, cursor: string) {
  try {
    const canvas = map.getCanvas();
    if (canvas && canvas.style.cursor !== cursor) {
      canvas.style.cursor = cursor;
    }
  } catch {
    // Mapbox can clear its canvas before React runs all effect cleanups during route changes.
  }
}

function clampRoommatesForListings(value: number | null, maxRoommates: number) {
  if (value == null || maxRoommates <= 0) return null;
  return Math.min(value, maxRoommates);
}

function isValidLngLat(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    isFiniteNumber(value[0]) &&
    value[0] >= -180 &&
    value[0] <= 180 &&
    isFiniteNumber(value[1]) &&
    value[1] >= -90 &&
    value[1] <= 90
  );
}

function parseSavedMapView(
  raw: string | null,
  market: string,
): SavedMapView | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SavedMapView>;
    if (
      parsed.market !== market ||
      !isValidLngLat(parsed.center) ||
      !isFiniteNumber(parsed.zoom) ||
      parsed.zoom < 0 ||
      parsed.zoom > 24
    ) {
      return null;
    }

    return {
      market,
      center: parsed.center,
      zoom: parsed.zoom,
      bearing: isFiniteNumber(parsed.bearing) ? parsed.bearing : 0,
      pitch: isFiniteNumber(parsed.pitch) ? parsed.pitch : 0,
      updatedAt: isFiniteNumber(parsed.updatedAt)
        ? parsed.updatedAt
        : Date.now(),
    };
  } catch {
    return null;
  }
}

function loadSavedMapView(market: string): SavedMapView | null {
  try {
    return parseSavedMapView(
      window.localStorage.getItem(MAP_VIEW_STORAGE_KEY),
      market,
    );
  } catch {
    return null;
  }
}

function saveMapView(instance: MapboxMap, market: string) {
  const center = instance.getCenter();
  const view: SavedMapView = {
    market,
    center: [center.lng, center.lat],
    zoom: instance.getZoom(),
    bearing: instance.getBearing(),
    pitch: instance.getPitch(),
    updatedAt: Date.now(),
  };
  const serializedView = JSON.stringify(view);

  try {
    window.localStorage.setItem(MAP_VIEW_STORAGE_KEY, serializedView);
  } catch {
    // localStorage can be unavailable in private browsing or locked-down contexts.
  }
}

function getListingBounds(
  listings: ListingWithCoords[],
): ApartmentMapBounds | undefined {
  if (listings.length < 2) return undefined;
  return listings.reduce<[[number, number], [number, number]]>(
    (acc, listing) => {
      acc[0][0] = Math.min(acc[0][0], listing.longitude);
      acc[0][1] = Math.min(acc[0][1], listing.latitude);
      acc[1][0] = Math.max(acc[1][0], listing.longitude);
      acc[1][1] = Math.max(acc[1][1], listing.latitude);
      return acc;
    },
    [
      [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
      [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
    ],
  );
}

function getFeatureListingId(feature: MapboxGeoJSONFeature | undefined) {
  const id = feature?.properties?.id;
  if (typeof id === "string") return id;
  if (typeof id === "number") return String(id);
  return null;
}

function markerImageId(
  label: string,
  hasGroups: boolean,
  selected: boolean,
  avatars: MarkerAvatar[],
) {
  const avatarPart =
    avatars.length === 0
      ? "noav"
      : avatars
          .map(
            (a) =>
              `${a.isOverflow ? "o" : "a"}${a.initials.replace(/[^a-zA-Z0-9]+/g, "").toLowerCase()}`,
          )
          .join(".");
  return [
    "kinfolk-price-pin",
    selected ? "selected" : "idle",
    hasGroups ? "groups" : "single",
    label
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase() || "ask",
    avatarPart,
  ].join("-");
}

function avatarColorFor(initials: string): string {
  let hash = 0;
  for (let i = 0; i < initials.length; i++) {
    hash = (hash * 31 + initials.charCodeAt(i)) | 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function buildMarkerAvatars(listing: ApartmentListing): MarkerAvatar[] {
  const members = listing.formingGroups.flatMap((group) => group.members);
  if (members.length === 0) return [];
  if (members.length <= AVATAR_MAX_VISIBLE) {
    return members.map((m) => ({
      initials: m.initials,
      color: avatarColorFor(m.initials),
      isOverflow: false,
    }));
  }
  const visible = members.slice(0, AVATAR_MAX_VISIBLE - 1).map((m) => ({
    initials: m.initials,
    color: avatarColorFor(m.initials),
    isOverflow: false,
  }));
  visible.push({
    initials: `+${members.length - (AVATAR_MAX_VISIBLE - 1)}`,
    color: "",
    isOverflow: true,
  });
  return visible;
}

// Selected pins always draw on top of everything else.
const SELECTED_SORT_KEY = 1_000_000;

// How important is this listing to *this* user, right now? Drives which pins
// survive map decluttering and the order of the list. Group momentum dominates
// because, for Kinfolk, a forming group IS the unit-discovery signal — a group
// close to filling or already touring is the strongest "join now" cue.
function listingSignalScore(
  listing: ApartmentListing,
  displayRent: number | null,
  profile: ApartmentSearchSnapshot["activeProfile"],
  preferredNeighborhoods: Set<string>,
): number {
  let score = 0;

  // Group momentum: take the most-advanced group on the listing. Fill ratio
  // carries the "almost full" urgency; status gates how real that momentum is.
  const groupMomentum = listing.formingGroups.reduce((best, group) => {
    const fill =
      group.spotsTotal > 0 ? group.spotsFilled / group.spotsTotal : 0;
    const statusWeight =
      group.status === "touring" ? 1 : group.status === "ready" ? 0.85 : 0.5;
    return Math.max(best, (0.4 + 0.6 * fill) * statusWeight);
  }, 0);
  score += groupMomentum * 140;
  // A second forming group is extra social proof, with diminishing weight.
  if (listing.formingGroups.length > 1) score += 12;

  // Personal fit (0–100), the next-strongest pull.
  score += (listing.fitScore / 100) * 80;

  // Preference match from the active housing profile: in-budget and in a
  // neighborhood the user already favors.
  if (
    displayRent != null &&
    displayRent >= profile.budgetMin &&
    displayRent <= profile.budgetMax
  ) {
    score += 30;
  }
  if (preferredNeighborhoods.has(listing.neighborhood.trim().toLowerCase())) {
    score += 20;
  }

  return score;
}

function roundedRectPath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const right = x + width;
  const bottom = y + height;
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(right - radius, y);
  context.quadraticCurveTo(right, y, right, y + radius);
  context.lineTo(right, bottom - radius);
  context.quadraticCurveTo(right, bottom, right - radius, bottom);
  context.lineTo(x + radius, bottom);
  context.quadraticCurveTo(x, bottom, x, bottom - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

function createMarkerImage(
  label: string,
  hasGroups: boolean,
  selected: boolean,
  avatars: MarkerAvatar[],
): ImageData | null {
  if (typeof document === "undefined") return null;

  const pixelRatio = 2;
  const fontSize = selected ? 13.5 : 13;
  const font = `600 ${fontSize}px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  const measureCanvas = document.createElement("canvas");
  const measureContext = measureCanvas.getContext("2d");
  if (!measureContext) return null;

  measureContext.font = font;
  const textWidth = Math.ceil(measureContext.measureText(label).width);
  const dotSize = hasGroups ? 6 : 0;
  const gap = hasGroups ? 6 : 0;
  const paddingX = selected ? 12 : 10;
  const paddingY = selected ? 7 : 6;
  const pillWidth = paddingX * 2 + dotSize + gap + textWidth;
  const pillHeight = fontSize + paddingY * 2;

  const avatarCount = avatars.length;
  const avatarOuter = (AVATAR_RADIUS + AVATAR_RING) * 2;
  const avatarRowWidth =
    avatarCount > 0 ? avatarOuter + (avatarCount - 1) * AVATAR_GAP : 0;
  const avatarRowHeight = avatarCount > 0 ? avatarOuter : 0;
  const avatarTopGap = avatarCount > 0 ? AVATAR_TO_PILL_GAP : 0;

  const shadowPadding = 7;
  const bodyWidth = Math.max(pillWidth, avatarRowWidth);
  const bodyHeight = pillHeight + avatarTopGap + avatarRowHeight;
  const width = Math.ceil(bodyWidth + shadowPadding * 2);
  const height = Math.ceil(bodyHeight + shadowPadding * 2);

  const canvas = document.createElement("canvas");
  canvas.width = width * pixelRatio;
  canvas.height = height * pixelRatio;
  const context = canvas.getContext("2d");
  if (!context) return null;

  context.scale(pixelRatio, pixelRatio);
  context.font = font;
  context.textBaseline = "middle";

  const pillX = shadowPadding + (bodyWidth - pillWidth) / 2;
  const pillY = shadowPadding;

  context.shadowColor = "rgba(14, 31, 23, 0.25)";
  context.shadowBlur = 10;
  context.shadowOffsetY = 3;
  roundedRectPath(context, pillX, pillY, pillWidth, pillHeight, pillHeight / 2);
  context.fillStyle = selected ? "#1c3526" : "#ffffff";
  context.fill();

  context.shadowColor = "transparent";
  context.lineWidth = 1;
  context.strokeStyle = selected
    ? "rgba(255,255,255,0.35)"
    : "rgba(0,0,0,0.08)";
  roundedRectPath(context, pillX, pillY, pillWidth, pillHeight, pillHeight / 2);
  context.stroke();

  let cursorX = pillX + paddingX;
  if (hasGroups) {
    context.beginPath();
    context.arc(
      cursorX + dotSize / 2,
      pillY + pillHeight / 2,
      dotSize / 2,
      0,
      Math.PI * 2,
    );
    context.fillStyle = selected ? "#9fe4bc" : "#6dd49a";
    context.fill();
    cursorX += dotSize + gap;
  }

  context.fillStyle = selected ? "#ffffff" : "#1c3526";
  context.fillText(label, cursorX, pillY + pillHeight / 2 + 0.5);

  if (avatarCount > 0) {
    const ringColor = selected ? "#1c3526" : "#ffffff";
    const avatarRowY = pillY + pillHeight + avatarTopGap;
    const avatarRowX = shadowPadding + (bodyWidth - avatarRowWidth) / 2;
    const avatarFontSize = 8;
    context.font = `700 ${avatarFontSize}px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    context.textAlign = "center";

    for (let i = 0; i < avatarCount; i++) {
      const avatar = avatars[i];
      const cx = avatarRowX + AVATAR_RADIUS + AVATAR_RING + i * AVATAR_GAP;
      const cy = avatarRowY + AVATAR_RADIUS + AVATAR_RING;

      context.beginPath();
      context.arc(cx, cy, AVATAR_RADIUS + AVATAR_RING, 0, Math.PI * 2);
      context.fillStyle = ringColor;
      context.fill();

      context.beginPath();
      context.arc(cx, cy, AVATAR_RADIUS, 0, Math.PI * 2);
      if (avatar.isOverflow) {
        context.fillStyle = selected ? "#1c3526" : "#ffffff";
        context.fill();
        context.lineWidth = 1;
        context.strokeStyle = selected
          ? "rgba(255,255,255,0.35)"
          : "rgba(28,53,38,0.3)";
        context.stroke();
        context.fillStyle = selected ? "#ffffff" : "#1c3526";
      } else {
        context.fillStyle = avatar.color;
        context.fill();
        context.fillStyle = "#ffffff";
      }

      const text = avatar.isOverflow
        ? avatar.initials
        : avatar.initials.slice(0, 2).toUpperCase();
      context.fillText(text, cx, cy + 0.5);
    }

    context.textAlign = "start";
  }

  return context.getImageData(0, 0, canvas.width, canvas.height);
}

// Every marker image id this module has added to the live style, so stale
// ones can be pruned: the id embeds the price label, and cycling the
// roommates filter re-labels every pin — without eviction the style
// accumulates hundreds of orphaned GPU-resident canvases per session.
const addedMarkerImageIds = new Set<string>();

function ensureMarkerImages(map: MapboxMap, data: PropertyFeatureCollection) {
  const wanted = new Set<string>();
  for (const feature of data.features) {
    const { icon, selectedIcon, label, hasGroups, avatars } =
      feature.properties;
    for (const iconId of [icon, selectedIcon]) {
      wanted.add(iconId);
      if (map.hasImage(iconId)) continue;
      const image = createMarkerImage(
        label,
        hasGroups,
        iconId === selectedIcon,
        avatars,
      );
      if (image) {
        map.addImage(iconId, image, { pixelRatio: 2 });
        addedMarkerImageIds.add(iconId);
      }
    }
  }

  for (const iconId of addedMarkerImageIds) {
    if (wanted.has(iconId)) continue;
    addedMarkerImageIds.delete(iconId);
    if (map.hasImage(iconId)) {
      map.removeImage(iconId);
    }
  }
}

function addPropertyLayers(map: MapboxMap, data: PropertyFeatureCollection) {
  if (map.getSource(PROPERTY_SOURCE_ID)) return;

  ensureMarkerImages(map, data);
  map.addSource(PROPERTY_SOURCE_ID, {
    type: "geojson",
    data: data as FeatureCollection,
    promoteId: "id",
  });

  map.addLayer({
    id: PROPERTY_MARKER_LAYER_ID,
    type: "symbol",
    source: PROPERTY_SOURCE_ID,
    layout: {
      "icon-image": [
        "case",
        ["boolean", ["get", "selected"], false],
        ["get", "selectedIcon"],
        ["get", "icon"],
      ],
      "icon-anchor": "bottom",
      // Pins always draw (no live collision, so panning never makes them flicker
      // in and out). Decluttering is done by the revealZoom filter instead.
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "symbol-sort-key": ["get", "sortKey"],
    },
  });

  applyRevealFilter(map, map.getZoom());
}

// Show a pin once the map has zoomed to at least its revealZoom (the selected
// pin always shows so its popup has an anchor). Re-applied as zoom changes;
// the constant comparison means a pin appears once on zoom-in and stays.
function applyRevealFilter(map: MapboxMap, zoom: number) {
  if (!map.getLayer(PROPERTY_MARKER_LAYER_ID)) return;
  const compact = map.getContainer().clientWidth < COMPACT_MAP_MAX_WIDTH;
  const effectiveZoom = compact ? zoom - COMPACT_REVEAL_ZOOM_BIAS : zoom;
  map.setFilter(PROPERTY_MARKER_LAYER_ID, [
    "any",
    ["<=", ["get", "revealZoom"], effectiveZoom],
    ["==", ["get", "selected"], true],
  ]);
}

function useApartmentMapDerivedData({
  budgetIncludeUnpriced,
  budgetRange,
  deferredSearchValue,
  minBaths,
  minBeds,
  profileFilterDefaults,
  roommates,
  selectedId,
  selectedNeighborhoods,
  snapshot,
  sortOrder,
  viewportBounds,
}: {
  budgetIncludeUnpriced: boolean;
  budgetRange: BudgetRange;
  deferredSearchValue: string;
  minBaths: number | null;
  minBeds: number | null;
  profileFilterDefaults: ApartmentFilterDefaults;
  roommates: number | null;
  selectedId: string | null;
  selectedNeighborhoods: Set<string>;
  snapshot: ApartmentSearchSnapshot;
  sortOrder: ApartmentSortOrder;
  viewportBounds: Bounds | null;
}) {
  const listingsWithCoords = useMemo<ListingWithCoords[]>(
    () =>
      snapshot.listings.filter(
        (listing): listing is ListingWithCoords =>
          listing.latitude != null && listing.longitude != null,
      ),
    [snapshot.listings],
  );
  // The split-aware display fit score must be recomputed eagerly (not lazily at
  // pin render): the declutter/sort signal (listingSignalScore) and the pin
  // badge read listing.fitScore, so scoping this to in-view pins would break
  // sort order and the rendered scores.
  const scoredListingsWithCoords = useMemo<ListingWithCoords[]>(
    () =>
      listingsWithCoords.map((listing) => ({
        ...listing,
        fitScore: surfaceFitScoreForListing({
          listing,
          profile: snapshot.activeProfile,
          profileRoommates: profileFilterDefaults.roommates,
          roommates,
        }),
      })),
    [listingsWithCoords, profileFilterDefaults.roommates, roommates, snapshot.activeProfile],
  );

  // The full universe of neighborhoods that have any listing at all. Counts are
  // unfiltered here — this drives the saved-profile narrowing below (which must
  // not shift as the user changes budget/beds) and supplies the value/label for
  // every neighborhood the filtered dropdown options are derived from.
  const neighborhoodUniverse = useMemo(
    () => neighborhoodFilterOptionsForListings(listingsWithCoords),
    [listingsWithCoords],
  );

  // Saved profile neighborhoods are narrowed to options that have listings.
  const profileDefaultNeighborhoods = useMemo(() => {
    const available = new Set(
      neighborhoodUniverse.map((option) => option.value),
    );
    const result = new Set<string>();
    for (const name of snapshot.activeProfile.neighborhoods) {
      const value = normalizeNeighborhoodFilterValue(name);
      if (available.has(value)) result.add(value);
    }
    return result;
  }, [neighborhoodUniverse, snapshot.activeProfile.neighborhoods]);

  const filtersMatchProfile =
    budgetRangesEqual(budgetRange, profileFilterDefaults.budgetRange) &&
    !budgetIncludeUnpriced &&
    roommates === profileFilterDefaults.roommates &&
    minBeds === null &&
    minBaths === null &&
    // Empty counts as matching: the pristine page starts with NO neighborhood
    // filter, and showing "Reset to my profile" there would NARROW results
    // the user never filtered.
    (selectedNeighborhoods.size === 0 ||
      setsEqual(selectedNeighborhoods, profileDefaultNeighborhoods));

  const toolbarFilterCriteria = useMemo(
    () => ({
      search: deferredSearchValue.trim().toLowerCase(),
      minBeds,
      minBaths,
      neighborhoods: selectedNeighborhoods,
    }),
    [
        deferredSearchValue,
      minBeds,
      minBaths,
      selectedNeighborhoods,
    ],
  );

  const filteredListings = useMemo(() => {
    return scoredListingsWithCoords.filter((listing) => {
      if (!listingMatchesToolbarFilters(listing, toolbarFilterCriteria))
        return false;
      if (
        !listingMatchesBudgetRange(
          listing,
          budgetRange,
          budgetIncludeUnpriced,
          roommates,
        )
      ) {
        return false;
      }
      return true;
    });
  }, [
    scoredListingsWithCoords,
    toolbarFilterCriteria,
    budgetRange,
    budgetIncludeUnpriced,
    roommates,
  ]);

  // Listings matching every filter EXCEPT the neighborhood selection, so each
  // neighborhood's badge counts what it would actually add given the current
  // budget/beds/fit/search (faceted-search convention: a facet never narrows
  // its own counts).
  const neighborhoodFacetListings = useMemo(() => {
    const criteria = {
      ...toolbarFilterCriteria,
      neighborhoods: new Set<string>(),
    };
    return scoredListingsWithCoords.filter(
      (listing) =>
        listingMatchesToolbarFilters(listing, criteria) &&
        listingMatchesBudgetRange(
          listing,
          budgetRange,
          budgetIncludeUnpriced,
          roommates,
        ),
    );
  }, [
    scoredListingsWithCoords,
    toolbarFilterCriteria,
    budgetRange,
    budgetIncludeUnpriced,
    roommates,
  ]);

  // Dropdown options with filter-aware counts: zero-count neighborhoods drop
  // out, but anything currently selected stays pinned (even at 0) so the user
  // can still un-check it.
  const neighborhoodOptions = useMemo(
    () =>
      neighborhoodFilterOptionsWithCounts(
        neighborhoodFacetListings,
        neighborhoodUniverse,
        selectedNeighborhoods,
      ),
    [neighborhoodFacetListings, neighborhoodUniverse, selectedNeighborhoods],
  );

  const budgetHistogramSource = useMemo(() => {
    return scoredListingsWithCoords.filter((listing) =>
      listingMatchesToolbarFilters(listing, toolbarFilterCriteria),
    );
  }, [scoredListingsWithCoords, toolbarFilterCriteria]);

  const budgetHistogramBuckets = useMemo(
    () => buildBudgetHistogram(budgetHistogramSource, roommates),
    [budgetHistogramSource, roommates],
  );

  const listingScores = useMemo(() => {
    const profile = snapshot.activeProfile;
    const preferredNeighborhoods = new Set(
      profile.neighborhoods.map((name) => name.trim().toLowerCase()),
    );
    const scores = new Map<string, number>();
    for (const listing of filteredListings) {
      const displayRent = propertyMarkerRentForDisplay(listing, roommates);
      scores.set(
        listing.id,
        listingSignalScore(
          listing,
          displayRent,
          profile,
          preferredNeighborhoods,
        ),
      );
    }
    return scores;
  }, [filteredListings, roommates, snapshot.activeProfile]);

  const compactViewport = useSyncExternalStore(
    subscribeCompactViewport,
    getCompactViewportSnapshot,
    getCompactViewportServerSnapshot,
  );

  const revealZoomById = useMemo(() => {
    const ranked = filteredListings.toSorted(
      (a, b) => (listingScores.get(b.id) ?? 0) - (listingScores.get(a.id) ?? 0),
    );
    const denominator = Math.max(1, ranked.length - 1);
    const span = REVEAL_ZOOM_MAX - REVEAL_ZOOM_MIN;
    const alwaysVisible = compactViewport
      ? COMPACT_ALWAYS_VISIBLE_COUNT
      : ALWAYS_VISIBLE_COUNT;
    const result = new Map<string, number>();
    ranked.forEach((listing, index) => {
      result.set(
        listing.id,
        index < alwaysVisible
          ? 0
          : REVEAL_ZOOM_MIN + (index / denominator) * span,
      );
    });
    return result;
  }, [filteredListings, listingScores, compactViewport]);

  const propertyFeatureCollection = useMemo<PropertyFeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: filteredListings.map((listing) => {
        const displayRent = propertyMarkerRentForDisplay(listing, roommates);
        const label =
          displayRent == null || displayRent <= 0
            ? "Ask"
            : formatCurrency(displayRent);
        const hasGroups = listing.formingGroups.length > 0;
        const avatars = buildMarkerAvatars(listing);
        const selected = selectedId === listing.id;
        return {
          type: "Feature",
          id: listing.id,
          properties: {
            id: listing.id,
            label,
            hasGroups,
            fitScore: listing.fitScore,
            sortKey: selected
              ? SELECTED_SORT_KEY
              : (listingScores.get(listing.id) ?? 0),
            revealZoom: revealZoomById.get(listing.id) ?? REVEAL_ZOOM_MIN,
            selected,
            icon: markerImageId(label, hasGroups, false, avatars),
            selectedIcon: markerImageId(label, hasGroups, true, avatars),
            avatars,
          },
          geometry: {
            type: "Point",
            coordinates: [listing.longitude, listing.latitude],
          },
        };
      }),
    }),
    [filteredListings, selectedId, roommates, listingScores, revealZoomById],
  );

  // Which neighborhoods have listings on screen right now. Derived from the
  // facet listings (every other filter applied, neighborhoods deliberately
  // not) so picking one neighborhood cannot empty the picker it came from.
  const viewportNeighborhoodValues = useMemo(() => {
    if (!viewportBounds) return null;
    const values = new Set<string>();
    for (const listing of neighborhoodFacetListings) {
      if (
        listing.longitude >= viewportBounds.west &&
        listing.longitude <= viewportBounds.east &&
        listing.latitude >= viewportBounds.south &&
        listing.latitude <= viewportBounds.north
      ) {
        const value = normalizeNeighborhoodFilterValue(listing.neighborhood);
        if (value) values.add(value);
      }
    }
    return values;
  }, [neighborhoodFacetListings, viewportBounds]);

  const listingsInView = useMemo(() => {
    const inView = !viewportBounds
      ? filteredListings
      : filteredListings.filter(
          (listing) =>
            listing.longitude >= viewportBounds.west &&
            listing.longitude <= viewportBounds.east &&
            listing.latitude >= viewportBounds.south &&
            listing.latitude <= viewportBounds.north,
        );
    return sortListingsForPanel(inView, sortOrder, {
      fitScores: listingScores,
      roommates,
    });
  }, [filteredListings, viewportBounds, listingScores, roommates, sortOrder]);

  const selectedListing = useMemo(
    () => filteredListings.find((listing) => listing.id === selectedId) ?? null,
    [filteredListings, selectedId],
  );

  return {
    budgetHistogramBuckets,
    filteredListings,
    filtersMatchProfile,
    inViewCount: listingsInView.length,
    listingsInView,
    listingsWithCoords: scoredListingsWithCoords,
    matchedCount: filteredListings.length,
    neighborhoodOptions,
    profileDefaultNeighborhoods,
    viewportNeighborhoodValues,
    propertyFeatureCollection,
    selectedListing,
  };
}

function useApartmentsMapLifecycle({
  dispatch,
  filteredListings,
  initialFocusListing,
  listingsWithCoords,
  map,
  mapContainerRef,
  mapRef,
  onSelectListing,
  propertyFeatureCollection,
  snapshotMarket,
  updateBoundsFromMap,
}: {
  dispatch: Dispatch<ApartmentsViewAction>;
  filteredListings: ListingWithCoords[];
  initialFocusListing: ListingWithCoords | null;
  listingsWithCoords: ListingWithCoords[];
  map: MapboxMap | null;
  mapContainerRef: RefObject<HTMLDivElement | null>;
  mapRef: RefObject<MapboxMap | null>;
  onSelectListing: (listing: ListingWithCoords) => void;
  propertyFeatureCollection: PropertyFeatureCollection;
  snapshotMarket: string;
  updateBoundsFromMap: (instance: MapboxMap) => void;
}) {
  const filteredListingsRef = useRef<ListingWithCoords[]>([]);
  const propertyFeatureCollectionRef = useRef<PropertyFeatureCollection>({
    type: "FeatureCollection",
    features: [],
  });
  const lastRevealZoomRef = useRef<number>(Number.NEGATIVE_INFINITY);
  const handleMapLoad = useEffectEvent((instance: MapboxMap) => {
    addPropertyLayers(instance, propertyFeatureCollectionRef.current);
    dispatch({ type: "set-map", map: instance });
    updateBoundsFromMap(instance);
  });
  const handleMapMoveEnd = useEffectEvent((instance: MapboxMap) => {
    updateBoundsFromMap(instance);
    saveMapView(instance, snapshotMarket);
  });
  const syncPropertyFeatures = useEffectEvent((instance: MapboxMap) => {
    const collection = propertyFeatureCollection;
    ensureMarkerImages(instance, collection);
    const source = instance.getSource(PROPERTY_SOURCE_ID) as
      | GeoJSONSource
      | undefined;
    source?.setData(collection as FeatureCollection);
  });
  const handleMapClick = useEffectEvent(
    (event: MapMouseEvent, instance: MapboxMap) => {
      if (mapRef.current !== instance) return;

      const features = instance.queryRenderedFeatures(event.point, {
        layers: [...PROPERTY_INTERACTIVE_LAYER_IDS],
      });
      const pointFeature = features.find(
        (feature) => feature.layer?.id === PROPERTY_MARKER_LAYER_ID,
      );
      const listingId = getFeatureListingId(pointFeature);
      const listing = listingId
        ? filteredListingsRef.current.find((item) => item.id === listingId)
        : null;

      if (listing) {
        onSelectListing(listing);
        return;
      }

      dispatch({ type: "clear-selected" });
    },
  );

  // The listings/focus values only seed the map's INITIAL view. Read them via
  // refs so a filter change (new array identity every roommates/filter
  // dispatch) can't tear down and recreate the whole WebGL map.
  const initialViewListingsRef = useRef(listingsWithCoords);
  useEffect(() => {
    initialViewListingsRef.current = listingsWithCoords;
  }, [listingsWithCoords]);
  const initialFocusListingRef = useRef(initialFocusListing);
  useEffect(() => {
    initialFocusListingRef.current = initialFocusListing;
  }, [initialFocusListing]);

  useEffect(() => {
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token) return;
    if (!mapContainerRef.current) return;

    let cancelled = false;
    let cleanupMap: (() => void) | null = null;

    void import("mapbox-gl")
      .then(({ default: mapboxgl }) => {
        if (cancelled || !mapContainerRef.current) return;

        mapboxgl.accessToken = token;

        const initialFocus = initialFocusListingRef.current;
        const initialListings = initialViewListingsRef.current;
        const savedView = loadSavedMapView(snapshotMarket);
        const initialBounds = savedView || initialFocus
          ? undefined
          : getListingBounds(initialListings);
        const singleListing =
          !savedView && !initialFocus && !initialBounds
            ? initialListings[0]
            : null;
        const initialView = resolveApartmentMapInitialView({
          defaultCenter: DEFAULT_MARKET_CENTER,
          fallbackListing: singleListing,
          initialBounds,
          initialFocusListing: initialFocus,
          maxZoom: LISTING_BOUNDS_MAX_ZOOM,
          savedView,
        });

        const instance = new mapboxgl.Map({
          container: mapContainerRef.current,
          style: MAP_STYLE,
          attributionControl: false,
          ...(initialView.kind === "bounds"
            ? {
                bounds: initialView.bounds,
                fitBoundsOptions: {
                  padding: LISTING_BOUNDS_PADDING,
                  duration: 0,
                  maxZoom: LISTING_BOUNDS_MAX_ZOOM,
                },
              }
            : {
                center: initialView.center,
                zoom: initialView.zoom,
                bearing: initialView.bearing,
                pitch: initialView.pitch,
              }),
        });
        instance.addControl(
          new mapboxgl.AttributionControl({ compact: true }),
          "bottom-right",
        );
        instance.addControl(
          new mapboxgl.NavigationControl({ showCompass: false }),
          "bottom-right",
        );

        const handleLoad = () => handleMapLoad(instance);
        const handleMoveEnd = () => handleMapMoveEnd(instance);
        const handleZoom = () => {
          const zoom = instance.getZoom();
          if (Math.abs(zoom - lastRevealZoomRef.current) < REVEAL_ZOOM_EPSILON)
            return;
          lastRevealZoomRef.current = zoom;
          applyRevealFilter(instance, zoom);
        };

        instance.on("load", handleLoad);
        instance.on("moveend", handleMoveEnd);
        instance.on("zoom", handleZoom);

        mapRef.current = instance;
        cleanupMap = () => {
          instance.off("load", handleLoad);
          instance.off("moveend", handleMoveEnd);
          instance.off("zoom", handleZoom);
          instance.remove();
          if (mapRef.current === instance) mapRef.current = null;
          dispatch({ type: "set-map", map: null });
        };
      })
      .catch((error: unknown) => {
        console.warn("Unable to load Mapbox GL", error);
      });

    return () => {
      cancelled = true;
      cleanupMap?.();
      cleanupMap = null;
    };
  }, [dispatch, mapContainerRef, mapRef, snapshotMarket]);

  useEffect(() => {
    filteredListingsRef.current = filteredListings;
  }, [filteredListings]);

  useEffect(() => {
    propertyFeatureCollectionRef.current = propertyFeatureCollection;
  }, [propertyFeatureCollection]);

  useEffect(() => {
    if (!map) return;
    syncPropertyFeatures(map);
  }, [map, propertyFeatureCollection]);

  useEffect(() => {
    if (!map) return;

    const handleClick = (event: MapMouseEvent) => handleMapClick(event, map);

    const handleMarkerMouseEnter = () => {
      if (mapRef.current !== map) return;
      applyMapCursor(map, "pointer");
    };

    const handleMarkerMouseLeave = () => {
      if (mapRef.current !== map) return;
      applyMapCursor(map, "");
    };

    map.on("click", handleClick);
    for (const layerId of PROPERTY_INTERACTIVE_LAYER_IDS) {
      map.on("mouseenter", layerId, handleMarkerMouseEnter);
      map.on("mouseleave", layerId, handleMarkerMouseLeave);
    }

    return () => {
      map.off("click", handleClick);
      for (const layerId of PROPERTY_INTERACTIVE_LAYER_IDS) {
        map.off("mouseenter", layerId, handleMarkerMouseEnter);
        map.off("mouseleave", layerId, handleMarkerMouseLeave);
      }
      applyMapCursor(map, "");
    };
  }, [map, mapRef]);
}

export function ApartmentsMapView({
  initialListing = null,
  initialListingId = null,
  snapshot,
}: Props) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const maxRoommates = useMemo(
    () => maxRoommatesForListings(snapshot.listings),
    [snapshot.listings],
  );
  const profileFilterDefaults = useMemo(
    () =>
      apartmentFilterDefaultsFromProfile(
        snapshot.activeProfile,
        snapshot.listings,
      ),
    [snapshot.activeProfile, snapshot.listings],
  );
  const initialRoommates = useMemo(
    () => clampRoommatesForListings(profileFilterDefaults.roommates, maxRoommates),
    [maxRoommates, profileFilterDefaults.roommates],
  );
  const initialDetailListing = useMemo(
    () =>
      initialListing
        ? {
            ...initialListing,
            fitScore: surfaceFitScoreForListing({
              listing: initialListing,
              profile: snapshot.activeProfile,
              profileRoommates: profileFilterDefaults.roommates,
              roommates: initialRoommates,
            }),
          }
        : null,
    [
      initialListing,
      initialRoommates,
      profileFilterDefaults.roommates,
      snapshot.activeProfile,
    ],
  );
  const [state, dispatch] = useReducer(
    apartmentsViewReducer,
    { defaults: profileFilterDefaults, initialDetailListing },
    createInitialApartmentsViewState,
  );
  const [mobileView, setMobileView] = useState<"map" | "list">("map");
  // Desktop-only: collapse the list panel to hand the full width to the map.
  // Mobile uses MobileViewToggle instead, so this never applies below lg.
  const [listCollapsed, setListCollapsed] = useState(false);
  const { savedListingIds, toggleSavedListing } = useSavedListings();
  const {
    budgetRange,
    budgetIncludeUnpriced,
    detailListing,
    detailLoadingId,
    map,
    minBeds,
    minBaths,
    selectedNeighborhoods,
    roommates: storedRoommates,
    searchValue,
    selectedId,
    sortOrder,
    viewportBounds,
  } = state;
  const deferredSearchValue = useDeferredValue(searchValue);
  // A query that geocoded to a place ("near Dolores Park") is a location, not
  // a text filter — the map flew there, so listing text matching would only
  // hide everything again.
  const [locationQuery, setLocationQuery] = useState<string | null>(null);
  // The place the last search landed on. Drives the pin: after the map flies
  // somewhere, nothing on screen said which point was actually searched for.
  const [searchedPlace, setSearchedPlace] = useState<SearchedPlace | null>(
    null,
  );
  const effectiveSearchValue =
    deferredSearchValue.trim() === locationQuery ? "" : deferredSearchValue;
  const roommates = clampRoommatesForListings(storedRoommates, maxRoommates);
  const tokenMissing = !process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

  // The list panel shows/hides via CSS (no JS-driven width animation), so the
  // map's container resizes synchronously. Mapbox doesn't observe that on its
  // own — nudge it on the next frame so the canvas repaints to the new width.
  useEffect(() => {
    if (!map) return;
    const raf = requestAnimationFrame(() => map.resize());
    return () => cancelAnimationFrame(raf);
  }, [listCollapsed, map]);

  const {
    budgetHistogramBuckets,
    filteredListings,
    filtersMatchProfile,
    inViewCount,
    listingsInView,
    listingsWithCoords,
    matchedCount,
    neighborhoodOptions,
    profileDefaultNeighborhoods,
    propertyFeatureCollection,
    selectedListing,
    viewportNeighborhoodValues,
  } = useApartmentMapDerivedData({
    budgetIncludeUnpriced,
    budgetRange,
    deferredSearchValue: effectiveSearchValue,
    minBaths,
    minBeds,
    profileFilterDefaults,
    roommates,
    selectedId,
    selectedNeighborhoods,
    snapshot,
    sortOrder,
    viewportBounds,
  });

  // Search rescue. Two failure modes used to dead-end at "0 matched":
  // 1. The query matches listings that are simply outside the current
  //    viewport → pan/zoom the map to the matches.
  // 2. The query matches no listing text at all (a place: "near Dolores
  //    Park", "24th & Valencia") → geocode it within the market and fly
  //    there, then stop text-filtering that query (see locationQuery).
  const marketBbox = useMemo<MarketBbox | null>(() => {
    let west = Infinity;
    let south = Infinity;
    let east = -Infinity;
    let north = -Infinity;
    for (const listing of listingsWithCoords) {
      west = Math.min(west, listing.longitude);
      east = Math.max(east, listing.longitude);
      south = Math.min(south, listing.latitude);
      north = Math.max(north, listing.latitude);
    }
    if (!Number.isFinite(west)) return null;
    // ~13km margin so places just outside the listing extent still resolve.
    const margin = 0.12;
    return {
      west: west - margin,
      south: south - margin,
      east: east + margin,
      north: north + margin,
    };
  }, [listingsWithCoords]);

  // Resolve a query to a place and take the map there. Returns false when the
  // query resolves to nothing, so callers can fall back to text filtering.
  // Setting locationQuery stops the text filter fighting the move: once the map
  // is over Page St, "300 page st" is a location, not a word to match.
  // Monotonic id for the newest place lookup; stale responses check against it.
  // Claimed through a helper so the callbacks below never mutate a ref they
  // also close over as a dependency.
  const placeRequestRef = useRef(0);
  const claimPlaceRequest = useCallback(() => {
    placeRequestRef.current += 1;
    return placeRequestRef.current;
  }, []);

  const runPlaceSearch = useCallback(
    async (rawQuery: string) => {
      const query = rawQuery.trim();
      const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
      const instance = mapRef.current;
      if (!instance || !token || query.length < 3) return false;
      // Two searches in one session share a map instance, so comparing map
      // identity can never reject a superseded request. A slow response for an
      // earlier query would otherwise land after a newer one and leave the
      // field, the marker and the map describing different places.
      const requestId = claimPlaceRequest();
      const center = instance.getCenter();
      const placed = await geocodeSearchQuery({
        query,
        token,
        bbox: marketBbox,
        proximity: [center.lng, center.lat],
      });
      // Both guards: identity rejects a superseded query, and the instance
      // check rejects a response for a map that has since been torn down.
      if (
        !placed ||
        requestId !== placeRequestRef.current ||
        instance !== mapRef.current
      ) {
        return false;
      }
      setLocationQuery(query);
      setSearchedPlace({
        center: placed.center,
        name: query,
        address: placed.label,
      });
      if (placed.bbox) {
        // Neighborhoods and localities carry their own extent.
        instance.fitBounds(placed.bbox, {
          padding: LISTING_BOUNDS_PADDING,
          maxZoom: 15,
          duration: 900,
        });
      } else {
        // A single address, station or restaurant is a point — go in close
        // enough that the surrounding blocks are what fills the map.
        instance.flyTo({ center: placed.center, zoom: 15, duration: 900 });
      }
      return true;
    },
    [claimPlaceRequest, mapRef, marketBbox],
  );

  // A picked suggestion already knows exactly which feature it is, so it skips
  // the guessing that forward geocoding has to do and retrieves it by id.
  const pickSuggestion = useCallback(
    (suggestion: PlaceSuggestion, sessionToken: string) => {
      const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
      const instance = mapRef.current;
      if (!instance || !token) return;
      const requestId = claimPlaceRequest();
      void retrievePlace({ id: suggestion.id, token, sessionToken }).then(
        (placed) => {
          if (
            !placed ||
            requestId !== placeRequestRef.current ||
            instance !== mapRef.current
          ) {
            return;
          }
          const label = placed.label || suggestion.name;
          dispatch({ type: "set-search", value: suggestion.name });
          setLocationQuery(suggestion.name);
          setSearchedPlace({
            center: placed.center,
            name: suggestion.name,
            address: suggestion.context || label,
          });
          if (placed.bbox) {
            instance.fitBounds(placed.bbox, {
              padding: LISTING_BOUNDS_PADDING,
              maxZoom: 15,
              duration: 900,
            });
          } else {
            instance.flyTo({ center: placed.center, zoom: 15, duration: 900 });
          }
        },
      );
    },
    [claimPlaceRequest, dispatch, mapRef],
  );

  // A new array literal each render would change identity on every parent
  // re-render, and it is in the deps of the debounced suggest effect — whose
  // cleanup aborts the in-flight request. Under typing (which re-renders twice
  // via useDeferredValue) that could cancel autocomplete indefinitely.
  const suggestProximity = useMemo<[number, number] | null>(
    () =>
      viewportBounds
        ? [
            (viewportBounds.west + viewportBounds.east) / 2,
            (viewportBounds.south + viewportBounds.north) / 2,
          ]
        : null,
    [viewportBounds],
  );

  const geocodeAttempts = useRef(new Set<string>());
  const lastAutoFitQuery = useRef<string | null>(null);

  // Submitting is a deliberate "take me there": it geocodes whatever was typed
  // regardless of whether the text filter happens to match something, which is
  // what makes an address or a station behave like a destination rather than a
  // substring. The automatic rescue below still covers the un-submitted case.
  const submitSearch = useCallback(() => {
    const query = searchValue.trim();
    if (query.length < 3) return;
    setSearchedPlace(null);
    geocodeAttempts.current.add(query);
    void runPlaceSearch(query);
  }, [runPlaceSearch, searchValue]);

  useEffect(() => {
    const query = deferredSearchValue.trim();
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!map || !token || query.length < 3 || query === locationQuery) return;
    // Debounced past the deferred value so we act on settled queries, not
    // every keystroke prefix.
    const timer = window.setTimeout(() => {
      if (matchedCount > 0) {
        if (inViewCount > 0 || lastAutoFitQuery.current === query) return;
        lastAutoFitQuery.current = query;
        let west = Infinity;
        let south = Infinity;
        let east = -Infinity;
        let north = -Infinity;
        for (const listing of filteredListings) {
          west = Math.min(west, listing.longitude);
          east = Math.max(east, listing.longitude);
          south = Math.min(south, listing.latitude);
          north = Math.max(north, listing.latitude);
        }
        if (!Number.isFinite(west)) return;
        map.fitBounds(
          [
            [west, south],
            [east, north],
          ],
          {
            padding: LISTING_BOUNDS_PADDING,
            maxZoom: 15,
            duration: 900,
          },
        );
        return;
      }
      if (geocodeAttempts.current.has(query)) return;
      geocodeAttempts.current.add(query);
      void runPlaceSearch(query);
    }, 650);
    return () => window.clearTimeout(timer);
  }, [
    deferredSearchValue,
    filteredListings,
    inViewCount,
    locationQuery,
    map,
    matchedCount,
    runPlaceSearch,
  ]);

  const updateBoundsFromMap = useCallback((instance: MapboxMap) => {
    const bounds = instance.getBounds() as LngLatBounds | null;
    if (!bounds) return;
    const nextBounds = {
      west: bounds.getWest(),
      south: bounds.getSouth(),
      east: bounds.getEast(),
      north: bounds.getNorth(),
    };
    startTransition(() => {
      dispatch({ type: "set-viewport-bounds", bounds: nextBounds });
    });
  }, []);

  const initialDetailListings = useMemo(
    () => (initialDetailListing ? [initialDetailListing] : []),
    [initialDetailListing],
  );
  const { cacheListingDetails, openListingDetails, prefetchListingDetails } =
    useApartmentListingDetails({
      initialListings: initialDetailListings,
      onClearLoading: () => dispatch({ type: "clear-detail-loading" }),
      onOpenListing: (listing) => dispatch({ type: "set-detail", listing }),
      onStartLoading: (listingId) =>
        dispatch({ type: "set-detail-loading", id: listingId }),
    });

  // Stable identity: AnchoredPopup keys an effect on onClose, so an inline
  // arrow here would tear the Mapbox popup down on every parent re-render.
  const clearSelected = useCallback(
    () => dispatch({ type: "clear-selected" }),
    [dispatch],
  );

  const onSelectListing = useCallback(
    (listing: ListingWithCoords) => {
      dispatch({ type: "select", id: listing.id });
      prefetchListingDetails(listing);
      if (mapRef.current) {
        // Position the selected point so the popup (anchored above) sits comfortably below
        // the top of the map panel. mapbox eases center; positive y offset shifts
        // the geographic target downward on screen.
        const container = mapRef.current.getContainer();
        const mapHeight = container.clientHeight;
        // Reserve ~440px above the point for the popup + 24px margin.
        // Cap so the point doesn't crash into the bottom edge.
        const desiredMarkerY = Math.min(
          mapHeight - 60,
          Math.max(mapHeight * 0.7, 460),
        );
        const verticalOffset = desiredMarkerY - mapHeight / 2;
        mapRef.current.easeTo({
          center: [listing.longitude, listing.latitude],
          offset: [0, verticalOffset],
          duration: 450,
        });
      }
    },
    [prefetchListingDetails],
  );

  const initialFocusListing = useMemo(
    () =>
      initialListingId
        ? listingsWithCoords.find((entry) => entry.id === initialListingId) ??
          null
        : null,
    [initialListingId, listingsWithCoords],
  );

  useApartmentsMapLifecycle({
    dispatch,
    filteredListings,
    initialFocusListing,
    listingsWithCoords,
    map,
    mapContainerRef,
    mapRef,
    onSelectListing,
    propertyFeatureCollection,
    snapshotMarket: snapshot.market,
    updateBoundsFromMap,
  });

  return (
    <main className="flex h-[100dvh] w-full flex-col overflow-hidden bg-[var(--background)] text-[var(--ink-900)]">
      {tokenMissing ? (
        <MissingMapboxToken />
      ) : (
        <div className="relative flex min-h-0 flex-1 flex-col lg:flex-row">
          {/* The controls float on the map rather than sitting in a band above
              it. On desktop the layer stops at the list panel's edge so the
              bar centres over the map, not over the whole page. */}
          <div
            className={`pointer-events-none absolute inset-x-0 top-0 z-20 ${
              listCollapsed ? "" : "lg:right-[min(585px,53vw)]"
            }`}
          >
            <ApartmentsToolbar
              budgetHistogramBuckets={budgetHistogramBuckets}
              budgetIncludeUnpriced={budgetIncludeUnpriced}
              matchedCount={matchedCount}
              budgetRange={budgetRange}
              defaultBudgetRange={profileFilterDefaults.budgetRange}
              defaultRoommates={profileFilterDefaults.roommates}
              maxRoommates={maxRoommates}
              onBudgetIncludeUnpricedChange={(value) =>
              dispatch({ type: "set-budget-include-unpriced", value })
              }
              onBudgetRangeChange={(range) =>
              dispatch({ type: "set-budget-range", range })
              }
              onRoommatesChange={(value) =>
              dispatch({ type: "set-roommates", value })
              }
              onBedBathChange={(next) =>
              dispatch({
                type: "set-bed-bath",
                minBeds: next.minBeds,
                minBaths: next.minBaths,
              })
              }
              neighborhoodOptions={neighborhoodOptions}
              selectedNeighborhoods={selectedNeighborhoods}
              onNeighborhoodToggle={(value) =>
              dispatch({ type: "toggle-neighborhood", value })
              }
              onNeighborhoodsClear={() =>
                dispatch({ type: "clear-neighborhoods" })
              }
              viewportNeighborhoodValues={viewportNeighborhoodValues}
              marketLabel={snapshot.market ?? null}
              onSearchChange={(value) => dispatch({ type: "set-search", value })}
              onSubmitSearch={submitSearch}
              showResetToProfile={!filtersMatchProfile}
              onResetToProfile={() =>
                dispatch({
                  type: "reset-to-profile",
                  defaults: profileFilterDefaults,
                  neighborhoods: profileDefaultNeighborhoods,
                })
              }
              onPickSuggestion={pickSuggestion}
              suggestBbox={marketBbox}
              suggestProximity={suggestProximity}
              visibleCount={inViewCount}
              roommates={roommates}
              minBeds={minBeds}
              minBaths={minBaths}
              searchValue={searchValue}
            />
          </div>
          <ApartmentsMapPanel
            map={map}
            searchedPlace={searchedPlace}
            onDismissSearchedPlace={() => setSearchedPlace(null)}
            mapContainerRef={mapContainerRef}
            mobileHidden={mobileView !== "map"}
            onClearSelected={clearSelected}
            onOpenDetails={openListingDetails}
            roommates={roommates}
            selectedListing={selectedListing}
          />
          <ApartmentsListPanel
            searchValue={searchValue}
            onClearSearch={() => dispatch({ type: "set-search", value: "" })}
            refreshedAt={snapshot.refreshedAt}
            refreshStale={snapshot.refreshStale}
            showResetToProfile={!filtersMatchProfile}
            onResetToProfile={() =>
              dispatch({
                type: "reset-to-profile",
                defaults: profileFilterDefaults,
                neighborhoods: profileDefaultNeighborhoods,
              })
            }
            collapsed={listCollapsed}
            inViewCount={inViewCount}
            listings={listingsInView}
            matchedCount={matchedCount}
            mobileHidden={mobileView !== "list"}
            onCollapse={() => setListCollapsed(true)}
            onOpenDetails={openListingDetails}
            onPrefetchDetails={prefetchListingDetails}
            onSelectListing={onSelectListing}
            onSortOrderChange={(value) =>
              dispatch({ type: "set-sort-order", value })
            }
            onToggleSave={toggleSavedListing}
            roommates={roommates}
            savedListingIds={savedListingIds}
            selectedId={selectedId}
            sortOrder={sortOrder}
            viewportBounds={viewportBounds}
          />
          {listCollapsed ? (
            <button
              type="button"
              onClick={() => setListCollapsed(false)}
              className="kin-focus absolute right-4 top-[76px] z-30 hidden items-center gap-2 rounded-full border border-[var(--border-strong)] bg-white/95 py-2 pl-3.5 pr-2.5 text-sm font-semibold text-[var(--ink-800)] shadow-[0_8px_24px_-12px_rgba(14,31,23,0.35)] backdrop-blur transition hover:bg-[var(--bg-soft)] lg:inline-flex"
            >
              <PanelRightOpen size={15} aria-hidden="true" />
              Show list
              <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-[var(--bg-soft)] px-1.5 text-[11px] font-semibold text-[var(--ink-600)]">
                {matchedCount}
              </span>
            </button>
          ) : null}
          <MobileViewToggle
            value={mobileView}
            onChange={setMobileView}
            matchedCount={matchedCount}
          />

        </div>
      )}

      {detailListing ? (
        <PropertyDetailModal
          listing={detailListing}
          enrichedLoading={detailLoadingId != null}
          onClose={() => dispatch({ type: "close-detail" })}
          onListingUpdated={cacheListingDetails}
          roommatesOverride={roommates}
          activeProfile={snapshot.activeProfile}
        />
      ) : null}
    </main>
  );
}

function ApartmentsToolbar({
  budgetHistogramBuckets,
  budgetIncludeUnpriced,
  matchedCount,
  budgetRange,
  defaultBudgetRange,
  defaultRoommates,
  maxRoommates,
  onBudgetIncludeUnpricedChange,
  onBudgetRangeChange,
  onRoommatesChange,
  onBedBathChange,
  neighborhoodOptions,
  selectedNeighborhoods,
  onNeighborhoodToggle,
  onNeighborhoodsClear,
  viewportNeighborhoodValues,
  marketLabel,
  onSearchChange,
  showResetToProfile,
  onResetToProfile,
  onSubmitSearch,
  onPickSuggestion,
  suggestBbox,
  suggestProximity,
  visibleCount,
  roommates,
  minBeds,
  minBaths,
  searchValue,
}: {
  budgetHistogramBuckets: BudgetHistogramBucket[];
  budgetIncludeUnpriced: boolean;
  matchedCount: number;
  budgetRange: BudgetRange;
  defaultBudgetRange: BudgetRange;
  defaultRoommates: number | null;
  maxRoommates: number;
  onBudgetIncludeUnpricedChange: (value: boolean) => void;
  onBudgetRangeChange: (range: BudgetRange) => void;
  onRoommatesChange: (value: number | null) => void;
  onBedBathChange: (next: BedBathFilter) => void;
  neighborhoodOptions: NeighborhoodFilterOption[];
  selectedNeighborhoods: ReadonlySet<string>;
  onNeighborhoodToggle: (value: string) => void;
  onNeighborhoodsClear: () => void;
  viewportNeighborhoodValues: ReadonlySet<string> | null;
  marketLabel: string | null;
  onSearchChange: (value: string) => void;
  showResetToProfile: boolean;
  onResetToProfile: () => void;
  onSubmitSearch: () => void;
  onPickSuggestion: (suggestion: PlaceSuggestion, sessionToken: string) => void;
  suggestBbox: MarketBbox | null;
  suggestProximity: [number, number] | null;
  visibleCount: number;
  roommates: number | null;
  minBeds: number | null;
  minBaths: number | null;
  searchValue: string;
}) {
  // Filters apply as they change, so the bar's action is a dismissal. Clicking
  // it already lands outside every popover (which closes it); dropping focus
  // out of the text field is what releases the bar's engaged appearance.
  // Only inputs are blurred — a keyboard user who activates the button should
  // keep focus on it rather than have it dumped on <body>.
  const dismissSearchBar = () => {
    const active = document.activeElement;
    if (active instanceof HTMLInputElement) {
      active.blur();
    }
  };

  // The three facts that define the query sit inside the bar as labelled
  // fields. Everything else only narrows the result set and lives in the chip
  // row underneath.
  const searchSegments = (
    <>
      <BudgetRangeControl
        range={budgetRange}
        onChange={onBudgetRangeChange}
        buckets={budgetHistogramBuckets}
        matchedCount={matchedCount}
        profileDefaultRange={defaultBudgetRange}
        includeUnpriced={budgetIncludeUnpriced}
        onIncludeUnpricedChange={onBudgetIncludeUnpricedChange}
        variant="segment"
      />
      <BedBathControl
        minBeds={minBeds}
        minBaths={minBaths}
        onChange={onBedBathChange}
        variant="segment"
      />
      <RoommatesControl
        value={roommates}
        onChange={onRoommatesChange}
        maxRoommates={maxRoommates}
        profileDefault={defaultRoommates}
        variant="segment"
      />
    </>
  );

  // Below `sm` the bar keeps only the search field, so the same three facts
  // reappear at the head of the chip row in their pill form.
  const primaryChips = (
    <>
      <BudgetRangeControl
        range={budgetRange}
        onChange={onBudgetRangeChange}
        buckets={budgetHistogramBuckets}
        matchedCount={matchedCount}
        profileDefaultRange={defaultBudgetRange}
        includeUnpriced={budgetIncludeUnpriced}
        onIncludeUnpricedChange={onBudgetIncludeUnpricedChange}
      />
      <BedBathControl
        minBeds={minBeds}
        minBaths={minBaths}
        onChange={onBedBathChange}
      />
      <RoommatesControl
        value={roommates}
        onChange={onRoommatesChange}
        maxRoommates={maxRoommates}
        profileDefault={defaultRoommates}
      />
    </>
  );

  // The toolbar is not a band across the top of the page — it floats over the
  // map as three pieces: navigation pinned left, the search bar centred, and
  // the freshness badge pinned right. The map is the surface; these sit on it.
  return (
    <>
      <Link
        href="/me"
        className="kin-focus pointer-events-auto absolute left-3 top-[19px] z-20 grid size-10 place-items-center rounded-full bg-white text-[var(--ink-800)] shadow-[var(--lift-2)] transition hover:bg-[var(--bg-soft)] sm:left-4 sm:top-4 sm:size-11"
        aria-label="Back to Me"
      >
        <ArrowLeft size={16} aria-hidden="true" />
      </Link>

      <div className="absolute inset-x-0 top-3 z-20 flex flex-col items-center gap-2 sm:top-4 sm:gap-2.5">
        {/* One round container, hairline-divided fields, each a quiet label over
            its current value, closing on the single saturated action. Which
            field is live — and the whole bar's engaged appearance — is derived
            in CSS from the triggers' own aria-expanded (see .kin-searchbar). */}
        {/* Padded only on the left, where the pinned back button sits — the
            right side has nothing to clear since the freshness badge moved into
            the results header. Symmetric padding wasted 68px of a phone screen. */}
        <div className="flex w-full justify-center pl-[62px] pr-3 sm:px-20">
        <div className="kin-searchbar pointer-events-auto h-[54px] w-full max-w-[860px] p-[5px] sm:h-[58px]">
          <WhereControl
            searchValue={searchValue}
            onSearchChange={onSearchChange}
            onSubmit={onSubmitSearch}
            onPickSuggestion={onPickSuggestion}
            suggestBbox={suggestBbox}
            suggestProximity={suggestProximity}
            options={neighborhoodOptions}
            inViewValues={viewportNeighborhoodValues}
            selected={selectedNeighborhoods}
            onToggle={onNeighborhoodToggle}
            onClear={onNeighborhoodsClear}
            marketLabel={marketLabel}
          />

          {/* Rendered as direct children, not inside a `display: contents`
              wrapper: contents flattens rendering but NOT sibling relationships,
              so the wrapper silently killed the Where↔Budget divider. Each
              segment hides itself below `sm`, where it moves to the chip row. */}
          {searchSegments}

          {/* Filters apply as they change, so this is a dismissal, not a submit
              — it says how many homes are waiting and gets out of the way. */}
          {/* Submitting takes you to the place you typed and hands back the
              listings around it, so the count is what the list will hold —
              the viewport total, not every match in the market. */}
          <button
            type="button"
            onClick={() => {
              onSubmitSearch();
              dismissSearchBar();
            }}
            aria-label={`Show ${visibleCount} homes`}
            className="kin-searchbar-go kin-focus shrink-0 self-center"
          >
            <Search size={17} aria-hidden="true" />
            <span>
              Show <span className="mono">{visibleCount}</span>
            </span>
          </button>
        </div>
        </div>

        {/* Below `sm` the bar keeps only "Where", so the other fields reappear
            as pills. On desktop there is no chip row at all — every filter
            lives in the bar or in the results header. */}
        <div className="pointer-events-auto flex w-full items-center gap-2 overflow-x-auto px-3 pb-1 [mask-image:linear-gradient(90deg,black_0,black_calc(100%-24px),rgba(0,0,0,0.25)_100%)] [scrollbar-width:none] sm:hidden">
          {primaryChips}
          {/* Reset lives in the results header on desktop, but that header is
              hidden in mobile map view — without this a phone user who changes
              a filter has no way to undo it without switching to the list. */}
          {showResetToProfile ? (
            <button
              type="button"
              onClick={onResetToProfile}
              className="kin-focus inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-white px-3 text-[13px] font-semibold text-[var(--ink-700)] shadow-[var(--lift-2)]"
            >
              <RotateCcw size={12} aria-hidden="true" />
              Reset
            </button>
          ) : null}
        </div>
      </div>

    </>
  );
}

// Data freshness badge in the header. refreshedAt is the median last_seen_at
// across the loaded listings — when the typical displayed listing was last
// scraped at the source — so the badge goes amber instead of pretending the
// data is live when the import job hasn't run (or only partially ran).
const subscribeNoop = () => () => {};

function DataFreshnessIndicator({
  refreshedAt,
  stale,
}: {
  refreshedAt: string | null;
  stale: boolean;
}) {
  // Time formatting depends on the viewer's locale/timezone, which the server
  // can't know. useSyncExternalStore returns the server snapshot (false) during
  // SSR and the first client render — so they agree (no hydration mismatch) —
  // then re-renders with the client snapshot (true) to fill in the local time.
  const mounted = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );

  const refreshedDate = useMemo(
    () => (refreshedAt ? new Date(refreshedAt) : null),
    [refreshedAt],
  );
  const shortLabel = useMemo(
    () =>
      refreshedDate?.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }) ?? null,
    [refreshedDate],
  );
  const fullLabel = useMemo(
    () =>
      refreshedDate?.toLocaleString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      }) ?? null,
    [refreshedDate],
  );

  const badge = freshnessBadgeState({
    hasTimestamp: refreshedDate != null,
    stale,
    shortLabel: mounted ? shortLabel : null,
    fullLabel: mounted ? fullLabel : null,
  });

  return (
    <div className="group relative shrink-0">
      {/* tabIndex makes the tooltip reachable by keyboard/switch access —
          group-focus-within never fires without a focusable element inside. */}
      <output
        tabIndex={0}
        aria-label={badge.ariaLabel}
        className="kin-focus inline-flex items-center gap-1.5 rounded-full border border-[var(--border-strong)] bg-white py-1.5 pl-2.5 pr-3 text-[var(--ink-600)] transition hover:bg-[var(--bg-soft)]"
      >
        <span className="relative grid size-2 place-items-center">
          {badge.ping ? (
            <span
              className={`absolute inline-flex size-2 rounded-full ${badge.dotClass} opacity-60 motion-safe:animate-ping`}
            />
          ) : null}
          <span
            className={`relative inline-flex size-2 rounded-full ${badge.dotClass}`}
          />
        </span>
        {badge.mobileBadgeLabel ? (
          <span className="text-[11px] font-semibold sm:hidden">
            {badge.mobileBadgeLabel}
          </span>
        ) : null}
        <span
          className="hidden text-[11px] font-semibold sm:inline"
          suppressHydrationWarning
        >
          {badge.badgeLabel}
        </span>
      </output>

      <div
        role="tooltip"
        className="pointer-events-none absolute right-0 top-full z-50 mt-2 w-64 origin-top-right translate-y-1 rounded-xl border border-[var(--border-strong)] bg-white p-3 text-left opacity-0 shadow-[0_18px_40px_-20px_rgba(14,31,23,0.45)] transition duration-150 group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100"
      >
        <p className="flex items-center gap-1.5 text-xs font-semibold text-[var(--ink-900)]">
          <span
            className={`inline-flex size-2 rounded-full ${badge.dotClass}`}
          />
          {badge.title}
        </p>
        <p
          className="mt-1.5 text-[11px] leading-relaxed text-[var(--ink-600)]"
          suppressHydrationWarning
        >
          {badge.detail}
        </p>
      </div>
    </div>
  );
}

function MissingMapboxToken() {
  return (
    <div className="grid flex-1 place-items-center bg-[#f3f0e7] p-8 text-center">
      <div className="max-w-md rounded-2xl border border-[var(--border-strong)] bg-white p-6 shadow-xl">
        <p className="text-[13px] font-semibold text-[var(--ink-600)]">
          Mapbox token missing
        </p>
        <h2 className="serif mt-2 text-2xl">Add NEXT_PUBLIC_MAPBOX_TOKEN</h2>
        <p className="mt-3 text-sm text-[var(--ink-600)]">
          Set a Mapbox public token in <code>.env.local</code> and restart the
          dev server.
        </p>
      </div>
    </div>
  );
}

// Marks the point a search resolved to.
//
// A bare dot was not enough: on a map already carrying priced listing pins, a
// second unlabelled dot reads as noise. This states what it is — the name and
// street of the thing that was searched — and can be dismissed, because a
// marker you cannot get rid of becomes clutter the moment it stops being
// useful. Rendered through a portal into the marker element so the dismiss
// button is a real React control rather than hand-wired DOM.
function SearchedPlacePin({
  map,
  place,
  onDismiss,
}: {
  map: MapboxMap;
  place: SearchedPlace;
  onDismiss: () => void;
}) {
  const [container] = useState(() => {
    if (typeof document === "undefined") return null;
    const node = document.createElement("div");
    // mapbox-gl creates this element with pointer-events defaulting to auto and
    // sizes it to the whole flex column — card width by card+stem+dot height.
    // Left alone it swallows clicks and drag-starts across that entire
    // rectangle, including the transparent gutters either side of the stem, so
    // listing chips near the pin become unclickable. Only the dismiss button
    // opts back in (see .kin-place-card-dismiss).
    node.style.pointerEvents = "none";
    return node;
  });

  useEffect(() => {
    if (!container) return;
    let cancelled = false;
    let marker: { remove: () => void } | null = null;

    void import("mapbox-gl")
      .then(({ default: mapboxgl }) => {
        if (cancelled) return;
        marker = new mapboxgl.Marker({
          element: container,
          anchor: "bottom",
        })
          .setLngLat(place.center)
          .addTo(map);
      })
      .catch((error: unknown) => {
        console.warn("Unable to place the search pin", error);
      });

    return () => {
      cancelled = true;
      marker?.remove();
      marker = null;
    };
  }, [container, map, place.center]);

  if (!container) return null;

  return createPortal(
    <div className="kin-place-pin">
      <div className="kin-place-card">
        <span className="kin-place-card-text">
          <span className="kin-place-card-name">{place.name}</span>
          {place.address ? (
            <span className="kin-place-card-address">{place.address}</span>
          ) : null}
        </span>
        <button
          type="button"
          onClick={onDismiss}
          aria-label={`Clear the ${place.name} marker`}
          className="kin-place-card-dismiss kin-focus"
        >
          <X size={13} aria-hidden="true" />
        </button>
      </div>
      <span className="kin-place-pin-stem" aria-hidden="true" />
      <span className="kin-place-pin-dot" aria-hidden="true" />
    </div>,
    container,
  );
}

function ApartmentsMapPanel({
  map,
  searchedPlace,
  onDismissSearchedPlace,
  mapContainerRef,
  mobileHidden,
  onClearSelected,
  onOpenDetails,
  roommates,
  selectedListing,
}: {
  map: MapboxMap | null;
  searchedPlace: SearchedPlace | null;
  onDismissSearchedPlace: () => void;
  mapContainerRef: RefObject<HTMLDivElement | null>;
  mobileHidden: boolean;
  onClearSelected: () => void;
  onOpenDetails: (listing: ApartmentListing) => void | Promise<void>;
  roommates: number | null;
  selectedListing: ListingWithCoords | null;
}) {
  return (
    <section
      className={`relative min-h-0 w-full shrink-0 lg:!block lg:h-auto lg:flex-1 ${
        mobileHidden ? "hidden" : "block flex-1"
      }`}
    >
      <div ref={mapContainerRef} className="size-full" />

      {map && searchedPlace ? (
        <SearchedPlacePin
          map={map}
          place={searchedPlace}
          onDismiss={onDismissSearchedPlace}
        />
      ) : null}

      {map && selectedListing ? (
        <AnchoredPopup
          map={map}
          listing={selectedListing}
          onClose={onClearSelected}
          onOpenDetails={() => {
            void onOpenDetails(selectedListing);
          }}
          roommates={roommates}
        />
      ) : null}
    </section>
  );
}

function measureVirtualApartmentList(
  node: HTMLDivElement,
): VirtualListViewport {
  const styles = window.getComputedStyle(node);
  const horizontalPadding =
    Number.parseFloat(styles.paddingLeft) +
    Number.parseFloat(styles.paddingRight);

  return {
    height: node.clientHeight || LIST_PANEL_INITIAL_HEIGHT,
    scrollTop: node.scrollTop,
    width: Math.max(
      0,
      (node.clientWidth || LIST_PANEL_INITIAL_WIDTH) - horizontalPadding,
    ),
  };
}

function viewportSnapshotsEqual(
  a: VirtualListViewport,
  b: VirtualListViewport,
) {
  return (
    Math.abs(a.height - b.height) < 1 &&
    Math.abs(a.scrollTop - b.scrollTop) < 1 &&
    Math.abs(a.width - b.width) < 1
  );
}

function createVirtualApartmentListStore() {
  let node: HTMLDivElement | null = null;
  let snapshot = LIST_PANEL_DEFAULT_VIEWPORT;
  let resizeObserver: ResizeObserver | null = null;
  const listeners = new Set<() => void>();

  const emit = () => {
    for (const listener of listeners) listener();
  };
  const updateSnapshot = (nextSnapshot: VirtualListViewport) => {
    if (viewportSnapshotsEqual(snapshot, nextSnapshot)) return;
    snapshot = nextSnapshot;
    emit();
  };
  const syncFromNode = () => {
    if (!node) return;
    updateSnapshot(measureVirtualApartmentList(node));
  };
  const handleScroll = () => syncFromNode();

  return {
    clampScrollTop(maxScrollTop: number) {
      if (!node || node.scrollTop <= maxScrollTop) return;
      node.scrollTop = maxScrollTop;
      syncFromNode();
    },
    scrollToTop() {
      if (!node || node.scrollTop === 0) return;
      node.scrollTop = 0;
      syncFromNode();
    },
    getServerSnapshot() {
      return LIST_PANEL_DEFAULT_VIEWPORT;
    },
    getSnapshot() {
      return snapshot;
    },
    setNode(nextNode: HTMLDivElement | null) {
      if (node === nextNode) return;
      if (node) node.removeEventListener("scroll", handleScroll);
      resizeObserver?.disconnect();
      resizeObserver = null;
      node = nextNode;
      if (!node) {
        updateSnapshot(LIST_PANEL_DEFAULT_VIEWPORT);
        return;
      }

      node.addEventListener("scroll", handleScroll, { passive: true });
      syncFromNode();
      resizeObserver = new ResizeObserver(syncFromNode);
      resizeObserver.observe(node);
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function useVirtualApartmentList(listingCount: number) {
  const [store] = useState<VirtualListStore>(createVirtualApartmentListStore);
  const viewport = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );

  const columnCount = viewport.width >= 520 ? 2 : 1;
  const rowHeight = LIST_PANEL_CARD_HEIGHT + LIST_PANEL_ROW_GAP;
  const rowCount = Math.ceil(listingCount / columnCount);
  const scrollHeight =
    rowCount === 0 ? 0 : rowCount * rowHeight - LIST_PANEL_ROW_GAP;
  const maxScrollTop = Math.max(0, scrollHeight - viewport.height);
  const scrollTop = Math.min(viewport.scrollTop, maxScrollTop);
  const startRow = Math.max(
    0,
    Math.floor(scrollTop / rowHeight) - LIST_PANEL_OVERSCAN_ROWS,
  );
  const endRow = Math.min(
    rowCount,
    Math.ceil((scrollTop + viewport.height) / rowHeight) +
      LIST_PANEL_OVERSCAN_ROWS,
  );
  const startIndex = startRow * columnCount;
  const endIndex = Math.min(listingCount, endRow * columnCount);

  useEffect(() => {
    store.clampScrollTop(maxScrollTop);
  }, [maxScrollTop, store]);

  return {
    columnCount,
    endIndex,
    rowHeight,
    scrollerRef: store.setNode,
    scrollHeight,
    scrollToTop: store.scrollToTop,
    startIndex,
  };
}

function ApartmentsListPanel({
  searchValue,
  onClearSearch,
  refreshedAt,
  refreshStale,
  showResetToProfile,
  onResetToProfile,
  collapsed,
  inViewCount,
  listings,
  matchedCount,
  mobileHidden,
  onCollapse,
  onOpenDetails,
  onPrefetchDetails,
  onSelectListing,
  onSortOrderChange,
  onToggleSave,
  roommates,
  savedListingIds,
  selectedId,
  sortOrder,
  viewportBounds,
}: {
  searchValue: string;
  onClearSearch: () => void;
  refreshedAt: string | null;
  refreshStale: boolean;
  showResetToProfile: boolean;
  onResetToProfile: () => void;
  collapsed: boolean;
  inViewCount: number;
  listings: ListingWithCoords[];
  matchedCount: number;
  mobileHidden: boolean;
  onCollapse: () => void;
  onOpenDetails: (listing: ApartmentListing) => void | Promise<void>;
  onPrefetchDetails: (listing: ApartmentListing) => void;
  onSelectListing: (listing: ListingWithCoords) => void;
  onSortOrderChange: (value: ApartmentSortOrder) => void;
  onToggleSave: (listingId: string) => void;
  roommates: number | null;
  savedListingIds: ReadonlySet<string>;
  selectedId: string | null;
  sortOrder: ApartmentSortOrder;
  viewportBounds: Bounds | null;
}) {
  const {
    columnCount,
    endIndex,
    rowHeight,
    scrollerRef,
    scrollHeight,
    scrollToTop,
    startIndex,
  } = useVirtualApartmentList(listings.length);
  const visibleListings = listings.slice(startIndex, endIndex);

  // The panel is ordered by signal score, which weighs group momentum on top
  // of fit — so the leader may not carry the highest displayed fit score. The
  // badge only appears when it agrees with the numbers the cards print: the
  // leader holds the panel's max fitScore and sits in the confident band.
  const leaderIsBestFit = useMemo(() => {
    if (sortOrder !== "best-fit" || listings.length === 0) return false;
    const leader = listings[0];
    if (fitToneForScore(leader.fitScore) !== "positive") return false;
    return listings.every((listing) => listing.fitScore <= leader.fitScore);
  }, [listings, sortOrder]);

  // Re-sorting reorders the whole list — snap back to the top so the user
  // sees the new #1, not an arbitrary middle page of the new order.
  useEffect(() => {
    scrollToTop();
  }, [scrollToTop, sortOrder]);

  return (
    <aside
      className={`min-h-0 w-full shrink-0 flex-col border-t border-[var(--border)] bg-white lg:border-l lg:border-t-0 ${
        collapsed ? "lg:!hidden" : "lg:!flex lg:w-[min(585px,53vw)]"
      } ${mobileHidden ? "hidden" : "flex flex-1"}`}
    >
      {/* On mobile the floating controls sit over this panel, so the header
          starts clear of them; on desktop they stay over the map.

          The fit gate lives here rather than as a pill floating on the map:
          it is a question about result quality, which is the same question the
          sort control answers, so the two belong side by side. */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-[var(--border)] bg-white px-4 pb-3 pt-[108px] lg:pt-3">
        <p className="text-sm font-semibold text-[var(--ink-900)]">
          <span className="mono">{matchedCount}</span> matched
          {viewportBounds && inViewCount !== matchedCount ? (
            <span className="font-normal text-[var(--ink-600)]">
              {" "}
              · <span className="mono">{inViewCount}</span> in view
            </span>
          ) : null}
          {showResetToProfile ? (
            <button
              type="button"
              onClick={onResetToProfile}
              className="kin-focus ml-2 inline-flex items-center gap-1 rounded-full align-baseline text-[13px] font-semibold text-[var(--ink-600)] underline-offset-4 transition hover:text-[var(--ink-900)] hover:underline"
            >
              <RotateCcw size={11} aria-hidden="true" />
              Reset
            </button>
          ) : null}
        </p>
        <div className="flex items-center gap-3">
          {/* Data freshness belongs with the listings it describes. It used to
              float at the top-right of the map, where it sat on top of the
              search bar's own action. */}
          <DataFreshnessIndicator refreshedAt={refreshedAt} stale={refreshStale} />
          <SortControl value={sortOrder} onChange={onSortOrderChange} />
          <button
            type="button"
            onClick={onCollapse}
            aria-label="Collapse list for full map"
            title="Collapse list"
            className="kin-focus hidden size-8 shrink-0 place-items-center rounded-full text-[var(--ink-500)] transition hover:bg-[var(--bg-soft)] hover:text-[var(--ink-800)] lg:grid"
          >
            <PanelRightClose size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div
        ref={scrollerRef}
        className="flex-1 overflow-y-auto px-4 py-4"
      >
        {listings.length === 0 ? (
          <div className="rounded-[var(--radius-card)] bg-[var(--bg-soft)] p-6 text-center text-[14px] leading-relaxed text-[var(--ink-700)]">
            {/* Two different dead ends used to read the same way. An empty
                viewport is fixed by panning; a query that matched nothing
                anywhere — and resolved to no place either — is not, and
                "pan or zoom out" sends the user chasing listings that do not
                exist. */}
            {matchedCount === 0 && searchValue.trim() ? (
              <>
                Nothing matches{" "}
                <span className="font-semibold text-[var(--ink-900)]">
                  “{searchValue.trim()}”
                </span>
                , and we couldn&rsquo;t find a place by that name either.
                <button
                  type="button"
                  onClick={onClearSearch}
                  className="kin-focus mt-3 block w-full text-[14px] font-semibold text-[var(--forest-700)] underline-offset-4 hover:underline"
                >
                  Clear the search
                </button>
              </>
            ) : (
              "No matches in the current map view. Pan or zoom out to see more."
            )}
          </div>
        ) : (
          <div
            className="relative pb-20 lg:pb-3"
            style={{
              minHeight: scrollHeight + 80,
            }}
          >
            {visibleListings.map((listing, offset) => {
              const index = startIndex + offset;
              const row = Math.floor(index / columnCount);
              const column = index % columnCount;
              return (
                <div
                  key={listing.id}
                  className="absolute"
                  style={{
                    height: LIST_PANEL_CARD_HEIGHT,
                    left:
                      columnCount === 1
                        ? 0
                        : column === 0
                          ? 0
                          : `calc((100% + ${LIST_PANEL_ROW_GAP}px) / 2)`,
                    top: row * rowHeight,
                    width:
                      columnCount === 1
                        ? "100%"
                        : `calc((100% - ${LIST_PANEL_ROW_GAP}px) / 2)`,
                  }}
                >
                  <PropertyListCard
                    listing={listing}
                    selected={selectedId === listing.id}
                    onPreviewIntent={() => onPrefetchDetails(listing)}
                    onSelect={() => onSelectListing(listing)}
                    onOpenDetail={() => onOpenDetails(listing)}
                    imagePriority={index < 4}
                    roommatesOverride={roommates}
                    saved={savedListingIds.has(listing.id)}
                    onToggleSave={onToggleSave}
                    topPick={index === 0 && leaderIsBestFit}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}

function MobileViewToggle({
  value,
  onChange,
  matchedCount,
}: {
  value: "map" | "list";
  onChange: (value: "map" | "list") => void;
  matchedCount: number;
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex justify-center px-4 lg:hidden">
      <div
        role="tablist"
        aria-label="Switch between map and list view"
        className="pointer-events-auto inline-flex items-center gap-1 rounded-full border border-[var(--border-strong)] bg-white/95 p-1 shadow-[0_8px_24px_-12px_rgba(14,31,23,0.35)] backdrop-blur"
      >
        <button
          type="button"
          role="tab"
          aria-selected={value === "map"}
          onClick={() => onChange("map")}
          className={`kin-focus inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-sm font-semibold transition ${
            value === "map"
              ? "bg-[var(--forest-700)] text-white"
              : "text-[var(--ink-700)] hover:bg-[var(--bg-soft)]"
          }`}
        >
          <MapIcon size={15} aria-hidden="true" />
          Map
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={value === "list"}
          onClick={() => onChange("list")}
          className={`kin-focus inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-sm font-semibold transition ${
            value === "list"
              ? "bg-[var(--forest-700)] text-white"
              : "text-[var(--ink-700)] hover:bg-[var(--bg-soft)]"
          }`}
        >
          <ListIcon size={15} aria-hidden="true" />
          List
          <span
            className={`ml-1 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[11px] font-semibold ${
              value === "list"
                ? "bg-white/20 text-white"
                : "bg-[var(--bg-soft)] text-[var(--ink-600)]"
            }`}
          >
            {matchedCount}
          </span>
        </button>
      </div>
    </div>
  );
}

function AnchoredPopup({
  map,
  listing,
  onClose,
  onOpenDetails,
  roommates,
}: {
  map: MapboxMap;
  listing: ApartmentListing;
  onClose: () => void;
  onOpenDetails: () => void;
  roommates: number | null;
}) {
  const [container] = useState(() => {
    if (typeof document === "undefined") return null;
    return document.createElement("div");
  });
  useEffect(() => {
    if (!container) return;
    if (listing.latitude == null || listing.longitude == null) return;
    const coordinates: [number, number] = [listing.longitude, listing.latitude];
    let cancelled = false;
    let popup: MapboxPopup | null = null;
    const handleClose = () => onClose();

    void import("mapbox-gl")
      .then(({ default: mapboxgl }) => {
        if (cancelled) return;
        const currentPopup = new mapboxgl.Popup({
          closeButton: false,
          closeOnClick: false,
          anchor: "bottom",
          offset: 18,
          maxWidth: "340px",
          className: "kinfolk-anchored-popup",
        })
          .setLngLat(coordinates)
          .setDOMContent(container)
          .addTo(map);
        popup = currentPopup;
        currentPopup.on("close", handleClose);
      })
      .catch((error: unknown) => {
        console.warn("Unable to load Mapbox popup", error);
      });

    return () => {
      cancelled = true;
      const currentPopup = popup;
      if (currentPopup) {
        currentPopup.off("close", handleClose);
        currentPopup.remove();
      }
      popup = null;
    };
  }, [
    container,
    listing.id,
    listing.latitude,
    listing.longitude,
    map,
    onClose,
  ]);

  if (!container) return null;
  return createPortal(
    <PropertyPopupCard
      listing={listing}
      onClose={onClose}
      onOpenDetails={onOpenDetails}
      roommatesOverride={roommates}
    />,
    container,
  );
}
