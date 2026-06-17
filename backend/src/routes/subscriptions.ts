import { Router, type Request, type Response } from "express";
import {
  createSubscriptionRequestSchema,
  type SubscriptionResponse,
} from "@tlhn/shared/subscriptions";
import type { AppDatabase } from "../db/client.js";
import { subscriptions } from "../db/schema.js";

export interface SubscriptionsRouterDependencies {
  db: AppDatabase;
}

export function createSubscriptionsRouter(
  dependencies: SubscriptionsRouterDependencies,
): Router {
  const router = Router();

  router.post("/", async (req: Request, res: Response, next) => {
    const body = createSubscriptionRequestSchema.safeParse(req.body);

    if (!body.success) {
      res.status(400).json({
        error: "Invalid subscription payload",
        issues: body.error.flatten().fieldErrors,
      });
      return;
    }

    try {
      const [created] = await dependencies.db
        .insert(subscriptions)
        .values({
          email: body.data.email,
        })
        .onConflictDoNothing({
          target: subscriptions.email,
        })
        .returning({
          email: subscriptions.email,
        });

      const response: SubscriptionResponse = {
        email: body.data.email,
        subscribed: true,
        already_subscribed: !created,
      };

      res.status(created ? 201 : 200).json(response);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
