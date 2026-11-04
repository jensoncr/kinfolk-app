import { describe, expect, it } from "vitest";
import { resolveApartmentMapInitialView } from "./map-initial-view";

const defaultCenter: [number, number] = [-122.4194, 37.7749];
const maxZoom = 13;

describe("resolveApartmentMapInitialView", () => {
  it("centers a deep-linked listing before saved views or fitted bounds", () => {
    expect(
      resolveApartmentMapInitialView({
        defaultCenter,
        fallbackListing: { latitude: 37.7, longitude: -122.4 },
        initialBounds: [
          [-123, 37],
          [-122, 38],
        ],
        initialFocusListing: { latitude: 37.8, longitude: -122.5 },
        maxZoom,
        savedView: {
          bearing: 20,
          center: [-121, 36],
          pitch: 15,
          zoom: 15,
        },
      }),
    ).toEqual({
      kind: "camera",
      bearing: 20,
      center: [-122.5, 37.8],
      pitch: 15,
      zoom: 15,
    });
  });

  it("uses the deep-linked listing max zoom when a saved view is zoomed out", () => {
    expect(
      resolveApartmentMapInitialView({
        defaultCenter,
        fallbackListing: null,
        initialBounds: undefined,
        initialFocusListing: { latitude: 37.8, longitude: -122.5 },
        maxZoom,
        savedView: {
          bearing: 0,
          center: [-121, 36],
          pitch: 0,
          zoom: 9,
        },
      }),
    ).toMatchObject({
      center: [-122.5, 37.8],
      zoom: maxZoom,
    });
  });

  it("uses a saved view when there is no linked listing focus", () => {
    expect(
      resolveApartmentMapInitialView({
        defaultCenter,
        fallbackListing: null,
        initialBounds: [
          [-123, 37],
          [-122, 38],
        ],
        initialFocusListing: null,
        maxZoom,
        savedView: {
          bearing: 10,
          center: [-121, 36],
          pitch: 5,
          zoom: 12,
        },
      }),
    ).toEqual({
      kind: "camera",
      bearing: 10,
      center: [-121, 36],
      pitch: 5,
      zoom: 12,
    });
  });

  it("fits listing bounds before falling back to a single listing or market center", () => {
    const initialBounds: [[number, number], [number, number]] = [
      [-123, 37],
      [-122, 38],
    ];

    expect(
      resolveApartmentMapInitialView({
        defaultCenter,
        fallbackListing: { latitude: 37.7, longitude: -122.4 },
        initialBounds,
        initialFocusListing: null,
        maxZoom,
        savedView: null,
      }),
    ).toEqual({ kind: "bounds", bounds: initialBounds });
  });

  it("falls back to a single listing and then the default market center", () => {
    expect(
      resolveApartmentMapInitialView({
        defaultCenter,
        fallbackListing: { latitude: 37.7, longitude: -122.4 },
        initialBounds: undefined,
        initialFocusListing: null,
        maxZoom,
        savedView: null,
      }),
    ).toMatchObject({
      center: [-122.4, 37.7],
      zoom: maxZoom,
    });

    expect(
      resolveApartmentMapInitialView({
        defaultCenter,
        fallbackListing: null,
        initialBounds: undefined,
        initialFocusListing: null,
        maxZoom,
        savedView: null,
      }),
    ).toMatchObject({
      center: defaultCenter,
      zoom: 11,
    });
  });
});
