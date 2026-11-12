import { z } from 'zod';

export const bodySchema = z.union([
  z.strictObject({ json: z.json() }),
  z.strictObject({ text: z.string() }),
]);

export const requestSchema = z.strictObject({
  method: z
    .string()
    .regex(/^[A-Z]+$/, 'method must be uppercase letters, e.g. GET')
    .default('GET'),
  url: z.string().min(1),
  headers: z.record(z.string(), z.string()).default({}),
  body: bodySchema.optional(),
  followRedirects: z.boolean().optional(),
  insecure: z.boolean().optional(),
  compressed: z.boolean().optional(),
  timeoutMs: z.number().positive().optional(),
});

export type RequestSpec = z.infer<typeof requestSchema>;
