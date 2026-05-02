import { describe, it, expect } from "vitest";
import { RegexCodeScannerProvider } from "../infrastructure/analysis/regex-code-scanner.provider";
import type { RepositoryFile } from "../application/analysis/contracts/repository-code.provider";

function makeFile(
  path: string,
  content: string,
  role: RepositoryFile["role"] = "other",
): RepositoryFile {
  return { path, content, role };
}

describe("Express Mount-Prefix Resolution - Deep / Advanced", () => {
  const scanner = new RegexCodeScannerProvider();

  it("should preserve original router-only paths AND generate prefixed paths", async () => {
    const files: RepositoryFile[] = [
      makeFile(
        "src/routes/orders.js",
        `
        const router = require('express').Router();
        router.get('/history/:userId', (req, res) => { res.json([]); });
        module.exports = router;
        `,
        "route",
      ),
      makeFile(
        "src/app.js",
        `
        const express = require('express');
        const orderRoutes = require('./routes/orders');
        const app = express();
        app.use('/api/orders', orderRoutes);
        `,
        "other",
      ),
    ];

    const result = await scanner.scan(files);
    const endpoints = result._unsafeUnwrap().filter((e) => e.source === "server");
    const paths = endpoints.map((e) => `${e.method}:${e.path}`);

    // MUST contain both!
    expect(paths).toContain("GET:/history/{userId}");
    expect(paths).toContain("GET:/api/orders/history/{userId}");
  });

  it("should handle nested routers (e.g. app -> apiRouter -> ordersRouter)", async () => {
    const files: RepositoryFile[] = [
      makeFile(
        "src/routes/orders.js",
        `
        const router = require('express').Router();
        router.get('/history/:userId', (req, res) => { res.json([]); });
        module.exports = router;
        `,
        "route",
      ),
      makeFile(
        "src/routes/index.js",
        `
        const ordersRouter = require('./orders');
        const router = require('express').Router();
        router.use('/orders', ordersRouter);
        module.exports = router;
        `,
        "route",
      ),
      makeFile(
        "src/app.js",
        `
        const express = require('express');
        const apiRouter = require('./routes/index');
        const app = express();
        app.use('/api', apiRouter);
        `,
        "other",
      ),
    ];

    const result = await scanner.scan(files);
    const endpoints = result._unsafeUnwrap().filter((e) => e.source === "server");
    const paths = endpoints.map((e) => `${e.method}:${e.path}`);

    // The order router has /history/{userId}
    // Nested one level gives /orders/history/{userId}
    // Fully nested gives /api/orders/history/{userId}
    // The implementation currently pushes the FULLY nested path.
    expect(paths).toContain("GET:/history/{userId}"); // original
    expect(paths).toContain("GET:/api/orders/history/{userId}"); // fully nested
  });

  it("should handle inline requires in app.use", async () => {
    const files: RepositoryFile[] = [
      makeFile(
        "src/routes/products.js",
        `
        const router = require('express').Router();
        router.get('/:productId', (req, res) => { res.json({}); });
        module.exports = router;
        `,
        "route",
      ),
      makeFile(
        "src/app.js",
        `
        const express = require('express');
        const app = express();
        app.use('/api/products', require('./routes/products'));
        app.use('/api/v2/products', require('./routes/products').router);
        `,
        "other",
      ),
    ];

    const result = await scanner.scan(files);
    const endpoints = result._unsafeUnwrap().filter((e) => e.source === "server");
    const paths = endpoints.map((e) => `${e.method}:${e.path}`);

    expect(paths).toContain("GET:/{productId}"); // original
    expect(paths).toContain("GET:/api/products/{productId}"); // inline prefix
    // The second require might override the first depending on fileMountMap behavior,
    // but at least one should work. We test if it supports inline require correctly.
  });
});
