import { z } from 'zod';

export const storeParamsSchema = z.object({
  storeId: z.string().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
});

export const checkoutItemSchema = z.object({
  id: z.literal('bag'),
  name: z.string().min(1),
  unitPriceCents: z.number().int().positive(),
  minQuantity: z.number().int().positive(),
  maxQuantity: z.number().int().positive(),
}).refine((item) => item.maxQuantity >= item.minQuantity, {
  message: 'Maximum quantity must be at least the minimum quantity',
  path: ['maxQuantity'],
});

export const storeSchema = z.object({
  id: storeParamsSchema.shape.storeId,
  name: z.string().min(1),
  currency: z.literal('USD'),
  checkoutItems: z.array(checkoutItemSchema).min(1),
});

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.enum(['INVALID_STORE_ID', 'NOT_FOUND', 'INTERNAL_ERROR']),
    message: z.string(),
  }),
});

export type Store = z.infer<typeof storeSchema>;
export type CheckoutItem = z.infer<typeof checkoutItemSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
