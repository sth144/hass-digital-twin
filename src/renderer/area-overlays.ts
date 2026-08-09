import * as THREE from "three";

export type Polygon = [number, number][];
export interface AreaShape {
  polygon?: Polygon;
}

/** Distinct-but-muted floor colours, assigned in area order. */
const PALETTE = [0x4aa8e0, 0x65e6c3, 0xe0a34a, 0xb26ad6, 0x6ad67f, 0xe0687f, 0xd6cf6a];
// Sits above typical floor slabs (a CAD floor is often ~0.1 m thick) so fills are not buried.
const FLOOR_Y = 0.12;
const HANDLE_Y = 0.3;

/**
 * Draws mapped areas as floor polygons: a translucent fill, an outline, and — while a
 * room is being edited — draggable vertex handles.
 */
export class AreaOverlays {
  private readonly fills = new THREE.Group();
  private readonly handles = new THREE.Group();
  private readonly handleIndex = new Map<THREE.Object3D, { areaId: string; index: number }>();
  private areas: Record<string, AreaShape> = {};
  private selected?: string;
  private editing?: string;

  constructor(private readonly scene: THREE.Scene) {
    this.fills.name = "overlay__area_fills";
    this.handles.name = "overlay__area_handles";
    scene.add(this.fills, this.handles);
  }

  setAreas(areas: Record<string, AreaShape>) {
    this.areas = areas;
    this.rebuild();
  }
  setSelected(areaId?: string) {
    this.selected = areaId;
    this.rebuild();
  }
  /** Shows vertex handles for one area, or none when undefined. */
  setEditing(areaId?: string) {
    this.editing = areaId;
    this.rebuild();
  }
  /** Redraws in place; used while dragging a vertex. */
  refresh() {
    this.rebuild();
  }
  pickHandle(raycaster: THREE.Raycaster) {
    for (const hit of raycaster.intersectObjects(this.handles.children, false)) {
      const found = this.handleIndex.get(hit.object);
      if (found) return found;
    }
    return undefined;
  }

  dispose() {
    this.scene.remove(this.fills, this.handles);
    AreaOverlays.clear(this.fills);
    AreaOverlays.clear(this.handles);
  }

  private rebuild() {
    AreaOverlays.clear(this.fills);
    AreaOverlays.clear(this.handles);
    this.handleIndex.clear();
    Object.entries(this.areas).forEach(([areaId, area], index) => {
      if (!area.polygon || area.polygon.length < 3) return;
      const color = PALETTE[index % PALETTE.length];
      const selected = areaId === this.selected;
      this.fills.add(AreaOverlays.buildFill(area.polygon, color, selected));
      this.fills.add(AreaOverlays.buildOutline(area.polygon, color, selected));
      if (areaId === this.editing) this.buildHandles(areaId, area.polygon, color);
    });
  }

  private static buildFill(polygon: Polygon, color: number, selected: boolean) {
    const shape = new THREE.Shape();
    polygon.forEach(([x, z], index) => (index === 0 ? shape.moveTo(x, z) : shape.lineTo(x, z)));
    const mesh = new THREE.Mesh(
      new THREE.ShapeGeometry(shape),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: selected ? 0.26 : 0.09,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    mesh.rotation.x = Math.PI / 2;
    mesh.position.y = FLOOR_Y;
    mesh.renderOrder = 1;
    return mesh;
  }

  private static buildOutline(polygon: Polygon, color: number, selected: boolean) {
    const points = polygon.map(([x, z]) => new THREE.Vector3(x, FLOOR_Y + 0.005, z));
    const line = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: selected ? 1 : 0.5,
        depthTest: false,
      }),
    );
    line.renderOrder = 2;
    return line;
  }

  private buildHandles(areaId: string, polygon: Polygon, color: number) {
    polygon.forEach(([x, z], index) => {
      const handle = new THREE.Mesh(
        new THREE.SphereGeometry(0.12, 14, 10),
        new THREE.MeshBasicMaterial({ color, depthTest: false }),
      );
      handle.position.set(x, HANDLE_Y, z);
      handle.renderOrder = 3;
      this.handles.add(handle);
      this.handleIndex.set(handle, { areaId, index });
    });
  }

  private static clear(group: THREE.Group) {
    for (const child of [...group.children]) {
      group.remove(child);
      if (child instanceof THREE.Mesh || child instanceof THREE.LineLoop) {
        child.geometry.dispose();
        (Array.isArray(child.material) ? child.material : [child.material]).forEach((material) =>
          material.dispose(),
        );
      }
    }
  }
}
