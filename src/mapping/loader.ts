import yaml from "js-yaml";
import { mappingSchema, twinCatalogSchema, type HouseMapping, type TwinCatalog } from "./schema";

export async function loadMapping(url: string): Promise<HouseMapping> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to load mapping: ${response.status}`);
  const raw = url.endsWith(".json") ? await response.json() : yaml.load(await response.text());
  return mappingSchema.parse(raw);
}

export async function loadTwinCatalog(url: string): Promise<TwinCatalog> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to load twin catalog: ${response.status}`);
  return twinCatalogSchema.parse(yaml.load(await response.text()));
}
