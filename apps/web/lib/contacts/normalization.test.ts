import { describe, expect, it } from "vitest";
import {
  normalizeImportedContact,
  parseContactsPayloadText,
  parseVCardContactsText,
} from "./normalization";

describe("contact normalization", () => {
  it("normalizes browser contact fields", () => {
    expect(
      normalizeImportedContact({
        name: ["Ada Lovelace"],
        emails: [" ADA@Example.COM "],
        phones: ["(415) 555-0100"],
        source: "browser_picker",
      }),
    ).toMatchObject({
      displayName: "Ada Lovelace",
      emails: ["ada@example.com"],
      phones: ["+14155550100"],
      primaryEmail: "ada@example.com",
      primaryPhoneE164: "+14155550100",
      source: "browser_picker",
    });
  });

  it("parses loose pasted contacts", () => {
    const contacts = parseContactsPayloadText(
      "Grace Hopper, grace@example.com, 212-555-0199\nNikola Tesla nikola@example.com",
    );

    expect(contacts).toHaveLength(2);
    expect(normalizeImportedContact(contacts[0]!)).toMatchObject({
      displayName: "Grace Hopper",
      primaryEmail: "grace@example.com",
      primaryPhoneE164: "+12125550199",
    });
    expect(normalizeImportedContact(contacts[1]!)).toMatchObject({
      displayName: "Nikola Tesla",
      primaryEmail: "nikola@example.com",
    });
  });

  it("parses vCard names, emails, and phones", () => {
    const contacts = parseVCardContactsText(`BEGIN:VCARD
VERSION:3.0
FN:Katherine Johnson
EMAIL:katherine@example.com
TEL;TYPE=CELL:(650) 555-0180
END:VCARD`);

    expect(normalizeImportedContact(contacts[0]!)).toMatchObject({
      displayName: "Katherine Johnson",
      primaryEmail: "katherine@example.com",
      primaryPhoneE164: "+16505550180",
      source: "vcard",
    });
  });
});
