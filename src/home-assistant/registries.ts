import type { AreaRegistryEntry, EntityRegistryEntry, HomeAssistant } from "./types";

export async function loadRegistries(hass: HomeAssistant) {
  const [areas, entities] = await Promise.all([
    hass.connection.sendMessagePromise<AreaRegistryEntry[]>({ type: "config/area_registry/list" }),
    hass.connection.sendMessagePromise<EntityRegistryEntry[]>({ type: "config/entity_registry/list" }),
  ]);
  return { areas, entities };
}
