import { z } from "zod";

// Query-string bounding box used by the map data API routes
export const boundsSchema = z.object({
  left: z.coerce.number().min(-180).max(180),
  right: z.coerce.number().min(-180).max(180),
  bottom: z.coerce.number().min(-90).max(90),
  top: z.coerce.number().min(-90).max(90),
});

export type Bounds = z.infer<typeof boundsSchema>;

export function boundsSpanDegrees(bounds: Bounds): number {
  return Math.max(bounds.right - bounds.left, bounds.top - bounds.bottom);
}
