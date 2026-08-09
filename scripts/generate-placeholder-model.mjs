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

const material = (color) => new MeshStandardMaterial({ color: new Color(color), roughness: 0.72 });
const room = new Group();
room.name = "area__living_room";

const floor = new Mesh(new PlaneGeometry(8, 6), material("#52677b"));
floor.rotation.x = -Math.PI / 2;
room.add(floor);

const addRoomZone = (name, x, z, color) => {
  const zone = new Group();
  zone.name = name;
  const zoneFloor = new Mesh(new PlaneGeometry(3.6, 3.2), material(color));
  zoneFloor.rotation.x = -Math.PI / 2;
  zoneFloor.position.set(x, 0.01, z);
  zone.add(zoneFloor);
  return zone;
};
const kitchenZone = addRoomZone("area__kitchen", 5.1, 0.1, "#627783");
const livingZone = addRoomZone("area__living_annex", 0.2, 4.4, "#596d83");
const officeZone = addRoomZone("area__office", 5.1, 4.1, "#6f6485");
const garageZone = addRoomZone("area__garage", -5.0, 0.1, "#65717e");

const wallMaterial = material("#d9e2ec");
for (const [width, height, depth, x, y, z] of [
  [8, 2.7, 0.12, 0, 1.35, -3],
  [0.12, 2.7, 6, -4, 1.35, 0],
]) {
  room.add(
    new Mesh(new BoxGeometry(width, height, depth), wallMaterial)
      .translateX(x)
      .translateY(y)
      .translateZ(z),
  );
}
for (const [width, height, depth, x, y, z] of [
  [0.12, 2.7, 3.0, 3.15, 1.35, -1.45],
  [3.0, 2.7, 0.12, 3.15, 1.35, 2.45],
  [0.12, 2.7, 2.0, 3.15, 1.35, 4.9],
])
  room.add(
    new Mesh(new BoxGeometry(width, height, depth), wallMaterial)
      .translateX(x)
      .translateY(y)
      .translateZ(z),
  );

const rug = new Mesh(new BoxGeometry(3.5, 0.06, 2.2), material("#7096b5"));
rug.position.set(0.3, 0.03, 0.25);
room.add(rug);

// Devices are not modelled here: the panel builds them procedurally from the mapping
// (see src/renderer/device-models.ts), so this file only carries the architecture.
const door = new Mesh(new BoxGeometry(1.5, 2.2, 0.08), material("#7fc1d4"));
door.name = "door__back";
door.position.set(0, 1.1, -2.92);

const scene = new Scene();
scene.add(room, garageZone, kitchenZone, livingZone, officeZone, door);

const glb = await new GLTFExporter().parseAsync(scene, { binary: true, onlyVisible: false });
await writeFile(new URL("../public/house/house.glb", import.meta.url), Buffer.from(glb));
