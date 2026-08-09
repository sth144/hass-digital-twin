import type { HomeAssistant } from "./types";
export function toggleEntity(hass: HomeAssistant, entityId: string) {
  return hass.callService("homeassistant", "toggle", { entity_id: entityId });
}
