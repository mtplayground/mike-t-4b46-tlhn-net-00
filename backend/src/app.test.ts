import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AppDatabase } from "./db/client.js";
import { factionCounts, messages, subscriptions } from "./db/schema.js";
import { createApp } from "./app.js";
import { MessagePostRateLimiter } from "./services/messagePostRateLimit.js";
import type { Faction } from "@tlhn/shared";

interface StoredMessage {
  id: number;
  faction: Faction;
  displayName: string;
  body: string;
  user: string | null;
  createdAt: Date;
}

class TestDatabase {
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
  private factionFilter?: Faction;
  private limitCount?: number;
  private selectedTable?: unknown;

  constructor(private readonly db: TestDatabase) {}

  from(table: unknown): this {
    this.selectedTable = table;
    return this;
  }

  where(condition: unknown): this {
    const value = getFirstConditionParam(condition);
    if (isFaction(value)) {
      this.factionFilter = value;
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

interface TestServer {
  baseUrl: string;
  close: () => Promise<void>;
  db: TestDatabase;
}

async function startTestServer(): Promise<TestServer> {
  const db = new TestDatabase();
  const app = createApp({
    checkDatabaseHealth: async () => ({ latencyMs: 1, status: "ok" }),
    db: db as unknown as AppDatabase,
    messagePostRateLimiter: new MessagePostRateLimiter(30_000),
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

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

function getFirstConditionParam(condition: unknown): unknown {
  if (
    typeof condition === "object" &&
    condition !== null &&
    "queryChunks" in condition &&
    Array.isArray(condition.queryChunks)
  ) {
    return condition.queryChunks.find((chunk) => {
      return (
        typeof chunk === "object" &&
        chunk !== null &&
        chunk.constructor.name === "Param"
      );
    })?.value;
  }

  return undefined;
}

function assertFaction(value: unknown): Faction {
  assert(isFaction(value));
  return value;
}

function isFaction(value: unknown): value is Faction {
  return value === "ai_haters" || value === "ai_lovers";
}

describe("backend API", () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await startTestServer();
  });

  afterEach(async () => {
    await server.close();
  });

  it("creates and lists messages by faction", async () => {
    const createdResponse = await fetch(`${server.baseUrl}/api/messages`, {
      body: JSON.stringify({
        body: "Keep the humans online.",
        display_name: "signal_ab123",
        faction: "ai_haters",
      }),
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": "198.51.100.10",
      },
      method: "POST",
    });

    assert.equal(createdResponse.status, 201);
    const created = await readJson<{
      message: {
        body: string;
        display_name: string;
        faction: Faction;
        user: string | null;
      };
    }>(createdResponse);
    assert.equal(created.message.body, "Keep the humans online.");
    assert.equal(created.message.display_name, "signal_ab123");
    assert.equal(created.message.faction, "ai_haters");
    assert.equal(created.message.user, null);

    server.db.addMessage({
      body: "Blue channel only.",
      displayName: "oracle_cd456",
      faction: "ai_lovers",
    });

    const listedResponse = await fetch(
      `${server.baseUrl}/api/messages?faction=ai_haters`,
    );

    assert.equal(listedResponse.status, 200);
    const listed = await readJson<{
      messages: Array<{ body: string; faction: Faction }>;
    }>(listedResponse);
    assert.deepEqual(
      listed.messages.map((message) => message.faction),
      ["ai_haters"],
    );
  });

  it("rejects invalid message payloads and rate limits repeated posts", async () => {
    const invalidResponse = await fetch(`${server.baseUrl}/api/messages`, {
      body: JSON.stringify({
        body: "",
        display_name: "signal_ab123",
        faction: "ai_haters",
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    assert.equal(invalidResponse.status, 400);

    const headers = {
      "Content-Type": "application/json",
      "x-forwarded-for": "203.0.113.22",
    };
    const payload = {
      body: "First transmission.",
      display_name: "signal_ab123",
      faction: "ai_haters",
    };
    const firstResponse = await fetch(`${server.baseUrl}/api/messages`, {
      body: JSON.stringify(payload),
      headers,
      method: "POST",
    });
    const secondResponse = await fetch(`${server.baseUrl}/api/messages`, {
      body: JSON.stringify({ ...payload, body: "Too soon." }),
      headers,
      method: "POST",
    });

    assert.equal(firstResponse.status, 201);
    assert.equal(secondResponse.status, 429);
    const rateLimit = await readJson<{
      error: string;
      retry_after_seconds: number;
    }>(secondResponse);
    assert.equal(rateLimit.error, "Message post cooldown active");
    assert.equal(rateLimit.retry_after_seconds, 30);
  });

  it("returns faction counts and increments once per session", async () => {
    const initialResponse = await fetch(`${server.baseUrl}/api/factions/counts`);
    assert.equal(initialResponse.status, 200);
    assert.deepEqual(await readJson(initialResponse), {
      counts: { ai_haters: 0, ai_lovers: 0 },
    });

    const joinResponse = await fetch(`${server.baseUrl}/api/factions/ai_lovers/join`, {
      method: "POST",
    });
    assert.equal(joinResponse.status, 200);
    const joined = await readJson<{
      already_joined: boolean;
      counts: Record<Faction, number>;
      display_name: string;
      faction: Faction;
    }>(joinResponse);
    assert.equal(joined.already_joined, false);
    assert.equal(joined.faction, "ai_lovers");
    assert.match(joined.display_name, /^[a-z][a-z0-9]*_[a-z0-9]{5}$/);
    assert.deepEqual(joined.counts, { ai_haters: 0, ai_lovers: 1 });

    const cookie = joinResponse.headers.get("set-cookie");
    assert(cookie);
    const repeatJoinResponse = await fetch(
      `${server.baseUrl}/api/factions/ai_haters/join`,
      {
        headers: { cookie },
        method: "POST",
      },
    );
    const repeatJoin = await readJson<{
      already_joined: boolean;
      counts: Record<Faction, number>;
      faction: Faction;
    }>(repeatJoinResponse);

    assert.equal(repeatJoinResponse.status, 200);
    assert.equal(repeatJoin.already_joined, true);
    assert.equal(repeatJoin.faction, "ai_lovers");
    assert.deepEqual(repeatJoin.counts, { ai_haters: 0, ai_lovers: 1 });
  });

  it("validates and deduplicates subscriptions", async () => {
    const invalidResponse = await fetch(`${server.baseUrl}/api/subscriptions`, {
      body: JSON.stringify({ email: "not-an-email" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    assert.equal(invalidResponse.status, 400);

    const firstResponse = await fetch(`${server.baseUrl}/api/subscriptions`, {
      body: JSON.stringify({ email: "Human@Signal.NET" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const secondResponse = await fetch(`${server.baseUrl}/api/subscriptions`, {
      body: JSON.stringify({ email: "human@signal.net" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    assert.equal(firstResponse.status, 201);
    assert.equal(secondResponse.status, 200);
    assert.deepEqual(await readJson(firstResponse), {
      already_subscribed: false,
      email: "human@signal.net",
      subscribed: true,
    });
    assert.deepEqual(await readJson(secondResponse), {
      already_subscribed: true,
      email: "human@signal.net",
      subscribed: true,
    });
  });
});
