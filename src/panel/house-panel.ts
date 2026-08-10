import { LitElement, css, html, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { loadMapping, loadTwinCatalog } from "../mapping/loader";
import { mappingSchema, type HouseMapping, type TwinCatalog } from "../mapping/schema";
import type { HomeAssistant } from "../home-assistant/types";
import type { HassEntity } from "../home-assistant/types";
import { toggleEntity } from "../home-assistant/service-calls";
import { StateBindings } from "../home-assistant/state-bindings";
import { loadRegistries } from "../home-assistant/registries";
import yaml from "js-yaml";
import { HouseScene } from "../renderer/scene";
import { resolveDeviceKind } from "../renderer/device-models";

const SVG_NS = "http://www.w3.org/2000/svg";
/** Material Design Icon paths, so controls read as symbols instead of sentences. */
const ICON_PATHS = {
  move: "M13,6V11H18V7.75L22.25,12L18,16.25V13H13V18H16.25L12,22.25L7.75,18H11V13H6V16.25L1.75,12L6,7.75V11H11V6H7.75L12,1.75L16.25,6H13Z",
  remove:
    "M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z",
  power:
    "M16.56,5.44L15.11,6.89C16.84,7.94 18,9.83 18,12A6,6 0 0,1 12,18A6,6 0 0,1 6,12C6,9.83 7.16,7.94 8.88,6.88L7.44,5.44C5.36,6.88 4,9.28 4,12A8,8 0 0,0 12,20A8,8 0 0,0 20,12C20,9.28 18.64,6.88 16.56,5.44M13,3H11V13H13",
  recenter:
    "M5,15H3V19A2,2 0 0,0 5,21H9V19H5V15M5,5H9V3H5A2,2 0 0,0 3,5V9H5V5M19,3H15V5H19V9H21V5A2,2 0 0,0 19,3M19,19H15V21H19A2,2 0 0,0 21,19V15H19V19M12,9A3,3 0 0,0 9,12A3,3 0 0,0 12,15A3,3 0 0,0 15,12A3,3 0 0,0 12,9Z",
};
/** Home Assistant domains mapped onto the mapping schema's object types. */
const DOMAIN_TYPES: Record<string, "light" | "switch" | "camera" | "control" | "sensor"> = {
  light: "light",
  switch: "switch",
  camera: "camera",
  fan: "control",
  binary_sensor: "sensor",
  sensor: "sensor",
};
const TOGGLEABLE = ["light", "switch", "fan"];
/** Domains the device-model library can actually draw. */
const PLACEABLE = /^(light|switch|fan|camera|media_player|vacuum|humidifier|cover|lock|climate)\./;
type Mode = "view" | "devices" | "rooms";
const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: "view", label: "View", hint: "Click a device to control it, or a room to see its devices" },
  { id: "devices", label: "Devices", hint: "Drag devices in the model to reposition them" },
  { id: "rooms", label: "Rooms", hint: "Drag the corner handles to reshape a room outline" },
];
const MODE_MESSAGE: Record<Mode, string> = {
  view: "Clicking a device controls it.",
  devices: "Drag a device in the model to move it, or click it to select it.",
  rooms:
    "Drag a handle to move a corner, click inside a room to add one, shift-click a handle to remove it.",
};

@customElement("hass-digital-twin-panel")
export class HousePanel extends LitElement {
  @property({ attribute: false }) hass?: HomeAssistant;
  @property({ type: Boolean }) narrow = false;
  @property({ attribute: false }) panel?: { config?: { mappingUrl?: string } };
  @state() private error?: string;
  private mapping?: HouseMapping;
  private houseScene?: HouseScene;
  private bindings?: StateBindings;
  private selectedArea?: string;
  private pendingEntity?: HassEntity;
  private selectedMappedEntityId?: string;
  private editorMessage = "";
  private readonly entityAreas = new Map<string, string>();
  private readonly areaNames = new Map<string, string>();
  private mode: Mode = "view";
  private editingOpen = false;
  private initialized = false;
  private twinId?: string;
  private unsaved = false;
  private get editMode() {
    return this.mode === "devices";
  }
  private get roomEditMode() {
    return this.mode === "rooms";
  }
  static styles = css`
    :host {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 340px;
      height: 100%;
      background: var(--primary-background-color, #111111);
      color: var(--primary-text-color, #e1e1e1);
      font-family: var(--paper-font-body1_-_font-family, Roboto, system-ui, sans-serif);
      font-size: 14px;
    }
    #scene {
      min-width: 0;
      position: relative;
    }
    /* ---- viewport toolbar: one surface, modes grouped away from the camera action ---- */
    #toolbar {
      position: absolute;
      top: 12px;
      right: 12px;
      z-index: 20;
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px;
      background: var(--card-background-color, #1c1c1c);
      border: 1px solid var(--divider-color, rgba(225, 225, 225, 0.12));
      border-radius: var(--ha-card-border-radius, 12px);
      box-shadow: var(--ha-card-box-shadow, 0 2px 10px rgba(0, 0, 0, 0.3));
    }
    .segmented {
      display: flex;
      gap: 2px;
      padding: 2px;
      border-radius: 8px;
      background: var(--secondary-background-color, #202020);
    }
    .segmented button {
      appearance: none;
      border: 0;
      background: none;
      font: inherit;
      font-size: 13px;
      min-height: 32px;
      padding: 6px 12px;
      border-radius: 6px;
      cursor: pointer;
      color: var(--secondary-text-color, #9b9b9b);
    }
    .segmented button[aria-pressed="true"] {
      background: var(--card-background-color, #1c1c1c);
      color: var(--primary-color, #03a9f4);
      font-weight: 500;
    }
    .toolbar-divider {
      width: 1px;
      align-self: stretch;
      margin: 4px 2px;
      background: var(--divider-color, rgba(225, 225, 225, 0.12));
    }
    .icon-button {
      appearance: none;
      border: 0;
      background: none;
      cursor: pointer;
      width: 36px;
      height: 36px;
      border-radius: 8px;
      display: grid;
      place-items: center;
      color: var(--secondary-text-color, #9b9b9b);
    }
    .icon-button:hover {
      background: var(--secondary-background-color, #202020);
      color: var(--primary-text-color, #e1e1e1);
    }
    .icon-button svg {
      width: 20px;
      height: 20px;
      fill: currentColor;
    }
    #object-actions-overlay {
      position: absolute;
      top: 64px;
      right: 12px;
      z-index: 20;
      width: 224px;
      padding: 12px;
      display: grid;
      gap: 8px;
      background: var(--card-background-color, #1c1c1c);
      border: 1px solid var(--divider-color, rgba(225, 225, 225, 0.12));
      border-radius: var(--ha-card-border-radius, 12px);
      box-shadow: var(--ha-card-box-shadow, 0 2px 10px rgba(0, 0, 0, 0.3));
    }
    #object-actions-overlay:empty {
      display: none;
    }
    #object-actions-overlay .title {
      font-weight: 500;
    }
    .error {
      position: absolute;
      inset: auto 12px 12px;
      padding: 12px;
      border-radius: var(--ha-card-border-radius, 12px);
      background: var(--error-color, #db4437);
      color: #fff;
    }
    /* ---- right panel ---- */
    aside {
      display: flex;
      flex-direction: column;
      min-height: 0;
      background: var(--primary-background-color, #111111);
      border-left: 1px solid var(--divider-color, rgba(225, 225, 225, 0.12));
    }
    .panel-head {
      padding: 12px;
      background: var(--card-background-color, #1c1c1c);
      border-bottom: 1px solid var(--divider-color, rgba(225, 225, 225, 0.12));
    }
    select {
      width: 100%;
      font: inherit;
      padding: 8px 10px;
      border-radius: 8px;
      color: var(--primary-text-color, #e1e1e1);
      background: var(--secondary-background-color, #202020);
      border: 1px solid var(--divider-color, rgba(225, 225, 225, 0.12));
    }
    #panel {
      display: grid;
      gap: 12px;
      align-content: start;
      padding: 12px;
      overflow: auto;
      min-height: 0;
    }
    .card {
      display: grid;
      gap: 10px;
      padding: 12px;
      background: var(--card-background-color, #1c1c1c);
      border-radius: var(--ha-card-border-radius, 12px);
      box-shadow: var(--ha-card-box-shadow, none);
      border: 1px solid var(--divider-color, rgba(225, 225, 225, 0.12));
    }
    .card-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 8px;
      font-weight: 500;
      font-size: 15px;
    }
    .card-head .count {
      font-size: 12px;
      font-weight: 400;
      color: var(--secondary-text-color, #9b9b9b);
    }
    .hint {
      margin: 0;
      font-size: 12px;
      line-height: 1.45;
      color: var(--secondary-text-color, #9b9b9b);
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .chip {
      appearance: none;
      font: inherit;
      font-size: 13px;
      cursor: pointer;
      padding: 6px 12px;
      border-radius: 999px;
      color: var(--primary-text-color, #e1e1e1);
      background: var(--secondary-background-color, #202020);
      border: 1px solid var(--divider-color, rgba(225, 225, 225, 0.12));
    }
    .chip[aria-pressed="true"] {
      background: var(--primary-color, #03a9f4);
      border-color: var(--primary-color, #03a9f4);
      color: var(--text-primary-color, #fff);
    }
    .device {
      display: grid;
      grid-template-columns: 22px minmax(0, 1fr) auto;
      align-items: center;
      gap: 10px;
      width: 100%;
      padding: 6px 4px;
      border: 0;
      border-radius: 8px;
      background: none;
      font: inherit;
      color: inherit;
      text-align: left;
      cursor: pointer;
    }
    .device:hover {
      background: var(--secondary-background-color, #202020);
    }
    .device.unplaced .name {
      color: var(--secondary-text-color, #9b9b9b);
    }
    .device.unplaced .dot {
      background: none;
      border: 1px dashed var(--secondary-text-color, #9b9b9b);
      box-sizing: border-box;
    }
    .text-button.primary {
      color: var(--text-primary-color, #fff);
      background: var(--primary-color, #03a9f4);
      border-color: var(--primary-color, #03a9f4);
    }
    .text-button:disabled {
      cursor: default;
      opacity: 0.6;
    }
    .device .dot {
      width: 12px;
      height: 12px;
      margin: 0 5px;
      border-radius: 50%;
      background: var(--divider-color, rgba(225, 225, 225, 0.2));
    }
    .device .dot.active {
      background: var(--state-active-color, #fdd835);
      box-shadow: 0 0 0 3px rgba(253, 216, 53, 0.18);
    }
    .device .name {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .device .state {
      display: block;
      font-size: 12px;
      color: var(--secondary-text-color, #9b9b9b);
    }
    .toggle {
      appearance: none;
      border: 0;
      cursor: pointer;
      width: 40px;
      height: 22px;
      border-radius: 999px;
      position: relative;
      background: var(--secondary-background-color, #3a3a3a);
    }
    .toggle::after {
      content: "";
      position: absolute;
      top: 3px;
      left: 3px;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: #fff;
      transition: left 0.15s ease;
    }
    .toggle[aria-pressed="true"] {
      background: var(--primary-color, #03a9f4);
    }
    .toggle[aria-pressed="true"]::after {
      left: 21px;
    }
    details.card > summary {
      cursor: pointer;
      font-weight: 500;
      font-size: 15px;
      list-style: none;
    }
    details.card > summary::-webkit-details-marker {
      display: none;
    }
    details.card > summary::after {
      content: "▾";
      float: right;
      color: var(--secondary-text-color, #9b9b9b);
    }
    details.card[open] > summary::after {
      content: "▴";
    }
    .status {
      margin: 0;
      font-size: 12px;
      line-height: 1.45;
      color: var(--primary-color, #03a9f4);
    }
    .stack {
      display: grid;
      gap: 6px;
      max-height: 220px;
      overflow: auto;
    }
    .text-button {
      appearance: none;
      font: inherit;
      font-size: 13px;
      cursor: pointer;
      width: 100%;
      text-align: left;
      padding: 8px 10px;
      border-radius: 8px;
      color: var(--primary-text-color, #e1e1e1);
      background: var(--secondary-background-color, #202020);
      border: 1px solid var(--divider-color, rgba(225, 225, 225, 0.12));
    }
    .text-button:hover {
      border-color: var(--primary-color, #03a9f4);
    }
    .text-button.suggested {
      border-color: var(--state-active-color, #fdd835);
    }
    .icon-row {
      display: flex;
      gap: 8px;
    }
    .icon-row .icon-button {
      border: 1px solid var(--divider-color, rgba(225, 225, 225, 0.12));
      color: var(--primary-text-color, #e1e1e1);
    }
    label.field {
      display: grid;
      gap: 6px;
      font-size: 12px;
      color: var(--secondary-text-color, #9b9b9b);
    }
    input[type="range"] {
      width: 100%;
      accent-color: var(--primary-color, #03a9f4);
    }
    @media (max-width: 800px) {
      :host {
        grid-template-columns: 1fr;
        grid-template-rows: 1fr auto;
      }
      aside {
        max-height: 45vh;
      }
    }
  `;
  firstUpdated() {
    this.initialized = true;
    void this.initialize();
  }
  connectedCallback() {
    super.connectedCallback();
    if (this.initialized && !this.houseScene?.canvas.isConnected) {
      queueMicrotask(() => void this.initialize());
    }
  }
  disconnectedCallback() {
    window.removeEventListener("keydown", this.onKeyDown);
    this.bindings?.stop();
    this.houseScene?.dispose();
    this.houseScene = undefined;
    super.disconnectedCallback();
  }
  protected shouldUpdate(changed: PropertyValues): boolean {
    return !this.initialized || changed.has("error");
  }
  render() {
    return html`<main id="scene">
        <div id="toolbar" role="toolbar" aria-label="Model controls">
          <div class="segmented" id="modes" role="group" aria-label="Interaction mode">
            ${MODES.map(
              (mode) =>
                html`<button
                  data-mode=${mode.id}
                  title=${mode.hint}
                  aria-pressed=${mode.id === "view"}
                  @click=${() => this.setMode(mode.id)}
                >
                  ${mode.label}
                </button>`,
            )}
          </div>
          <span class="toolbar-divider"></span>
          <button id="reset-camera" class="icon-button" title="Reset view" aria-label="Reset view">
            <svg viewBox="0 0 24 24"><path d=${ICON_PATHS.recenter}></path></svg>
          </button>
        </div>
        <section id="object-actions-overlay"></section>
        ${this.error ? html`<p class="error">${this.error}</p>` : ""}
      </main>
      <aside>
        <div class="panel-head">
          <select id="twin-select" aria-label="Digital twin"></select>
        </div>
        <div id="panel"></div>
      </aside>`;
  }
  private async initialize() {
    const host = this.renderRoot.querySelector<HTMLElement>("#scene");
    if (!host) return;
    this.houseScene = new HouseScene(
      host,
      (areaId) => this.selectArea(areaId),
      (entityId) => this.onSceneEntityClick(entityId),
      (entityId, position) => this.onSceneEntityDropped(entityId, position),
      (areaId, polygon) => this.onPolygonChanged(areaId, polygon),
    );
    this.houseScene.start();
    this.renderRoot
      .querySelector<HTMLButtonElement>("#reset-camera")
      ?.addEventListener("click", () => this.houseScene?.resetView());
    host.addEventListener("click", (event) => this.placePendingEntity(event));
    window.addEventListener("keydown", this.onKeyDown);
    host.addEventListener("dragover", (event) => event.preventDefault());
    host.addEventListener("drop", (event) => {
      event.preventDefault();
      const entityId = event.dataTransfer?.getData("text/plain");
      const entity = entityId ? this.hass?.states[entityId] : undefined;
      if (entity) {
        this.pendingEntity = entity;
        this.placePendingEntity(event);
      }
    });
    try {
      const configuredUrl = this.panel?.config?.mappingUrl;
      const catalog = await loadTwinCatalog(
        configuredUrl?.endsWith("/twins.yaml") ? configuredUrl : "/hass_digital_twin/twins.yaml",
      );
      this.populateTwinSelect(catalog);
      await this.loadTwin(catalog, catalog.twins[0].id);
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Unable to initialize house model";
    }
  }
  private populateTwinSelect(catalog: TwinCatalog) {
    const select = this.renderRoot.querySelector<HTMLSelectElement>("#twin-select");
    if (!select) return;
    select.replaceChildren(...catalog.twins.map((twin) => new Option(twin.name, twin.id)));
    select.addEventListener("change", () => void this.loadTwin(catalog, select.value));
  }
  private async loadTwin(catalog: TwinCatalog, twinId: string) {
    const twin = catalog.twins.find((entry) => entry.id === twinId);
    if (!twin) return;
    this.twinId = twinId;
    this.unsaved = false;
    const published = await loadMapping(twin.mapping);
    const saved = await this.loadSavedLayout(twinId);
    this.mapping = saved ? HousePanel.mergeLayout(published, saved) : published;
    this.houseScene?.setAreas(this.mapping.areas);
    this.houseScene?.setEntities(this.mapping.entities);
    this.houseScene?.setCameraUrlResolver((entityId) => {
      const picture = this.hass?.states[entityId]?.attributes.entity_picture;
      return typeof picture === "string" ? picture : undefined;
    });
    this.houseScene?.setBackground(this.mapping.background);
    await this.houseScene?.load(this.mapping.model);
    if (this.mapping.camera)
      this.houseScene?.setHomeView(this.mapping.camera.position, this.mapping.camera.target);
    else this.houseScene?.frameModel();
    this.selectedArea = undefined;
    this.selectedMappedEntityId = undefined;
    this.houseScene?.setSelectedArea(undefined);
    Object.entries(this.mapping.entities).forEach(([id]) =>
      this.houseScene?.syncEntity(id, this.hass?.states[id]?.state ?? "off"),
    );
    if (this.hass && !this.bindings) {
      this.bindings = new StateBindings(this.hass, (entity) =>
        this.houseScene?.syncEntity(entity.entity_id, entity.state),
      );
      void this.bindings.start();
      const registries = await loadRegistries(this.hass);
      registries.areas.forEach((area) => this.areaNames.set(area.area_id, area.name));
      const deviceAreas = new Map(registries.devices.map((device) => [device.id, device.area_id]));
      this.entityAreas.clear();
      registries.entities.forEach((entity) => {
        const areaId =
          entity.area_id ?? (entity.device_id ? deviceAreas.get(entity.device_id) : undefined);
        if (areaId) this.entityAreas.set(entity.entity_id, areaId);
      });
    }
    this.renderPanel();
  }
  private selectArea(areaId: string, options: { focus?: boolean } = {}) {
    const area = this.mapping?.areas[areaId];
    if (!area) return;
    this.selectedArea = areaId;
    this.houseScene?.setSelectedArea(areaId);
    if (area.camera && options.focus !== false)
      this.houseScene?.focus(area.camera.position, area.camera.target);
    this.renderPanel();
  }
  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") this.cancelPlacement();
  };
  /** The three modes drive the same pointer, so they are exclusive by construction. */
  private setMode(mode: Mode) {
    this.mode = mode;
    this.houseScene?.setEditMode(mode === "devices");
    this.houseScene?.setRoomEditMode(mode === "rooms");
    if (mode !== "devices") this.cancelPlacement();
    for (const button of this.renderRoot.querySelectorAll<HTMLButtonElement>("#modes button"))
      button.setAttribute("aria-pressed", String(button.dataset.mode === mode));
    if (mode !== "view") this.editingOpen = true;
    this.editorMessage = MODE_MESSAGE[mode];
    this.renderPanel();
  }
  /** While editing, a device click selects it; otherwise it controls the device. */
  private onSceneEntityClick(entityId: string) {
    const entity = this.hass?.states[entityId];
    if (this.editMode && entity) this.showObjectControls(entity);
    else void this.toggleMappedEntity(entityId);
  }
  /** The scene edits the polygon in place; this records and reports the result. */
  private onPolygonChanged(areaId: string, polygon: [number, number][]) {
    const area = this.mapping?.areas[areaId];
    if (!area) return;
    area.polygon = polygon;
    this.editorMessage = `${this.areaLabel(areaId)} outline now has ${polygon.length} corners; export the YAML to keep it.`;
    this.saveDraft();
    this.renderPanel();
  }
  private addRoom() {
    if (!this.mapping || !this.houseScene) return;
    const [cx, cz] = this.houseScene.viewCenter();
    let index = Object.keys(this.mapping.areas).length + 1;
    while (this.mapping.areas[`room_${index}`]) index++;
    const areaId = `room_${index}`;
    this.mapping.areas[areaId] = {
      objects: [],
      polygon: [
        [cx - 1.5, cz - 1.5],
        [cx + 1.5, cz - 1.5],
        [cx + 1.5, cz + 1.5],
        [cx - 1.5, cz + 1.5],
      ],
    };
    this.houseScene.setAreas(this.mapping.areas);
    this.editorMessage = `Added ${this.areaLabel(areaId)}. Pick its Home Assistant area below, then drag its corners.`;
    this.saveDraft();
    this.selectArea(areaId);
  }
  private deleteRoom(areaId: string) {
    if (!this.mapping) return;
    const placed = Object.values(this.mapping.entities).filter(
      (entity) => entity.area === areaId,
    ).length;
    delete this.mapping.areas[areaId];
    this.selectedArea = undefined;
    this.houseScene?.setAreas(this.mapping.areas);
    this.houseScene?.setSelectedArea(undefined);
    this.editorMessage = placed
      ? `Removed the room; ${placed} placed device(s) still reference it and are now hidden.`
      : "Removed the room from this twin only; Home Assistant was unchanged.";
    this.saveDraft();
    this.renderPanel();
  }
  /** Links the selected room outline to a Home Assistant area. */
  private assignRoomArea(areaId: string, haAreaId: string) {
    const area = this.mapping?.areas[areaId];
    if (!area) return;
    if (haAreaId) area.ha_area_id = haAreaId;
    else delete area.ha_area_id;
    this.editorMessage = `${this.areaLabel(areaId)} is now linked to ${haAreaId ? this.areaNames.get(haAreaId) : "no Home Assistant area"}.`;
    this.saveDraft();
    // Re-select so the room label and its device list pick up the new area, without
    // yanking the camera to the room's saved viewpoint.
    this.selectArea(areaId, { focus: false });
  }
  /** Commits a drag that the scene already applied to the model. */
  private onSceneEntityDropped(entityId: string, position: [number, number, number]) {
    const mapped = this.mapping?.entities[entityId];
    const entity = this.hass?.states[entityId];
    if (!mapped || !entity) return;
    const [x, y, z] = position;
    mapped.position = [x, y, z];
    if (mapped.light) mapped.light.position = [x, mapped.light.position[1], z];
    if (mapped.door) this.shiftDoor(mapped.door, x, z);
    this.selectedMappedEntityId = entityId;
    this.editorMessage = `Moved ${this.displayName(entity)} in this twin only; Home Assistant was unchanged.`;
    this.saveDraft();
    this.renderPanel();
  }
  private async toggleMappedEntity(entityId: string) {
    const entity = this.mapping?.entities[entityId];
    if (!entity || !this.hass) return;
    const nextState = this.hass.states[entityId]?.state !== "on";
    if (entity.object) this.houseScene?.setObjectActive(entity.object, nextState);
    try {
      await toggleEntity(this.hass, entityId);
    } catch {
      if (entity.object) this.houseScene?.setObjectActive(entity.object, !nextState);
    }
  }
  /** One card per job: pick a room, work its devices, open the editor only when needed. */
  private renderPanel() {
    const root = this.renderRoot.querySelector<HTMLElement>("#panel");
    const overlay = this.renderRoot.querySelector<HTMLElement>("#object-actions-overlay");
    if (!root || !this.mapping) return;
    overlay?.replaceChildren();
    if (overlay) this.renderObjectActions(overlay);
    root.replaceChildren(this.roomsCard(), this.devicesCard(), this.editingCard());
  }
  private card(title: string, count?: string) {
    const card = document.createElement("div");
    card.className = "card";
    const head = document.createElement("div");
    head.className = "card-head";
    const label = document.createElement("span");
    label.textContent = title;
    head.append(label);
    if (count) {
      const badge = document.createElement("span");
      badge.className = "count";
      badge.textContent = count;
      head.append(badge);
    }
    card.append(head);
    return card;
  }
  private roomsCard() {
    const areas = Object.keys(this.mapping?.areas ?? {});
    const card = this.card("Rooms", `${areas.length}`);
    const chips = document.createElement("div");
    chips.className = "chips";
    for (const areaId of areas) {
      const chip = document.createElement("button");
      chip.className = "chip";
      chip.textContent = this.areaLabel(areaId);
      chip.setAttribute("aria-pressed", String(areaId === this.selectedArea));
      chip.onclick = () => this.selectArea(areaId);
      chip.ondragover = (event) => event.preventDefault();
      chip.ondrop = (event) => {
        event.preventDefault();
        const entityId = event.dataTransfer?.getData("text/plain");
        if (entityId) void this.assignArea(entityId, areaId);
      };
      chips.append(chip);
    }
    card.append(chips);
    return card;
  }
  /** The one and only device list: the selected room's, placed first. */
  private devicesCard() {
    const areaId = this.selectedArea;
    if (!areaId) {
      const empty = this.card("Devices");
      const hint = document.createElement("p");
      hint.className = "hint";
      hint.textContent = "Pick a room above, or click one in the model, to see its devices.";
      empty.append(hint);
      return empty;
    }
    // Home Assistant owns which area a device is in, so the room lists everything HA
    // puts there — placed in the model or not.
    const placed = this.roomEntities(areaId);
    const placedIds = new Set(placed.map((entity) => entity.entity_id));
    const inArea = this.areaCandidates(areaId).filter((entity) => !placedIds.has(entity.entity_id));
    const card = this.card(this.areaLabel(areaId), `${placed.length + inArea.length} in this area`);
    const list = document.createElement("div");
    list.className = "stack";
    for (const entity of placed) list.append(this.deviceRow(entity));
    for (const entity of inArea) list.append(this.deviceRow(entity, false));
    if (!list.children.length) {
      const hint = document.createElement("p");
      hint.className = "hint";
      hint.textContent = this.mapping?.areas[areaId]?.ha_area_id
        ? "Home Assistant has no devices in this area."
        : "Link this room to a Home Assistant area in Rooms mode to list its devices.";
      card.append(hint);
      return card;
    }
    card.append(list);
    // Only count what the model library can draw: sensors and buttons stay list-only.
    const drawable = inArea.filter((entity) => PLACEABLE.test(entity.entity_id)).length;
    if (drawable) {
      const placeAll = document.createElement("button");
      placeAll.className = "text-button";
      placeAll.textContent = `Place ${drawable} unplaced device${drawable === 1 ? "" : "s"}`;
      placeAll.onclick = () => this.placeAllInRoom(areaId);
      card.append(placeAll);
    }
    return card;
  }
  /** Drops every unplaced device of a room into a tidy grid inside its outline. */
  private placeAllInRoom(areaId: string) {
    const polygon = this.mapping?.areas[areaId]?.polygon;
    if (!polygon?.length) {
      this.editorMessage = "This room has no outline yet, so there is nowhere to put them.";
      return this.renderPanel();
    }
    const xs = polygon.map(([x]) => x);
    const zs = polygon.map(([, z]) => z);
    const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
    const [z0, z1] = [Math.min(...zs), Math.max(...zs)];
    const placedIds = new Set(this.roomEntities(areaId).map((entity) => entity.entity_id));
    const todo = this.areaCandidates(areaId).filter(
      (entity) => !placedIds.has(entity.entity_id) && PLACEABLE.test(entity.entity_id),
    );
    if (!todo.length) {
      this.editorMessage =
        "Nothing here has a shape to draw — sensors and buttons are listed only.";
      return this.renderPanel();
    }
    const columns = Math.ceil(Math.sqrt(todo.length));
    todo.forEach((entity, index) => {
      const fx = (index % columns) + 1;
      const fz = Math.floor(index / columns) + 1;
      const rows = Math.ceil(todo.length / columns);
      this.selectedArea = areaId;
      this.createMappedEntity(entity, [
        x0 + ((x1 - x0) * fx) / (columns + 1),
        0,
        z0 + ((z1 - z0) * fz) / (rows + 1),
      ]);
    });
    this.houseScene?.setEntities(this.mapping!.entities);
    todo.forEach((entity) => this.houseScene?.syncEntity(entity.entity_id, entity.state ?? "off"));
    this.editorMessage = `Placed ${todo.length} device${todo.length === 1 ? "" : "s"} in ${this.areaLabel(areaId)}. Drag them where they belong, then save.`;
    this.saveDraft();
    this.renderPanel();
  }
  private deviceRow(entity: HassEntity, placed = true) {
    const row = document.createElement("button");
    row.className = placed ? "device" : "device unplaced";
    row.draggable = true;
    row.ondragstart = (event) => event.dataTransfer?.setData("text/plain", entity.entity_id);
    row.onclick = placed
      ? () => this.showObjectControls(entity)
      : () => this.startPlacement(entity, false);
    row.title = placed ? "" : "Click, then click a spot in the model";
    const active = entity.state === "on" || entity.state === "playing";
    const dot = document.createElement("span");
    dot.className = active ? "dot active" : "dot";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = this.displayName(entity);
    const state = document.createElement("small");
    state.className = "state";
    state.textContent = entity.state;
    name.append(state);
    row.append(dot, name);
    if (TOGGLEABLE.includes(entity.entity_id.split(".")[0])) {
      const toggle = document.createElement("button");
      toggle.className = "toggle";
      toggle.setAttribute("aria-pressed", String(active));
      toggle.title = `Toggle ${this.displayName(entity)}`;
      toggle.onclick = (event) => {
        event.stopPropagation();
        void this.toggleMappedEntity(entity.entity_id);
      };
      row.append(toggle);
    }
    return row;
  }
  /** Everything the editor needs, folded away until it is wanted. */
  private editingCard() {
    const details = document.createElement("details");
    details.className = "card";
    details.open = this.editingOpen;
    details.ontoggle = () => (this.editingOpen = details.open);
    const summary = document.createElement("summary");
    summary.textContent = "Editing";
    details.append(summary);
    const status = document.createElement("p");
    status.className = "status";
    status.textContent = this.editorMessage || MODE_MESSAGE[this.mode];
    const caveat = document.createElement("p");
    caveat.className = "hint";
    caveat.textContent =
      "Changes stay in this browser until you download the YAML. They never alter Home Assistant.";
    details.append(status, caveat);
    if (this.roomEditMode) this.renderRoomEditor(details);
    details.append(...this.unplacedSection());
    const save = document.createElement("button");
    save.className = this.unsaved ? "text-button primary" : "text-button";
    save.textContent = this.unsaved ? "Save layout" : "Layout saved";
    save.disabled = !this.unsaved;
    save.onclick = () => void this.saveLayout();
    const revert = document.createElement("button");
    revert.className = "text-button";
    revert.textContent = "Revert to the twin's YAML";
    revert.onclick = () => void this.revertLayout();
    const exportButton = document.createElement("button");
    exportButton.className = "text-button";
    exportButton.textContent = "Download mapping YAML";
    exportButton.onclick = () => this.downloadMapping();
    details.append(save, revert, exportButton);
    return details;
  }
  private unplacedSection() {
    const heading = document.createElement("p");
    heading.className = "hint";
    heading.textContent = "Unplaced devices — pick one, then click a spot in the model.";
    const list = document.createElement("div");
    list.className = "stack";
    const haAreaId = this.selectedArea
      ? (this.mapping?.areas[this.selectedArea]?.ha_area_id ?? this.selectedArea)
      : undefined;
    const mapped = new Set(Object.keys(this.mapping?.entities ?? {}));
    const candidates = Object.values(this.hass?.states ?? {})
      .filter(
        (entity) =>
          /^(light|switch|fan|camera)\./.test(entity.entity_id) && !mapped.has(entity.entity_id),
      )
      .sort(
        (a, b) =>
          Number(this.entityAreas.get(b.entity_id) === haAreaId) -
          Number(this.entityAreas.get(a.entity_id) === haAreaId),
      )
      .slice(0, 12);
    for (const entity of candidates) {
      const button = document.createElement("button");
      const matches = this.entityAreas.get(entity.entity_id) === haAreaId;
      button.className = matches ? "text-button suggested" : "text-button";
      button.textContent = `${matches ? "★ " : ""}${this.displayName(entity)}`;
      button.onclick = () => this.startPlacement(entity, false);
      list.append(button);
    }
    return [heading, list];
  }
  private downloadMapping() {
    const blob = new Blob([yaml.dump(this.mapping)], { type: "text/yaml" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "digital-twin-mapping.yaml";
    link.click();
    URL.revokeObjectURL(link.href);
  }
  /** Room outline controls: add or delete a room, and link one to a Home Assistant area. */
  private renderRoomEditor(root: HTMLElement) {
    const addButton = document.createElement("button");
    addButton.className = "text-button";
    addButton.textContent = "Add room";
    addButton.onclick = () => this.addRoom();
    root.append(addButton);
    const areaId = this.selectedArea;
    const area = areaId ? this.mapping?.areas[areaId] : undefined;
    if (!areaId || !area) {
      const hint = document.createElement("p");
      hint.className = "hint";
      hint.textContent = "Select a room to edit its outline.";
      root.append(hint);
      return;
    }
    const field = document.createElement("label");
    field.className = "field";
    field.textContent = `Home Assistant area for ${this.areaLabel(areaId)}`;
    const select = document.createElement("select");
    select.append(new Option("— not linked —", ""));
    for (const [haAreaId, name] of [...this.areaNames].sort((a, b) => a[1].localeCompare(b[1])))
      select.append(new Option(name, haAreaId));
    select.value = area.ha_area_id ?? "";
    select.onchange = () => this.assignRoomArea(areaId, select.value);
    field.append(select);
    const corners = document.createElement("p");
    corners.className = "hint";
    corners.textContent = `${area.polygon?.length ?? 0} corners`;
    const deleteButton = document.createElement("button");
    deleteButton.className = "text-button";
    deleteButton.textContent = "Delete room";
    deleteButton.onclick = () => this.deleteRoom(areaId);
    root.append(field, corners, deleteButton);
  }
  /** Overlay controls for the selected placed object: symbols only, tooltips carry the words. */
  private renderObjectActions(overlay: HTMLElement) {
    const entityId = this.selectedMappedEntityId;
    const entity = entityId ? this.hass?.states[entityId] : undefined;
    if (!entityId || !entity) return;
    const label = document.createElement("div");
    label.className = "title";
    label.textContent = this.displayName(entity);
    overlay.append(label);
    const domain = entityId.split(".")[0];
    if (domain === "light") overlay.append(...this.brightnessControl(entityId, entity));
    overlay.append(...this.placementControls(entityId));
    const actions = document.createElement("div");
    actions.className = "icon-row";
    if (TOGGLEABLE.includes(domain))
      actions.append(
        this.iconButton("power", "Toggle device", () => void this.toggleMappedEntity(entityId)),
      );
    actions.append(
      this.iconButton("move", "Move in twin", () => this.startPlacement(entity, true)),
      this.iconButton("remove", "Remove from twin", () => this.removeMappedEntity(entityId)),
    );
    overlay.append(actions);
  }
  /** Height and rotation: the two things a drag across the floor cannot express. */
  private placementControls(entityId: string) {
    const mapped = this.mapping?.entities[entityId];
    if (!mapped) return [];
    const height = mapped.position?.[1] ?? 0;
    return [
      this.slider(
        "Height",
        `${height.toFixed(2)} m`,
        { min: 0, max: 3, step: 0.05, value: height },
        (value) => this.houseScene?.setEntityHeight(entityId, value),
        (value) => {
          const [x, , z] = mapped.position ?? [0, 0, 0];
          mapped.position = [x, this.houseScene?.setEntityHeight(entityId, value) ?? value, z];
          if (mapped.light) mapped.light.position = [x, mapped.position[1], z];
          this.commitPlacement(entityId);
        },
      ),
      this.slider(
        "Rotation",
        `${Math.round(mapped.yaw ?? 0)}°`,
        { min: 0, max: 345, step: 15, value: mapped.yaw ?? 0 },
        (value) => this.houseScene?.setEntityYaw(entityId, value),
        (value) => {
          mapped.yaw = value;
          this.houseScene?.setEntityYaw(entityId, value);
          this.commitPlacement(entityId);
        },
      ),
    ];
  }
  private commitPlacement(entityId: string) {
    this.saveDraft();
    this.houseScene?.syncEntity(entityId, this.hass?.states[entityId]?.state ?? "off");
    this.renderPanel();
  }
  /**
   * Preview runs on every input event so the model tracks the thumb; the panel is only
   * rebuilt on release, because rebuilding it mid-drag would drop the drag.
   */
  private slider(
    label: string,
    readout: string,
    range: { min: number; max: number; step: number; value: number },
    onPreview: (value: number) => void,
    onCommit: (value: number) => void,
  ) {
    const field = document.createElement("label");
    field.className = "field";
    field.textContent = `${label} · ${readout}`;
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(range.min);
    input.max = String(range.max);
    input.step = String(range.step);
    input.value = String(range.value);
    input.oninput = () => {
      field.firstChild!.textContent = `${label} · ${
        range.step < 1 ? `${Number(input.value).toFixed(2)} m` : `${input.value}°`
      }`;
      onPreview(Number(input.value));
    };
    input.onchange = () => onCommit(Number(input.value));
    field.append(input);
    return field;
  }
  private brightnessControl(entityId: string, entity: HassEntity) {
    const field = document.createElement("label");
    field.className = "field";
    field.textContent = "Brightness";
    const brightness = document.createElement("input");
    brightness.type = "range";
    brightness.min = "1";
    brightness.max = "100";
    const current = Number(entity.attributes.brightness ?? 255);
    brightness.value = String(Math.max(1, Math.round((current / 255) * 100)));
    brightness.onchange = () =>
      void this.hass?.callService("light", "turn_on", {
        entity_id: entityId,
        brightness_pct: Number(brightness.value),
      });
    field.append(brightness);
    return [field];
  }
  private removeMappedEntity(entityId: string) {
    if (!this.mapping) return;
    delete this.mapping.entities[entityId];
    this.houseScene?.highlightObject();
    this.houseScene?.setEntities(this.mapping.entities);
    this.selectedMappedEntityId = undefined;
    this.editorMessage = `Removed ${entityId} from this twin only; Home Assistant was unchanged.`;
    this.saveDraft();
    this.renderPanel();
  }
  /**
   * A saved layout owns what the user arranged — room outlines and device placements —
   * while the published YAML owns which model file to load. Re-exporting the CAD
   * document therefore swaps the geometry without disturbing anything that was placed,
   * and rooms added to the document since the layout was saved still appear.
   */
  private static mergeLayout(published: HouseMapping, saved: HouseMapping): HouseMapping {
    return {
      ...saved,
      model: published.model,
      background: published.background ?? saved.background,
      camera: published.camera ?? saved.camera,
      areas: { ...published.areas, ...saved.areas },
      entities: saved.entities,
    };
  }
  /** Local key so an unsaved layout survives a reload even without Home Assistant. */
  private draftKey(twinId = this.twinId) {
    return `hass-digital-twin:layout:${twinId}`;
  }
  /**
   * Edits are kept in Home Assistant so they follow the user between browsers, with the
   * browser copy as a fallback for versions that do not have the websocket commands yet.
   */
  private async loadSavedLayout(twinId: string) {
    const stored = await this.readLayout(twinId);
    if (!stored) return undefined;
    try {
      return mappingSchema.parse(stored);
    } catch {
      this.editorMessage = "Saved layout did not match the schema, so the YAML was used instead.";
      return undefined;
    }
  }
  private async readLayout(twinId: string): Promise<unknown> {
    try {
      const result = await this.hass?.connection.sendMessagePromise<{ mapping?: unknown }>({
        type: "hass_digital_twin/load_layout",
        twin: twinId,
      });
      if (result?.mapping) return result.mapping;
    } catch {
      // Home Assistant has not loaded the new commands yet; fall back to this browser.
    }
    const local = localStorage.getItem(this.draftKey(twinId));
    return local ? yaml.load(local) : undefined;
  }
  /** Marks the layout dirty and keeps a browser copy, so nothing is lost on reload. */
  private saveDraft() {
    if (!this.mapping) return;
    this.unsaved = true;
    localStorage.setItem(this.draftKey(), yaml.dump(this.mapping));
  }
  private async saveLayout() {
    if (!this.mapping || !this.twinId) return;
    try {
      await this.hass?.connection.sendMessagePromise({
        type: "hass_digital_twin/save_layout",
        twin: this.twinId,
        mapping: JSON.parse(JSON.stringify(this.mapping)),
      });
      this.editorMessage = "Layout saved to Home Assistant.";
    } catch {
      this.editorMessage =
        "Saved in this browser only — restart Home Assistant to store it there too.";
    }
    this.unsaved = false;
    this.renderPanel();
  }
  /** Throws the edits away and goes back to the twin's YAML. */
  private async revertLayout() {
    if (!this.twinId) return;
    localStorage.removeItem(this.draftKey());
    try {
      await this.hass?.connection.sendMessagePromise({
        type: "hass_digital_twin/clear_layout",
        twin: this.twinId,
      });
    } catch {
      // Nothing stored server-side to clear.
    }
    this.editorMessage = "Reverted to the twin's saved YAML.";
    window.location.reload();
  }
  /** Entities this twin has placed in a room. */
  private roomEntities(areaId: string) {
    return Object.entries(this.mapping?.entities ?? {})
      .filter(([, entity]) => entity.area === areaId)
      .map(([entityId]) => this.hass?.states[entityId])
      .filter((entity): entity is HassEntity => Boolean(entity));
  }
  /** Entities Home Assistant puts in the room's linked area. */
  private areaCandidates(areaId: string) {
    const haAreaId = this.mapping?.areas[areaId]?.ha_area_id ?? areaId;
    return Object.values(this.hass?.states ?? {}).filter(
      (entity) => this.entityAreas.get(entity.entity_id) === haAreaId,
    );
  }
  private displayName(entity: HassEntity) {
    return String(entity.attributes.friendly_name ?? entity.entity_id).replace(/\s+(on|off)$/i, "");
  }
  private async assignArea(entityId: string, areaId: string) {
    if (!this.hass) return;
    const haAreaId = this.mapping?.areas[areaId]?.ha_area_id ?? areaId;
    await this.hass.connection.sendMessagePromise({
      type: "config/entity_registry/update",
      entity_id: entityId,
      area_id: haAreaId,
    });
    this.entityAreas.set(entityId, haAreaId);
    this.editorMessage = `Assigned ${entityId} to ${this.areaLabel(areaId)} in Home Assistant.`;
    this.renderPanel();
  }
  private showObjectControls(entity: HassEntity) {
    const current = this.mapping?.entities[entity.entity_id];
    if (!current) return;
    this.houseScene?.highlightObject(current.object);
    this.selectedMappedEntityId = entity.entity_id;
    this.editorMessage = this.editMode
      ? `Selected ${this.displayName(entity)}. Drag it in the model, or use the move button.`
      : `Selected ${this.displayName(entity)}.`;
    this.renderPanel();
  }
  /** Arms a click-to-place gesture; the next canvas click positions this entity. */
  private startPlacement(entity: HassEntity, moving: boolean) {
    this.pendingEntity = entity;
    this.houseScene?.setPlacementMode(true);
    const verb = moving ? "new location" : "location";
    this.editorMessage = `Click the ${verb} in the model for ${this.displayName(entity)}, or press Escape to cancel.`;
    this.renderPanel();
  }
  private cancelPlacement() {
    if (!this.pendingEntity) return;
    this.pendingEntity = undefined;
    this.houseScene?.setPlacementMode(false);
    this.editorMessage = "Cancelled; nothing was moved.";
    this.renderPanel();
  }
  private placePendingEntity(event: MouseEvent) {
    if (!this.pendingEntity || !this.mapping || !(event.target instanceof HTMLCanvasElement))
      return;
    const position = this.houseScene?.pointOnFloor(event);
    if (!position) return;
    const entity = this.pendingEntity;
    this.pendingEntity = undefined;
    this.houseScene?.setPlacementMode(false);
    if (this.mapping.entities[entity.entity_id]) this.moveMappedEntity(entity, position);
    else this.createMappedEntity(entity, position);
    this.houseScene?.setEntities(this.mapping.entities);
    this.saveDraft();
    this.renderPanel();
  }
  /** Moves an existing placement horizontally, keeping its height and its model binding. */
  private moveMappedEntity(entity: HassEntity, [x, y, z]: [number, number, number]) {
    const mapped = this.mapping?.entities[entity.entity_id];
    if (!mapped) return;
    const requested: [number, number, number] = [x, mapped.position?.[1] ?? y, z];
    if (mapped.light) mapped.light.position = [x, mapped.light.position[1], z];
    if (mapped.door) this.shiftDoor(mapped.door, x, z);
    this.selectedMappedEntityId = entity.entity_id;
    const applied = this.houseScene?.moveEntity(entity.entity_id, requested);
    mapped.position = applied ?? requested;
    if (!applied) this.houseScene?.showDraftMarker(entity.entity_id, requested);
    this.houseScene?.highlightObject(mapped.object);
    this.houseScene?.syncEntity(entity.entity_id, entity.state);
    this.editorMessage = `Moved ${this.displayName(entity)} in this twin only; Home Assistant was unchanged.`;
  }
  private createMappedEntity(entity: HassEntity, position: [number, number, number]) {
    if (!this.mapping) return;
    const areaId = this.selectedArea ?? Object.keys(this.mapping.areas)[0];
    const mapped = {
      type: DOMAIN_TYPES[entity.entity_id.split(".")[0]] ?? "control",
      model: resolveDeviceKind(entity.entity_id, {
        name: this.displayName(entity),
        deviceClass: String(entity.attributes.device_class ?? ""),
      }),
      name: this.displayName(entity),
      area: areaId,
      position,
      object: `draft__${entity.entity_id}`,
    } satisfies HouseMapping["entities"][string];
    this.mapping.entities[entity.entity_id] = mapped;
    this.houseScene?.setEntities(this.mapping.entities);
    // The scene decides the mount height for the chosen model.
    mapped.position = this.houseScene?.showDraftMarker(entity.entity_id, position) ?? position;
    this.houseScene?.syncEntity(entity.entity_id, entity.state);
    this.editorMessage = `Placed ${this.displayName(entity)} in ${this.areaLabel(areaId)}.`;
  }
  /** Keeps a door's open and closed poses the same distance apart as it moves. */
  private shiftDoor(
    door: { open_position: [number, number, number]; closed_position: [number, number, number] },
    x: number,
    z: number,
  ) {
    const [dx, dz] = [x - door.closed_position[0], z - door.closed_position[2]];
    for (const key of ["open_position", "closed_position"] as const) {
      const point = door[key];
      door[key] = [point[0] + dx, point[1], point[2] + dz];
    }
  }
  private iconButton(icon: keyof typeof ICON_PATHS, tooltip: string, onClick: () => void) {
    const button = document.createElement("button");
    button.className = "icon-button";
    button.title = tooltip;
    button.setAttribute("aria-label", tooltip);
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", ICON_PATHS[icon]);
    svg.append(path);
    button.append(svg);
    button.onclick = onClick;
    return button;
  }
  /** Prefers the Home Assistant area name, falling back to a title-cased mapping key. */
  private areaLabel(areaId: string) {
    const haAreaId = this.mapping?.areas[areaId]?.ha_area_id ?? areaId;
    return (
      this.areaNames.get(haAreaId) ??
      areaId.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
    );
  }
}
