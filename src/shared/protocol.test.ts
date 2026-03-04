import { describe, it, expect } from "vitest";
import { checkProtocolCompatibility, PROTOCOL_VERSION } from "./types";

describe("PROTOCOL_VERSION", () => {
  it("follows x.y.z semver format", () => {
    expect(PROTOCOL_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("checkProtocolCompatibility", () => {
  it("returns 'compatible' when versions are identical", () => {
    expect(checkProtocolCompatibility("1.0.0", "1.0.0")).toBe("compatible");
  });

  it("returns 'compatible' when only patch differs", () => {
    expect(checkProtocolCompatibility("1.0.0", "1.0.3")).toBe("compatible");
    expect(checkProtocolCompatibility("1.2.5", "1.2.0")).toBe("compatible");
    expect(checkProtocolCompatibility("2.1.9", "2.1.1")).toBe("compatible");
  });

  it("returns 'minor' when minor version differs", () => {
    expect(checkProtocolCompatibility("1.0.0", "1.1.0")).toBe("minor");
    expect(checkProtocolCompatibility("1.2.0", "1.0.0")).toBe("minor");
    expect(checkProtocolCompatibility("1.3.5", "1.1.2")).toBe("minor");
  });

  it("returns 'major' when major version differs", () => {
    expect(checkProtocolCompatibility("1.0.0", "2.0.0")).toBe("major");
    expect(checkProtocolCompatibility("2.0.0", "1.0.0")).toBe("major");
    expect(checkProtocolCompatibility("3.1.2", "1.5.9")).toBe("major");
  });

  it("major takes precedence over minor difference", () => {
    expect(checkProtocolCompatibility("1.2.0", "2.3.0")).toBe("major");
  });
});
