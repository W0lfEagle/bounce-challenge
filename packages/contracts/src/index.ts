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

export const checkoutDetailsSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name.'),
  email: z.string().trim().pipe(z.email('Enter a valid email address.')),
  cardNumber: z.string()
    .regex(/^[0-9 ]+$/, 'Use only digits and spaces.')
    .transform((value) => value.replace(/ /g, ''))
    .pipe(z.string().regex(/^[0-9]{13,19}$/, 'Enter a card number with 13–19 digits.')),
});

export type CheckoutDetails = z.infer<typeof checkoutDetailsSchema>;
