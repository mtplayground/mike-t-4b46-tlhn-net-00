import { createServer, type Server } from "node:http";
import assert from "node:assert/strict";
import type { Faction } from "@tlhn/shared";
import { createApp } from "./app.js";
import type { AppDatabase } from "./db/client.js";
import { factionCounts, messages, subscriptions } from "./db/schema.js";
import { MessagePostRateLimiter } from "./services/messagePostRateLimit.js";

interface StoredMessage {
  id: number;
  faction: Faction;
  displayName: string;
  body: string;
  user: string | null;
  createdAt: Date;
}

export class TestDatabase {
  readonly factionCounts: Record<Faction, number> = {
    ai_haters: 0,
    ai_lovers: 0,
  };
  readonly messages: StoredMessage[] = [];
  readonly subscriptions = new Set<string>();
  private nextMessageId = 1;

  select(): TestSelectBuilder {
    return new TestSelectBuilder(this);
  }

  insert(table: unknown): TestInsertBuilder {
    return new TestInsertBuilder(this, table);
  }

  addMessage(value: {
    body: string;
    displayName: string;
    faction: Faction;
    user?: string | null;
  }): StoredMessage {
    const message: StoredMessage = {
      body: value.body,
      createdAt: new Date(Date.now() + this.nextMessageId),
      displayName: value.displayName,
      faction: value.faction,
      id: this.nextMessageId,
      user: value.user ?? null,
    };

    this.nextMessageId += 1;
    this.messages.push(message);

    return message;
  }
}

class TestSelectBuilder implements PromiseLike<unknown[]> {
  private beforeIdFilter?: number;
  private factionFilter?: Faction;
  private limitCount?: number;
  private selectedTable?: unknown;

  constructor(private readonly db: TestDatabase) {}

  from(table: unknown): this {
    this.selectedTable = table;
    return this;
  }

  where(condition: unknown): this {
    for (const value of getConditionParams(condition)) {
      if (isFaction(value)) {
        this.factionFilter = value;
      } else if (typeof value === "number") {
        this.beforeIdFilter = value;
      }
    }

    return this;
  }

  orderBy(): this {
    return this;
  }

  limit(limitCount: number): this {
    this.limitCount = limitCount;
    return this;
  }

  then<TResult1 = unknown[], TResult2 = never>(
    onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute(): Promise<unknown[]> {
    if (this.selectedTable === messages) {
      const rows = this.db.messages
        .filter(
          (message) => !this.factionFilter || message.faction === this.factionFilter,
        )
        .filter(
          (message) =>
            this.beforeIdFilter === undefined || message.id < this.beforeIdFilter,
        )
        .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());

      return rows.slice(0, this.limitCount ?? rows.length);
    }

    if (this.selectedTable === factionCounts) {
      return Object.entries(this.db.factionCounts).map(([faction, count]) => ({
        count,
        faction,
      }));
    }

    return [];
  }
}

class TestInsertBuilder {
  private insertedValue: Record<string, unknown> = {};
  private skipOnConflict = false;

  constructor(
    private readonly db: TestDatabase,
    private readonly insertedTable: unknown,
  ) {}

  values(value: Record<string, unknown>): this {
    this.insertedValue = value;
    return this;
  }

  onConflictDoNothing(): this {
    this.skipOnConflict = true;
    return this;
  }

  async onConflictDoUpdate(): Promise<void> {
    if (this.insertedTable === factionCounts && isFaction(this.insertedValue.faction)) {
      this.db.factionCounts[this.insertedValue.faction] += 1;
    }
  }

  async returning(): Promise<unknown[]> {
    if (this.insertedTable === messages) {
      return [
        this.db.addMessage({
          body: String(this.insertedValue.body),
          displayName: String(this.insertedValue.displayName),
          faction: assertFaction(this.insertedValue.faction),
          user:
            typeof this.insertedValue.user === "string"
              ? this.insertedValue.user
              : null,
        }),
      ];
    }

    if (this.insertedTable === subscriptions) {
      const email = String(this.insertedValue.email);
      if (this.db.subscriptions.has(email) && this.skipOnConflict) {
        return [];
      }

      this.db.subscriptions.add(email);
      return [{ email }];
    }

    return [];
  }
}

export interface TestServer {
  baseUrl: string;
  close: () => Promise<void>;
  db: TestDatabase;
}

export async function startTestServer(cooldownMs = 30_000): Promise<TestServer> {
  const db = new TestDatabase();
  const app = createApp({
    checkDatabaseHealth: async () => ({ latencyMs: 1, status: "ok" }),
    db: db as unknown as AppDatabase,
    messagePostRateLimiter: new MessagePostRateLimiter(cooldownMs),
  });
  const server = createServer(app);

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  const address = server.address();
  assert(address && typeof address === "object");

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => closeServer(server),
    db,
  };
}

export async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function getConditionParams(condition: unknown): unknown[] {
  const params: unknown[] = [];
  const seen = new WeakSet<object>();

  const visit = (value: unknown): void => {
    if (typeof value !== "object" || value === null || seen.has(value)) {
      return;
    }

    seen.add(value);

    if (value.constructor.name === "Param" && "value" in value) {
      params.push(value.value);
      return;
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        visit(entry);
      }
      return;
    }

    if ("queryChunks" in value) {
      visit(value.queryChunks);
    }
  };

  visit(condition);

  return params;
}

function assertFaction(value: unknown): Faction {
  assert(isFaction(value));
  return value;
}

function isFaction(value: unknown): value is Faction {
  return value === "ai_haters" || value === "ai_lovers";
}
