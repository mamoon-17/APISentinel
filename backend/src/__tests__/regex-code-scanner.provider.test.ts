import { describe, expect, it } from "vitest";
import { RegexCodeScannerProvider } from "../infrastructure/analysis/regex-code-scanner.provider";

describe("RegexCodeScannerProvider", () => {
  it("resolves imported path constants used in frontend calls", async () => {
    const scanner = new RegexCodeScannerProvider();

    const result = await scanner.scan([
      {
        path: "frontend/src/lib/api-paths.ts",
        content: `export const LOGIN_PATH = "/auth/login";`,
        role: "other",
      },
      {
        path: "frontend/src/pages/Login.tsx",
        content: `
          import { LOGIN_PATH } from "../lib/api-paths";
          await fetch(LOGIN_PATH, { method: "POST", body: JSON.stringify({ email, password }) });
        `,
        role: "other",
      },
    ]);

    const usages = result._unsafeUnwrap();
    expect(
      usages.find(
        (usage) => usage.source === "client" && usage.path === "/auth/login",
      ),
    ).toMatchObject({
      method: "POST",
      callCount: 1,
    });
  });

  it("resolves imported path helper functions used in frontend calls", async () => {
    const scanner = new RegexCodeScannerProvider();

    const result = await scanner.scan([
      {
        path: "frontend/src/lib/api-paths.ts",
        content: `export const userDetailsPath = (userId: string) => \`/api/users/\${userId}\`;`,
        role: "other",
      },
      {
        path: "frontend/src/pages/User.tsx",
        content: `
          import { userDetailsPath } from "../lib/api-paths";
          const response = await fetch(userDetailsPath(currentUserId));
          await response.json();
        `,
        role: "other",
      },
    ]);

    const usages = result._unsafeUnwrap();
    expect(
      usages.find(
        (usage) =>
          usage.source === "client" && usage.path === "/api/users/{userId}",
      ),
    ).toMatchObject({
      method: "GET",
      callCount: 1,
    });
  });

  it("captures absolute URLs built from base URL constants", async () => {
    const scanner = new RegexCodeScannerProvider();

    const result = await scanner.scan([
      {
        path: "frontend/src/lib/config.ts",
        content: `export const API_BASE_URL = "http://localhost:3000";`,
        role: "other",
      },
      {
        path: "frontend/src/pages/Auth.tsx",
        content: [
          'import { API_BASE_URL } from "../lib/config";',
          'await fetch(`${API_BASE_URL}/auth/register`, {',
          '  method: "POST",',
          '  body: JSON.stringify({ email, password }),',
          '});',
        ].join("\n"),
        role: "other",
      },
    ]);

    const usages = result._unsafeUnwrap();
    expect(
      usages.find(
        (usage) => usage.source === "client" && usage.path === "/auth/register",
      ),
    ).toMatchObject({
      method: "POST",
      callCount: 1,
    });
  });

  it("captures new URL() expressions used in frontend calls", async () => {
    const scanner = new RegexCodeScannerProvider();

    const result = await scanner.scan([
      {
        path: "frontend/src/lib/config.ts",
        content: `export const API_BASE_URL = "http://localhost:3000";`,
        role: "other",
      },
      {
        path: "frontend/src/pages/Auth.tsx",
        content: `
          import { API_BASE_URL } from "../lib/config";
          await fetch(new URL("/auth/login", API_BASE_URL));
        `,
        role: "other",
      },
    ]);

    const usages = result._unsafeUnwrap();
    expect(
      usages.find(
        (usage) => usage.source === "client" && usage.path === "/auth/login",
      ),
    ).toMatchObject({
      method: "GET",
      callCount: 1,
    });
  });

  it("does not fabricate backend schemas when none were inferred", async () => {
    const scanner = new RegexCodeScannerProvider();

    const result = await scanner.scan([
      {
        path: "backend/src/routes/auth.routes.ts",
        content: `router.post("/auth/login", handler);`,
        role: "route",
      },
    ]);

    const usages = result._unsafeUnwrap();
    expect(usages[0]).toMatchObject({
      path: "/auth/login",
      source: "server",
    });
    expect(usages[0]?.responseBodySchema).toBeUndefined();
  });
});
