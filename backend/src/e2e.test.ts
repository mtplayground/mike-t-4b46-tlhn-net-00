import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Faction } from "@tlhn/shared";
import { readJson, startTestServer, type TestServer } from "./testSupport.js";

describe("network end-to-end flow", () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await startTestServer();
  });

  afterEach(async () => {
    await server.close();
  });

  it("joins a faction, posts once, hits cooldown, polls the message, subscribes, and updates tallies", async () => {
    const initialCountsResponse = await fetch(`${server.baseUrl}/api/factions/counts`);
    assert.equal(initialCountsResponse.status, 200);
    assert.deepEqual(await readJson(initialCountsResponse), {
      counts: { ai_haters: 0, ai_lovers: 0 },
    });

    const joinResponse = await fetch(`${server.baseUrl}/api/factions/ai_haters/join`, {
      method: "POST",
    });
    assert.equal(joinResponse.status, 200);
    const joined = await readJson<{
      already_joined: boolean;
      counts: Record<Faction, number>;
      display_name: string;
      faction: Faction;
      joined: boolean;
    }>(joinResponse);

    assert.equal(joined.joined, true);
    assert.equal(joined.already_joined, false);
    assert.equal(joined.faction, "ai_haters");
    assert.match(joined.display_name, /^[a-z][a-z0-9]*_[a-z0-9]{5}$/);
    assert.deepEqual(joined.counts, { ai_haters: 1, ai_lovers: 0 });

    const joinCookie = joinResponse.headers.get("set-cookie");
    assert(joinCookie);

    const messageBody = "End-to-end human signal.";
    const messageHeaders = {
      "Content-Type": "application/json",
      "x-forwarded-for": "192.0.2.24",
    };
    const messagePayload = {
      body: messageBody,
      display_name: joined.display_name,
      faction: joined.faction,
    };
    const createdMessageResponse = await fetch(`${server.baseUrl}/api/messages`, {
      body: JSON.stringify(messagePayload),
      headers: messageHeaders,
      method: "POST",
    });

    assert.equal(createdMessageResponse.status, 201);
    const createdMessage = await readJson<{
      message: {
        body: string;
        display_name: string;
        faction: Faction;
      };
    }>(createdMessageResponse);
    assert.equal(createdMessage.message.body, messageBody);
    assert.equal(createdMessage.message.display_name, joined.display_name);
    assert.equal(createdMessage.message.faction, "ai_haters");

    const cooldownResponse = await fetch(`${server.baseUrl}/api/messages`, {
      body: JSON.stringify({ ...messagePayload, body: "Too soon." }),
      headers: messageHeaders,
      method: "POST",
    });
    assert.equal(cooldownResponse.status, 429);
    assert.equal(cooldownResponse.headers.get("retry-after"), "30");
    const cooldown = await readJson<{
      error: string;
      retry_after_seconds: number;
    }>(cooldownResponse);
    assert.equal(cooldown.error, "Message post cooldown active");
    assert.equal(cooldown.retry_after_seconds, 30);

    const messagesResponse = await fetch(
      `${server.baseUrl}/api/messages?faction=ai_haters`,
    );
    assert.equal(messagesResponse.status, 200);
    const listedMessages = await readJson<{
      has_more: boolean;
      messages: Array<{
        body: string;
        display_name: string;
        faction: Faction;
      }>;
    }>(messagesResponse);
    assert.equal(listedMessages.has_more, false);
    assert.equal(listedMessages.messages.length, 1);
    assert.equal(listedMessages.messages[0]?.body, messageBody);
    assert.equal(listedMessages.messages[0]?.display_name, joined.display_name);
    assert.equal(listedMessages.messages[0]?.faction, "ai_haters");

    const subscriptionResponse = await fetch(`${server.baseUrl}/api/subscriptions`, {
      body: JSON.stringify({ email: "Flow@Human.NET" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    assert.equal(subscriptionResponse.status, 201);
    assert.deepEqual(await readJson(subscriptionResponse), {
      already_subscribed: false,
      email: "flow@human.net",
      subscribed: true,
    });

    const repeatSubscriptionResponse = await fetch(
      `${server.baseUrl}/api/subscriptions`,
      {
        body: JSON.stringify({ email: "flow@human.net" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      },
    );
    assert.equal(repeatSubscriptionResponse.status, 200);
    assert.deepEqual(await readJson(repeatSubscriptionResponse), {
      already_subscribed: true,
      email: "flow@human.net",
      subscribed: true,
    });

    const finalCountsResponse = await fetch(`${server.baseUrl}/api/factions/counts`, {
      headers: { cookie: joinCookie },
    });
    assert.equal(finalCountsResponse.status, 200);
    assert.deepEqual(await readJson(finalCountsResponse), {
      counts: { ai_haters: 1, ai_lovers: 0 },
    });
  });

  it("pages through more than 25 faction messages newest-first", async () => {
    for (let index = 1; index <= 28; index += 1) {
      server.db.addMessage({
        body: `Paged signal ${index}`,
        displayName: "sentinel_pg001",
        faction: "ai_haters",
      });
    }

    const firstPageResponse = await fetch(
      `${server.baseUrl}/api/messages?faction=ai_haters`,
    );

    assert.equal(firstPageResponse.status, 200);
    const firstPage = await readJson<{
      has_more: boolean;
      messages: Array<{ body: string; id: number }>;
    }>(firstPageResponse);
    assert.equal(firstPage.has_more, true);
    assert.equal(firstPage.messages.length, 25);
    assert.equal(firstPage.messages[0]?.body, "Paged signal 28");
    assert.equal(firstPage.messages.at(-1)?.body, "Paged signal 4");

    const beforeId = firstPage.messages.at(-1)?.id;
    assert(beforeId);

    const secondPageResponse = await fetch(
      `${server.baseUrl}/api/messages?faction=ai_haters&before_id=${beforeId}`,
    );

    assert.equal(secondPageResponse.status, 200);
    const secondPage = await readJson<{
      has_more: boolean;
      messages: Array<{ body: string }>;
    }>(secondPageResponse);
    assert.equal(secondPage.has_more, false);
    assert.deepEqual(
      secondPage.messages.map((message) => message.body),
      ["Paged signal 3", "Paged signal 2", "Paged signal 1"],
    );
  });
});
