import { z } from "zod";
import { DEVICE_KINDS } from "../renderer/device-models";

const vector3 = z.tuple([z.number(), z.number(), z.number()]);
const point2 = z.tuple([z.number(), z.number()]);
export const mappingSchema = z.object({
  model: z.string().min(1),
  background: z.string().optional(),
  /** Opening view for this twin; the model is framed automatically when omitted. */
  camera: z.object({ position: vector3, target: vector3 }).optional(),
  areas: z
    .record(
      z.string(),
      z.object({
        ha_area_id: z.string().optional(),
        objects: z.array(z.string()).default([]),
        polygon: z.array(point2).min(3).optional(),
        camera: z.object({ position: vector3, target: vector3 }).optional(),
      }),
    )
    .default({}),
  entities: z
    .record(
      z.string(),
      z.object({
        type: z.enum(["light", "switch", "camera", "control", "sensor"]),
        /** Which procedural device model to draw; inferred from the entity when omitted. */
        model: z.enum(DEVICE_KINDS).optional(),
        /** Degrees to rotate the device model about Y; 0 faces +Z. */
        yaw: z.number().optional(),
        name: z.string().optional(),
        area: z.string().optional(),
        object: z.string().optional(),
        position: vector3.optional(),
        action: z.enum(["toggle", "more-info"]).optional(),
        preview: z.enum(["hover", "tap"]).optional(),
        light: z
          .object({
            position: vector3,
            radius: z.number().positive(),
            intensity_scale: z.number().positive().default(1),
          })
          .optional(),
        door: z.object({ open_position: vector3, closed_position: vector3 }).optional(),
      }),
    )
    .default({}),
});
export type HouseMapping = z.infer<typeof mappingSchema>;

export const twinCatalogSchema = z.object({
  twins: z
    .array(z.object({ id: z.string().min(1), name: z.string().min(1), mapping: z.string().min(1) }))
    .min(1),
});
export type TwinCatalog = z.infer<typeof twinCatalogSchema>;
