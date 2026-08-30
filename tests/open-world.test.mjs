import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  appType: "custom",
  configFile: false,
  root,
  resolve: { alias: { "@": root } },
  server: { middlewareMode: true, hmr: false },
});

after(async () => {
  await vite.close();
});

const world = await vite.ssrLoadModule("/app/heatwave-game.tsx");

test("carves three named interiors into the live city map", () => {
  assert.equal(world.INTERIORS.length, 3);
  for (const interior of world.INTERIORS) {
    assert.equal(world.CITY_MAP[interior.doorY][interior.doorX], 0);
    assert.equal(
      world.getWorldZone(interior.minX + 0.5, interior.minY + 0.5),
      interior.id,
    );
  }
});

test("spawns a unique, walkable street population", () => {
  const game = world.createGame();
  const civilians = game.actors.filter((actor) => actor.kind === "civilian");
  const clerks = game.actors.filter((actor) => actor.kind === "clerk");
  assert.equal(civilians.length, 12);
  assert.equal(clerks.length, 3);
  assert.equal(new Set(game.actors.map((actor) => actor.id)).size, game.actors.length);
  for (const actor of [...civilians, ...clerks]) {
    assert.equal(world.isWall(actor.x, actor.y), false);
    assert.equal(actor.hostile, false);
  }
});

test("moves civilians deterministically without entering walls", () => {
  const game = world.createGame();
  const before = new Map(
    game.actors
      .filter((actor) => actor.kind === "civilian")
      .map((actor) => [actor.id, [actor.x, actor.y]]),
  );
  for (let step = 0; step < 600; step += 1) {
    world.updateGame(game, new Set(), 1 / 60, () => {});
  }
  const civilians = game.actors.filter(
    (actor) => actor.kind === "civilian" && actor.active,
  );
  assert.ok(
    civilians.some((actor) => {
      const start = before.get(actor.id);
      return start && Math.hypot(actor.x - start[0], actor.y - start[1]) > 0.2;
    }),
  );
  for (const actor of civilians) assert.equal(world.isWall(actor.x, actor.y), false);
});

test("turns a visible crime into a delayed police search", () => {
  const game = world.createGame();
  assert.equal(world.witnessCrime(game, 1), true);
  assert.equal(game.policeMode, "reported");
  assert.ok(
    game.actors.some(
      (actor) => actor.kind === "civilian" && (actor.reportTimer ?? 0) > 0,
    ),
  );
  for (let step = 0; step < 260; step += 1) {
    world.updateGame(game, new Set(), 1 / 60, () => {});
  }
  assert.ok(game.heat >= 1);
  assert.ok(game.actors.some((actor) => actor.kind === "cop" && actor.active));
});

test("caps and reinforces police response without duplicate actors", () => {
  const game = world.createGame();
  world.raiseHeat(game, 9);
  world.raiseHeat(game, 3);
  assert.equal(game.heat, 3);
  assert.equal(
    game.actors.filter((actor) => actor.kind === "cop" && actor.active).length,
    6,
  );
  assert.equal(
    game.actors.filter((actor) => actor.kind === "policeCar" && actor.active).length,
    2,
  );
  assert.equal(new Set(game.actors.map((actor) => actor.id)).size, game.actors.length);
});

test("lets interior clerks sell persistent supplies", () => {
  const game = world.createGame();
  game.x = 17.3;
  game.y = 6.2;
  game.zone = "pawn";
  const cash = game.cash;
  const shells = game.shotgunAmmo;
  world.interact(game);
  assert.equal(game.cash, cash - 75);
  assert.equal(game.shotgunAmmo, shells + 8);
  assert.equal(game.zone, "pawn");
});

test("preserves the full mission state sequence", () => {
  const game = world.createGame();
  game.x = game.carX;
  game.y = game.carY;
  world.interact(game);
  assert.equal(game.mission, "crate");

  game.inCar = false;
  game.x = 30;
  game.y = 13.2;
  world.updateGame(game, new Set(), 1 / 60, () => {});
  assert.equal(game.mission, "escape");

  for (const actor of game.actors) {
    if (actor.kind === "cop" || actor.kind === "policeCar") actor.active = false;
  }
  game.heatTimer = 0;
  for (let step = 0; step < 220; step += 1) {
    world.updateGame(game, new Set(), 1 / 60, () => {});
  }
  assert.equal(game.mission, "delivery");

  let result;
  game.x = 6.5;
  game.y = 22.5;
  world.updateGame(game, new Set(), 1 / 60, (next) => {
    result = next;
  });
  assert.equal(game.mission, "complete");
  assert.ok(result.score > 0);
});
