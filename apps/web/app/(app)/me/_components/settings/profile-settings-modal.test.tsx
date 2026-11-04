import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DashboardSnapshot } from "@/lib/shared/types";

vi.mock("@/components/ui/modal", async () => {
  const React = await vi.importActual<typeof import("react")>("react");

  return {
    Modal: ({ children }: { children: React.ReactNode }) =>
      React.createElement("section", null, children),
    ModalContent: ({
      children,
      description,
      title,
    }: {
      children: React.ReactNode;
      description?: string;
      title: string;
    }) =>
      React.createElement(
        "div",
        { "aria-label": title },
        React.createElement("h2", null, title),
        description ? React.createElement("p", null, description) : null,
        children,
      ),
    ModalTrigger: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
  };
});

import { ProfileSettingsModal } from "./profile-settings-modal";

function renderProfileSettings(
  user: Partial<DashboardSnapshot["user"]> = {},
) {
  const snapshot = {
    user: {
      email: "jamie@example.com",
      linkedinConnected: true,
      linkedinUrl: "https://www.linkedin.com/in/jamiechen/",
      phone: "+14155550100",
      phoneVerified: true,
      ...user,
    },
  } as DashboardSnapshot;

  return renderToStaticMarkup(
    <ProfileSettingsModal
      snapshot={snapshot}
      trigger={<button type="button">Profile settings</button>}
    />,
  );
}

describe("ProfileSettingsModal", () => {
  it("renders identity fields without fake editable social controls", () => {
    const html = renderProfileSettings();

    expect(html).toContain("Profile settings");
    expect(html).toContain("jamie@example.com");
    expect(html).toContain("+14155550100");
    expect(html).toContain("linkedin.com/in/jamiechen");
    expect(html).toContain("GitHub");
    expect(html).toContain("X (Twitter)");
    expect(html.match(/Not added/g)).toHaveLength(2);
    expect(html).not.toContain("<input");
    expect(html).not.toContain("Enter your GitHub username");
    expect(html).not.toContain("Enter your X username");
  });

  it("does not display an unverified phone number as contact identity", () => {
    const html = renderProfileSettings({
      phone: "+14155550100",
      phoneVerified: false,
    });

    expect(html).toContain("Phone Number");
    expect(html).toContain("Not added");
    expect(html).not.toContain("+14155550100");
  });

  it("does not display blank verified-phone snapshots as contact identity", () => {
    const blankPhone = renderProfileSettings({
      phone: "   ",
      phoneVerified: true,
    });
    const placeholderPhone = renderProfileSettings({
      phone: "Not verified",
      phoneVerified: true,
    });
    const shortPhone = renderProfileSettings({
      phone: "555",
      phoneVerified: true,
    });

    expect(blankPhone).toContain("Phone Number");
    expect(blankPhone).toContain("Not added");
    expect(placeholderPhone).toContain("Phone Number");
    expect(placeholderPhone).toContain("Not added");
    expect(shortPhone).toContain("Phone Number");
    expect(shortPhone).toContain("Not added");
    expect(shortPhone).not.toContain("555");
  });
});
