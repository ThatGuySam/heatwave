import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const config = JSON.parse(
  await readFile(path.join(root, "wrangler.jsonc"), "utf8"),
);
const packageJson = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
);

test("configures an assets-only Cloudflare Worker", () => {
  assert.equal(config.name, "heatwave-99");
  assert.equal(config.compatibility_date, "2026-08-30");
  assert.equal(config.assets.directory, "./dist/client");
  assert.equal(config.assets.not_found_handling, "single-page-application");
  assert.equal("main" in config, false);
  assert.equal("binding" in config.assets, false);
  assert.equal("run_worker_first" in config.assets, false);
});

test("exposes separate Cloudflare build and deploy commands", () => {
  assert.match(
    packageJson.scripts["build:cloudflare"],
    /CLOUDFLARE_STATIC_EXPORT=1/,
  );
  assert.match(packageJson.scripts["deploy:cloudflare"], /wrangler deploy/);
});

test(
  "the Cloudflare build emits a static entry document",
  { skip: process.env.CLOUDFLARE_STATIC_EXPORT !== "1" },
  async () => {
    const indexPath = path.join(root, "dist", "client", "index.html");
    await access(indexPath);
    const html = await readFile(indexPath, "utf8");
    assert.match(html, /<title>Heatwave 99<\/title>/);
    assert.match(html, /A living street, three walk-in joints/);
  },
);
