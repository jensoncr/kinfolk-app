import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LocationAutocomplete } from "./location-autocomplete";

describe("LocationAutocomplete", () => {
  it("links validation state to the input for assistive technology", () => {
    const html = renderToStaticMarkup(
      <LocationAutocomplete
        ariaDescribedBy="future-city-error"
        ariaInvalid
        ariaLabel="Add a future city"
        onChange={vi.fn()}
        value="Seattle"
      />,
    );

    expect(html).toContain('aria-describedby="future-city-error"');
    expect(html).toContain('aria-invalid="true"');
  });
});
