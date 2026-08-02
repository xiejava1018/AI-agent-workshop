import { describe, it, expect } from "vitest";
import {
  buildAuditLogWhere,
  parseAuditLogFilters,
  parsePositiveInt,
} from "./audit-query";

describe("parsePositiveInt", () => {
  it("returns the fallback for missing/non-numeric/zero values", () => {
    expect(parsePositiveInt(null, 7)).toBe(7);
    expect(parsePositiveInt("abc", 7)).toBe(7);
    expect(parsePositiveInt("0", 7)).toBe(7);
    expect(parsePositiveInt("-5", 7)).toBe(7);
  });

  it("returns the parsed integer for valid positive values", () => {
    expect(parsePositiveInt("3", 7)).toBe(3);
    expect(parsePositiveInt("12", 7)).toBe(12);
  });
});

describe("parseAuditLogFilters", () => {
  it("returns an empty object when no filters are present", () => {
    const sp = new URLSearchParams();
    expect(parseAuditLogFilters(sp)).toEqual({});
  });

  it("parses all supported filters, trimming whitespace and dropping empty", () => {
    const sp = new URLSearchParams({
      userId: "u1 ",
      action: " user.create",
      resourceType: "user",
      resourceId: "r1",
      from: "2026-01-01T00:00:00Z",
      to: "2026-02-01T00:00:00Z",
      page: "2",
      limit: "10",
    });
    expect(parseAuditLogFilters(sp)).toEqual({
      userId: "u1",
      action: "user.create",
      resourceType: "user",
      resourceId: "r1",
      from: new Date("2026-01-01T00:00:00Z"),
      to: new Date("2026-02-01T00:00:00Z"),
    });
  });

  it("ignores malformed date values", () => {
    const sp = new URLSearchParams({ from: "not-a-date", to: " " });
    expect(parseAuditLogFilters(sp)).toEqual({});
  });
});

describe("buildAuditLogWhere", () => {
  it("builds a createdAt range from from/to", () => {
    const from = new Date("2026-01-01T00:00:00Z");
    const to = new Date("2026-02-01T00:00:00Z");
    const where = buildAuditLogWhere({ from, to });
    expect(where).toEqual({
      createdAt: { gte: from, lte: to },
    });
  });

  it("combines scalar filters with the range", () => {
    const where = buildAuditLogWhere({
      userId: "u1",
      action: "user.create",
      resourceType: "user",
      resourceId: "r1",
    });
    expect(where).toEqual({
      userId: "u1",
      action: "user.create",
      resourceType: "user",
      resourceId: "r1",
    });
  });

  it("returns an empty where when nothing is set", () => {
    expect(buildAuditLogWhere({})).toEqual({});
  });
});
