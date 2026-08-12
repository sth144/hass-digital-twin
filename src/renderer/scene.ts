import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { MappedAreaPicker } from "./interaction";
import { createDeviceModel, deviceMountHeight, resolveDeviceKind } from "./device-models";
import { AreaOverlays, type Polygon } from "./area-overlays";
import { pointInPolygon } from "./interaction";
import type { HouseMapping } from "../mapping/schema";

type MappedEntities = HouseMapping["entities"];
type MappedEntity = MappedEntities[string];
type MappedAreas = HouseMapping["areas"];

/** States that count as "device is doing something", across the domains we draw. */
export const ACTIVE_STATES = new Set([
  "on",
  "open",
  "playing",
  "cleaning",
  "returning",
  "home",
  "running",
]);

export class HouseScene {
  readonly canvas = document.createElement("canvas");
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
  readonly renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
  private readonly tooltip = document.createElement("div");
  private readonly cameraPreview = document.createElement("img");
  private hoverEntity?: string;
  private cameraUrlFor?: (entityId: string) => string | undefined;
  private readonly controls: OrbitControls;
  private readonly areaPicker: MappedAreaPicker;
  private model?: THREE.Object3D;
  private readonly entityConfig = new Map<string, MappedEntity>();
  private readonly entityLights = new Map<string, THREE.PointLight>();
  private readonly spinningFans = new Set<string>();
  private readonly homePosition = new THREE.Vector3(5, 4, 5);
  private readonly homeTarget = new THREE.Vector3(0, 0.8, 0);
  /** Device models built for entities the house model has no object for, keyed by entity id. */
  private readonly spawned = new Map<string, THREE.Object3D>();
  private selectionHelper?: THREE.BoxHelper;
  private grid?: THREE.GridHelper;
  private frame?: number;
  private running = false;
  private editMode = false;
  private roomEditMode = false;
  private selectedArea?: string;
  private areas: MappedAreas = {};
  private drag?: { entityId: string; start: { x: number; y: number }; moved: boolean };
  private vertexDrag?: { areaId: string; index: number; moved: boolean };
  private readonly overlays: AreaOverlays;
  private readonly resizeObserver: ResizeObserver;
  constructor(
    private readonly host: HTMLElement,
    onAreaSelect: (areaId: string) => void,
    onEntitySelect: (entityId: string) => void,
    private readonly onEntityMoved: (
      entityId: string,
      position: [number, number, number],
    ) => void = () => {},
    private readonly onPolygonChanged: (areaId: string, polygon: Polygon) => void = () => {},
  ) {
    this.camera.position.copy(this.homePosition);
    this.camera.lookAt(this.homeTarget);
    host.style.position = "relative";
    this.canvas.style.cssText = "display:block;width:100%;height:100%;";
    this.tooltip.style.cssText =
      "display:none;position:absolute;z-index:10;pointer-events:none;padding:5px 8px;border-radius:4px;background:#111c;color:#fff;font:12px sans-serif;transition:none;";
    this.cameraPreview.style.cssText =
      "display:none;position:absolute;z-index:10;pointer-events:none;width:240px;max-height:160px;object-fit:cover;border:1px solid #8fa3b8;border-radius:5px;background:#101827;";
    host.append(this.canvas, this.tooltip, this.cameraPreview);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0x101827);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.target.set(0, 0.8, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 1;
    this.controls.maxDistance = 30;
    this.areaPicker = new MappedAreaPicker(
      this.canvas,
      this.camera,
      this.scene,
      onAreaSelect,
      onEntitySelect,
      (entityId, label, x, y) => this.showHover(entityId, label, x, y),
    );
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x172033, 1.2));
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.5);
    keyLight.position.set(4, 6, 3);
    this.scene.add(keyLight);
    this.grid = new THREE.GridHelper(10, 10, 0x61718b, 0x2c3850);
    this.scene.add(this.grid);
    this.overlays = new AreaOverlays(this.scene);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    document.addEventListener("visibilitychange", this.onVisibility);
    // Capture on the host runs before OrbitControls' own canvas listeners, so a drag that
    // starts on a mapped device moves the device instead of orbiting the camera.
    this.canvas.addEventListener("webglcontextlost", this.onContextLost);
    this.canvas.addEventListener("webglcontextrestored", this.onContextRestored);
    host.addEventListener("pointerdown", this.onDragStart, true);
    host.addEventListener("pointermove", this.onDragMove, true);
    host.addEventListener("pointerup", this.onDragEnd, true);
    host.addEventListener("pointercancel", this.onDragEnd, true);
  }
  async load(url: string) {
    const gltf = await new GLTFLoader().loadAsync(url);
    if (this.model) this.scene.remove(this.model);
    this.model = gltf.scene;
    HouseScene.normalizeMaterials(this.model);
    this.scene.add(this.model);
    this.fitToModel();
    this.syncSpawnedDevices();
  }
  /**
   * Some CAD exporters (OpenCASCADE, and so FreeCAD) write every material as fully
   * metallic and fully rough. With no environment map to reflect, that renders almost
   * black however bright the lights are, so treat a bare metalness of 1 as unauthored.
   */
  private static normalizeMaterials(model: THREE.Object3D) {
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (!(material instanceof THREE.MeshStandardMaterial)) continue;
        if (material.metalness === 1 && !material.metalnessMap) material.metalness = 0;
        if (material.roughness === 1 && !material.roughnessMap) material.roughness = 0.85;
        material.needsUpdate = true;
      }
    });
  }
  /** Sizes the zoom range and ground grid to whatever model was just loaded. */
  private fitToModel() {
    if (!this.model) return;
    const box = new THREE.Box3().setFromObject(this.model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const span = Math.max(size.x, size.z, 1);
    this.controls.maxDistance = Math.max(30, span * 3);
    if (this.grid) this.scene.remove(this.grid);
    const extent = Math.ceil(span * 1.2);
    this.grid = new THREE.GridHelper(
      extent,
      Math.max(4, Math.round(extent / 2)),
      0x61718b,
      0x2c3850,
    );
    this.grid.position.set(center.x, 0, center.z);
    this.scene.add(this.grid);
  }
  /**
   * Browsers drop the WebGL context of a background tab to reclaim GPU memory. Calling
   * preventDefault is what allows it to come back at all; without it the canvas is dead
   * for good. The render loop stops meanwhile, since drawing to a lost context is a no-op.
   */
  private readonly onContextLost = (event: Event) => {
    event.preventDefault();
    this.stop();
  };
  private readonly onContextRestored = () => this.start();
  /** True once the canvas has lost its context and needs the scene rebuilding. */
  get contextLost() {
    return this.renderer.getContext().isContextLost();
  }
  /** The current camera, so a rebuild can put the user back where they were. */
  viewState() {
    return {
      position: this.camera.position.toArray() as [number, number, number],
      target: this.controls.target.toArray() as [number, number, number],
    };
  }
  applyView(view: { position: [number, number, number]; target: [number, number, number] }) {
    this.camera.position.fromArray(view.position);
    this.controls.target.fromArray(view.target);
    this.controls.update();
  }
  /** The ground grid helps while arranging; it is noise when simply looking at a house. */
  setGridVisible(visible: boolean) {
    if (this.grid) this.grid.visible = visible;
  }
  /** Frames the whole model, used when a twin does not declare its own opening view. */
  frameModel() {
    if (!this.model) return;
    const box = new THREE.Box3().setFromObject(this.model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const span = Math.max(size.x, size.z, 1);
    const distance = span / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
    this.setHomeView(
      [center.x, box.max.y + distance * 0.6, center.z + distance],
      [center.x, box.min.y, center.z],
    );
  }
  setHomeView(position: [number, number, number], target: [number, number, number]) {
    this.homePosition.fromArray(position);
    this.homeTarget.fromArray(target);
    this.resetView();
  }
  setAreas(areas: MappedAreas) {
    this.areas = areas;
    this.areaPicker.setAreas(areas);
    this.overlays.setAreas(areas);
  }
  setSelectedArea(areaId?: string) {
    this.selectedArea = areaId;
    this.overlays.setSelected(areaId);
    if (this.roomEditMode) this.overlays.setEditing(areaId);
  }
  /** Shows vertex handles for the selected room and enables vertex editing gestures. */
  setRoomEditMode(active: boolean) {
    this.roomEditMode = active;
    this.vertexDrag = undefined;
    this.controls.enabled = true;
    this.overlays.setEditing(active ? this.selectedArea : undefined);
    this.canvas.style.cursor = active ? "crosshair" : this.editMode ? "grab" : "";
  }
  /** Centre of the current view on the floor plane, for placing a new room. */
  viewCenter(): [number, number] {
    return [this.controls.target.x, this.controls.target.z];
  }
  setEntities(entities: MappedEntities) {
    this.areaPicker.setEntities(entities);
    this.entityConfig.clear();
    this.entityLights.forEach((light) => this.scene.remove(light));
    this.entityLights.clear();
    for (const [entityId, entity] of Object.entries(entities)) {
      this.entityConfig.set(entityId, entity);
      if (entity.light) {
        const light = new THREE.PointLight(0xffdca8, 0, entity.light.radius);
        light.position.fromArray(entity.light.position);
        this.scene.add(light);
        this.entityLights.set(entityId, light);
      }
    }
    this.syncSpawnedDevices();
  }
  /** Builds a device model for every mapped entity the house model has no object for. */
  private syncSpawnedDevices() {
    if (!this.model) return;
    for (const [entityId, config] of this.entityConfig) {
      const inModel = config.object ? Boolean(this.model.getObjectByName(config.object)) : false;
      if (inModel || !config.position) this.removeSpawned(entityId);
      else this.spawnDevice(entityId, config.position);
    }
    for (const entityId of [...this.spawned.keys()])
      if (!this.entityConfig.has(entityId)) this.removeSpawned(entityId);
  }
  private removeSpawned(entityId: string) {
    const existing = this.spawned.get(entityId);
    if (!existing) return;
    this.scene.remove(existing);
    this.spawned.delete(entityId);
  }
  /** Adds or repositions the model for one entity; returns the position actually used. */
  private spawnDevice(entityId: string, position: [number, number, number]) {
    const config = this.entityConfig.get(entityId);
    const kind = config?.model ?? resolveDeviceKind(entityId, { name: config?.name });
    let device = this.spawned.get(entityId);
    if (!device || device.userData.kind !== kind) {
      this.removeSpawned(entityId);
      device = createDeviceModel(kind);
      device.userData.kind = kind;
      device.name = config?.object ?? `draft__${entityId}`;
      this.spawned.set(entityId, device);
      this.scene.add(device);
    }
    const height = position[1] || deviceMountHeight(kind);
    device.position.set(position[0], height, position[2]);
    device.rotation.y = ((config?.yaw ?? 0) * Math.PI) / 180;
    return [position[0], height, position[2]] as [number, number, number];
  }
  /** Finds a named object in the house model or among the spawned device models. */
  private findObject(objectName: string) {
    return (
      this.model?.getObjectByName(objectName) ??
      [...this.spawned.values()].find((object) => object.name === objectName)
    );
  }
  syncEntity(entityId: string, state: string) {
    const config = this.entityConfig.get(entityId);
    if (!config) return;
    const active = ACTIVE_STATES.has(state);
    const light = this.entityLights.get(entityId);
    if (light && config.light) light.intensity = active ? config.light.intensity_scale * 4 : 0;
    if (config.object) {
      // Doors show their state by moving, so they are not tinted as well.
      if (!config.door) this.setObjectActive(config.object, active);
      if (config.door)
        this.findObject(config.object)?.position.fromArray(
          active ? config.door.open_position : config.door.closed_position,
        );
      // Spin is decided by what the device is, not by how its object was named, so
      // devices placed from the panel (object `draft__…`) spin too.
      const spins = config.model === "fan" || config.object.startsWith("fan__");
      if (spins && active) this.spinningFans.add(config.object);
      else this.spinningFans.delete(config.object);
    }
  }
  /**
   * Device models glow through their indicator parts (a lens, a screen, a bulb); plain
   * house-model meshes keep the older whole-object tint.
   */
  setObjectActive(objectName: string, active: boolean) {
    const root = this.findObject(objectName);
    if (!root) return;
    const indicators: THREE.Mesh[] = [];
    root.traverse((object) => {
      if (object instanceof THREE.Mesh && object.userData.indicator) indicators.push(object);
    });
    if (indicators.length) {
      for (const mesh of indicators) HouseScene.setGlow(mesh, active);
      return;
    }
    if (root instanceof THREE.Mesh) HouseScene.setTint(root, active);
  }
  private static setGlow(mesh: THREE.Mesh, active: boolean) {
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material])
      if (material instanceof THREE.MeshStandardMaterial) {
        material.emissiveIntensity = active ? 1 : 0;
        material.needsUpdate = true;
      }
  }
  private static setTint(mesh: THREE.Mesh, active: boolean) {
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material])
      if (material instanceof THREE.MeshStandardMaterial) {
        material.color.set(active ? 0x66e6a6 : 0x9a7a1f);
        material.emissive.set(active ? 0x155c3a : 0x000000);
        material.needsUpdate = true;
      }
  }
  setBackground(color?: string) {
    this.renderer.setClearColor(color ?? 0x101827);
  }
  setCameraUrlResolver(resolver: (entityId: string) => string | undefined) {
    this.cameraUrlFor = resolver;
  }
  private showHover(entityId: string | undefined, label: string | undefined, x: number, y: number) {
    this.tooltip.textContent = label ?? "";
    this.tooltip.style.display = label ? "block" : "none";
    this.tooltip.style.left = `${x + 12}px`;
    this.tooltip.style.top = `${y + 12}px`;
    const isCamera = entityId?.startsWith("camera.");
    this.cameraPreview.style.display = isCamera ? "block" : "none";
    if (isCamera && entityId !== this.hoverEntity) {
      const url = this.cameraUrlFor?.(entityId!);
      if (url) this.cameraPreview.src = url;
    }
    if (isCamera) {
      this.cameraPreview.style.left = `${x + 12}px`;
      this.cameraPreview.style.top = `${y + 34}px`;
    }
    this.hoverEntity = entityId;
  }
  focus(position: [number, number, number], target: [number, number, number]) {
    this.camera.position.fromArray(position);
    this.controls.target.fromArray(target);
    this.controls.update();
  }
  resetView() {
    this.camera.position.copy(this.homePosition);
    this.controls.target.copy(this.homeTarget);
    this.controls.update();
  }
  pointOnFloor(event: MouseEvent): [number, number, number] | undefined {
    const rect = this.canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, this.camera);
    const hit = raycaster.ray.intersectPlane(
      new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
      new THREE.Vector3(),
    );
    // Height comes from the device kind, so a wall camera does not spawn on the floor.
    return hit ? [hit.x, 0, hit.z] : undefined;
  }
  /** Places (or repositions) the procedural model for an entity. */
  showDraftMarker(entityId: string, position: [number, number, number]) {
    return this.spawnDevice(entityId, position);
  }
  /**
   * Moves an already-mapped entity horizontally to a floor point, keeping its height.
   * Returns the applied position, or undefined when the entity has nothing to move.
   */
  moveEntity(entityId: string, position: [number, number, number]) {
    const [x, , z] = position;
    const objectName = this.entityConfig.get(entityId)?.object;
    const object =
      this.spawned.get(entityId) ??
      (objectName ? this.model?.getObjectByName(objectName) : undefined);
    if (!object) return undefined;
    const target = new THREE.Vector3(x, 0, z);
    const local = object.parent ? object.parent.worldToLocal(target) : target;
    object.position.set(local.x, object.position.y, local.z);
    const height = object.getWorldPosition(new THREE.Vector3()).y;
    const light = this.entityLights.get(entityId);
    light?.position.set(x, light.position.y, z);
    this.selectionHelper?.update();
    return [x, height, z] as [number, number, number];
  }
  /** The object a mapped entity is drawn as, whether it came from the model or the library. */
  private entityObject(entityId: string) {
    const objectName = this.entityConfig.get(entityId)?.object;
    return (
      this.spawned.get(entityId) ??
      (objectName ? this.model?.getObjectByName(objectName) : undefined)
    );
  }
  /** Raises or lowers a device; returns the height that was applied. */
  setEntityHeight(entityId: string, height: number) {
    const object = this.entityObject(entityId);
    if (!object) return undefined;
    const world = object.getWorldPosition(new THREE.Vector3());
    const target = new THREE.Vector3(world.x, height, world.z);
    const local = object.parent ? object.parent.worldToLocal(target) : target;
    object.position.y = local.y;
    const light = this.entityLights.get(entityId);
    light?.position.setY(height);
    this.selectionHelper?.update();
    return height;
  }
  /** Turns a device about its vertical axis, in degrees. */
  setEntityYaw(entityId: string, degrees: number) {
    const object = this.entityObject(entityId);
    if (!object) return undefined;
    object.rotation.y = (degrees * Math.PI) / 180;
    this.selectionHelper?.update();
    return degrees;
  }
  /** Crosshair plus paused picking, so a placement click is not read as a device tap. */
  setPlacementMode(active: boolean) {
    this.areaPicker.setSelectionEnabled(!active);
    this.canvas.style.cursor = active ? "crosshair" : this.editMode ? "grab" : "";
  }
  /** In edit mode a press on a mapped device drags it instead of orbiting the camera. */
  setEditMode(active: boolean) {
    this.editMode = active;
    this.drag = undefined;
    this.controls.enabled = true;
    this.canvas.style.cursor = active ? "grab" : "";
  }
  private onDragStart = (event: PointerEvent) => {
    if (event.button !== 0) return;
    if (this.roomEditMode && this.onVertexPointerDown(event)) return;
    if (!this.editMode) return;
    const { entityId } = this.areaPicker.pick(event.clientX, event.clientY);
    if (!entityId) return;
    this.drag = { entityId, start: { x: event.clientX, y: event.clientY }, moved: false };
    this.controls.enabled = false;
    this.canvas.style.cursor = "grabbing";
    this.highlightObject(this.entityConfig.get(entityId)?.object);
  };
  /** Grabs a vertex handle, or removes it on shift-click. Returns true when consumed. */
  private onVertexPointerDown(event: PointerEvent) {
    const handle = this.overlays.pickHandle(this.raycastAt(event));
    if (!handle) return false;
    const polygon = this.areas[handle.areaId]?.polygon;
    if (!polygon) return false;
    this.controls.enabled = false;
    this.areaPicker.setSelectionEnabled(false);
    if (event.shiftKey) {
      if (polygon.length > 3) {
        polygon.splice(handle.index, 1);
        this.overlays.refresh();
        this.onPolygonChanged(handle.areaId, polygon);
      }
      return true;
    }
    this.vertexDrag = { ...handle, moved: false };
    this.canvas.style.cursor = "grabbing";
    return true;
  }
  private raycastAt(event: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect();
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(
      new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      this.camera,
    );
    return raycaster;
  }
  private onDragMove = (event: PointerEvent) => {
    if (this.vertexDrag) {
      const point = this.pointOnFloor(event);
      const polygon = this.areas[this.vertexDrag.areaId]?.polygon;
      if (!point || !polygon) return;
      this.vertexDrag.moved = true;
      polygon[this.vertexDrag.index] = [point[0], point[2]];
      this.overlays.refresh();
      return;
    }
    const drag = this.drag;
    if (!drag) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.start.x, event.clientY - drag.start.y) < 4)
      return;
    const point = this.pointOnFloor(event);
    if (!point) return;
    drag.moved = true;
    // A dragged device must not also register as a tap that toggles it.
    this.areaPicker.setSelectionEnabled(false);
    this.moveEntity(drag.entityId, point);
  };
  private onDragEnd = (event: PointerEvent) => {
    const vertexDrag = this.vertexDrag;
    this.vertexDrag = undefined;
    const drag = this.drag;
    this.drag = undefined;
    this.canvas.style.cursor = this.roomEditMode ? "crosshair" : this.editMode ? "grab" : "";
    setTimeout(() => {
      this.controls.enabled = true;
      this.areaPicker.setSelectionEnabled(true);
    }, 0);
    if (vertexDrag) {
      const polygon = this.areas[vertexDrag.areaId]?.polygon;
      if (vertexDrag.moved && polygon) this.onPolygonChanged(vertexDrag.areaId, polygon);
      return;
    }
    if (!drag && this.roomEditMode && this.addVertexAt(event)) return;
    if (!drag?.moved) return;
    const config = this.entityConfig.get(drag.entityId);
    const object =
      this.spawned.get(drag.entityId) ??
      (config?.object ? this.model?.getObjectByName(config.object) : undefined);
    const world = object?.getWorldPosition(new THREE.Vector3());
    if (world) this.onEntityMoved(drag.entityId, [world.x, world.y, world.z]);
  };
  /**
   * A click inside the room being edited adds a vertex, splitting the nearest edge so the
   * outline keeps its shape. Clicks outside fall through to normal room selection.
   */
  private addVertexAt(event: PointerEvent) {
    const areaId = this.selectedArea;
    const polygon = areaId ? this.areas[areaId]?.polygon : undefined;
    const point = this.pointOnFloor(event);
    if (!areaId || !polygon || !point) return false;
    const [x, , z] = point;
    if (!pointInPolygon(polygon, x, z)) return false;
    polygon.splice(HouseScene.nearestEdge(polygon, x, z) + 1, 0, [x, z]);
    this.overlays.refresh();
    this.areaPicker.setSelectionEnabled(false);
    this.onPolygonChanged(areaId, polygon);
    return true;
  }
  /** Index of the polygon vertex that starts the edge closest to a point. */
  private static nearestEdge(polygon: Polygon, x: number, z: number) {
    let best = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < polygon.length; i++) {
      const [ax, az] = polygon[i];
      const [bx, bz] = polygon[(i + 1) % polygon.length];
      const [dx, dz] = [bx - ax, bz - az];
      const lengthSquared = dx * dx + dz * dz || 1;
      const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / lengthSquared));
      const distance = Math.hypot(x - (ax + t * dx), z - (az + t * dz));
      if (distance < bestDistance) [best, bestDistance] = [i, distance];
    }
    return best;
  }
  highlightObject(objectName?: string) {
    if (this.selectionHelper) this.scene.remove(this.selectionHelper);
    const object = objectName ? this.model?.getObjectByName(objectName) : undefined;
    if (!object) return;
    this.selectionHelper = new THREE.BoxHelper(object, 0x65e6c3);
    this.selectionHelper.material.depthTest = false;
    this.selectionHelper.renderOrder = 10;
    this.scene.add(this.selectionHelper);
  }
  start() {
    if (this.running) return;
    this.running = true;
    this.render();
  }
  dispose() {
    this.stop();
    this.overlays.dispose();
    this.areaPicker.dispose();
    this.controls.dispose();
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener("webglcontextlost", this.onContextLost);
    this.canvas.removeEventListener("webglcontextrestored", this.onContextRestored);
    this.canvas.remove();
    this.tooltip.remove();
    this.cameraPreview.remove();
    this.host.removeEventListener("pointerdown", this.onDragStart, true);
    this.host.removeEventListener("pointermove", this.onDragMove, true);
    this.host.removeEventListener("pointerup", this.onDragEnd, true);
    this.host.removeEventListener("pointercancel", this.onDragEnd, true);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.renderer.dispose();
  }
  private resize() {
    const { clientWidth: width, clientHeight: height } = this.host;
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }
  private render = () => {
    if (!this.running) return;
    for (const name of this.spinningFans) {
      const fan = this.findObject(name);
      if (fan) fan.rotation.y += 0.12;
    }
    this.controls.update();
    this.selectionHelper?.update();
    this.renderer.render(this.scene, this.camera);
    this.frame = requestAnimationFrame(this.render);
  };
  private stop() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = undefined;
    this.running = false;
  }
  private onVisibility = () => (document.hidden ? this.stop() : this.start());
}
