"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

const VIEW_WIDTH = 384;
const VIEW_HEIGHT = 216;
const MAP_SIZE = 34;
const FOV_SCALE = 0.72;
const FIXED_STEP = 1 / 60;

const spriteImages: {
  enemies: HTMLImageElement | null;
  weapons: HTMLImageElement | null;
} = {
  enemies: null,
  weapons: null,
};

type ActorKind =
  | "gang"
  | "cop"
  | "civilian"
  | "clerk"
  | "policeCar"
  | "car"
  | "crate"
  | "medkit"
  | "ammo"
  | "sign";

type ServiceKind = "armor" | "ammo" | "health";
type WorldZone = "street" | "sunwash" | "pawn" | "arcade";
type PoliceMode = "clear" | "reported" | "searching" | "spotted";

type Actor = {
  id: number;
  kind: ActorKind;
  x: number;
  y: number;
  health: number;
  active: boolean;
  hostile: boolean;
  cooldown: number;
  frame: number;
  label?: string;
  variant?: number;
  moveAngle?: number;
  turnTimer?: number;
  panicTimer?: number;
  reportTimer?: number;
  reported?: boolean;
  service?: ServiceKind;
  targetX?: number;
  targetY?: number;
  thinkTimer?: number;
};

type Weapon = "shotgun" | "smg";
type MissionStep = "car" | "crate" | "escape" | "delivery" | "complete";
type DemoMode = "drive" | "combat" | "heat" | "payoff";

type GameState = {
  x: number;
  y: number;
  angle: number;
  health: number;
  armor: number;
  cash: number;
  shotgunAmmo: number;
  smgAmmo: number;
  weapon: Weapon;
  weaponCooldown: number;
  muzzle: number;
  hurtFlash: number;
  pickupFlash: number;
  shake: number;
  inCar: boolean;
  carX: number;
  carY: number;
  heat: number;
  heatTimer: number;
  maxHeat: number;
  policeMode: PoliceMode;
  lastKnownX: number;
  lastKnownY: number;
  witnessCooldown: number;
  zone: WorldZone;
  mission: MissionStep;
  hasCrate: boolean;
  kills: number;
  elapsed: number;
  actors: Actor[];
  message: string;
  messageTimer: number;
  running: boolean;
  completed: boolean;
  score: number;
};

type Result = {
  score: number;
  kills: number;
  maxHeat: number;
  elapsed: number;
  health: number;
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const distance = (ax: number, ay: number, bx: number, by: number) =>
  Math.hypot(ax - bx, ay - by);

export function buildMap() {
  const map = Array.from({ length: MAP_SIZE }, () =>
    Array.from({ length: MAP_SIZE }, () => 0),
  );

  for (let i = 0; i < MAP_SIZE; i += 1) {
    map[0][i] = 1;
    map[MAP_SIZE - 1][i] = 1;
    map[i][0] = 1;
    map[i][MAP_SIZE - 1] = 1;
  }

  const building = (
    x: number,
    y: number,
    width: number,
    height: number,
    material: number,
  ) => {
    for (let py = y; py < y + height; py += 1) {
      for (let px = x; px < x + width; px += 1) map[py][px] = material;
    }
  };

  building(3, 3, 7, 6, 2);
  building(14, 3, 7, 6, 3);
  building(25, 3, 6, 7, 4);
  building(4, 14, 6, 6, 4);
  building(14, 14, 8, 6, 2);
  building(26, 15, 5, 6, 3);
  building(3, 25, 7, 6, 3);
  building(14, 25, 7, 6, 4);
  building(25, 25, 6, 6, 2);

  const carveInterior = (
    x: number,
    y: number,
    width: number,
    height: number,
    doorX: number,
    doorY: number,
  ) => {
    for (let py = y + 1; py < y + height - 1; py += 1) {
      for (let px = x + 1; px < x + width - 1; px += 1) map[py][px] = 0;
    }
    map[doorY][doorX] = 0;
  };

  // Three buildings are part of the same collision map. Their open door tiles
  // make the interiors continuous with the street instead of loading a room.
  carveInterior(3, 3, 7, 6, 6, 8);
  carveInterior(14, 3, 7, 6, 17, 8);
  carveInterior(4, 14, 6, 6, 7, 14);

  // The drainage canal shortcut is intentionally narrow and risky.
  for (let x = 11; x < 25; x += 1) {
    map[22][x] = x === 17 ? 0 : 5;
    map[24][x] = x === 17 ? 0 : 5;
  }

  return map;
}

export const CITY_MAP = buildMap();

export const INTERIORS = [
  {
    id: "sunwash" as const,
    name: "SUNWASH LOBBY",
    minX: 4,
    maxX: 9,
    minY: 4,
    maxY: 8,
    doorX: 6,
    doorY: 8,
  },
  {
    id: "pawn" as const,
    name: "SUNSHOT PAWN",
    minX: 15,
    maxX: 20,
    minY: 4,
    maxY: 8,
    doorX: 17,
    doorY: 8,
  },
  {
    id: "arcade" as const,
    name: "NEON GATOR ARCADE",
    minX: 5,
    maxX: 9,
    minY: 15,
    maxY: 19,
    doorX: 7,
    doorY: 14,
  },
];

export function getWorldZone(x: number, y: number): WorldZone {
  const interior = INTERIORS.find(
    (entry) =>
      x >= entry.minX &&
      x < entry.maxX &&
      y >= entry.minY &&
      y < entry.maxY,
  );
  return interior?.id ?? "street";
}

function zoneName(zone: WorldZone) {
  if (zone === "street") return "Sunstroke County";
  return INTERIORS.find((entry) => entry.id === zone)?.name ?? "Interior";
}

const LANDMARKS = {
  motel: { x: 6.5, y: 11.5 },
  car: { x: 10.8, y: 11.5 },
  marina: { x: 29, y: 12.6 },
  crate: { x: 30, y: 13.2 },
  chop: { x: 6.5, y: 22.5 },
  sunwashClerk: { x: 6.2, y: 5.2 },
  pawnClerk: { x: 17.3, y: 5.2 },
  arcadeClerk: { x: 7.1, y: 17.2 },
};

const objectives: Record<MissionStep, string> = {
  car: "STEAL THE CORAL COUPE",
  crate: "RAID PELICAN MARINA",
  escape: "BREAK POLICE SIGHT",
  delivery: "DELIVER TO THE CHOP SHOP",
  complete: "JOB COMPLETE",
};

export const isWall = (x: number, y: number) => {
  const tileX = Math.floor(x);
  const tileY = Math.floor(y);
  return (
    tileX < 0 ||
    tileY < 0 ||
    tileX >= MAP_SIZE ||
    tileY >= MAP_SIZE ||
    CITY_MAP[tileY][tileX] !== 0
  );
};

function canOccupy(x: number, y: number, radius: number) {
  return !(
    isWall(x - radius, y - radius) ||
    isWall(x + radius, y - radius) ||
    isWall(x - radius, y + radius) ||
    isWall(x + radius, y + radius)
  );
}

export function initialActors(): Actor[] {
  const actors: Actor[] = [
    {
      id: 1,
      kind: "car",
      x: LANDMARKS.car.x,
      y: LANDMARKS.car.y,
      health: 999,
      active: true,
      hostile: false,
      cooldown: 0,
      frame: 0,
    },
    {
      id: 2,
      kind: "crate",
      x: LANDMARKS.crate.x,
      y: LANDMARKS.crate.y,
      health: 999,
      active: true,
      hostile: false,
      cooldown: 0,
      frame: 0,
    },
    {
      id: 3,
      kind: "medkit",
      x: 12,
      y: 22.8,
      health: 999,
      active: true,
      hostile: false,
      cooldown: 0,
      frame: 0,
    },
    {
      id: 4,
      kind: "ammo",
      x: 24.1,
      y: 12,
      health: 999,
      active: true,
      hostile: false,
      cooldown: 0,
      frame: 0,
    },
    {
      id: 5,
      kind: "sign",
      x: LANDMARKS.motel.x,
      y: 10.4,
      health: 999,
      active: true,
      hostile: false,
      cooldown: 0,
      frame: 0,
      label: "SUNWASH",
    },
    {
      id: 6,
      kind: "sign",
      x: 27.8,
      y: 11.2,
      health: 999,
      active: true,
      hostile: false,
      cooldown: 0,
      frame: 0,
      label: "PELICAN MARINA",
    },
    {
      id: 7,
      kind: "sign",
      x: LANDMARKS.chop.x,
      y: 21.4,
      health: 999,
      active: true,
      hostile: false,
      cooldown: 0,
      frame: 0,
      label: "CHOP SHOP",
    },
    {
      id: 8,
      kind: "sign",
      x: 6.5,
      y: 9.35,
      health: 999,
      active: true,
      hostile: false,
      cooldown: 0,
      frame: 0,
      label: "SUNWASH LOBBY",
    },
    {
      id: 9,
      kind: "sign",
      x: 17.5,
      y: 9.35,
      health: 999,
      active: true,
      hostile: false,
      cooldown: 0,
      frame: 0,
      label: "SUNSHOT PAWN",
    },
    {
      id: 10,
      kind: "sign",
      x: 7.5,
      y: 13.45,
      health: 999,
      active: true,
      hostile: false,
      cooldown: 0,
      frame: 0,
      label: "NEON GATOR",
    },
    {
      id: 60,
      kind: "clerk",
      x: LANDMARKS.sunwashClerk.x,
      y: LANDMARKS.sunwashClerk.y,
      health: 999,
      active: true,
      hostile: false,
      cooldown: 0,
      frame: 0,
      label: "Mara",
      variant: 0,
      service: "armor",
    },
    {
      id: 61,
      kind: "clerk",
      x: LANDMARKS.pawnClerk.x,
      y: LANDMARKS.pawnClerk.y,
      health: 999,
      active: true,
      hostile: false,
      cooldown: 0,
      frame: 0,
      label: "Rico",
      variant: 1,
      service: "ammo",
    },
    {
      id: 62,
      kind: "clerk",
      x: LANDMARKS.arcadeClerk.x,
      y: LANDMARKS.arcadeClerk.y,
      health: 999,
      active: true,
      hostile: false,
      cooldown: 0,
      frame: 0,
      label: "Dot",
      variant: 2,
      service: "health",
    },
  ];

  const civilians = [
    [11.6, 6.2, Math.PI / 2],
    [12.3, 17.2, -Math.PI / 2],
    [22.5, 5.4, Math.PI / 2],
    [23.2, 17.6, -Math.PI / 2],
    [5.2, 12.1, 0],
    [17.8, 11.5, Math.PI],
    [28.4, 22.4, Math.PI],
    [11.6, 27.4, Math.PI / 2],
    [23.1, 28.2, -Math.PI / 2],
    [31.8, 17.2, Math.PI / 2],
    [1.8, 12.3, 0],
    [18.2, 32.1, Math.PI],
  ] as const;

  civilians.forEach(([x, y, moveAngle], index) => {
    actors.push({
      id: 40 + index,
      kind: "civilian",
      x,
      y,
      health: 45,
      active: true,
      hostile: false,
      cooldown: 0,
      frame: 0,
      variant: index % 5,
      label: [
        "Nico",
        "Val",
        "June",
        "Tomas",
        "Bea",
        "Mack",
        "Luz",
        "Iggy",
        "Rae",
        "Sol",
        "Vee",
        "Cal",
      ][index],
      moveAngle,
      turnTimer: 1.5 + (index % 4) * 0.7,
      panicTimer: 0,
      reportTimer: 0,
      reported: false,
    });
  });

  [
    [27.1, 12.5],
    [29.1, 11.2],
    [31.1, 12.4],
    [27.2, 13.8],
    [30.2, 14.1],
    [24.4, 11.5],
  ].forEach(([x, y], index) =>
    actors.push({
      id: 20 + index,
      kind: "gang",
      x,
      y,
      health: 70,
      active: true,
      hostile: true,
      cooldown: 0.3 + index * 0.12,
      frame: index % 2,
    }),
  );

  return actors;
}

export function createGame(): GameState {
  return {
    x: 6.2,
    y: 11.8,
    angle: 0,
    health: 100,
    armor: 25,
    cash: 250,
    shotgunAmmo: 20,
    smgAmmo: 120,
    weapon: "shotgun",
    weaponCooldown: 0,
    muzzle: 0,
    hurtFlash: 0,
    pickupFlash: 0,
    shake: 0,
    inCar: false,
    carX: LANDMARKS.car.x,
    carY: LANDMARKS.car.y,
    heat: 0,
    heatTimer: 0,
    maxHeat: 0,
    policeMode: "clear",
    lastKnownX: 6.2,
    lastKnownY: 11.8,
    witnessCooldown: 0,
    zone: "street",
    mission: "car",
    hasCrate: false,
    kills: 0,
    elapsed: 0,
    actors: initialActors(),
    message: "PAGER: EASY SCORE. CORAL COUPE OUT FRONT.",
    messageTimer: 5,
    running: true,
    completed: false,
    score: 0,
  };
}

function createDemo(mode: DemoMode): GameState {
  const game = createGame();
  game.messageTimer = 5;

  if (mode === "drive") {
    game.x = 8.2;
    game.y = 11.6;
    game.angle = 0;
    game.inCar = true;
    game.mission = "crate";
    game.actors.find((actor) => actor.kind === "car")!.active = false;
    game.message = "COUPE HOTWIRED. PELICAN MARINA IS EAST.";
  } else if (mode === "combat") {
    game.x = 22.8;
    game.y = 12.2;
    game.angle = -0.08;
    game.weapon = "shotgun";
    game.armor = 90;
    game.mission = "crate";
    game.message = "MARINA CREW SPOTTED. HIT HARD, KEEP MOVING.";
  } else if (mode === "heat") {
    game.x = 29.4;
    game.y = 21.5;
    game.angle = Math.PI;
    game.inCar = true;
    game.hasCrate = true;
    game.mission = "escape";
    game.heat = 2;
    game.heatTimer = 12;
    game.maxHeat = 2;
    game.policeMode = "spotted";
    game.lastKnownX = game.x;
    game.lastKnownY = game.y;
    game.actors.find((actor) => actor.kind === "car")!.active = false;
    game.actors = game.actors.filter(
      (actor) =>
        actor.kind !== "gang" &&
        actor.kind !== "cop" &&
        actor.kind !== "policeCar",
    );
    game.actors.push(
      {
        id: 110,
        kind: "cop",
        x: 25.2,
        y: 21.5,
        health: 85,
        active: true,
        hostile: true,
        cooldown: 0.6,
        frame: 0,
      },
      {
        id: 111,
        kind: "cop",
        x: 28.4,
        y: 23,
        health: 85,
        active: true,
        hostile: true,
        cooldown: 0.9,
        frame: 0,
      },
    );
    game.message = "PACKAGE SECURED. HEAT LEVEL TWO. MOVE!";
  } else {
    game.x = 12.4;
    game.y = 21.5;
    game.angle = Math.PI;
    game.inCar = true;
    game.hasCrate = true;
    game.mission = "delivery";
    game.actors.find((actor) => actor.kind === "car")!.active = false;
    game.message = "HEAT LOST. TAKE IT HOME.";
  }

  return game;
}

function applyDemoScript(
  game: GameState,
  keys: Set<string>,
  mode: DemoMode,
) {
  keys.clear();
  if (mode === "drive") {
    keys.add("w");
    if (game.elapsed > 2.4 && game.elapsed < 3.4) keys.add("arrowright");
    if (game.elapsed > 3.9 && game.elapsed < 4.6) keys.add("arrowleft");
  } else if (mode === "combat") {
    keys.add(Math.floor(game.elapsed * 1.2) % 2 === 0 ? "d" : "a");
    if (game.weaponCooldown <= 0) fireWeapon(game);
  } else {
    keys.add("w");
  }
}

function lineOfSight(ax: number, ay: number, bx: number, by: number) {
  const length = distance(ax, ay, bx, by);
  const steps = Math.ceil(length * 5);
  for (let i = 1; i < steps; i += 1) {
    const t = i / steps;
    if (isWall(ax + (bx - ax) * t, ay + (by - ay) * t)) return false;
  }
  return true;
}

function spawnPolice(game: GameState, count: number) {
  const spawns = [
    [23.5, 11.5],
    [31.5, 22.5],
    [11.5, 21.5],
    [22.5, 32],
    [1.8, 22],
    [12, 1.8],
    [32, 12],
  ];

  for (let i = 0; i < Math.min(count, spawns.length); i += 1) {
    const [x, y] = spawns[i];
    const id = 100 + i;
    const existing = game.actors.find((actor) => actor.id === id);
    if (existing) {
      if (!existing.active) {
        existing.x = x;
        existing.y = y;
        existing.health = 85;
        existing.cooldown = 0.6 + i * 0.18;
        existing.frame = 0;
        existing.active = true;
        existing.hostile = true;
      }
      continue;
    }
    game.actors.push({
      id,
      kind: "cop",
      x,
      y,
      health: 85,
      active: true,
      hostile: true,
      cooldown: 0.6 + i * 0.18,
      frame: i % 2,
      thinkTimer: 0,
    });
  }

  const roadblocks = Math.max(0, Math.ceil(game.heat) - 1);
  const roadblockSpawns = [
    [13.1, 21.5],
    [23.1, 10.6],
  ];
  for (let i = 0; i < roadblocks; i += 1) {
    const [x, y] = roadblockSpawns[i];
    const id = 200 + i;
    const existing = game.actors.find((actor) => actor.id === id);
    if (existing) {
      existing.active = true;
      existing.x = x;
      existing.y = y;
      continue;
    }
    game.actors.push({
      id,
      kind: "policeCar",
      x,
      y,
      health: 999,
      active: true,
      hostile: false,
      cooldown: 0,
      frame: 0,
    });
  }
}

function setMessage(game: GameState, message: string, duration = 3) {
  game.message = message;
  game.messageTimer = duration;
}

export function raiseHeat(game: GameState, level: number) {
  game.heat = clamp(Math.max(game.heat, level), 0, 3);
  game.maxHeat = Math.max(game.maxHeat, Math.ceil(game.heat));
  game.heatTimer = 12;
  game.policeMode = "searching";
  game.lastKnownX = game.x;
  game.lastKnownY = game.y;
  const responseCounts = [0, 2, 4, 6];
  spawnPolice(game, responseCounts[Math.ceil(game.heat)] ?? 6);
}

export function witnessCrime(game: GameState, severity = 1) {
  if (game.witnessCooldown > 0) return false;
  game.witnessCooldown = 0.7;

  const officerSawIt = game.actors.some(
    (actor) =>
      actor.active &&
      actor.kind === "cop" &&
      distance(actor.x, actor.y, game.x, game.y) < 12 &&
      lineOfSight(actor.x, actor.y, game.x, game.y),
  );
  if (officerSawIt) {
    raiseHeat(game, Math.max(severity, game.heat || 1));
    game.policeMode = "spotted";
    setMessage(game, "PATROL SAW IT. UNITS INBOUND.", 2.5);
    return true;
  }

  let witnesses = 0;
  for (const actor of game.actors) {
    if (!actor.active || actor.kind !== "civilian") continue;
    const actorDistance = distance(actor.x, actor.y, game.x, game.y);
    if (actorDistance < 13) actor.panicTimer = Math.max(actor.panicTimer ?? 0, 8);
    if (
      actorDistance < 10 &&
      lineOfSight(actor.x, actor.y, game.x, game.y) &&
      !(actor.reportTimer && actor.reportTimer > 0)
    ) {
      actor.reportTimer = 3.2 + (actor.variant ?? 0) * 0.18;
      actor.reported = false;
      witnesses += 1;
    }
  }

  if (witnesses > 0) {
    game.policeMode = "reported";
    setMessage(game, `WITNESS${witnesses > 1 ? "ES" : ""} REPORTING. MOVE!`, 2.5);
    return true;
  }

  setMessage(game, "NO WITNESSES. COUNTY STAYS QUIET.", 1.6);
  return false;
}

function findNextTile(
  startX: number,
  startY: number,
  targetX: number,
  targetY: number,
) {
  const startTileX = Math.floor(startX);
  const startTileY = Math.floor(startY);
  const targetTileX = Math.floor(targetX);
  const targetTileY = Math.floor(targetY);
  const start = startTileY * MAP_SIZE + startTileX;
  const target = targetTileY * MAP_SIZE + targetTileX;
  if (start === target) return { x: targetX, y: targetY };

  const parents = new Int16Array(MAP_SIZE * MAP_SIZE);
  parents.fill(-1);
  parents[start] = -2;
  const queue = new Int16Array(MAP_SIZE * MAP_SIZE);
  let head = 0;
  let tail = 0;
  queue[tail++] = start;
  const offsets = [1, 0, -1, 0, 1];

  while (head < tail && parents[target] === -1) {
    const current = queue[head++];
    const cx = current % MAP_SIZE;
    const cy = Math.floor(current / MAP_SIZE);
    for (let direction = 0; direction < 4; direction += 1) {
      const nx = cx + offsets[direction];
      const ny = cy + offsets[direction + 1];
      if (nx < 0 || ny < 0 || nx >= MAP_SIZE || ny >= MAP_SIZE) continue;
      const next = ny * MAP_SIZE + nx;
      if (parents[next] !== -1 || CITY_MAP[ny][nx] !== 0) continue;
      parents[next] = current;
      queue[tail++] = next;
    }
  }

  if (parents[target] === -1) return { x: targetX, y: targetY };
  let step = target;
  while (parents[step] !== start && parents[step] >= 0) step = parents[step];
  return { x: (step % MAP_SIZE) + 0.5, y: Math.floor(step / MAP_SIZE) + 0.5 };
}

function actorCanOccupy(game: GameState, actor: Actor, x: number, y: number) {
  if (!canOccupy(x, y, 0.2)) return false;
  return !game.actors.some(
    (other) =>
      other !== actor &&
      other.active &&
      (other.kind === "civilian" || other.kind === "cop" || other.kind === "gang") &&
      distance(x, y, other.x, other.y) < 0.3,
  );
}

function moveWithCollision(
  game: GameState,
  dx: number,
  dy: number,
  radius: number,
) {
  const nextX = game.x + dx;
  const nextY = game.y + dy;
  const clearOfRoadblock = (x: number, y: number) =>
    !game.actors.some(
      (actor) =>
        actor.active &&
        actor.kind === "policeCar" &&
        distance(x, y, actor.x, actor.y) < radius + 0.62,
    );
  const allowedZone = (x: number, y: number) =>
    !game.inCar || getWorldZone(x, y) === "street";
  if (
    canOccupy(nextX, game.y, radius) &&
    clearOfRoadblock(nextX, game.y) &&
    allowedZone(nextX, game.y)
  ) {
    game.x = nextX;
  }
  if (
    canOccupy(game.x, nextY, radius) &&
    clearOfRoadblock(game.x, nextY) &&
    allowedZone(game.x, nextY)
  ) {
    game.y = nextY;
  }
}

function objectivePoint(game: GameState) {
  if (game.mission === "car") return LANDMARKS.car;
  if (game.mission === "crate") return LANDMARKS.crate;
  if (game.mission === "delivery") return LANDMARKS.chop;
  return null;
}

function fireWeapon(game: GameState) {
  if (!game.running || game.inCar || game.weaponCooldown > 0) return;

  const shotgun = game.weapon === "shotgun";
  if (shotgun ? game.shotgunAmmo <= 0 : game.smgAmmo <= 0) {
    game.weaponCooldown = 0.25;
    setMessage(game, "DRY. FIND AMMO.", 1.2);
    return;
  }

  if (shotgun) game.shotgunAmmo -= 1;
  else game.smgAmmo -= 1;
  game.weaponCooldown = shotgun ? 0.56 : 0.095;
  game.muzzle = shotgun ? 0.11 : 0.06;
  game.shake = shotgun ? 0.16 : 0.07;

  const cone = shotgun ? 0.16 : 0.055;
  const damage = shotgun ? 78 : 29;
  let target: Actor | null = null;
  let nearest = Number.POSITIVE_INFINITY;

  for (const actor of game.actors) {
    if (!actor.active || (!actor.hostile && actor.kind !== "civilian")) continue;
    const dx = actor.x - game.x;
    const dy = actor.y - game.y;
    const actorDistance = Math.hypot(dx, dy);
    const actorAngle = Math.atan2(dy, dx);
    let delta = actorAngle - game.angle;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    const generousCone = cone + 0.15 / Math.max(1, actorDistance);
    if (
      Math.abs(delta) < generousCone &&
      actorDistance < nearest &&
      lineOfSight(game.x, game.y, actor.x, actor.y)
    ) {
      target = actor;
      nearest = actorDistance;
    }
  }

  if (target) {
    target.health -= damage;
    target.frame = 2;
    game.pickupFlash = 0.045;
    if (target.kind === "cop") {
      raiseHeat(game, 3);
      game.policeMode = "spotted";
      setMessage(game, "OFFICER HIT. MAXIMUM COUNTY HEAT.", 2.4);
    } else if (target.kind === "civilian") {
      raiseHeat(game, 2);
      setMessage(game, "CIVILIAN HIT. COUNTY ALERTED.", 2.4);
    } else {
      witnessCrime(game, 1);
    }
    if (target.health <= 0) {
      target.active = false;
      if (target.kind !== "civilian") game.kills += 1;
      if (target.kind === "gang") game.cash += 25;
    }
  } else {
    witnessCrime(game, 1);
  }
}

export function interact(game: GameState) {
  if (game.inCar) {
    game.inCar = false;
    const offsets = [Math.PI, Math.PI / 2, -Math.PI / 2, 0];
    const parkingSpot = offsets
      .map((offset) => ({
        x: game.x + Math.cos(game.angle + offset) * 0.85,
        y: game.y + Math.sin(game.angle + offset) * 0.85,
      }))
      .find((spot) => canOccupy(spot.x, spot.y, 0.38));
    game.carX = parkingSpot?.x ?? game.x;
    game.carY = parkingSpot?.y ?? game.y;
    const car = game.actors.find((actor) => actor.kind === "car");
    if (car) {
      car.x = game.carX;
      car.y = game.carY;
      car.active = true;
    }
    setMessage(game, "COUPE PARKED. F TO GET BACK IN.", 1.8);
    return;
  }

  const carDistance = distance(game.x, game.y, game.carX, game.carY);
  if (carDistance < 1.55) {
    game.inCar = true;
    const car = game.actors.find((actor) => actor.kind === "car");
    if (car) car.active = false;
    if (game.mission === "car") {
      game.mission = "crate";
      setMessage(game, "COUPE HOTWIRED. PELICAN MARINA IS EAST.", 4);
    } else {
      setMessage(game, "BACK IN THE COUPE.", 2);
    }
    return;
  }

  const nearby = game.actors
    .filter(
      (actor) =>
        actor.active &&
        (actor.kind === "clerk" || actor.kind === "civilian") &&
        distance(game.x, game.y, actor.x, actor.y) < 1.15,
    )
    .sort(
      (a, b) =>
        distance(game.x, game.y, a.x, a.y) -
        distance(game.x, game.y, b.x, b.y),
    )[0];

  if (!nearby) {
    setMessage(game, "NOTHING TO USE HERE.", 1.2);
    return;
  }

  if (nearby.kind === "civilian") {
    const lines = [
      "County patrol has eyes on the bridges.",
      "Sunshot Pawn sells ammo. Cash only.",
      "The arcade soda machine still works.",
      "I heard sirens east of the canal.",
      "Walk indoors if you need to break sight.",
    ];
    setMessage(
      game,
      (nearby.panicTimer ?? 0) > 0
        ? `${nearby.label ?? "LOCAL"}: STAY AWAY FROM ME!`
        : `${nearby.label ?? "LOCAL"}: ${lines[nearby.id % lines.length]}`,
      3,
    );
    return;
  }

  const prices: Record<ServiceKind, number> = {
    armor: 100,
    ammo: 75,
    health: 50,
  };
  const service = nearby.service ?? "health";
  const price = prices[service];
  if (game.cash < price) {
    setMessage(game, `${nearby.label}: NEED $${price}.`, 2);
    return;
  }
  if (service === "armor" && game.armor >= 100) {
    setMessage(game, `${nearby.label}: YOUR VEST IS ALREADY SOLID.`, 2);
    return;
  }
  if (service === "health" && game.health >= 100) {
    setMessage(game, `${nearby.label}: YOU LOOK FINE TO ME.`, 2);
    return;
  }

  game.cash -= price;
  if (service === "armor") {
    game.armor = Math.min(100, game.armor + 50);
    setMessage(game, `${nearby.label}: ARMOR PATCHED +50.`, 2);
  } else if (service === "ammo") {
    game.shotgunAmmo += 8;
    game.smgAmmo += 50;
    setMessage(game, `${nearby.label}: SHELLS +8, SMG +50.`, 2);
  } else {
    game.health = Math.min(100, game.health + 50);
    setMessage(game, `${nearby.label}: COLD SODA, HEALTH +50.`, 2);
  }
  game.pickupFlash = 0.18;
}

export function updateGame(
  game: GameState,
  keys: Set<string>,
  dt: number,
  onFinished: (result: Result) => void,
) {
  if (!game.running) return;
  game.elapsed += dt;
  game.weaponCooldown = Math.max(0, game.weaponCooldown - dt);
  game.muzzle = Math.max(0, game.muzzle - dt);
  game.hurtFlash = Math.max(0, game.hurtFlash - dt);
  game.pickupFlash = Math.max(0, game.pickupFlash - dt);
  game.shake = Math.max(0, game.shake - dt);
  game.messageTimer = Math.max(0, game.messageTimer - dt);
  game.witnessCooldown = Math.max(0, game.witnessCooldown - dt);

  const turn =
    (keys.has("arrowleft") ? -1 : 0) +
    (keys.has("arrowright") ? 1 : 0);
  game.angle += turn * dt * (game.inCar ? 1.55 : 2.25);

  const forward =
    (keys.has("w") || keys.has("arrowup") ? 1 : 0) -
    (keys.has("s") || keys.has("arrowdown") ? 1 : 0);
  const strafe = (keys.has("d") ? 1 : 0) - (keys.has("a") ? 1 : 0);
  const sprinting = keys.has("shift");
  const speed = game.inCar ? (sprinting ? 3.2 : 5.3) : sprinting ? 4.2 : 2.8;
  const strafeScale = game.inCar ? 0 : 0.78;
  const dx =
    (Math.cos(game.angle) * forward +
      Math.cos(game.angle + Math.PI / 2) * strafe * strafeScale) *
    speed *
    dt;
  const dy =
    (Math.sin(game.angle) * forward +
      Math.sin(game.angle + Math.PI / 2) * strafe * strafeScale) *
    speed *
    dt;

  if (forward !== 0 || strafe !== 0) {
    moveWithCollision(game, dx, dy, game.inCar ? 0.36 : 0.22);
    if (game.inCar) {
      game.carX = game.x;
      game.carY = game.y;
    }
  }

  const nextZone = getWorldZone(game.x, game.y);
  if (nextZone !== game.zone) {
    game.zone = nextZone;
    setMessage(
      game,
      nextZone === "street"
        ? "BACK ON THE STREET."
        : `ENTERED ${zoneName(nextZone)}. F TO TALK OR BUY.`,
      2.5,
    );
  }

  if (keys.has(" ") && !game.inCar) fireWeapon(game);

  const crate = game.actors.find((actor) => actor.kind === "crate");
  if (
    game.mission === "crate" &&
    !game.inCar &&
    crate?.active &&
    distance(game.x, game.y, crate.x, crate.y) < 0.9
  ) {
    crate.active = false;
    game.hasCrate = true;
    game.mission = "escape";
    raiseHeat(game, 2);
    game.pickupFlash = 0.25;
    setMessage(game, "PACKAGE SECURED. HEAT LEVEL TWO. MOVE!", 4);
  }

  for (const actor of game.actors) {
    if (!actor.active) continue;
    const actorDistance = distance(game.x, game.y, actor.x, actor.y);

    if (actor.kind === "medkit" && actorDistance < 0.72 && game.health < 100) {
      actor.active = false;
      game.health = Math.min(100, game.health + 45);
      game.pickupFlash = 0.18;
      setMessage(game, "HEALTH +45", 1.4);
      continue;
    }

    if (actor.kind === "ammo" && actorDistance < 0.72) {
      actor.active = false;
      game.shotgunAmmo += 8;
      game.smgAmmo += 50;
      game.pickupFlash = 0.18;
      setMessage(game, "AMMO RESTOCKED", 1.4);
      continue;
    }

    if (actor.kind === "civilian") {
      actor.panicTimer = Math.max(0, (actor.panicTimer ?? 0) - dt);
      actor.turnTimer = (actor.turnTimer ?? 0) - dt;

      if ((actor.reportTimer ?? 0) > 0) {
        actor.reportTimer = Math.max(0, (actor.reportTimer ?? 0) - dt);
        if (actor.reportTimer === 0 && !actor.reported) {
          actor.reported = true;
          raiseHeat(game, 1);
          setMessage(game, "DISPATCH GOT THE DESCRIPTION. SEARCH ACTIVE.", 3);
        }
      }

      const panicking = (actor.panicTimer ?? 0) > 0;
      if (panicking) {
        actor.moveAngle = Math.atan2(actor.y - game.y, actor.x - game.x);
        actor.frame = 1;
      } else {
        actor.frame = 0;
        actor.reported = false;
        if ((actor.turnTimer ?? 0) <= 0) {
          actor.moveAngle =
            (actor.moveAngle ?? 0) + ((actor.id % 5) - 2) * 0.38;
          actor.turnTimer = 2.4 + (actor.id % 4) * 0.65;
        }
      }

      const walkSpeed = panicking ? 1.55 : 0.38;
      const moveAngle = actor.moveAngle ?? 0;
      const mx = Math.cos(moveAngle) * walkSpeed * dt;
      const my = Math.sin(moveAngle) * walkSpeed * dt;
      let moved = false;
      if (actorCanOccupy(game, actor, actor.x + mx, actor.y)) {
        actor.x += mx;
        moved = true;
      }
      if (actorCanOccupy(game, actor, actor.x, actor.y + my)) {
        actor.y += my;
        moved = true;
      }
      if (!moved) {
        actor.moveAngle = moveAngle + Math.PI / 2 + (actor.id % 3) * 0.3;
        actor.turnTimer = 0.5;
      }
      continue;
    }

    if (!actor.hostile) continue;
    actor.cooldown -= dt;
    if (actor.frame === 2 && actor.cooldown < 0.45) actor.frame = 0;

    const seesPlayer =
      actorDistance < (actor.kind === "cop" ? 12 : 10) &&
      lineOfSight(actor.x, actor.y, game.x, game.y);
    if (seesPlayer && actor.kind === "cop") {
      game.lastKnownX = game.x;
      game.lastKnownY = game.y;
      game.policeMode = "spotted";
    }
    if (!seesPlayer && actor.kind !== "cop") continue;

    let targetX = game.x;
    let targetY = game.y;
    if (actor.kind === "cop" && !seesPlayer) {
      if (game.heat <= 0) continue;
      actor.thinkTimer = (actor.thinkTimer ?? 0) - dt;
      if ((actor.thinkTimer ?? 0) <= 0 || actor.targetX === undefined) {
        const next = findNextTile(
          actor.x,
          actor.y,
          game.lastKnownX,
          game.lastKnownY,
        );
        actor.targetX = next.x;
        actor.targetY = next.y;
        actor.thinkTimer = 0.45 + (actor.id % 3) * 0.08;
      }
      targetX = actor.targetX ?? game.lastKnownX;
      targetY = actor.targetY ?? game.lastKnownY;
    }

    const targetDistance = Math.max(
      0.001,
      distance(actor.x, actor.y, targetX, targetY),
    );
    const pursue = targetDistance > (actor.kind === "cop" ? 1.25 : 2.8);
    if (pursue) {
      const moveSpeed = actor.kind === "cop" ? 1.32 : 0.85;
      const mx = ((targetX - actor.x) / targetDistance) * moveSpeed * dt;
      const my = ((targetY - actor.y) / targetDistance) * moveSpeed * dt;
      if (actorCanOccupy(game, actor, actor.x + mx, actor.y)) actor.x += mx;
      if (actorCanOccupy(game, actor, actor.x, actor.y + my)) actor.y += my;
    }

    if (seesPlayer && actorDistance < 7.5 && actor.cooldown <= 0) {
      actor.cooldown = actor.kind === "cop" ? 0.95 : 1.25;
      actor.frame = 1;
      const rawDamage = actor.kind === "cop" ? 7 : 5;
      const absorbed = Math.min(game.armor, Math.ceil(rawDamage * 0.45));
      game.armor -= absorbed;
      game.health -= rawDamage - absorbed;
      game.hurtFlash = 0.16;
      game.shake = 0.12;
    }
  }

  if (game.heat > 0) {
    const copSeesPlayer = game.actors.some(
      (actor) =>
        actor.active &&
        actor.kind === "cop" &&
        distance(actor.x, actor.y, game.x, game.y) < 11 &&
        lineOfSight(actor.x, actor.y, game.x, game.y),
    );
    if (copSeesPlayer) {
      game.heatTimer = 10;
      game.policeMode = "spotted";
      game.lastKnownX = game.x;
      game.lastKnownY = game.y;
    } else {
      if (game.policeMode !== "reported") game.policeMode = "searching";
      game.heatTimer -= dt;
    }
    if (game.heatTimer <= 0) {
      game.heat = Math.max(0, game.heat - dt * 0.72);
      if (game.heat < 0.05) {
        game.heat = 0;
        game.policeMode = "clear";
        game.actors.forEach((actor) => {
          if (actor.kind === "cop" || actor.kind === "policeCar") {
            actor.active = false;
          }
        });
        if (game.mission === "escape") {
          game.mission = "delivery";
          setMessage(game, "HEAT LOST. TAKE THE CANAL TO THE CHOP SHOP.", 4);
        }
      }
    }
  }

  if (game.health <= 0) {
    game.health = 0;
    game.running = false;
    onFinished({
      score: 0,
      kills: game.kills,
      maxHeat: game.maxHeat,
      elapsed: game.elapsed,
      health: 0,
    });
    return;
  }

  if (
    game.mission === "delivery" &&
    distance(game.x, game.y, LANDMARKS.chop.x, LANDMARKS.chop.y) < 1.25
  ) {
    game.mission = "complete";
    game.completed = true;
    game.running = false;
    const timeBonus = Math.max(0, Math.round(500 - game.elapsed * 2.2));
    game.score = 1000 + game.kills * 25 + timeBonus + game.health * 3;
    game.cash += game.score;
    onFinished({
      score: game.score,
      kills: game.kills,
      maxHeat: game.maxHeat,
      elapsed: game.elapsed,
      health: game.health,
    });
    return;
  }
}

const wallPalettes: Record<number, [string, string]> = {
  1: ["#91566f", "#5d3a62"],
  2: ["#ef7a7f", "#9f4e73"],
  3: ["#23b8b2", "#176f88"],
  4: ["#e9b13e", "#a45b47"],
  5: ["#5592a8", "#35536e"],
};

function drawActorSprite(
  ctx: CanvasRenderingContext2D,
  kind: ActorKind,
  x: number,
  y: number,
  width: number,
  height: number,
  frame: number,
  label?: string,
  variant = 0,
) {
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  ctx.imageSmoothingEnabled = false;
  const pixel = Math.max(1, Math.floor(width / 10));

  if (
    (kind === "cop" || kind === "gang") &&
    spriteImages.enemies?.complete
  ) {
    const sourceY = kind === "cop" ? 0 : 64;
    ctx.drawImage(
      spriteImages.enemies,
      0,
      sourceY,
      64,
      64,
      -width * 0.62,
      -height * 0.58,
      width * 1.24,
      height * 1.24,
    );
    if (frame === 1) {
      ctx.fillStyle = "#fff1a8";
      ctx.fillRect(-pixel, -height * 0.3, pixel * 2, pixel * 2);
    }
    ctx.restore();
    return;
  }

  if (kind === "car" || kind === "policeCar") {
    const policeCar = kind === "policeCar";
    ctx.fillStyle = policeCar ? "#e7edf1" : "#ff4f69";
    ctx.fillRect(-width / 2, -height * 0.48, width, height * 0.62);
    ctx.fillStyle = policeCar ? "#143d66" : "#2e224d";
    ctx.fillRect(-width * 0.28, -height * 0.72, width * 0.56, height * 0.3);
    ctx.fillStyle = policeCar ? "#8bdcff" : "#20e6d1";
    ctx.fillRect(-width * 0.22, -height * 0.66, width * 0.44, height * 0.17);
    ctx.fillStyle = "#171025";
    ctx.fillRect(-width * 0.44, height * 0.03, width * 0.18, height * 0.2);
    ctx.fillRect(width * 0.26, height * 0.03, width * 0.18, height * 0.2);
    if (policeCar) {
      ctx.fillStyle = Math.floor(performance.now() / 180) % 2 ? "#ff315d" : "#42c8ff";
      ctx.fillRect(-width * 0.18, -height * 0.78, width * 0.16, height * 0.08);
      ctx.fillRect(width * 0.02, -height * 0.78, width * 0.16, height * 0.08);
    }
  } else if (kind === "crate") {
    ctx.fillStyle = "#ffbd2e";
    ctx.fillRect(-width * 0.34, -height * 0.36, width * 0.68, height * 0.48);
    ctx.fillStyle = "#6a3d44";
    ctx.fillRect(-width * 0.25, -height * 0.29, width * 0.5, pixel);
    ctx.fillRect(-pixel / 2, -height * 0.36, pixel, height * 0.48);
  } else if (kind === "medkit" || kind === "ammo") {
    ctx.fillStyle = kind === "medkit" ? "#f1edd4" : "#20e6d1";
    ctx.fillRect(-width * 0.3, -height * 0.34, width * 0.6, height * 0.46);
    ctx.fillStyle = kind === "medkit" ? "#ff315d" : "#241737";
    if (kind === "medkit") {
      ctx.fillRect(-pixel / 2, -height * 0.28, pixel, height * 0.33);
      ctx.fillRect(-width * 0.18, -height * 0.18, width * 0.36, pixel);
    } else {
      ctx.fillRect(-width * 0.18, -height * 0.26, pixel, height * 0.28);
      ctx.fillRect(0, -height * 0.26, pixel, height * 0.28);
    }
  } else if (kind === "sign") {
    ctx.fillStyle = "#241737";
    ctx.fillRect(-width * 0.48, -height * 0.46, width * 0.96, height * 0.38);
    ctx.strokeStyle = "#ffbd2e";
    ctx.lineWidth = Math.max(1, pixel / 2);
    ctx.strokeRect(-width * 0.48, -height * 0.46, width * 0.96, height * 0.38);
    ctx.fillStyle = "#ffbd2e";
    ctx.font = `bold ${Math.max(4, Math.floor(width / Math.max(8, (label?.length ?? 8) * 0.65)))}px monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label ?? "", 0, -height * 0.27);
    ctx.fillRect(-pixel / 2, -height * 0.08, pixel, height * 0.42);
  } else if (kind === "civilian" || kind === "clerk") {
    const shirts = ["#ffbd2e", "#20e6d1", "#ff4f69", "#a77cff", "#f1edd4"];
    const pants = ["#343052", "#5c3159", "#214f62", "#47355e", "#243247"];
    const clerk = kind === "clerk";
    ctx.fillStyle = frame === 2 ? "#fff1c9" : ["#d9946f", "#8f5b4b", "#c67c5d"][variant % 3];
    ctx.fillRect(-width * 0.16, -height * 0.49, width * 0.32, height * 0.22);
    ctx.fillStyle = pants[variant % pants.length];
    ctx.fillRect(-width * 0.19, -height * 0.51, width * 0.38, height * 0.08);
    ctx.fillStyle = clerk ? "#f1edd4" : shirts[variant % shirts.length];
    ctx.fillRect(-width * 0.27, -height * 0.27, width * 0.54, height * 0.43);
    if (clerk) {
      ctx.fillStyle = "#ff2d95";
      ctx.fillRect(-width * 0.18, -height * 0.19, width * 0.36, height * 0.29);
    }
    ctx.fillStyle = pants[variant % pants.length];
    const legOffset = frame === 1 ? width * 0.05 : 0;
    ctx.fillRect(-width * 0.27 - legOffset, height * 0.16, width * 0.2, height * 0.31);
    ctx.fillRect(width * 0.07 + legOffset, height * 0.16, width * 0.2, height * 0.31);
    ctx.fillStyle = "#25162f";
    ctx.fillRect(-width * 0.42, -height * 0.18, width * 0.16, height * 0.33);
    ctx.fillRect(width * 0.26, -height * 0.18, width * 0.16, height * 0.33);
  } else {
    const cop = kind === "cop";
    const body = cop ? "#3ea7d8" : "#ff2d95";
    const dark = cop ? "#173c66" : "#62285c";
    ctx.fillStyle = frame === 2 ? "#fff1c9" : "#d9946f";
    ctx.fillRect(-width * 0.16, -height * 0.49, width * 0.32, height * 0.22);
    ctx.fillStyle = dark;
    ctx.fillRect(-width * 0.19, -height * 0.51, width * 0.38, height * 0.08);
    ctx.fillStyle = body;
    ctx.fillRect(-width * 0.27, -height * 0.27, width * 0.54, height * 0.43);
    ctx.fillStyle = dark;
    ctx.fillRect(-width * 0.28, height * 0.16, width * 0.21, height * 0.31);
    ctx.fillRect(width * 0.07, height * 0.16, width * 0.21, height * 0.31);
    ctx.fillStyle = "#25162f";
    const armShift = frame === 1 ? -height * 0.14 : 0;
    ctx.fillRect(-width * 0.43, -height * 0.19 + armShift, width * 0.18, height * 0.35);
    ctx.fillRect(width * 0.25, -height * 0.19 + armShift, width * 0.18, height * 0.35);
    if (frame === 1) {
      ctx.fillStyle = "#fff1a8";
      ctx.fillRect(-pixel / 2, -height * 0.34, pixel, pixel);
    }
  }
  ctx.restore();
}

function renderGame(ctx: CanvasRenderingContext2D, game: GameState) {
  const width = VIEW_WIDTH;
  const height = VIEW_HEIGHT;
  const shakeX =
    game.shake > 0 ? Math.sin(game.elapsed * 91) * game.shake * 12 : 0;
  const shakeY =
    game.shake > 0 ? Math.cos(game.elapsed * 77) * game.shake * 8 : 0;
  ctx.save();
  ctx.translate(Math.round(shakeX), Math.round(shakeY));

  if (game.zone === "street") {
    const sky = ctx.createLinearGradient(0, 0, 0, height * 0.52);
    sky.addColorStop(0, "#402f7d");
    sky.addColorStop(0.68, "#d94d86");
    sky.addColorStop(1, "#ffad55");
    ctx.fillStyle = sky;
    ctx.fillRect(-8, -8, width + 16, height * 0.52 + 8);

    ctx.fillStyle = "#ffdd77";
    ctx.fillRect(width * 0.74, 22, 28, 28);
    ctx.fillStyle = "#f87e68";
    for (let sy = 28; sy < 49; sy += 5) ctx.fillRect(width * 0.74, sy, 28, 2);

    const floor = ctx.createLinearGradient(0, height * 0.5, 0, height);
    floor.addColorStop(0, "#35234f");
    floor.addColorStop(1, "#151224");
    ctx.fillStyle = floor;
    ctx.fillRect(-8, height * 0.5, width + 16, height * 0.55 + 8);

    for (let y = Math.ceil(height * 0.56); y < height; y += 13) {
      ctx.fillStyle = y % 26 === 0 ? "#443159" : "#2c2440";
      ctx.fillRect(0, y, width, 1);
    }
  } else {
    const roomColors: Record<Exclude<WorldZone, "street">, [string, string]> = {
      sunwash: ["#302044", "#5a3b59"],
      pawn: ["#173d4d", "#285c61"],
      arcade: ["#39194e", "#641d59"],
    };
    const [ceiling, floor] = roomColors[game.zone];
    ctx.fillStyle = ceiling;
    ctx.fillRect(-8, -8, width + 16, height * 0.52 + 8);
    ctx.fillStyle = floor;
    ctx.fillRect(-8, height * 0.5, width + 16, height * 0.55 + 8);
    ctx.fillStyle = "#ffbd2e";
    ctx.fillRect(28, 26, width - 56, 3);
    for (let y = Math.ceil(height * 0.54); y < height; y += 11) {
      ctx.fillStyle = y % 22 === 0 ? "#1d1728" : "#75607b";
      ctx.fillRect(0, y, width, 1);
    }
  }

  const dirX = Math.cos(game.angle);
  const dirY = Math.sin(game.angle);
  const planeX = -dirY * FOV_SCALE;
  const planeY = dirX * FOV_SCALE;
  const zBuffer = new Float32Array(width);

  for (let x = 0; x < width; x += 1) {
    const cameraX = (2 * x) / width - 1;
    const rayDirX = dirX + planeX * cameraX;
    const rayDirY = dirY + planeY * cameraX;
    let mapX = Math.floor(game.x);
    let mapY = Math.floor(game.y);
    const deltaDistX = Math.abs(1 / (rayDirX || 0.00001));
    const deltaDistY = Math.abs(1 / (rayDirY || 0.00001));
    const stepX = rayDirX < 0 ? -1 : 1;
    const stepY = rayDirY < 0 ? -1 : 1;
    let sideDistX =
      rayDirX < 0
        ? (game.x - mapX) * deltaDistX
        : (mapX + 1 - game.x) * deltaDistX;
    let sideDistY =
      rayDirY < 0
        ? (game.y - mapY) * deltaDistY
        : (mapY + 1 - game.y) * deltaDistY;
    let side = 0;
    let material = 1;
    let guard = 0;

    while (guard < 80) {
      guard += 1;
      if (sideDistX < sideDistY) {
        sideDistX += deltaDistX;
        mapX += stepX;
        side = 0;
      } else {
        sideDistY += deltaDistY;
        mapY += stepY;
        side = 1;
      }
      if (
        mapX < 0 ||
        mapY < 0 ||
        mapX >= MAP_SIZE ||
        mapY >= MAP_SIZE
      ) {
        material = 1;
        break;
      }
      material = CITY_MAP[mapY][mapX];
      if (material !== 0) break;
    }

    const wallDistance = Math.max(
      0.001,
      side === 0
        ? (mapX - game.x + (1 - stepX) / 2) / rayDirX
        : (mapY - game.y + (1 - stepY) / 2) / rayDirY,
    );
    zBuffer[x] = wallDistance;
    const lineHeight = Math.min(height * 2.2, height / wallDistance);
    const drawStart = Math.floor(height / 2 - lineHeight / 2);
    const drawEnd = Math.floor(height / 2 + lineHeight / 2);
    const palette = wallPalettes[material] ?? wallPalettes[1];
    let wallX =
      side === 0
        ? game.y + wallDistance * rayDirY
        : game.x + wallDistance * rayDirX;
    wallX -= Math.floor(wallX);
    const stripe = Math.floor(wallX * 12);
    const dim = clamp(1 - wallDistance / 38, 0.3, 1);
    ctx.globalAlpha = dim;
    ctx.fillStyle = side === 1 ? palette[1] : palette[0];
    ctx.fillRect(x, drawStart, 1, drawEnd - drawStart);
    if (stripe === 2 || stripe === 8) {
      ctx.fillStyle = material === 3 ? "#b7fff3" : "#6a285e";
      const windowY = drawStart + (drawEnd - drawStart) * 0.28;
      ctx.fillRect(
        x,
        windowY,
        1,
        Math.max(1, (drawEnd - drawStart) * 0.13),
      );
    }
    ctx.globalAlpha = 1;
  }

  const visibleActors = game.actors
    .filter((actor) => actor.active)
    .map((actor) => ({
      actor,
      distance: (game.x - actor.x) ** 2 + (game.y - actor.y) ** 2,
    }))
    .sort((a, b) => b.distance - a.distance);

  const inverse = 1 / (planeX * dirY - dirX * planeY);
  for (const entry of visibleActors) {
    const actor = entry.actor;
    const spriteX = actor.x - game.x;
    const spriteY = actor.y - game.y;
    const transformX = inverse * (dirY * spriteX - dirX * spriteY);
    const transformY = inverse * (-planeY * spriteX + planeX * spriteY);
    if (transformY <= 0.1) continue;
    const screenX = Math.floor((width / 2) * (1 + transformX / transformY));
    const baseScale =
      actor.kind === "car" || actor.kind === "policeCar"
        ? 1.25
        : actor.kind === "sign"
          ? 1.4
          : actor.kind === "civilian" || actor.kind === "clerk"
            ? 0.82
            : 0.9;
    const spriteHeight = Math.abs(
      Math.floor((height / transformY) * baseScale),
    );
    const spriteWidth =
      actor.kind === "car" || actor.kind === "policeCar"
        ? Math.floor(spriteHeight * 1.25)
        : actor.kind === "sign"
          ? Math.floor(spriteHeight * 1.5)
          : Math.floor(spriteHeight * 0.58);
    const drawX = screenX - spriteWidth / 2;
    const drawY = height / 2 - spriteHeight / 2;
    const center = clamp(Math.floor(screenX), 0, width - 1);
    if (transformY < zBuffer[center] + 0.2 && spriteHeight > 2) {
      drawActorSprite(
        ctx,
        actor.kind,
        drawX + spriteWidth / 2,
        drawY + spriteHeight / 2,
        spriteWidth,
        spriteHeight,
        actor.frame,
        actor.label,
        actor.variant,
      );
    }
  }

  ctx.restore();
  drawHud(ctx, game);
}

function drawHud(ctx: CanvasRenderingContext2D, game: GameState) {
  const width = VIEW_WIDTH;
  const height = VIEW_HEIGHT;
  ctx.save();
  ctx.imageSmoothingEnabled = false;

  if (game.inCar) {
    ctx.fillStyle = "#191225";
    ctx.fillRect(width / 2 - 66, height - 25, 132, 28);
    ctx.fillStyle = "#ff4f69";
    ctx.fillRect(width / 2 - 57, height - 21, 114, 9);
    ctx.fillStyle = "#20e6d1";
    ctx.fillRect(width / 2 - 38, height - 20, 76, 4);
    ctx.strokeStyle = "#ffbd2e";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(width / 2, height - 2, 20, Math.PI, 0);
    ctx.stroke();
  } else {
    const bob = Math.sin(game.elapsed * 8) * 1.5;
    const recoil = game.muzzle > 0 ? 7 : 0;
    const center = width / 2;
    const weaponY = height - 4 + bob + recoil;
    if (spriteImages.weapons?.complete) {
      const sourceX =
        game.weapon === "shotgun"
          ? game.muzzle > 0
            ? 64
            : 0
          : game.muzzle > 0
            ? 192
            : 128;
      const drawSize = 104;
      ctx.drawImage(
        spriteImages.weapons,
        sourceX,
        0,
        64,
        64,
        center - drawSize / 2,
        weaponY - drawSize + 5,
        drawSize,
        drawSize,
      );
    } else if (game.weapon === "shotgun") {
      ctx.fillStyle = "#26192d";
      ctx.fillRect(center - 31, weaponY - 18, 62, 25);
      ctx.fillStyle = "#8a5944";
      ctx.fillRect(center - 14, weaponY - 28, 28, 25);
      ctx.fillStyle = "#d5b06f";
      ctx.fillRect(center - 8, weaponY - 48, 16, 23);
      ctx.fillStyle = "#302c3d";
      ctx.fillRect(center - 6, weaponY - 68, 12, 23);
    } else {
      ctx.fillStyle = "#211b2d";
      ctx.fillRect(center - 25, weaponY - 27, 50, 34);
      ctx.fillStyle = "#4f6170";
      ctx.fillRect(center - 8, weaponY - 50, 16, 28);
      ctx.fillStyle = "#9c8257";
      ctx.fillRect(center + 8, weaponY - 12, 9, 20);
    }
    if (game.muzzle > 0 && !spriteImages.weapons?.complete) {
      ctx.fillStyle = "#fff1a8";
      ctx.fillRect(center - 7, weaponY - 79, 14, 11);
      ctx.fillStyle = "#ff6b35";
      ctx.fillRect(center - 3, weaponY - 86, 6, 8);
    }
  }

  ctx.textBaseline = "top";
  ctx.font = "bold 8px monospace";
  ctx.fillStyle = "#100c1cdd";
  ctx.fillRect(6, 6, 106, 26);
  ctx.fillStyle = "#fff1c9";
  ctx.fillText(`HP ${String(Math.ceil(game.health)).padStart(3, "0")}`, 11, 10);
  ctx.fillStyle = "#20e6d1";
  ctx.fillRect(11, 20, game.health * 0.52, 4);
  ctx.fillStyle = "#6b477f";
  ctx.fillRect(64, 20, 42, 4);
  ctx.fillStyle = "#ffbd2e";
  ctx.fillRect(64, 20, game.armor * 0.42, 4);
  ctx.fillStyle = "#c7b8cf";
  ctx.fillText(`ARM ${String(Math.ceil(game.armor)).padStart(2, "0")}`, 65, 10);

  const ammo = game.weapon === "shotgun" ? game.shotgunAmmo : game.smgAmmo;
  ctx.fillStyle = "#100c1cdd";
  ctx.fillRect(width - 70, height - 23, 64, 17);
  ctx.fillStyle = "#fff1c9";
  ctx.textAlign = "right";
  ctx.fillText(
    `${game.weapon.toUpperCase()} ${String(ammo).padStart(3, "0")}`,
    width - 10,
    height - 18,
  );

  ctx.textAlign = "left";
  ctx.fillStyle = "#100c1cdd";
  ctx.fillRect(6, height - 23, 76, 17);
  ctx.fillStyle = "#ffbd2e";
  ctx.fillText(`$${game.cash.toLocaleString("en-US")}`, 11, height - 18);

  ctx.textAlign = "center";
  ctx.fillStyle = "#100c1ce8";
  ctx.fillRect(width / 2 - 92, 6, 184, 24);
  ctx.fillStyle = "#ffbd2e";
  ctx.fillText(objectives[game.mission], width / 2, 10);
  const point = objectivePoint(game);
  if (point) {
    const meters = Math.round(distance(game.x, game.y, point.x, point.y) * 10);
    const targetAngle = Math.atan2(point.y - game.y, point.x - game.x);
    let delta = targetAngle - game.angle;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    const arrow = Math.abs(delta) < 0.22 ? "^" : delta < 0 ? "<" : ">";
    ctx.fillStyle = "#20e6d1";
    ctx.fillText(`${arrow} ${meters}M`, width / 2, 19);
  } else if (game.mission === "escape") {
    ctx.fillStyle = "#20e6d1";
    ctx.fillText(`${Math.max(0, Math.ceil(game.heatTimer))} SEC`, width / 2, 19);
  }

  const heat = Math.ceil(game.heat);
  for (let i = 0; i < 3; i += 1) {
    const x = 12 + i * 13;
    const y = 39;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = i < heat ? "#ff315d" : "#392447";
    ctx.fillRect(-4, -4, 8, 8);
    ctx.restore();
  }
  ctx.fillStyle = heat > 0 ? "#ff8096" : "#816d89";
  ctx.textAlign = "left";
  ctx.fillText("HEAT", 51, 35);
  ctx.font = "bold 6px monospace";
  ctx.fillStyle =
    game.policeMode === "spotted"
      ? "#ffbd2e"
      : game.policeMode === "clear"
        ? "#816d89"
        : "#8fe8ff";
  ctx.fillText(
    game.policeMode === "clear"
      ? "NO ACTIVE SEARCH"
      : game.policeMode === "reported"
        ? "WITNESS REPORTING"
        : game.policeMode === "spotted"
          ? "PLAYER SPOTTED"
          : `SEARCH ${Math.max(0, Math.ceil(game.heatTimer))}`,
    8,
    48,
  );

  const location = zoneName(game.zone).toUpperCase();
  ctx.textAlign = "center";
  ctx.fillStyle = "#100c1cdd";
  ctx.fillRect(width / 2 - 55, 33, 110, 11);
  ctx.fillStyle = game.zone === "street" ? "#c7b8cf" : "#20e6d1";
  ctx.fillText(location, width / 2, 36);

  drawMinimap(ctx, game);

  ctx.strokeStyle = game.muzzle > 0 ? "#fff1a8" : "#20e6d1";
  ctx.globalAlpha = 0.88;
  ctx.beginPath();
  ctx.moveTo(width / 2 - 5, height / 2);
  ctx.lineTo(width / 2 - 2, height / 2);
  ctx.moveTo(width / 2 + 2, height / 2);
  ctx.lineTo(width / 2 + 5, height / 2);
  ctx.moveTo(width / 2, height / 2 - 5);
  ctx.lineTo(width / 2, height / 2 - 2);
  ctx.moveTo(width / 2, height / 2 + 2);
  ctx.lineTo(width / 2, height / 2 + 5);
  ctx.stroke();
  ctx.globalAlpha = 1;

  if (game.messageTimer > 0) {
    ctx.font = "bold 7px monospace";
    const textWidth = Math.min(
      width - 24,
      ctx.measureText(game.message).width + 16,
    );
    ctx.fillStyle = "#100c1cef";
    ctx.fillRect(width / 2 - textWidth / 2, height - 44, textWidth, 13);
    ctx.fillStyle = "#fff1c9";
    ctx.textAlign = "center";
    ctx.fillText(game.message, width / 2, height - 41);
  }

  if (game.hurtFlash > 0) {
    ctx.globalAlpha = clamp(game.hurtFlash * 2.8, 0, 0.42);
    ctx.fillStyle = "#ff174f";
    ctx.fillRect(0, 0, width, height);
  }
  if (game.pickupFlash > 0) {
    ctx.globalAlpha = clamp(game.pickupFlash * 1.8, 0, 0.28);
    ctx.fillStyle = "#fff4af";
    ctx.fillRect(0, 0, width, height);
  }

  ctx.restore();
}

function drawMinimap(ctx: CanvasRenderingContext2D, game: GameState) {
  const size = 52;
  const x = VIEW_WIDTH - size - 6;
  const y = 35;
  const scale = size / MAP_SIZE;
  ctx.save();
  ctx.fillStyle = "#100c1cdd";
  ctx.fillRect(x - 2, y - 2, size + 4, size + 4);
  for (let py = 0; py < MAP_SIZE; py += 1) {
    for (let px = 0; px < MAP_SIZE; px += 1) {
      if (CITY_MAP[py][px] !== 0) {
        ctx.fillStyle = CITY_MAP[py][px] === 5 ? "#1a5969" : "#3f2d52";
        ctx.fillRect(x + px * scale, y + py * scale, scale + 0.2, scale + 0.2);
      }
    }
  }
  const objective = objectivePoint(game);
  if (objective) {
    ctx.fillStyle = "#ffbd2e";
    ctx.fillRect(
      x + objective.x * scale - 1,
      y + objective.y * scale - 1,
      3,
      3,
    );
  }
  for (const actor of game.actors) {
    if (!actor.active) continue;
    if (actor.kind === "cop" || actor.kind === "policeCar") {
      ctx.fillStyle = "#42c8ff";
      const dot = actor.kind === "policeCar" ? 2.6 : 2;
      ctx.fillRect(x + actor.x * scale, y + actor.y * scale, dot, dot);
    } else if (actor.kind === "civilian") {
      ctx.fillStyle = "#ffbd2e";
      ctx.fillRect(x + actor.x * scale, y + actor.y * scale, 1, 1);
    } else if (actor.kind === "clerk") {
      ctx.fillStyle = "#20e6d1";
      ctx.fillRect(x + actor.x * scale, y + actor.y * scale, 1.4, 1.4);
    }
  }
  if (game.heat > 0) {
    ctx.strokeStyle = "#ff8096";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(
      x + game.lastKnownX * scale,
      y + game.lastKnownY * scale,
      3.2,
      0,
      Math.PI * 2,
    );
    ctx.stroke();
  }
  ctx.translate(x + game.x * scale, y + game.y * scale);
  ctx.rotate(game.angle);
  ctx.fillStyle = "#fff1c9";
  ctx.beginPath();
  ctx.moveTo(4, 0);
  ctx.lineTo(-3, -2.5);
  ctx.lineTo(-3, 2.5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

function requestPointerLockSafely(canvas: HTMLCanvasElement | null) {
  if (!canvas?.requestPointerLock) return;
  try {
    void Promise.resolve(canvas.requestPointerLock()).catch(() => {
      // Keyboard turning remains available when a preview/browser blocks lock.
    });
  } catch {
    // Pointer lock is an enhancement; arrow-key turning is the fallback.
  }
}

export function HeatwaveGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<GameState>(createGame());
  const keysRef = useRef(new Set<string>());
  const demoRef = useRef<DemoMode | null>(null);
  const [started, setStarted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const finish = useCallback((nextResult: Result) => {
    setResult(nextResult);
    document.exitPointerLock?.();
  }, []);

  const start = useCallback(() => {
    keysRef.current.clear();
    demoRef.current = null;
    gameRef.current = createGame();
    setResult(null);
    setStarted(true);
    setPaused(false);
    requestPointerLockSafely(canvasRef.current);
  }, []);

  useEffect(() => {
    const enemies = new Image();
    enemies.src = "/assets/enemies.png";
    spriteImages.enemies = enemies;
    const weapons = new Image();
    weapons.src = "/assets/weapons.png";
    spriteImages.weapons = weapons;
  }, []);

  useEffect(() => {
    const candidate = new URLSearchParams(window.location.search).get("demo");
    let startFrame = 0;
    if (
      candidate === "drive" ||
      candidate === "combat" ||
      candidate === "heat" ||
      candidate === "payoff"
    ) {
      demoRef.current = candidate;
      gameRef.current = createDemo(candidate);
      startFrame = window.requestAnimationFrame(() => setStarted(true));
    }
    return () => window.cancelAnimationFrame(startFrame);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = VIEW_WIDTH;
    canvas.height = VIEW_HEIGHT;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;

    let frame = 0;
    let last = performance.now();
    let accumulator = 0;

    const loop = (now: number) => {
      const elapsed = Math.min(0.08, (now - last) / 1000);
      last = now;
      if (started && !paused && !result) {
        accumulator += elapsed;
        while (accumulator >= FIXED_STEP) {
          if (demoRef.current) {
            applyDemoScript(
              gameRef.current,
              keysRef.current,
              demoRef.current,
            );
          }
          updateGame(gameRef.current, keysRef.current, FIXED_STEP, finish);
          accumulator -= FIXED_STEP;
        }
      }
      renderGame(ctx, gameRef.current);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    return () => cancelAnimationFrame(frame);
  }, [finish, paused, result, started]);

  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      keysRef.current.add(key);
      if (
        [" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)
      ) {
        event.preventDefault();
      }
      if (key === "1") gameRef.current.weapon = "shotgun";
      if (key === "2") gameRef.current.weapon = "smg";
      if (key === "f" && !event.repeat) interact(gameRef.current);
      if (key === "r" && result) start();
    };
    const keyUp = (event: KeyboardEvent) => {
      keysRef.current.delete(event.key.toLowerCase());
    };
    const mouseMove = (event: MouseEvent) => {
      if (document.pointerLockElement === canvasRef.current) {
        gameRef.current.angle += event.movementX * 0.0024;
      }
    };
    const mouseDown = (event: MouseEvent) => {
      if (event.button === 0 && started && !paused && !result) {
        if (document.pointerLockElement !== canvasRef.current) {
          requestPointerLockSafely(canvasRef.current);
        }
        fireWeapon(gameRef.current);
      }
    };
    const pointerChange = () => {
      if (!started || result) return;
      setPaused(document.pointerLockElement !== canvasRef.current);
    };
    window.addEventListener("keydown", keyDown, { passive: false });
    window.addEventListener("keyup", keyUp);
    window.addEventListener("mousemove", mouseMove);
    window.addEventListener("mousedown", mouseDown);
    document.addEventListener("pointerlockchange", pointerChange);
    return () => {
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      window.removeEventListener("mousemove", mouseMove);
      window.removeEventListener("mousedown", mouseDown);
      document.removeEventListener("pointerlockchange", pointerChange);
    };
  }, [paused, result, start, started]);

  return (
    <section className="game-shell" aria-label="Heatwave 99 playable game">
      <canvas
        ref={canvasRef}
        className="game-canvas"
        aria-label="First-person game view. Use mouse and keyboard controls."
        onContextMenu={(event) => event.preventDefault()}
      />

      {!started && (
        <div className="menu-screen">
          <div className="menu-copy">
            <p className="eyebrow">Sunstroke County // Summer 1999</p>
            <h1 className="game-title">
              Heatwave <span>99</span>
            </h1>
            <p className="tagline">
              A living street, three walk-in joints, and a county that follows
              the last place it saw you.
            </p>
          </div>
          <aside className="job-card" aria-label="Mission briefing">
            <p className="eyebrow">Pager job 01</p>
            <h2>Pelican Drop</h2>
            <p>
              Take the coral coupe east. Lift the package at Pelican Marina.
              Lose the patrols. Deliver south of the canal.
            </p>
            <div className="controls-grid" aria-label="Controls">
              <kbd>WASD</kbd>
              <span>Move / drive</span>
              <kbd>MOUSE</kbd>
              <span>Aim / fire</span>
              <kbd>F</kbd>
              <span>Vehicles / talk / shop</span>
              <kbd>1 / 2</kbd>
              <span>Shotgun / SMG</span>
              <kbd>SHIFT</kbd>
              <span>Sprint / handbrake</span>
            </div>
            <Button className="start-button" onClick={start}>
              Play job
            </Button>
          </aside>
        </div>
      )}

      {started && paused && !result && (
        <button
          type="button"
          className="pause-chip"
          onClick={() => requestPointerLockSafely(canvasRef.current)}
        >
          Click to resume
        </button>
      )}

      {result && (
        <div className="result-screen">
          <div className="result-card">
            <p className="eyebrow">
              {result.health > 0 ? "Pelican drop cleared" : "County got you"}
            </p>
            <h2>{result.health > 0 ? "Job complete" : "Wasted"}</h2>
            <dl>
              <dt>Payout</dt>
              <dd>${result.score.toLocaleString("en-US")}</dd>
              <dt>Time</dt>
              <dd>{formatTime(result.elapsed)}</dd>
              <dt>Enemies down</dt>
              <dd>{result.kills}</dd>
              <dt>Maximum heat</dt>
              <dd>{result.maxHeat} / 3</dd>
              <dt>Health left</dt>
              <dd>{Math.ceil(result.health)}</dd>
            </dl>
            <Button className="start-button" onClick={start}>
              Run it again
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
