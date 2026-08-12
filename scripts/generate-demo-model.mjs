/**
 * Builds the demo house shipped with the repo: a fictional single-storey home used by the
 * README recording and as a first-run twin. Architecture only — devices come from the
 * procedural model library at runtime (src/renderer/device-models.ts).
 */
import { writeFile } from "node:fs/promises";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { BoxGeometry, Color, Group, Mesh, MeshStandardMaterial, PlaneGeometry, Scene } from "three";

// GLTFExporter uses FileReader, which browsers provide but Node does not.
globalThis.FileReader = class FileReader {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((result) => {
      this.result = result;
      this.onloadend?.();
    });
  }
  readAsDataURL(blob) {
    blob.arrayBuffer().then((result) => {
      this.result = `data:${blob.type};base64,${Buffer.from(result).toString("base64")}`;
      this.onloadend?.();
    });
  }
};

const material = (color, roughness = 0.75) =>
  new MeshStandardMaterial({ color: new Color(color), roughness });

const scene = new Scene();
const add = (mesh) => {
  scene.add(mesh);
  return mesh;
};

/** Rooms as [x0, x1, z0, z1]; the mapping's polygons use the same numbers. */
const ROOMS = {
  living_room: { box: [0, 5.4, 0, 4.6], color: "#8794a3" },
  kitchen: { box: [5.4, 9.6, 0, 4.6], color: "#7f8b99" },
  hallway: { box: [0, 9.6, 4.6, 6.0], color: "#78838f" },
  bedroom: { box: [0, 4.4, 6.0, 9.8], color: "#8b93a5" },
  bathroom: { box: [4.4, 6.9, 6.0, 9.8], color: "#7c8a95" },
  study: { box: [6.9, 9.6, 6.0, 9.8], color: "#87849b" },
  garage: { box: [9.6, 13.6, 0, 4.6], color: "#767f88" },
};

// Ground and outdoor surfaces first, so interior floors sit on top of them.
const ground = add(new Mesh(new PlaneGeometry(26, 22), material("#5f7355")));
ground.rotation.x = -Math.PI / 2;
ground.position.set(6.8, -0.02, 3.4);
ground.name = "ground";

const slab = (name, [x0, x1, z0, z1], color, y = 0) => {
  const floor = new Mesh(new PlaneGeometry(x1 - x0, z1 - z0), material(color));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
  floor.name = name;
  return floor;
};
add(slab("area__driveway", [9.8, 13.4, -4.2, 0], "#9a9a96", 0.01));
add(slab("area__front_path", [5.6, 7.0, -4.2, 0], "#a8a49c", 0.01));
for (const [id, room] of Object.entries(ROOMS)) add(slab(`area__${id}`, room.box, room.color, 0.02));

const WALL = { height: 2.6, thickness: 0.16, color: "#dfe4e9" };
/** Wall segments as [x0, x1, z0, z1]; zero-length in one axis makes a straight run. */
const WALLS = [
  [0, 13.6, 0, 0], // front
  [0, 13.6, 9.8, 9.8], // back
  [0, 0, 0, 9.8], // west
  [13.6, 13.6, 0, 9.8], // east
  [5.4, 5.4, 0, 4.6], // living / kitchen
  [9.6, 9.6, 0, 9.8], // house / garage
  [0, 9.6, 4.6, 4.6], // front rooms / hallway
  [0, 9.6, 6.0, 6.0], // hallway / back rooms
  [4.4, 4.4, 6.0, 9.8], // bedroom / bathroom
  [6.9, 6.9, 6.0, 9.8], // bathroom / study
];
const wallMaterial = material(WALL.color, 0.9);
for (const [x0, x1, z0, z1] of WALLS) {
  const width = Math.max(x1 - x0, WALL.thickness);
  const depth = Math.max(z1 - z0, WALL.thickness);
  const wall = new Mesh(new BoxGeometry(width, WALL.height, depth), wallMaterial);
  wall.position.set((x0 + x1) / 2, WALL.height / 2, (z0 + z1) / 2);
  add(wall);
}

// A little furniture so the rooms read as rooms; devices are drawn by the panel.
const prop = (name, [w, h, d], [x, y, z], color) => {
  const mesh = new Mesh(new BoxGeometry(w, h, d), material(color));
  mesh.position.set(x, y + h / 2, z);
  mesh.name = name;
  return add(mesh);
};
prop("sofa", [2.4, 0.7, 0.9], [2.6, 0, 3.7], "#4f6274");
prop("coffee_table", [1.1, 0.4, 0.6], [2.6, 0, 2.5], "#8a6b4b");
prop("tv_unit", [1.8, 0.4, 0.4], [2.7, 0, 0.4], "#3f4855");
prop("kitchen_counter", [3.6, 0.9, 0.65], [7.5, 0, 0.5], "#c9cdd2");
prop("kitchen_island", [2.2, 0.9, 0.9], [7.5, 0, 2.9], "#b9bec4");
prop("bed", [1.9, 0.5, 2.1], [2.1, 0, 8.2], "#5b6b80");
prop("nightstand", [0.5, 0.55, 0.45], [3.6, 0, 6.7], "#8a6b4b");
prop("wardrobe", [1.6, 2.0, 0.6], [0.9, 0, 6.5], "#7d6a55");
prop("bathtub", [1.6, 0.55, 0.75], [5.6, 0, 9.2], "#e6eef2");
prop("vanity", [1.1, 0.85, 0.5], [5.0, 0, 6.4], "#c9cdd2");
prop("desk", [1.8, 0.75, 0.7], [8.2, 0, 6.7], "#8a6b4b");
prop("bookshelf", [1.4, 1.9, 0.4], [8.7, 0, 9.5], "#7d6a55");
prop("workbench", [2.4, 0.9, 0.7], [11.6, 0, 4.1], "#6f7a84");

// A door the twin animates from a contact sensor.
const door = new Mesh(new BoxGeometry(0.9, 2.05, 0.08), material("#7fc1d4"));
door.name = "door__back";
door.position.set(1.4, 1.05, 9.76);
add(door);

// Planting, to give the outside some depth.
const tree = (x, z, scale = 1) => {
  const group = new Group();
  group.name = `tree_${x}_${z}`.replace(/\./g, "_");
  const trunk = new Mesh(new BoxGeometry(0.22, 2.1 * scale, 0.22), material("#6b4f3a"));
  trunk.position.y = (2.1 * scale) / 2;
  const canopy = new Mesh(new BoxGeometry(2.1 * scale, 1.7 * scale, 2.1 * scale), material("#4b6b45"));
  canopy.position.y = 2.1 * scale + (1.7 * scale) / 2 - 0.4;
  group.add(trunk, canopy);
  group.position.set(x, 0, z);
  return add(group);
};
tree(-1.6, -1.8, 1.1);
tree(15.2, 1.4, 0.9);
tree(-1.4, 7.4, 1);
prop("hedge_front", [9.0, 0.7, 0.5], [4.4, 0, -4.0], "#41603d");

const glb = await new GLTFExporter().parseAsync(scene, { binary: true, onlyVisible: false });
await writeFile(new URL("../public/house/demo-house.glb", import.meta.url), Buffer.from(glb));
process.stdout.write("demo model: public/house/demo-house.glb\n");
