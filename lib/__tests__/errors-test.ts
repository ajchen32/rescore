import { errorFromUnknown, slicerErrorMessage } from "../errors";

describe("slicerErrorMessage", () => {
  it("explains known slicer codes", () => {
    expect(slicerErrorMessage("PASSWORD_PROTECTED")).toMatch(/password/);
  });

  it("falls back for unknown codes", () => {
    expect(slicerErrorMessage("NOPE", "Custom")).toBe("Custom");
    expect(slicerErrorMessage(undefined)).toBe("Something went wrong while slicing the PDF.");
  });
});

describe("errorFromUnknown", () => {
  it("maps native errors by code, keeping their message as the fallback", () => {
    expect(errorFromUnknown({ code: "EMPTY_RESULT" })).toBe("No music systems were found in this PDF.");
    expect(errorFromUnknown({ code: "OTHER", message: "Disk full" })).toBe("Disk full");
  });

  it("uses an Error's message, and a default for anything else", () => {
    expect(errorFromUnknown(new Error("Boom"))).toBe("Boom");
    expect(errorFromUnknown("??")).toBe("Something went wrong while slicing the PDF.");
  });
});
