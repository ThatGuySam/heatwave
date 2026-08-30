import assert from "node:assert/strict";
import test from "node:test";

test("renders the Heatwave 99 game shell and update copy", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  const html = await response.text();
  assert.match(html, /<title>Heatwave 99<\/title>/);
  assert.match(html, /A living street, three walk-in joints/);
  assert.match(html, /Vehicles \/ talk \/ shop/);
  assert.doesNotMatch(html, /name=["']codex-preview["']/i);
});
