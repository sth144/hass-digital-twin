import yaml from "js-yaml";
import { mappingSchema, type HouseMapping } from "./schema";

export async function loadMapping(url: string): Promise<HouseMapping> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to load mapping: ${response.status}`);
  const raw = url.endsWith(".json") ? await response.json() : yaml.load(await response.text());
  return mappingSchema.parse(raw);
}
