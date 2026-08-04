import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { loadMapping } from "../mapping/loader";
import type { HouseMapping } from "../mapping/schema";
import type { HomeAssistant } from "../home-assistant/types";
import { HouseScene } from "../renderer/scene";
import "../ui/area-drawer";

@customElement("hass-digital-twin-panel")
export class HousePanel extends LitElement {
  @property({ attribute: false }) hass?: HomeAssistant; @property({ type: Boolean }) narrow = false; @property({ attribute: false }) panel?: { config?: { mappingUrl?: string } };
  @state() private error?: string; private mapping?: HouseMapping; private houseScene?: HouseScene;
  static styles = css`:host { display:grid; grid-template-columns:minmax(0,1fr) 320px; height:100%; background:#101827; } #scene { min-width:0; } aside { background:var(--card-background-color, #182234); overflow:auto; } @media (max-width: 800px) { :host { grid-template-columns:1fr; grid-template-rows:1fr auto; } aside { max-height:35vh; } }`;
  firstUpdated() { void this.initialize(); }
  disconnectedCallback() { this.houseScene?.dispose(); super.disconnectedCallback(); }
  render() { return html`<main id="scene">${this.error ? html`<p>${this.error}</p>` : ""}</main><aside><house-area-drawer></house-area-drawer></aside>`; }
  private async initialize() {
    const host = this.renderRoot.querySelector<HTMLElement>("#scene"); if (!host) return;
    this.houseScene = new HouseScene(host); host.append(this.houseScene.canvas); this.houseScene.start();
    try { this.mapping = await loadMapping(this.panel?.config?.mappingUrl ?? "/hass_digital_twin/house.yaml"); await this.houseScene.load(this.mapping.model); }
    catch (error) { this.error = error instanceof Error ? error.message : "Unable to initialize house model"; }
  }
}
