import { z } from "zod";

const vector3 = z.tuple([z.number(), z.number(), z.number()]);
export const mappingSchema = z.object({
  model: z.string().min(1),
  areas: z.record(z.string(), z.object({ objects: z.array(z.string()).min(1), camera: z.object({ position: vector3, target: vector3 }).optional() })).default({}),
  entities: z.record(z.string(), z.object({
    type: z.enum(["light", "switch", "camera", "control"]), area: z.string().optional(), object: z.string().optional(),
    action: z.enum(["toggle", "more-info"]).optional(), preview: z.enum(["hover", "tap"]).optional(),
    light: z.object({ position: vector3, radius: z.number().positive(), intensity_scale: z.number().positive().default(1) }).optional(),
  })).default({}),
});
export type HouseMapping = z.infer<typeof mappingSchema>;
