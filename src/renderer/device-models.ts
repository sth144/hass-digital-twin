import * as THREE from "three";

/**
 * Procedural stand-ins for devices that the house model itself does not contain.
 * Every model is built with its origin at the mount point and faces +Z, and tags the
 * meshes that represent device state with `userData.indicator` so the scene can glow
 * them instead of recolouring the whole object.
 */
export const DEVICE_KINDS = [
  "light",
  "switch",
  "plug",
  "camera",
  "fan",
  "sensor",
  "door",
  "tv",
  "dehumidifier",
  "air_purifier",
  "vacuum",
  "car",
  "phone",
  "laptop",
  "dog",
  "marker",
] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];

/** Where a kind naturally sits, in metres above the floor. */
const MOUNTS: Record<string, number> = {
  light: 2.35,
  fan: 2.3,
  switch: 1.3,
  camera: 1.9,
  sensor: 1.6,
  door: 1.1,
  plug: 0.3,
  tv: 0.44,
  phone: 0.78,
  laptop: 0.76,
};
export function deviceMountHeight(kind: DeviceKind) {
  return MOUNTS[kind] ?? 0;
}

const COLORS = {
  case: 0x3b4654,
  shell: 0xd7dde5,
  screen: 0x11161d,
  metal: 0x8c98a6,
  glass: 0x1b2430,
  warm: 0xffe9b0,
  accent: 0x4aa8e0,
  rubber: 0x232a33,
  fur: 0x9a6b43,
  paint: 0xb23b3b,
  backlight: 0x9fd0ff,
};

const surface = (color: number) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0.05 });

/**
 * An emissive part whose glow tracks entity state; starts dark. Dark parts such as
 * screens need an explicit glow colour, since glowing their own near-black colour
 * would not be visible.
 */
function indicator(color: number, glowColor = color) {
  return new THREE.MeshStandardMaterial({
    color,
    emissive: new THREE.Color(glowColor),
    emissiveIntensity: 0,
    roughness: 0.4,
  });
}

interface Part {
  geometry: THREE.BufferGeometry;
  color: number;
  at?: [number, number, number];
  rotate?: [number, number, number];
  glows?: boolean;
  glowColor?: number;
}

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const tube = (r: number, h: number, segments = 20) => new THREE.CylinderGeometry(r, r, h, segments);
const ball = (r: number) => new THREE.SphereGeometry(r, 18, 12);

function assemble(parts: Part[]) {
  const group = new THREE.Group();
  for (const part of parts) {
    const material = part.glows
      ? indicator(part.color, part.glowColor ?? part.color)
      : surface(part.color);
    const mesh = new THREE.Mesh(part.geometry, material);
    if (part.at) mesh.position.fromArray(part.at);
    if (part.rotate) mesh.rotation.fromArray(part.rotate);
    if (part.glows) mesh.userData.indicator = true;
    group.add(mesh);
  }
  return group;
}

const wheels = (radius: number, y: number, offsets: [number, number][]): Part[] =>
  offsets.map(([x, z]) => ({
    geometry: tube(radius, 0.14, 14),
    color: COLORS.rubber,
    at: [x, y, z],
    rotate: [0, 0, Math.PI / 2] as [number, number, number],
  }));

const legs = (height: number, offsets: [number, number][]): Part[] =>
  offsets.map(([x, z]) => ({
    geometry: tube(0.035, height, 10),
    color: COLORS.fur,
    at: [x, height / 2, z],
  }));

const BUILDERS: Record<DeviceKind, () => THREE.Object3D> = {
  light: () =>
    assemble([
      { geometry: tube(0.02, 0.16), color: COLORS.metal, at: [0, 0.08, 0] },
      { geometry: box(0.26, 0.05, 0.26), color: COLORS.shell, at: [0, -0.02, 0] },
      { geometry: ball(0.11), color: COLORS.warm, at: [0, -0.09, 0], glows: true },
    ]),
  switch: () =>
    assemble([
      { geometry: box(0.15, 0.21, 0.02), color: COLORS.shell },
      { geometry: box(0.07, 0.11, 0.025), color: COLORS.warm, at: [0, 0.01, 0.015], glows: true },
    ]),
  plug: () =>
    assemble([
      { geometry: box(0.12, 0.17, 0.02), color: COLORS.shell },
      { geometry: box(0.02, 0.05, 0.02), color: COLORS.case, at: [-0.025, 0.03, 0.012] },
      { geometry: box(0.02, 0.05, 0.02), color: COLORS.case, at: [0.025, 0.03, 0.012] },
      { geometry: ball(0.012), color: COLORS.accent, at: [0, -0.05, 0.014], glows: true },
    ]),
  camera: () =>
    assemble([
      { geometry: box(0.06, 0.06, 0.05), color: COLORS.case, at: [0, 0, -0.11] },
      { geometry: box(0.2, 0.13, 0.16), color: COLORS.shell },
      {
        geometry: tube(0.055, 0.05, 22),
        color: COLORS.glass,
        at: [0, 0, 0.1],
        rotate: [Math.PI / 2, 0, 0],
      },
      { geometry: ball(0.012), color: 0xff5a4a, at: [0.06, 0.045, 0.082], glows: true },
    ]),
  fan: () =>
    assemble([
      { geometry: tube(0.07, 0.07), color: COLORS.case },
      { geometry: box(1.0, 0.02, 0.14), color: COLORS.shell, at: [0, -0.02, 0] },
      { geometry: box(0.14, 0.02, 1.0), color: COLORS.shell, at: [0, -0.02, 0] },
    ]),
  sensor: () =>
    assemble([
      { geometry: box(0.09, 0.13, 0.03), color: COLORS.shell },
      { geometry: ball(0.014), color: COLORS.accent, at: [0, -0.04, 0.02], glows: true },
    ]),
  door: () =>
    assemble([
      { geometry: box(0.9, 2.05, 0.05), color: COLORS.shell, at: [0, 0, 0] },
      { geometry: ball(0.035), color: COLORS.metal, at: [0.36, 0, 0.045] },
    ]),
  tv: () =>
    assemble([
      { geometry: box(0.3, 0.03, 0.2), color: COLORS.case, at: [0, -0.42, 0] },
      { geometry: box(0.06, 0.2, 0.06), color: COLORS.case, at: [0, -0.31, 0] },
      { geometry: box(1.22, 0.72, 0.04), color: COLORS.case },
      {
        geometry: box(1.16, 0.66, 0.01),
        color: COLORS.screen,
        at: [0, 0, 0.026],
        glows: true,
        glowColor: COLORS.backlight,
      },
    ]),
  dehumidifier: () =>
    assemble([
      { geometry: box(0.38, 0.66, 0.32), color: COLORS.shell, at: [0, 0.33, 0] },
      { geometry: box(0.3, 0.03, 0.24), color: COLORS.case, at: [0, 0.67, 0] },
      { geometry: box(0.3, 0.16, 0.02), color: COLORS.glass, at: [0, 0.16, 0.16] },
      { geometry: box(0.1, 0.02, 0.02), color: COLORS.accent, at: [0, 0.56, 0.16], glows: true },
    ]),
  air_purifier: () =>
    assemble([
      { geometry: tube(0.17, 0.56, 26), color: COLORS.shell, at: [0, 0.28, 0] },
      { geometry: tube(0.15, 0.05, 26), color: COLORS.case, at: [0, 0.58, 0] },
      { geometry: tube(0.175, 0.03, 26), color: COLORS.accent, at: [0, 0.12, 0], glows: true },
    ]),
  vacuum: () =>
    assemble([
      { geometry: tube(0.22, 0.08, 30), color: COLORS.case, at: [0, 0.04, 0] },
      { geometry: tube(0.2, 0.02, 30), color: COLORS.shell, at: [0, 0.09, 0] },
      { geometry: tube(0.06, 0.04, 18), color: COLORS.case, at: [0, 0.11, -0.04] },
      { geometry: ball(0.018), color: COLORS.accent, at: [0, 0.1, 0.15], glows: true },
    ]),
  car: () =>
    assemble([
      { geometry: box(1.85, 0.42, 0.82), color: COLORS.paint, at: [0, 0.4, 0] },
      { geometry: box(1.0, 0.34, 0.76), color: COLORS.paint, at: [-0.05, 0.75, 0] },
      { geometry: box(0.96, 0.26, 0.78), color: COLORS.glass, at: [-0.05, 0.76, 0] },
      ...wheels(0.19, 0.19, [
        [-0.6, 0.42],
        [-0.6, -0.42],
        [0.6, 0.42],
        [0.6, -0.42],
      ]),
      { geometry: box(0.06, 0.1, 0.14), color: COLORS.warm, at: [0.92, 0.44, 0.28], glows: true },
      { geometry: box(0.06, 0.1, 0.14), color: COLORS.warm, at: [0.92, 0.44, -0.28], glows: true },
    ]),
  phone: () =>
    assemble([
      { geometry: box(0.075, 0.15, 0.009), color: COLORS.case },
      {
        geometry: box(0.066, 0.138, 0.002),
        color: COLORS.screen,
        at: [0, 0, 0.006],
        glows: true,
        glowColor: COLORS.backlight,
      },
    ]),
  laptop: () =>
    assemble([
      { geometry: box(0.33, 0.014, 0.23), color: COLORS.metal },
      { geometry: box(0.28, 0.001, 0.14), color: COLORS.case, at: [0, 0.009, 0.02] },
      {
        geometry: box(0.33, 0.22, 0.012),
        color: COLORS.metal,
        at: [0, 0.1, -0.12],
        rotate: [-0.28, 0, 0],
      },
      {
        geometry: box(0.3, 0.19, 0.002),
        color: COLORS.screen,
        at: [0, 0.1, -0.106],
        rotate: [-0.28, 0, 0],
        glows: true,
        glowColor: COLORS.backlight,
      },
    ]),
  dog: () =>
    assemble([
      { geometry: box(0.46, 0.24, 0.2), color: COLORS.fur, at: [0, 0.34, 0] },
      { geometry: ball(0.13), color: COLORS.fur, at: [0.28, 0.44, 0] },
      { geometry: box(0.12, 0.08, 0.09), color: COLORS.fur, at: [0.39, 0.39, 0] },
      { geometry: box(0.05, 0.1, 0.02), color: COLORS.fur, at: [0.24, 0.55, 0.07] },
      { geometry: box(0.05, 0.1, 0.02), color: COLORS.fur, at: [0.24, 0.55, -0.07] },
      ...legs(0.22, [
        [-0.16, 0.07],
        [-0.16, -0.07],
        [0.16, 0.07],
        [0.16, -0.07],
      ]),
      {
        geometry: tube(0.025, 0.2, 10),
        color: COLORS.fur,
        at: [-0.3, 0.44, 0],
        rotate: [0, 0, -0.9],
      },
      { geometry: ball(0.02), color: 0x2a2f36, at: [0.45, 0.39, 0] },
    ]),
  marker: () => assemble([{ geometry: ball(0.16), color: COLORS.accent, glows: true }]),
};

/** Name hints win over domains, since Home Assistant domains say little about form. */
const NAME_HINTS: [RegExp, DeviceKind][] = [
  [/dehumidifier|humidifier/, "dehumidifier"],
  [/purifier/, "air_purifier"],
  [/vacuum|roomba|robovac|deebot/, "vacuum"],
  [/laptop|macbook|notebook/, "laptop"],
  [/iphone|ipad|phone|pixel|galaxy/, "phone"],
  [/\bcar\b|tesla|truck|vehicle/, "car"],
  [/\bdog\b|puppy|\bcat\b|\bpet\b/, "dog"],
  [/\btv\b|television|roku|shield|chromecast/, "tv"],
  [/camera|\bcam\b/, "camera"],
  [/outlet|smart plug|plug/, "plug"],
  [/\bfan\b/, "fan"],
];
const DEVICE_CLASS_KINDS: Record<string, DeviceKind> = {
  tv: "tv",
  outlet: "plug",
  door: "door",
  garage_door: "door",
  window: "door",
  humidifier: "dehumidifier",
  speaker: "tv",
};
const DOMAIN_KINDS: Record<string, DeviceKind> = {
  light: "light",
  switch: "switch",
  camera: "camera",
  fan: "fan",
  media_player: "tv",
  vacuum: "vacuum",
  humidifier: "dehumidifier",
  device_tracker: "phone",
  person: "phone",
  lock: "door",
  cover: "door",
  binary_sensor: "sensor",
  sensor: "sensor",
};

/** Picks the closest model for an entity from its name, device class, then domain. */
export function resolveDeviceKind(
  entityId: string,
  options: { name?: string; deviceClass?: string } = {},
): DeviceKind {
  const text = `${options.name ?? ""} ${entityId}`.toLowerCase();
  const hint = NAME_HINTS.find(([pattern]) => pattern.test(text));
  if (hint) return hint[1];
  const domain = entityId.split(".")[0];
  return DEVICE_CLASS_KINDS[options.deviceClass ?? ""] ?? DOMAIN_KINDS[domain] ?? "marker";
}

export function createDeviceModel(kind: DeviceKind) {
  return (BUILDERS[kind] ?? BUILDERS.marker)();
}
