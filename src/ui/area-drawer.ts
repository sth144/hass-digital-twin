import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { HassEntity } from "../home-assistant/types";
@customElement("house-area-drawer")
export class HouseAreaDrawer extends LitElement {
  @property() title = "Select a room"; @property({ attribute: false }) entities: HassEntity[] = [];
  static styles = css`:host { display:block; padding:16px; color:var(--primary-text-color); } h2 { margin:0 0 12px; } li { margin:8px 0; }`;
  render() { return html`<h2>${this.title}</h2>${this.entities.length ? html`<ul>${this.entities.map((entity) => html`<li>${entity.entity_id}: ${entity.state}</li>`)}</ul>` : html`<p>Click a mapped room to view its devices.</p>`}`; }
}
