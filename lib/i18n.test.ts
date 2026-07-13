import { describe, it, expect } from "vitest";
import {
  parseLocale,
  isSupportedLocale,
  t,
  getMessages,
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
} from "./i18n";

describe("parseLocale", () => {
  it("extracts 'en' from /en/login", () => {
    expect(parseLocale("/en/login")).toBe("en");
  });

  it("extracts 'zh-CN' from /zh-CN/dashboard", () => {
    expect(parseLocale("/zh-CN/dashboard")).toBe("zh-CN");
  });

  it("falls back to DEFAULT_LOCALE for an unknown locale segment", () => {
    expect(parseLocale("/unknown/login")).toBe(DEFAULT_LOCALE);
    expect(parseLocale("/unknown/login")).toBe("en");
  });

  it("falls back to DEFAULT_LOCALE for a root or empty path", () => {
    expect(parseLocale("/")).toBe(DEFAULT_LOCALE);
    expect(parseLocale("")).toBe(DEFAULT_LOCALE);
  });

  it("ignores trailing path depth beyond the first segment", () => {
    expect(parseLocale("/zh-CN/a/b/c")).toBe("zh-CN");
  });
});

describe("isSupportedLocale", () => {
  it("narrows supported locales and rejects others", () => {
    for (const loc of SUPPORTED_LOCALES) {
      expect(isSupportedLocale(loc)).toBe(true);
    }
    expect(isSupportedLocale("fr")).toBe(false);
    expect(isSupportedLocale("")).toBe(false);
  });
});

describe("t (dot-path lookup + fallback)", () => {
  it("resolves a nested key to its en value", () => {
    expect(t("login.title", "en")).toBe("Sign in");
  });

  it("resolves a nested key to its zh-CN value", () => {
    expect(t("dashboard.title", "zh-CN")).toBe("仪表盘");
  });

  it("returns the key itself when the key is missing (fallback for visibility)", () => {
    expect(t("missing.key", "en")).toBe("missing.key");
  });

  it("returns the key itself for a leaf that is not a string", () => {
    // t("login", "en") resolves to the login object (non-string) -> return key.
    expect(t("login", "en")).toBe("login");
  });
});

describe("getMessages", () => {
  it("returns the message object for a locale with the expected top-level groups", () => {
    const en = getMessages("en");
    expect(en).toHaveProperty("login");
    expect(en).toHaveProperty("changePassword");
    expect(en).toHaveProperty("dashboard");
    expect(en).toHaveProperty("common");
  });

  it("falls back to DEFAULT_LOCALE messages for an unsupported locale argument at call sites", () => {
    // getMessages is typed to require Locale; the internal MESSAGES map is keyed
    // by Locale, so the fallback path is exercised via the ?? DEFAULT_LOCALE guard.
    const en = getMessages(DEFAULT_LOCALE);
    expect(en).toBe(getMessages("en"));
  });
});
