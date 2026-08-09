import type { HassEntity } from "../home-assistant/types";
export function lightIntensity(entity: HassEntity) {
  return entity.state === "on" ? Number(entity.attributes.brightness ?? 255) / 255 : 0;
}
