import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  ContinueOnPhone,
  ContinueOnPhoneModal,
} from "@/app/(app)/me/_components/continue-on-phone";
import { DashboardShell } from "@/app/(app)/me/_components/dashboard-shell";
import { MatchesPane, RequestActionError } from "@/app/(app)/me/_components/matches-pane";
import { PlanPane } from "@/app/(app)/me/_components/plan-pane";
import { ProfileEnrichmentPanel } from "@/app/(app)/me/_components/profile-enrichment-panel";
import { ProfilePane } from "@/app/(app)/me/_components/profile-page";
import { SettingsPane } from "@/app/(app)/me/_components/settings-page";
import { ProfileEnrichmentForm } from "@/app/(app)/me/_components/enrichment/profile-enrichment-form";
import type { MatchesSnapshot, RoommateProfileDetail } from "@/lib/matching/matches";
import type { LivingPlan, SavedListing } from "@/lib/plan/plan";
import {
  emptyProfileEnrichmentFormValues,
  type ProfileEnrichmentFormValues,
} from "@/lib/profiles/enrichment-form";
import { ENRICHMENT_TAG_VALUE_MAX_LENGTH } from "@/app/(app)/me/_components/enrichment/profile-enrichment-form-state";
import { buildProfileViewModel } from "@/lib/profiles/view";
import type {
  DashboardSnapshot,
  ProfileEnrichmentSnapshot,
} from "@/lib/shared/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
    push: vi.fn(),
    refresh: vi.fn(),
    replace: vi.fn(),
  }),
}));

vi.mock("next/link", async () => {
  const React = await vi.importActual<typeof import("react")>("react");

  return {
    default: ({
      children,
      href,
      ...props
    }: {
      children: React.ReactNode;
      href: string | { toString: () => string };
    }) =>
      React.createElement(
        "a",
        { ...props, href: typeof href === "string" ? href : href.toString() },
        children,
      ),
  };
});

vi.mock("next/image", async () => {
  const React = await vi.importActual<typeof import("react")>("react");

  function normalizeImgProps({
    alt = "",
    height,
    src = "",
    width,
    ...props
  }: Record<string, unknown>) {
    for (const key of ["fill", "priority", "quality", "sizes", "unoptimized"]) {
      delete props[key];
    }

    return {
      ...props,
      alt,
      height: typeof height === "number" ? height : undefined,
      src: typeof src === "string" ? src : "",
      width: typeof width === "number" ? width : undefined,
    };
  }

  return {
    default: (props: Record<string, unknown>) =>
      React.createElement("img", normalizeImgProps(props)),
    getImageProps: ({ props }: { props: Record<string, unknown> }) => ({
      props: normalizeImgProps(props),
    }),
  };
});

vi.mock("@/lib/integrations/continue-on-phone-server", () => ({
  getContinueOnPhoneConfig: () => ({
    agentEnabled: true,
    challengeEndpoint: "/api/kinfolk/continue-on-phone/challenge",
    publicHandoffBaseUrl: "http://localhost:3000",
  }),
}));

vi.mock("@/app/(app)/me/_components/linkedin-auth-gate", async () => {
  const React = await vi.importActual<typeof import("react")>("react");

  return {
    LinkedInAuthGate: () => React.createElement("main", null, "Welcome to Kinfolk."),
  };
});

vi.mock("@/app/(app)/me/_components/enrich-welcome-modal", async () => {
  const React = await vi.importActual<typeof import("react")>("react");

  return {
    EnrichWelcomeModal: ({
      enabled,
      hasAssistantImport,
      pendingFactCount,
    }: {
      enabled: boolean;
      hasAssistantImport: boolean;
      pendingFactCount: number;
    }) =>
      enabled
        ? React.createElement(
            "div",
            { "data-testid": "enrich-welcome-modal" },
            `Memory welcome ${hasAssistantImport ? "review" : "fresh"} ${pendingFactCount}`,
          )
        : null,
  };
});

vi.mock("@/app/(app)/me/_components/conversation-welcome-modal", async () => {
  const React = await vi.importActual<typeof import("react")>("react");

  return {
    ConversationWelcomeModal: ({
      enabled,
      firstName,
    }: {
      enabled: boolean;
      firstName: string;
    }) =>
      enabled
        ? React.createElement(
            "div",
            { "data-testid": "conversation-welcome-modal" },
            `Conversation welcome for ${firstName}`,
          )
        : null,
  };
});

vi.mock("@/app/(app)/me/_components/sign-out-row", async () => {
  const React = await vi.importActual<typeof import("react")>("react");

  return {
    SignOutRow: () => React.createElement("button", { type: "button" }, "Log out"),
  };
});

vi.mock("@/app/(app)/me/_components/settings/profile-settings-modal", async () => {
  const React = await vi.importActual<typeof import("react")>("react");

  return {
    ProfileSettingsModal: ({ trigger }: { trigger: React.ReactNode }) =>
      React.createElement(React.Fragment, null, trigger),
  };
});

vi.mock("@/app/(app)/me/_components/settings/privacy-modal", async () => {
  const React = await vi.importActual<typeof import("react")>("react");

  return {
    PrivacyModal: ({ trigger }: { trigger: React.ReactNode }) =>
      React.createElement(React.Fragment, null, trigger),
  };
});

vi.mock("@/app/(app)/me/_components/settings/connected-accounts-modal", async () => {
  const React = await vi.importActual<typeof import("react")>("react");

  return {
    ConnectedAccountsModal: ({ trigger }: { trigger: React.ReactNode }) =>
      React.createElement(React.Fragment, null, trigger),
  };
});

vi.mock("@/components/ui/location-autocomplete", async () => {
  const React = await vi.importActual<typeof import("react")>("react");

  return {
    LocationAutocomplete: ({
      ariaLabel,
      placeholder,
      value,
    }: {
      ariaLabel: string;
      placeholder: string;
      value: string;
    }) =>
      React.createElement("input", {
        "aria-label": ariaLabel,
        placeholder,
        readOnly: true,
        value,
      }),
  };
});

const profileDetail: RoommateProfileDetail = {
  about: "Likes quiet mornings and dinner with friends.",
  age: 29,
  breakdown: [
    { key: "communication_fit", label: "Communication", score: 91 },
    { key: "home_labor_fit", label: "Home labor", score: 84 },
  ],
  company: { label: "Studio", logoUrl: null },
  education: "UC Berkeley",
  hometown: "San Diego",
  interests: ["coffee", "running"],
  photos: [],
  school: { label: "Berkeley", logoUrl: null },
  signals: [{ label: "Cleanliness", value: "Keeps shared rooms reset" }],
};

function makeDashboardSnapshot({
  interview = {},
  linkedinProfile = {},
  profile = {},
  queue = [],
  roommate = {},
  user = {},
}: {
  interview?: Partial<DashboardSnapshot["interview"]>;
  linkedinProfile?: Partial<DashboardSnapshot["linkedinProfile"]>;
  profile?: Partial<DashboardSnapshot["profile"]>;
  queue?: DashboardSnapshot["queue"];
  roommate?: Partial<DashboardSnapshot["roommate"]>;
  user?: Partial<DashboardSnapshot["user"]>;
} = {}): DashboardSnapshot {
  return {
    agentAccess: {
      activeConnections: 0,
      lastSummary: "",
      recentTool: "",
      scopes: [],
    },
    housing: {
      commuteNotes: "",
      dealbreakers: [],
      flexibilityNotes: "",
      mustHaves: [],
      neighborhoods: [],
      pets: "",
    },
    interview: {
      channel: "web",
      completedAt: "",
      extractionStatus: "idle",
      status: "not_started",
      summary: "",
      ...interview,
    },
    linkedinProfile: {
      education: [],
      enrichedAt: null,
      enrichmentStatus: "not_started",
      headline: "",
      lastError: null,
      recentInteractions: [],
      resumeStatus: "missing",
      reviewStatus: "pending",
      salaryTarget: null,
      sourceConfidence: null,
      sourceProvider: null,
      startupGrind: "not_sure",
      startDate: "",
      workExperience: [],
      workMode: "",
      ...linkedinProfile,
    },
    profile: {
      budgetMax: 0,
      budgetMin: 0,
      completenessScore: 0,
      householdSizeMax: 0,
      householdSizeMin: 0,
      id: "profile-1",
      moveInEnd: "",
      moveInStart: "",
      status: "active",
      targetMarkets: ["san-francisco-ca"],
      visibilityMode: "private",
      ...profile,
    },
    queue,
    roommate: {
      cleanliness: "",
      conflictStyle: "",
      dealbreakers: [],
      hostingExpectations: "",
      lifestyleNotes: "",
      preferredAgeMax: null,
      preferredAgeMin: null,
      preferredAgeStrict: false,
      sleepSchedule: "",
      socialEnergy: "",
      ...roommate,
    },
    source: {
      detail: "fixture",
      kind: "supabase",
      status: "connected",
    },
    user: {
      aboutText: null,
      age: null,
      avatarUrl: "",
      birthYear: null,
      dateOfBirth: null,
      displayName: "Jamie Chen",
      educationDegree: null,
      educationMajor: null,
      educationSchool: null,
      educationYear: null,
      email: "jamie@example.com",
      externalAuthConnected: true,
      hometown: null,
      id: "user-1",
      interests: [],
      launchMarket: "san-francisco-ca",
      linkedinConnected: false,
      linkedinUrl: "",
      occupationCompany: null,
      occupationCompanyDomain: null,
      occupationCompanyLogoUrl: null,
      educationSchoolDomain: null,
      educationSchoolLogoUrl: null,
      occupationTitle: null,
      phone: "",
      phoneVerified: false,
      photos: [],
      ...user,
    },
  };
}

function makeEnrichmentSnapshot({
  facts = [],
  imports = [],
}: Partial<Pick<ProfileEnrichmentSnapshot, "facts" | "imports">> = {}): ProfileEnrichmentSnapshot {
  return {
    compatibility: [],
    conflicts: [],
    facts,
    gaps: [],
    imports,
    source: {
      detail: "fixture",
      kind: "supabase",
      status: "connected",
    },
  };
}

function chatGptImport({
  pendingFactCount = 0,
  status = "processed",
}: {
  pendingFactCount?: number;
  status?: string;
} = {}): ProfileEnrichmentSnapshot["imports"][number] {
  return {
    approvedFactCount: 0,
    createdAt: "2026-06-21T12:00:00.000Z",
    errorMessage: null,
    factCount: pendingFactCount,
    id: "import-chatgpt",
    method: "upload",
    pendingFactCount,
    processedAt: "2026-06-21T12:00:01.000Z",
    provider: "chatgpt",
    schemaVersion: "1",
    sensitiveFactCount: 0,
    sourceLabel: "ChatGPT memory",
    status,
  };
}

function pendingMemoryFact(): ProfileEnrichmentSnapshot["facts"][number] {
  return {
    confidence: 0.9,
    createdAt: "2026-06-21T12:00:00.000Z",
    dimension: "lifestyle",
    evidenceExcerpt: "Prefers tidy shared spaces.",
    factKey: "cleanliness",
    id: "fact-pending",
    importId: "import-chatgpt",
    importance: 0.8,
    matchingEligible: true,
    reviewState: "pending",
    sensitivityLevel: "standard",
    value: "tidy",
  };
}

function approvedFact({
  dimension = "profile",
  factKey,
  value,
  id = factKey,
}: {
  dimension?: string;
  factKey: string;
  value: string;
  id?: string;
}): ProfileEnrichmentSnapshot["facts"][number] {
  return {
    confidence: 0.9,
    createdAt: "2026-06-21T12:00:00.000Z",
    dimension,
    evidenceExcerpt: value,
    factKey,
    id,
    importId: "import-chatgpt",
    importance: 0.8,
    matchingEligible: true,
    reviewState: "approved",
    sensitivityLevel: "standard",
    value,
  };
}

function render(markup: React.ReactElement) {
  return renderToStaticMarkup(markup);
}

function linkTextsForHref(html: string, href: string) {
  const pattern = new RegExp(
    `<a\\b[^>]*href="${escapeRegExp(href)}"[^>]*>([\\s\\S]*?)</a>`,
    "g",
  );

  return [...html.matchAll(pattern)].map((match) => normalizeHtmlText(match[1]));
}

function expectLinkWithText(html: string, href: string, fragments: string[]) {
  const linkTexts = linkTextsForHref(html, href);
  const matchingText = linkTexts.find((text) =>
    fragments.every((fragment) => text.includes(fragment)),
  );

  if (!matchingText) {
    throw new Error(
      `Expected a ${href} link containing ${fragments.join(", ")}. Found: ${linkTexts.join(" | ")}`,
    );
  }
}

function normalizeHtmlText(html: string) {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("dashboard hub shell renders expected initial behavior", () => {
  it("uses the LinkedIn auth gate when external auth is missing", async () => {
    const snapshot = makeDashboardSnapshot({
      user: { externalAuthConnected: false },
    });

    const html = render(await DashboardShell({
      enrichment: makeEnrichmentSnapshot(),
      snapshot,
    }));

    expect(html).toContain("Welcome to Kinfolk.");
    expect(html).not.toContain("What your agent has so far");
  });

  it("renders the incomplete hub receipt, memory prompt, phone CTA, and hub cards", async () => {
    const snapshot = makeDashboardSnapshot({
      linkedinProfile: { enrichmentStatus: "source_not_configured" },
    });

    const html = render(await DashboardShell({
      enrichment: makeEnrichmentSnapshot(),
      snapshot,
    }));

    expect(html).toContain("Hey Jamie");
    expect(html).toContain("What your agent has so far");
    expect(html).toContain("0 of 5");
    expect(html).toContain("<progress");
    expect(html).toContain('aria-label="Profile setup progress"');
    expect(html).toContain('aria-valuetext="0 of 5 setup tasks complete"');
    expect(html).toContain('max="5"');
    expect(html).toContain('value="0"');
    expect(html).toContain("Budget");
    expect(html).toContain("Roommate openness");
    expect(html).toContain("Looking to move by");
    expect(html).toContain("Age range");
    expect(html).toContain("Verify phone");
    expect(html).toContain("Memory welcome fresh 0");
    expect(html).toContain("Continue on your phone");
    expect(html).toContain("Enrich with Claude");
    expect(html).toContain("Enrich with ChatGPT");
    expect(html).toContain("Your profile");
    expect(html).toContain("Finding matches");
    expect(html).toContain("Apartments");
    expect(html).not.toContain("Where you&#x27;ll live and who with");
    expectLinkWithText(html, "/me/profile", [
      "Your profile",
      "Add photos, work, and more",
    ]);
    expectLinkWithText(html, "/me/matches", [
      "Finding matches",
      "Your agent is reviewing listings now",
    ]);
    expectLinkWithText(html, "/apartments", [
      "Apartments",
      "Places your group could take",
    ]);
  });

  it("uses a friendly hub greeting when the display name is blank or padded", async () => {
    const blankNameHtml = render(await DashboardShell({
      enrichment: makeEnrichmentSnapshot(),
      snapshot: makeDashboardSnapshot({
        user: { displayName: "   " },
      }),
    }));
    const paddedNameHtml = render(await DashboardShell({
      enrichment: makeEnrichmentSnapshot(),
      snapshot: makeDashboardSnapshot({
        user: { displayName: "  Ada Lovelace  " },
      }),
    }));

    expect(blankNameHtml).toContain("Hey there");
    expect(blankNameHtml).not.toContain("Hey </h1>");
    expect(paddedNameHtml).toContain("Hey Ada");
  });

  it("keeps completed-profile hub cards routed when queued matches are ready", async () => {
    const html = render(await DashboardShell({
      enrichment: makeEnrichmentSnapshot(),
      snapshot: makeDashboardSnapshot({
        profile: {
          budgetMax: 3400,
          budgetMin: 2200,
          householdSizeMax: 3,
          householdSizeMin: 1,
          moveInEnd: "2026-08-01",
          moveInStart: "2026-07-15",
        },
        queue: [
          {
            candidateType: "apartment",
            evidence: [],
            expiresAt: "2026-07-01T00:00:00.000Z",
            fitScore: 82,
            id: "queue-1",
            monthlyRent: 3200,
            nextAction: "review",
            status: "ready",
            subtitle: "Nob Hill",
            title: "Apartment match",
            tradeoffs: [],
          },
          {
            candidateType: "roommate",
            evidence: [],
            expiresAt: "2026-07-01T00:00:00.000Z",
            fitScore: 91,
            id: "queue-2",
            monthlyRent: null,
            nextAction: "intro",
            status: "ready",
            subtitle: "Roommate fit",
            title: "Roommate match",
            tradeoffs: [],
          },
        ],
        roommate: {
          preferredAgeMax: 36,
          preferredAgeMin: 24,
        },
        user: {
          age: 29,
          phone: "+14155550100",
          phoneVerified: true,
        },
      }),
    }));

    expect(html).toContain("your hub at a glance.");
    expect(html).not.toContain("What your agent has so far");
    expectLinkWithText(html, "/me/profile", [
      "Profile ready",
      "View and edit your details",
    ]);
    expectLinkWithText(html, "/me/matches", [
      "2 ready",
      "Matches",
      "Groups + apartments your agent is reviewing",
    ]);
    expectLinkWithText(html, "/apartments", [
      "Apartments",
      "Places your group could take",
    ]);
  });

  it("renders the memory review welcome when an assistant import has pending facts", async () => {
    const snapshot = makeDashboardSnapshot({
      linkedinProfile: { enrichmentStatus: "ready" },
      user: {
        linkedinConnected: true,
        linkedinUrl: "https://www.linkedin.com/in/jamiechen/",
      },
    });

    const html = render(await DashboardShell({
      enrichment: makeEnrichmentSnapshot({
        facts: [pendingMemoryFact()],
        imports: [chatGptImport({ pendingFactCount: 1 })],
      }),
      snapshot,
    }));

    expect(html).toContain("Memory welcome review 1");
    expect(html).toContain("1 pending");
    expect(html).toContain("href=\"/me/settings/memories\"");
  });

  it("renders the conversation welcome when assistant memories are settled but setup is incomplete", async () => {
    const snapshot = makeDashboardSnapshot({
      linkedinProfile: { enrichmentStatus: "ready" },
      user: {
        linkedinConnected: true,
        linkedinUrl: "https://www.linkedin.com/in/jamiechen/",
      },
    });

    const html = render(await DashboardShell({
      enrichment: makeEnrichmentSnapshot({
        imports: [chatGptImport()],
      }),
      snapshot,
    }));

    expect(html).toContain("Conversation welcome for Jamie");
    expect(html).toContain("Continue on your phone");
    expect(html).not.toContain("Memory welcome");
  });

  it("shows a disabled continue-on-phone CTA when texting is not configured", () => {
    const html = render(
      <ContinueOnPhone
        config={{
          agentEnabled: false,
          challengeEndpoint: "/api/kinfolk/continue-on-phone/challenge",
          publicHandoffBaseUrl: "http://localhost:3000",
        }}
      />,
    );

    expect(html).toContain("Continue on your phone");
    expect(html).toContain("Linq text agent is not configured.");
    expect(html).toContain("disabled=\"\"");
  });

  it("names the continue-on-phone QR dialog by its title", () => {
    const html = render(
      <ContinueOnPhoneModal
        error={null}
        handoff={{
          kind: "verification_challenge",
          link: "sms:+15551234567?body=KIN-123",
          message: "KIN-123",
          phoneNumber: "+15551234567",
        }}
        link="sms:+15551234567?body=KIN-123"
        loadingChallenge={false}
        onClose={() => undefined}
        open
        qrCodeUrl="data:image/svg+xml;base64,PHN2Zy8+"
        qrError={null}
        qrLoading={false}
      />,
    );

    expect(html).toContain('aria-labelledby="continue-on-phone-modal-title"');
    expect(html).toContain('id="continue-on-phone-modal-title"');
    expect(html).toContain("Continue on mobile");
  });
});

describe("profile pane renders expected initial behavior", () => {
  it("renders overview, photos, profile sections, matching rows, and phone status from the profile view model", () => {
    const snapshot = makeDashboardSnapshot({
      interview: { status: "in_progress" },
      linkedinProfile: {
        education: [
          {
            dateRange: "2016 - 2020",
            id: "edu-1",
            logoUrl: null,
            organization: "Stanford University",
            subtitle: "",
            title: "BS in Computer Science",
          },
        ],
        enrichmentStatus: "ready",
        headline: "Product designer at Kinfolk Labs",
        workExperience: [
          {
            dateRange: "2024 - Present",
            id: "work-1",
            logoUrl: null,
            organization: "Kinfolk Labs",
            subtitle: "San Francisco",
            title: "Product designer",
          },
          {
            dateRange: "2021 - 2024",
            id: "work-2",
            logoUrl: null,
            organization: "Figma",
            subtitle: "Design systems",
            title: "Design lead",
          },
        ],
      },
      profile: {
        budgetMax: 3400,
        budgetMin: 2200,
        householdSizeMax: 3,
        householdSizeMin: 1,
        moveInEnd: "2026-08-01",
        moveInStart: "2026-07-15",
      },
      roommate: {
        cleanliness: "very tidy",
        conflictStyle: "cooldown then talk",
        dealbreakers: ["No smoking indoors"],
        hostingExpectations: "occasional",
        preferredAgeMax: 36,
        preferredAgeMin: 24,
        preferredAgeStrict: false,
        sleepSchedule: "early",
        socialEnergy: "balanced",
      },
      user: {
        aboutText: "I like a quiet home base near good coffee.",
        age: 29,
        displayName: "  Jamie   Chen  ",
        educationDegree: "BS",
        educationMajor: "Computer Science",
        educationSchool: "Stanford University",
        educationYear: "2020",
        hometown: "Chicago, IL",
        interests: ["Cooking", "Running", "Design"],
        occupationCompany: "Kinfolk Labs",
        occupationCompanyDomain: null,
        occupationCompanyLogoUrl: null,
        educationSchoolDomain: null,
        educationSchoolLogoUrl: null,
        occupationTitle: "Product designer",
        phone: "+14155550100",
        phoneVerified: false,
        photos: [
          {
            height: 800,
            id: "photo-main",
            isPrimary: true,
            position: 0,
            source: "upload",
            url: "https://example.com/profile-main.jpg",
            width: 600,
          },
          {
            height: 800,
            id: "photo-secondary",
            isPrimary: false,
            position: 1,
            source: "upload",
            url: "https://example.com/profile-secondary.jpg",
            width: 600,
          },
          {
            height: 800,
            id: "photo-linkedin",
            isPrimary: false,
            position: 2,
            source: "linkedin",
            url: "https://example.com/profile-linkedin.jpg",
            width: 600,
          },
        ],
      },
    });
    snapshot.housing.neighborhoods = ["Pacific Heights", "Nob Hill"];
    snapshot.housing.mustHaves = ["In-unit laundry", "Sunny kitchen"];
    snapshot.housing.dealbreakers = ["No ground-floor bedroom"];
    snapshot.housing.pets = "pet friendly";
    snapshot.housing.flexibilityNotes = "pay more for fit";
    const enrichment = makeEnrichmentSnapshot({
      facts: [
        approvedFact({ factKey: "work_from_home", value: "hybrid" }),
        approvedFact({ factKey: "noise_tolerance", value: "quiet" }),
        approvedFact({ factKey: "communication_style", value: "direct" }),
        approvedFact({ factKey: "conflict_repair", value: "cooldown then talk" }),
        approvedFact({ factKey: "hobbies", value: "photography, cooking" }),
      ],
      imports: [chatGptImport()],
    });
    const view = buildProfileViewModel(snapshot, enrichment);

    const html = render(
      <ProfilePane
        continueOnPhoneConfig={{
          agentEnabled: true,
          challengeEndpoint: "/api/kinfolk/continue-on-phone/challenge",
          publicHandoffBaseUrl: "http://localhost:3000",
        }}
        view={view}
      />,
    );

    expect(html).toContain("Preview");
    expect(html).toContain("what roommates see");
    expect(html).toContain("Jamie Chen");
    expect(html).toContain("29 · San Francisco");
    expect(html).not.toContain("san-francisco-ca");
    expect(html).toContain("Main");
    expect(html).toContain("LinkedIn");
    expect(html).toContain('aria-label="Remove photo 1"');
    expect(html).toContain('aria-label="Remove photo 2"');
    expect(html).toContain('aria-label="Move photo 1 right"');
    expect(html).toContain('aria-label="Move photo 2 left"');
    expect(html).toContain('aria-label="Add photo 4"');
    expect(html).toContain('aria-label="Add photo 5"');
    expect(html).toContain('aria-label="Add photo 6"');
    expect(html).toContain("Upload profile photo");
    expect(html).toContain(
      'accept="image/jpeg,image/jpg,image/pjpeg,image/png,image/webp,image/heic,image/heif"',
    );
    expect(html).toContain(
      "Up to 6 photos. JPEG, PNG, WebP, HEIC, or HEIF under 10 MB. First photo is your main one.",
    );
    expect(html).toContain("I like a quiet home base near good coffee.");
    expect(html).toContain("Product designer");
    expect(html).toContain("Kinfolk Labs");
    expect(html).toContain("From LinkedIn");
    expect(html).toContain("Design lead");
    expect(html).toContain("Stanford University");
    expect(html).toContain("BS in Computer Science");
    expect(html).toContain("2020");
    expect(html).toContain("Chicago, IL");
    expect(html).toContain("Cooking");
    expect(html).toContain("Running");
    expect(html).toContain("Matching preferences");
    expect(html).toContain("Phone");
    expect(html).toContain("Not verified");
    expect(html).toContain("Verify");
    expect(html).toContain('aria-label="Verify Phone"');
    expect(html).toContain('aria-label="Edit Budget"');
    expect(html).toContain('aria-label="Edit Move by"');
    expect(html).toContain("$2,200-$3,400");
    expect(html).toContain("Age 29 · Roommate range 24-36");
    expect(html).toContain("Pacific Heights, Nob Hill");
    expect(html).toContain("By Aug 1");
    expect(html).toContain("Open to households up to 3 people");
    expect(html).toContain("Pet friendly");
    expect(html).toContain("Very tidy");
    expect(html).toContain("In-unit laundry, Sunny kitchen");
    expect(html).toContain("Quiet");
    expect(html).toContain("No ground-floor bedroom, No smoking indoors");
    expect(html).toContain("Early");
    expect(html).toContain("Hybrid");
    expect(html).toContain("Balanced");
    expect(html).toContain("Occasional");
    expect(html).toContain("Direct");
    expect(html).toContain("Cooldown then talk");
    expect(html).toContain("Pay more for fit");
    expect(html).toContain("In progress");
    expect(html).toContain("View all memories");
    expect(html).toContain("href=\"/me/settings/memories\"");
  });

  it("keeps phone verification incomplete when the verified flag lacks a real phone", () => {
    const snapshot = makeDashboardSnapshot({
      user: {
        phone: "555",
        phoneVerified: true,
      },
    });
    const view = buildProfileViewModel(snapshot, makeEnrichmentSnapshot());

    const html = render(
      <ProfilePane
        continueOnPhoneConfig={{
          agentEnabled: true,
          challengeEndpoint: "/api/kinfolk/continue-on-phone/challenge",
          publicHandoffBaseUrl: "http://localhost:3000",
        }}
        view={view}
      />,
    );

    expect(html).toContain("Phone");
    expect(html).toContain("Not verified");
    expect(html).toContain("Verify");
    expect(html).not.toContain("555 is verified by texting Kinfolk.");
  });
});

describe("enrichment and memories surfaces render expected initial behavior", () => {
  it("renders the enrichment form with profile, lifestyle, roommate, and housing fields", () => {
    const initialValues: ProfileEnrichmentFormValues = {
      aboutText: "I like a calm home base with dinner nights and quiet mornings.",
      birthday: "1997-05-12",
      budgetMax: 3400,
      budgetMin: 2200,
      cleanliness: "tidy",
      communicationStyle: "direct",
      conflictRepair: "cooldown then talk",
      dealbreakers: ["Smoking indoors"],
      educationMajor: "Computer Science",
      educationSchool: "Stanford University",
      fullName: "Jamie Chen",
      gender: "female",
      guests: "occasional",
      hometown: "Chicago, IL",
      householdSize: "3",
      interests: ["Cooking", "Running"],
      moveInBy: "2026-08-01",
      musicTaste: "Phoebe Bridgers, A24 films",
      mustHaves: ["In-unit laundry", "Natural light"],
      neighborhoods: ["Pacific Heights", "Nob Hill"],
      noiseTolerance: "quiet",
      occupationCompany: "Kinfolk Labs",
      occupationCompanyDomain: "",
      educationSchoolDomain: "",
      occupationTitle: "Product designer",
      openToRoommates: true,
      pets: "pet friendly",
      rentFlexibility: "stretch_for_fit",
      sleepSchedule: "early",
      smoking: "no",
      socialEnergy: "balanced",
      workFromHome: "hybrid",
    };

    const html = render(
      <ProfileEnrichmentForm firstName="Jamie" initialValues={initialValues} />,
    );

    expect(html).toContain("data-testid=\"profile-enrichment-form\"");
    // A fully prefilled profile gets the confirm-pass framing, not a blank form.
    expect(html).toContain("Look this over, Jamie.");
    expect(html).toContain("100% complete");
    expect(html).toContain("The basics");
    expect(html).toContain("Work &amp; school");
    expect(html).toContain("You, in your own words");
    expect(html).toContain("Your daily rhythm");
    expect(html).toContain("Living with others");
    expect(html).toContain("How you communicate");
    expect(html).toContain("The place you");
    expect(html).toContain("value=\"Jamie Chen\"");
    expect(html).toContain("value=\"1997-05-12\"");
    expect(html).toContain("Product designer");
    expect(html).toContain("Stanford University");
    expect(html).toContain("I like a calm home base");
    expect(html).toContain("Cooking");
    expect(html).toContain("Pacific Heights");
    expect(html).toContain("In-unit laundry");
    expect(html).toContain("$2,200");
    expect(html).toContain("$3,400");
    expect(html).toContain("Saved when you finish");
    // Confirm-pass CTA: a fully prefilled profile confirms, it doesn't "finish".
    expect(html).toContain("Looks right — save &amp; see matches");
  });

  it("shows canonical prefilled rhythm choices as selected controls", () => {
    const html = render(
      <ProfileEnrichmentForm
        firstName="Jamie"
        initialValues={{
          ...emptyProfileEnrichmentFormValues(),
          fullName: "Jamie Chen",
          noiseTolerance: "very quiet",
          socialEnergy: "low key",
          workFromHome: "flexible",
        }}
      />,
    );

    expect(html).toMatch(/aria-pressed="true"[^>]*>Very quiet<\/button>/);
    expect(html).toMatch(/aria-pressed="true"[^>]*>Low key<\/button>/);
    expect(html).toMatch(/aria-pressed="true"[^>]*>Flexible<\/button>/);
  });

  it("renders enrichment tag inputs with the save-path length limit", () => {
    const html = render(
      <ProfileEnrichmentForm
        firstName="Jamie"
        initialValues={emptyProfileEnrichmentFormValues()}
      />,
    );

    expect(html).toContain(
      `data-testid="enrichment-interests" maxLength="${ENRICHMENT_TAG_VALUE_MAX_LENGTH}"`,
    );
    expect(html).toContain(
      `data-testid="enrichment-neighborhoods" maxLength="${ENRICHMENT_TAG_VALUE_MAX_LENGTH}"`,
    );
    expect(html).toContain(
      `data-testid="enrichment-mustHaves" maxLength="${ENRICHMENT_TAG_VALUE_MAX_LENGTH}"`,
    );
    expect(html).toContain(
      `data-testid="enrichment-dealbreakers" maxLength="${ENRICHMENT_TAG_VALUE_MAX_LENGTH}"`,
    );
  });

  it("renders the memories review panel with pending facts, approved groups, and import modal state", () => {
    const snapshot = makeEnrichmentSnapshot({
      facts: [
        pendingMemoryFact(),
        {
          confidence: 0.78,
          createdAt: "2026-06-21T12:02:00.000Z",
          dimension: "finance",
          evidenceExcerpt: "Income note was present in the imported dump.",
          factKey: "income_note",
          id: "fact-sensitive",
          importId: "import-chatgpt",
          importance: 0.5,
          matchingEligible: false,
          reviewState: "pending",
          sensitivityLevel: "high",
          value: "Sensitive income detail",
        },
        approvedFact({
          dimension: "housing",
          factKey: "budget",
          id: "fact-budget",
          value: "{\"min\":2200,\"max\":3400}",
        }),
        approvedFact({
          dimension: "lifestyle",
          factKey: "interests",
          id: "fact-interests",
          value: "[\"cooking\",\"running\"]",
        }),
      ],
      imports: [chatGptImport({ pendingFactCount: 2 })],
    });

    const html = render(
      <ProfileEnrichmentPanel
        initialImportOpen
        initialProvider="chatgpt"
        initialSnapshot={snapshot}
      />,
    );

    expect(html).toContain("Pending review");
    expect(html).toContain("Approve all safe");
    expect(html).toContain("tidy");
    expect(html).toContain("cleanliness");
    expect(html).toContain("90% confidence");
    expect(html).toContain("Sensitive income detail");
    expect(html).toContain("high");
    expect(html).toContain("housing");
    expect(html).toContain("$2,200-$3,400");
    expect(html).toContain("lifestyle");
    expect(html).toContain("cooking, running");
    expect(html).toContain("Paste a memory dump");
    expect(html).toContain("data-testid=\"import-memories-modal\"");
    expect(html).toContain("Paste your ChatGPT memories");
    expect(html).toContain("imports it as draft facts");
    expect(html).toContain("data-testid=\"profile-import-provider\"");
    expect(html).toContain("data-testid=\"profile-import-source-label\"");
    expect(html).toContain("data-testid=\"profile-import-payload\"");
    expect(html).toContain("data-testid=\"profile-import-submit\"");
  });
});

describe("dashboard protected panes render expected initial behavior", () => {
  it("renders settings rows with memory import status and account state", () => {
    const snapshot = {
      user: { linkedinConnected: true },
      profile: { visibilityMode: "anonymous" },
    } as DashboardSnapshot;
    const enrichment: ProfileEnrichmentSnapshot = {
      compatibility: [],
      conflicts: [],
      facts: [
        {
          confidence: 0.9,
          createdAt: "2026-06-21T12:00:00.000Z",
          dimension: "lifestyle",
          evidenceExcerpt: "Prefers tidy shared spaces.",
          factKey: "cleanliness",
          id: "fact-1",
          importId: "import-chatgpt",
          importance: 0.8,
          matchingEligible: true,
          reviewState: "approved",
          sensitivityLevel: "low",
          value: "tidy",
        },
        {
          confidence: 0.8,
          createdAt: "2026-06-21T12:00:00.000Z",
          dimension: "schedule",
          evidenceExcerpt: "Early riser.",
          factKey: "schedule",
          id: "fact-2",
          importId: "import-chatgpt",
          importance: 0.7,
          matchingEligible: true,
          reviewState: "approved",
          sensitivityLevel: "low",
          value: "early",
        },
      ],
      gaps: [],
      imports: [
        {
          approvedFactCount: 2,
          createdAt: "2026-06-21T12:00:00.000Z",
          errorMessage: null,
          factCount: 2,
          id: "import-chatgpt",
          method: "upload",
          pendingFactCount: 0,
          processedAt: "2026-06-21T12:00:01.000Z",
          provider: "chatgpt",
          schemaVersion: "1",
          sensitiveFactCount: 0,
          sourceLabel: "ChatGPT memory",
          status: "processed",
        },
      ],
      source: {
        detail: "fixture",
        kind: "supabase",
        status: "connected",
      },
    };

    const html = render(<SettingsPane enrichment={enrichment} snapshot={snapshot} />);

    expect(html).toContain("Profile settings");
    expect(html).toContain("Memories");
    expect(html).toContain("2 signals");
    expect(html).toContain("/me/settings/memories");
    expect(html).toContain("Privacy");
    expect(html).toContain("Connected accounts");
    expect(html).toContain("LinkedIn");
    expect(html).toContain("Log out");
  });

  it("renders matches tabs, apartment cards, pinned requests, and review banner", () => {
    const snapshot: MatchesSnapshot = {
      apartments: [
        {
          beds: "2 bd · 1 ba",
          evidence: [{ label: "Near work", detail: "18 minute commute" }],
          fitScore: 128,
          id: "apt-1",
          monthlyRent: 4200,
          nextAction: "Ask your group",
          perPersonRent: 2100,
          photoUrls: [
            "https://example.com/listing-cover.jpg",
            "https://example.com/listing-kitchen.jpg",
          ],
          rentCaption: "2-way split",
          sourceUrl: "https://example.com/listing",
          status: "suggested",
          subtitle: "Pacific Heights",
          title: "2120 Pine St",
          tradeoffs: [{ label: "Older kitchen", detail: "Still workable" }],
        },
      ],
      detail: "connected",
      enrichmentReview: {
        memoriesHref: "/me/settings/memories",
        message: "Review 3 new memories before they affect matching.",
        pendingBehavioralCount: 1,
        pendingFactCount: 3,
      },
      requests: [
        {
          detail: profileDetail,
          evidence: [{ label: "Shared friends", detail: "Two bridges" }],
          fitScore: -4,
          groupId: "group-1",
          groupLabel: "Pacific Heights",
          groupNeighborhood: "Pacific Heights",
          id: "request-1",
          listing: {
            address: "2120 Pine St",
            beds: "2 bd · 1 ba",
            monthlyRent: 4200,
            neighborhood: "Pacific Heights",
            perPersonRent: 2100,
            photoUrl: null,
          },
          openSpots: 1,
          requestedAt: new Date().toISOString(),
          requesterHeadline: "Designer at Studio",
          requesterImageUrl: null,
          requesterInitials: "AR",
          requesterName: "Avery Reed",
          requesterUserId: "user-requester",
          risks: [{ label: "Guests", detail: "Clarify hosting rhythm" }],
        },
      ],
      roommates: [
        {
          components: [
            { key: "communication_fit", label: "Communication", score: 91 },
            { key: "home_labor_fit", label: "Home labor", score: 84 },
          ],
          computedAt: "2026-06-21T12:00:00.000Z",
          detail: profileDetail,
          evidence: [{ label: "Clean home", detail: "Compatible routines" }],
          headline: "Product designer",
          id: "match-1",
          imageUrl: null,
          initials: "ML",
          locked: false,
          name: "Mina Lee",
          risks: [],
          score: 92,
          scoreLow: 86,
          scoreHigh: 96,
          coverage: 0.85,
          incomingIntent: false,
          userId: "user-match",
        },
      ],
      status: "connected",
    };

    const html = render(<MatchesPane snapshot={snapshot} />);

    expect(html).toContain("Matches");
    expect(html).toContain("1 person wants to join your groups");
    expect(html).toContain("Needs your response");
    expect(html).toContain("Avery Reed");
    expect(html).toContain("0% fit");
    expect(html).toContain("Accept");
    expect(html).toContain("Decline");
    expect(html).toContain("3 facts pending · 1 lifestyle");
    expect(html).toContain("review in Memories");
    expect(html).toContain("Apartments");
    expect(html).toContain("Roommates");
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Match categories"');
    expect(html).toContain('id="matches-tab-apartments"');
    expect(html).toContain('aria-controls="matches-panel-apartments"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('id="matches-tab-roommates"');
    expect(html).toContain('aria-controls="matches-panel-roommates"');
    expect(html).toContain('aria-selected="false"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('id="matches-panel-apartments"');
    expect(html).toContain('role="tabpanel"');
    expect(html).toContain('aria-labelledby="matches-tab-apartments"');
    expect(html).toContain("2120 Pine St");
    expect(html).toContain("100% fit");
    expect(html).toContain("$4,200/mo");
    expect(html).toContain("2-way split");
    expect(html).toContain("Ask your group");
    expect(html).toContain('aria-label="View listing for 2120 Pine St"');
    expect(html).toContain('aria-label="Previous photo"');
    expect(html).toContain("focus-visible:opacity-100");
  });

  it("renders request action errors as an accessible status region", () => {
    const html = render(
      <RequestActionError message="Only the group's creator can respond to join requests." />,
    );

    // role=status (implicitly polite) — role=alert + aria-live=polite send
    // contradictory politeness signals and can double-announce.
    expect(html).toContain('role="status"');
    expect(html).toContain("Only the group&#x27;s creator can respond to join requests.");
  });

  it("renders plan intent, invite, people, matches, saved items, and quiet watch", () => {
    const plan: LivingPlan = {
      futureCities: ["San Francisco, CA", "New York, NY"],
      intentConfirmedAt: "2026-06-21T12:00:00.000Z",
      intentNote: "Need room for a desk and a sunny kitchen.",
      moveHorizon: "3_6mo",
      relocationFlexibility: "flexible",
      silentMatcherEnabled: true,
    };
    const savedListing: SavedListing = {
      address: "77 Bruton St",
      beds: "2 bd · 2 ba",
      listingId: "listing-1",
      monthlyRent: 5200,
      neighborhood: "Nob Hill",
      note: "Good light",
      perPersonRent: 2600,
      photoUrl: null,
      savedId: "saved-1",
    };

    const html = render(
      <PlanPane
        apartmentsHref="/apartments"
        inviteLink={{ openInviteCount: 1, url: "/invite/kin-123" }}
        matches={[
          {
            components: [
              { label: "Communication", score: 91 },
              { label: "Trust", score: 112 },
            ],
            headline: "Designer at Studio",
            imageUrl: null,
            initials: "ML",
            name: "Mina Lee",
            score: 128,
            userId: "user-match",
          },
        ]}
        people={[
          {
            connectedAt: "2026-06-21T12:00:00.000Z",
            fitScore: 89,
            groupLabel: "Future SF",
            headline: "Engineer at Acme",
            imageUrl: null,
            initials: "JC",
            name: "Jamie Chen",
            relationship: "you_invited",
            userId: "user-person",
          },
        ]}
        plan={plan}
        requestCount={2}
        savedAreas={["Pacific Heights", "Nob Hill"]}
        savedListings={[savedListing]}
      />,
    );

    expect(html).toContain("Where &amp; when");
    expect(html).toContain("San Francisco, CA");
    expect(html).toContain("New York, NY");
    expect(html).toContain("3–6 months");
    expect(html).toContain("Flexible");
    expect(html).toContain("<fieldset");
    expect(html).toContain('<legend class="sr-only">Timing</legend>');
    expect(html).toContain('<legend class="sr-only">How ready</legend>');
    expect(html).not.toContain('role="group"');
    expect(html).toContain('aria-label="Plan notes"');
    expect(html).toContain("Need room for a desk and a sunny kitchen.");
    expect(html).toContain("/invite/kin-123");
    expect(html).toContain("1 open invite");
    expect(html).toContain("Jamie Chen");
    expect(html).toContain("89% fit");
    expect(html).toContain('href="/me/matches"');
    expect(html).toContain("All matches");
    expect(html).toContain("2 people want to join a group you started");
    expect(html).toContain("Mina Lee");
    expect(html).toContain("100%");
    expect(html).toContain("100 out of 100");
    expect(html).not.toContain("128%");
    expect(html).toContain("77 Bruton St");
    expect(html).toContain("$2,600/mo each");
    expect(html).toContain("Pacific Heights");
    expect(html).toContain("Quiet watch");
    expect(html).toContain("Coming soon");
    expect(html).toContain("Ready for background matching once alerts ship.");
    expect(html).toContain('aria-describedby="plan-matcher-readiness"');
  });

  it("renders singular Plan join request copy as a matches link", () => {
    const plan: LivingPlan = {
      futureCities: [],
      intentConfirmedAt: null,
      intentNote: "",
      moveHorizon: null,
      relocationFlexibility: null,
      silentMatcherEnabled: false,
    };

    const html = render(
      <PlanPane
        apartmentsHref="/apartments"
        inviteLink={null}
        matches={[]}
        people={[]}
        plan={plan}
        requestCount={1}
        savedAreas={[]}
        savedListings={[]}
      />,
    );

    expect(html).toContain("1 person wants to join a group you started");
    expect(html).toContain('href="/me/matches"');
    expect(html).toContain("Warming up");
  });

  it("renders incomplete Quiet watch plans as paused before opt-in", () => {
    const plan: LivingPlan = {
      futureCities: [],
      intentConfirmedAt: null,
      intentNote: "",
      moveHorizon: null,
      relocationFlexibility: null,
      silentMatcherEnabled: false,
    };

    const html = render(
      <PlanPane
        apartmentsHref="/apartments"
        inviteLink={null}
        matches={[]}
        people={[]}
        plan={plan}
        requestCount={0}
        savedAreas={[]}
        savedListings={[]}
      />,
    );

    expect(html).toContain("Add a future city, timing, and readiness before Quiet watch can start.");
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="false"');
    expect(html).toContain("disabled");
  });
});
