import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Faction } from "@tlhn/shared";
import { readJson, startTestServer, type TestServer } from "./testSupport.js";

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
