import * as THREE from "three";
import type { Polygon } from "./area-overlays";

/** Ray-casting point-in-polygon test on the ground plane. */
export function pointInPolygon(polygon: Polygon, x: number, z: number) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i];
    const [xj, zj] = polygon[j];
    const straddles = zi > z !== zj > z;
    if (straddles && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** What a pointer position resolves to: a mapped entity, a mapped area, or nothing. */
export interface PickResult {
  entityId?: string;
  label?: string;
  areaId?: string;
}

/** Raycasts the model and resolves a hit to the closest mapped entity or area ancestor. */
export class MappedAreaPicker {
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly objectAreas = new Map<string, string>();
  private readonly objectEntities = new Map<string, string>();
  private readonly objectLabels = new Map<string, string>();
  private readonly areaPolygons = new Map<string, Polygon>();
  private pointerDown?: { x: number; y: number };
  private selectionEnabled = true;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly camera: THREE.Camera,
    private readonly scene: THREE.Scene,
    private readonly onAreaSelect: (areaId: string) => void,
    private readonly onEntitySelect: (entityId: string) => void,
    private readonly onHover: (
      entityId: string | undefined,
      label: string | undefined,
      x: number,
      y: number,
    ) => void,
  ) {
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointermove", this.onPointerMove);
  }

  setAreas(areas: Record<string, { objects: string[]; polygon?: Polygon }>) {
    this.objectAreas.clear();
    this.areaPolygons.clear();
    for (const [areaId, area] of Object.entries(areas)) {
      for (const objectName of area.objects) this.objectAreas.set(objectName, areaId);
      if (area.polygon && area.polygon.length >= 3) this.areaPolygons.set(areaId, area.polygon);
    }
  }
  /** Which area's floor polygon contains a screen point, if any. */
  areaAtFloor(clientX: number, clientY: number) {
    const point = this.floorPoint(clientX, clientY);
    if (!point) return undefined;
    for (const [areaId, polygon] of this.areaPolygons)
      if (pointInPolygon(polygon, point.x, point.z)) return areaId;
    return undefined;
  }
  private floorPoint(clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.ray.intersectPlane(
      new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
      new THREE.Vector3(),
    );
  }
  setEntities(entities: Record<string, { object?: string; name?: string }>) {
    this.objectEntities.clear();
    this.objectLabels.clear();
    for (const [entityId, entity] of Object.entries(entities))
      if (entity.object) {
        this.objectEntities.set(entity.object, entityId);
        this.objectLabels.set(entity.object, entity.name ?? entityId);
      }
  }

  /** Placement and drag borrow the pointer, so click picking pauses while they own it. */
  setSelectionEnabled(enabled: boolean) {
    this.selectionEnabled = enabled;
  }

  /** Resolves a pointer position against the mapped model. */
  pick(clientX: number, clientY: number): PickResult {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    for (const hit of this.raycaster.intersectObjects(this.scene.children, true))
      for (let object: THREE.Object3D | null = hit.object; object; object = object.parent) {
        const entityId = this.objectEntities.get(object.name);
        if (entityId) return { entityId, label: this.objectLabels.get(object.name) };
        const areaId = this.objectAreas.get(object.name);
        if (areaId) return { areaId };
      }
    return {};
  }

  dispose() {
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
  }

  private onPointerDown = (event: PointerEvent) => {
    this.pointerDown = { x: event.clientX, y: event.clientY };
  };
  private onPointerMove = (event: PointerEvent) => {
    const rect = this.canvas.getBoundingClientRect();
    const { entityId, label } = this.pick(event.clientX, event.clientY);
    this.onHover(entityId, label, event.clientX - rect.left, event.clientY - rect.top);
  };
  private onPointerUp = (event: PointerEvent) => {
    const down = this.pointerDown;
    this.pointerDown = undefined;
    if (!down || !this.selectionEnabled) return;
    if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > 6) return;
    const { entityId, areaId } = this.pick(event.clientX, event.clientY);
    if (entityId) return this.onEntitySelect(entityId);
    // A drawn floor polygon is the explicit room boundary, so it wins over object names.
    const floorArea = this.areaAtFloor(event.clientX, event.clientY);
    if (floorArea) return this.onAreaSelect(floorArea);
    if (areaId) return this.onAreaSelect(areaId);
    const mappedAreas = new Set(this.objectAreas.values());
    if (mappedAreas.size === 1) this.onAreaSelect([...mappedAreas][0]);
  };
}
