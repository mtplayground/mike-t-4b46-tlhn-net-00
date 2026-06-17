import { z } from "zod";

export const createSubscriptionRequestSchema = z
  .object({
    email: z
      .string()
      .trim()
      .email()
      .max(320)
      .transform((email) => email.toLowerCase()),
  })
  .strict();

export type CreateSubscriptionRequest = z.infer<typeof createSubscriptionRequestSchema>;

export interface SubscriptionResponse {
  email: string;
  subscribed: true;
  already_subscribed: boolean;
}
