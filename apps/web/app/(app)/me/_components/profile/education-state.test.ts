import { describe, expect, it } from "vitest";
import {
  closeEducationEditor,
  openEducationEditor,
  resolveEducationSave,
} from "./education-state";

const importedEducation = {
  degree: "BS",
  major: "Computer Science",
  school: "Stanford University",
  year: "2020",
};

describe("education save state", () => {
  it("opens and closes the editor with stale top-level feedback cleared", () => {
    expect(openEducationEditor()).toEqual({ editing: true, topLevelError: null });
    expect(closeEducationEditor()).toEqual({ editing: false, topLevelError: null });
  });

  it("saves trimmed education fields as user-edited values", () => {
    expect(
      resolveEducationSave(
        {
          degree: "  BA  ",
          major: "  Economics  ",
          school: "  UC Berkeley  ",
          year: "  2021  ",
        },
        importedEducation,
      ),
    ).toEqual({
      displayDraft: {
        degree: "BA",
        major: "Economics",
        school: "UC Berkeley",
        year: "2021",
      },
      patch: {
        educationDegree: "BA",
        educationMajor: "Economics",
        educationSchool: "UC Berkeley",
        educationYear: "2021",
      },
      userEdits: {
        degree: true,
        major: true,
        school: true,
        year: true,
      },
    });
  });

  it("treats blank education fields as resetting to imported suggestions", () => {
    expect(
      resolveEducationSave(
        {
          degree: "",
          major: "  ",
          school: "\n",
          year: "",
        },
        importedEducation,
      ),
    ).toEqual({
      displayDraft: importedEducation,
      patch: {
        educationDegree: null,
        educationMajor: null,
        educationSchool: null,
        educationYear: null,
      },
      userEdits: {
        degree: false,
        major: false,
        school: false,
        year: false,
      },
    });
  });

  it("can reset individual fields while preserving other user edits", () => {
    expect(
      resolveEducationSave(
        {
          degree: "",
          major: "Biology",
          school: "",
          year: "2022",
        },
        importedEducation,
      ),
    ).toEqual({
      displayDraft: {
        degree: "BS",
        major: "Biology",
        school: "Stanford University",
        year: "2022",
      },
      patch: {
        educationDegree: null,
        educationMajor: "Biology",
        educationSchool: null,
        educationYear: "2022",
      },
      userEdits: {
        degree: false,
        major: true,
        school: false,
        year: true,
      },
    });
  });

  it("clamps optimistic education values to the same max lengths as the editor and server", () => {
    expect(
      resolveEducationSave(
        {
          degree: "  Masters  ",
          major: "  Computational Media  ",
          school: "  Stanford University  ",
          year: "  2026-2027  ",
        },
        {
          degree: "",
          major: "",
          school: "",
          year: "",
        },
        {
          degree: 2,
          major: 7,
          school: 8,
          year: 4,
        },
      ),
    ).toEqual({
      displayDraft: {
        degree: "Ma",
        major: "Computa",
        school: "Stanford",
        year: "2026",
      },
      patch: {
        educationDegree: "Ma",
        educationMajor: "Computa",
        educationSchool: "Stanford",
        educationYear: "2026",
      },
      userEdits: {
        degree: true,
        major: true,
        school: true,
        year: true,
      },
    });
  });
});
