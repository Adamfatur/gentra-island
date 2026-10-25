import { beforeEach, describe, expect, it } from "vitest";
import { setLanguage } from "./i18n";
import { cameraGuide, problemOf } from "./permission";

describe("problemOf", () => {
  it("maps browser errors to what the user can fix", () => {
    expect(problemOf("NotAllowedError")).toBe("denied");
    expect(problemOf("SecurityError")).toBe("denied");
    expect(problemOf("NotReadableError")).toBe("busy");
    expect(problemOf("AbortError")).toBe("busy");
    expect(problemOf("NotFoundError")).toBe("missing");
    expect(problemOf("TypeError")).toBe("unsupported");
  });
});

describe("cameraGuide", () => {
  beforeEach(() => setLanguage("en"));

  it("walks a Mac user to the Camera page with a button", () => {
    const g = cameraGuide("denied", "macos");
    expect(g.openSettings).toBe(true);
    expect(g.steps.length).toBeGreaterThanOrEqual(3);
    expect(g.steps.join(" ")).toMatch(/Gentra Island/);
  });

  it("names the desktop-apps switch on Windows", () => {
    expect(cameraGuide("denied", "windows").steps.join(" ")).toMatch(/desktop apps/);
  });

  it("asks to close other apps when the camera is busy, without a settings button", () => {
    const g = cameraGuide("busy", "macos");
    expect(g.openSettings).toBe(false);
    expect(g.steps[0]).toMatch(/Zoom|close/i);
  });

  it("is honest when there is no camera or no support", () => {
    expect(cameraGuide("missing", "macos").retry).toBe(true);
    expect(cameraGuide("unsupported", "linux").retry).toBe(false);
  });

  it("speaks Indonesian too", () => {
    setLanguage("id");
    expect(cameraGuide("denied", "macos").title).toMatch(/kamera/i);
  });
});
