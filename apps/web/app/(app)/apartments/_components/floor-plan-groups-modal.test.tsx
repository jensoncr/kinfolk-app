import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import type { FloorPlanType } from "@/lib/apartments/types";
import { FloorPlanGroupsModal } from "./floor-plan-groups-modal";
import { groupDetailFooterActionState } from "./floor-plan-groups-modal-state";

vi.mock("react-dom", async () => {
  const actual = await vi.importActual<typeof import("react-dom")>("react-dom");
  return {
    ...actual,
    createPortal: (children: React.ReactNode) => children,
  };
});

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) =>
    React.createElement("img", {
      alt: typeof props.alt === "string" ? props.alt : "",
      src: typeof props.src === "string" ? props.src : "",
    }),
}));

vi.mock("@/components/ui/confetti", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    Confetti: function Confetti({
      ref,
      ...props
    }: React.ComponentPropsWithRef<"div">) {
      return React.createElement("div", { ...props, ref });
    },
  };
});

const floorPlan: FloorPlanType = {
  availableAt: null,
  availableUnits: 1,
  bathrooms: 1,
  bedrooms: 2,
  effectiveRentPriceMax: 4200,
  effectiveRentPriceMin: 4200,
  groups: [],
  id: "plan-a",
  imageUrl: null,
  leaseTerms: [],
  name: "Plan A",
  rentPriceMax: 4200,
  rentPriceMin: 4200,
  specificAmenities: [],
  sqftMax: null,
  sqftMin: null,
  totalUnits: 1,
  units: [],
};

const openGroup = {
  id: "group-open",
  maxSize: 3,
  targetUnitName: "2A",
  members: [
    {
      color: "forest" as const,
      flex: false,
      initials: "LC",
      matchScore: 86,
      name: "Leo Chen",
    },
    {
      color: "mint" as const,
      flex: true,
      initials: "PS",
      matchScore: 78,
      name: "Priya Shah",
    },
  ],
};

const viewerOnlyGroup = {
  id: "group-viewer",
  maxSize: 2,
  targetUnitName: "2B",
  members: [
    {
      color: "warm" as const,
      flex: false,
      initials: "YO",
      name: "You",
    },
  ],
};

describe("FloorPlanGroupsModal", () => {
  it("renders group action failures inside the active groups modal", () => {
    vi.stubGlobal("document", { body: {} });

    const html = renderToStaticMarkup(
      <FloorPlanGroupsModal
        actionError="This group is already full."
        floorPlan={floorPlan}
        userGroupId={null}
        userStatus={null}
        onClose={vi.fn()}
        onLeave={vi.fn()}
        onRequestJoin={vi.fn()}
        onStartGroup={vi.fn()}
      />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain("This group is already full.");

    vi.unstubAllGlobals();
  });

  it("keeps request-to-join disabled while the matching group request is pending", () => {
    expect(
      groupDetailFooterActionState({
        group: openGroup,
        hasOtherMembership: false,
        isSoloUserGroup: false,
        isUserInThis: false,
        pendingAction: "request:group-open",
        ready: false,
        userStatus: null,
      }),
    ).toMatchObject({
      kind: "request",
      buttonLabel: "Requesting...",
      disabled: true,
      detailText:
        "Leo & Priya will see your profile to confirm the household. Nothing is final until they accept.",
    });
  });

  it("lets pending members withdraw from the group that is reviewing them", () => {
    expect(
      groupDetailFooterActionState({
        group: openGroup,
        hasOtherMembership: false,
        isSoloUserGroup: false,
        isUserInThis: true,
        pendingAction: "leave:group-open",
        ready: false,
        userStatus: "requested",
      }),
    ).toEqual({
      kind: "requested",
      statusText: "Leo & Priya are reviewing your profile.",
      buttonLabel: "Withdraw",
      disabled: true,
    });
  });

  it("blocks alternate group requests when the viewer already has a listing group", () => {
    expect(
      groupDetailFooterActionState({
        group: openGroup,
        hasOtherMembership: true,
        isSoloUserGroup: false,
        isUserInThis: false,
        pendingAction: null,
        ready: false,
        userStatus: null,
      }),
    ).toEqual({
      kind: "other-membership",
      detailText:
        "You're already with another group on this listing. Leave it first to request a different one.",
    });
  });

  it("labels a solo viewer group as deletable instead of a generic leave", () => {
    expect(
      groupDetailFooterActionState({
        group: viewerOnlyGroup,
        hasOtherMembership: false,
        isSoloUserGroup: true,
        isUserInThis: true,
        pendingAction: null,
        ready: false,
        userStatus: "member",
      }),
    ).toMatchObject({
      kind: "member",
      buttonLabel: "Delete group",
      disabled: false,
      detailText: "Delete it if you aren't looking here anymore.",
    });
  });

  it("does not offer a request action for a full group", () => {
    expect(
      groupDetailFooterActionState({
        group: openGroup,
        hasOtherMembership: false,
        isSoloUserGroup: false,
        isUserInThis: false,
        pendingAction: null,
        ready: true,
        userStatus: null,
      }),
    ).toEqual({
      kind: "full",
      detailText: "This group is full and ready to book. No open rooms right now.",
    });
  });
});
