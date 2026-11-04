type ApartmentMapSavedView = {
  center: [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
};

type ApartmentMapInitialListing = {
  latitude: number;
  longitude: number;
};

export type ApartmentMapBounds = [[number, number], [number, number]];

type ResolveApartmentMapInitialViewArgs = {
  defaultCenter: [number, number];
  fallbackListing: ApartmentMapInitialListing | null;
  initialBounds: ApartmentMapBounds | undefined;
  initialFocusListing: ApartmentMapInitialListing | null;
  maxZoom: number;
  savedView: ApartmentMapSavedView | null;
};

export type ApartmentMapInitialView =
  | { kind: "bounds"; bounds: ApartmentMapBounds }
  | {
      kind: "camera";
      bearing: number;
      center: [number, number];
      pitch: number;
      zoom: number;
    };

export function resolveApartmentMapInitialView({
  defaultCenter,
  fallbackListing,
  initialBounds,
  initialFocusListing,
  maxZoom,
  savedView,
}: ResolveApartmentMapInitialViewArgs): ApartmentMapInitialView {
  if (initialFocusListing) {
    return {
      kind: "camera",
      bearing: savedView?.bearing ?? 0,
      center: [initialFocusListing.longitude, initialFocusListing.latitude],
      pitch: savedView?.pitch ?? 0,
      zoom: Math.max(savedView?.zoom ?? maxZoom, maxZoom),
    };
  }

  if (!savedView && initialBounds) {
    return { kind: "bounds", bounds: initialBounds };
  }

  if (savedView) {
    return {
      kind: "camera",
      bearing: savedView.bearing,
      center: savedView.center,
      pitch: savedView.pitch,
      zoom: savedView.zoom,
    };
  }

  if (fallbackListing) {
    return {
      kind: "camera",
      bearing: 0,
      center: [fallbackListing.longitude, fallbackListing.latitude],
      pitch: 0,
      zoom: maxZoom,
    };
  }

  return {
    kind: "camera",
    bearing: 0,
    center: defaultCenter,
    pitch: 0,
    zoom: 11,
  };
}
