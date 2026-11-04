/** An organization the user can pick for work or school. */
export type OrgKind = "company" | "school";

/**
 * One picker suggestion. `domain` is what we persist — it is the stable key
 * that makes two people at the same employer comparable and the input to logo
 * resolution. `iconUrl` is a provider-issued preview URL, only good for the
 * duration of the picker session; the durable logo is resolved on save.
 */
export type OrgSuggestion = {
  name: string;
  domain: string;
  kind: OrgKind;
  iconUrl: string | null;
};
