import type {
  AreaRegistryEntry,
  DeviceRegistryEntry,
  EntityRegistryEntry,
  HomeAssistant,
} from "./types";

export async function loadRegistries(hass: HomeAssistant) {
  const [areas, entities, devices] = await Promise.all([
    hass.connection.sendMessagePromise<AreaRegistryEntry[]>({ type: "config/area_registry/list" }),
    hass.connection.sendMessagePromise<EntityRegistryEntry[]>({
      type: "config/entity_registry/list",
    }),
    hass.connection.sendMessagePromise<DeviceRegistryEntry[]>({
      type: "config/device_registry/list",
    }),
  ]);
  return { areas, entities, devices };
}
