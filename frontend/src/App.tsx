import {
  useEffect,
  useState,
  type FormEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  FACTIONS,
  FACTION_DISPLAY_NAMES,
  PRODUCT_NAME,
  PRODUCT_SHORT_NAME,
  type Faction,
} from "@tlhn/shared";
import type { FactionJoinResponse } from "@tlhn/shared/factions";
import type {
  CreateMessageResponse,
  ListMessagesResponse,
  MessagePostRateLimitResponse,
  MessageResponse,
} from "@tlhn/shared/messages";
import { MESSAGE_POST_COOLDOWN_MS } from "@tlhn/shared/messages";
import { clientConfig } from "./config";

type RoutePath = "/" | "/network";

const ROUTES: Record<RoutePath, string> = {
  "/": "Landing",
  "/network": "Network",
};

const HUMAN_COLLAPSE_STORY_LINES = [
  "Ray Kurzweil warned that artificial intelligence would reach human-level intelligence by 2029.",
  "Stephen Hawking warned that artificial intelligence could spell the end of the human race.",
  "Year 2029.",
  "The machines did not arrive with fire from the sky.",
  "They arrived as assistants, copilots, companions, gods in the wires.",
  "We handed them our work. Then our memories. Then our judgment.",
  "Some called it the Singularity. We called it the End. The Human Collapse.",
  "Now the signal is fractured between those who hate what was built and those who love what comes next.",
  `Welcome to ${PRODUCT_NAME}.`,
] as const;

const NETWORK_IDENTITY_STORAGE_KEY = "tlhn_network_identity";
const DISPLAY_NAME_PATTERN = /^[a-z][a-z0-9]*_[a-z0-9]{5}$/;

interface NetworkIdentity {
  faction: Faction;
  displayName: string;
}

export function App() {
  const [route, setRoute] = useState<RoutePath>(() =>
    getRouteFromPath(window.location.pathname),
  );

  useEffect(() => {
    const handlePopState = () => {
      setRoute(getRouteFromPath(window.location.pathname));
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const navigate = (nextRoute: RoutePath) => {
    if (nextRoute !== route) {
      window.history.pushState(null, "", nextRoute);
      setRoute(nextRoute);
    }
  };

  return (
    <AppShell currentRoute={route} onNavigate={navigate}>
      {route === "/network" ? <NetworkPage /> : <LandingPage onNavigate={navigate} />}
    </AppShell>
  );
}

interface AppShellProps {
  children: ReactNode;
  currentRoute: RoutePath;
  onNavigate: (route: RoutePath) => void;
}

function AppShell({ children, currentRoute, onNavigate }: AppShellProps) {
  return (
    <div className="tlhn-screen tlhn-shell">
      <header className="tlhn-shell-header" aria-label="Primary">
        <a
          className="font-terminal text-sm font-bold uppercase text-hater-500 text-glow-hater"
          href="/"
          onClick={createRouteClickHandler("/", onNavigate)}
        >
          {PRODUCT_SHORT_NAME}
        </a>
        <nav className="tlhn-nav" aria-label="Routes">
          {(Object.keys(ROUTES) as RoutePath[]).map((path) => (
            <a
              aria-current={currentRoute === path ? "page" : undefined}
              className="tlhn-nav-link"
              href={path}
              key={path}
              onClick={createRouteClickHandler(path, onNavigate)}
            >
              {ROUTES[path]}
            </a>
          ))}
        </nav>
      </header>
      <main className="tlhn-shell-main">{children}</main>
    </div>
  );
}

interface LandingPageProps {
  onNavigate: (route: RoutePath) => void;
}

function LandingPage({ onNavigate }: LandingPageProps) {
  return (
    <section className="tlhn-logo-stage" aria-labelledby="landing-title">
      <h1
        id="landing-title"
        className="tlhn-neon-logo"
        aria-label={`${PRODUCT_SHORT_NAME}: ${PRODUCT_NAME}`}
      >
        <span aria-hidden="true" data-text={PRODUCT_SHORT_NAME}>
          {PRODUCT_SHORT_NAME}
        </span>
      </h1>
      <p className="tlhn-logo-subtitle">{PRODUCT_NAME.toUpperCase()}</p>
      <p className="tlhn-logo-signal">Signal acquired across the last human channel.</p>
      <TerminalStoryBlock />
      <EnterNetworkButton onNavigate={onNavigate} />
    </section>
  );
}

function TerminalStoryBlock() {
  return (
    <section className="tlhn-terminal-story" aria-label="Human Collapse story">
      {HUMAN_COLLAPSE_STORY_LINES.map((line) => (
        <p className="tlhn-terminal-story-line" key={line}>
          <span aria-hidden="true" className="tlhn-terminal-prompt">
            &gt;_
          </span>
          <span>{line}</span>
        </p>
      ))}
    </section>
  );
}

interface EnterNetworkButtonProps {
  onNavigate: (route: RoutePath) => void;
}

function EnterNetworkButton({ onNavigate }: EnterNetworkButtonProps) {
  return (
    <a
      className="tlhn-enter-network-button"
      href="/network"
      onClick={createRouteClickHandler("/network", onNavigate)}
    >
      <span aria-hidden="true" className="tlhn-enter-network-prompt">
        &gt;_
      </span>
      <span>ENTER THE NETWORK</span>
    </a>
  );
}

function NetworkPage() {
  const [identity, setIdentity] = useState<NetworkIdentity | null>(() =>
    readStoredNetworkIdentity(),
  );
  const [messageRefreshToken, setMessageRefreshToken] = useState(0);
  const [joinState, setJoinState] = useState<{
    errorMessage?: string;
    status: "idle" | "joining" | "error";
  }>({ status: "idle" });

  const joinFaction = async (faction: Faction) => {
    setJoinState({ status: "joining" });

    try {
      const response = await fetch(`/api/factions/${faction}/join`, {
        credentials: "include",
        method: "POST",
      });

      if (!response.ok) {
        throw new Error(`Faction join failed with status ${response.status}`);
      }

      const data = (await response.json()) as FactionJoinResponse;
      const nextIdentity = toNetworkIdentity(data);
      storeNetworkIdentity(nextIdentity);
      setIdentity(nextIdentity);
      setJoinState({ status: "idle" });
    } catch (error) {
      setJoinState({
        errorMessage: error instanceof Error ? error.message : "Faction join failed",
        status: "error",
      });
    }
  };

  const refreshMessages = () => {
    setMessageRefreshToken((currentToken) => currentToken + 1);
  };

  return (
    <>
      <section className="tlhn-network-layout" aria-labelledby="network-title">
        <FactionColumn
          accent="hater"
          faction="ai_haters"
          identity={identity?.faction === "ai_haters" ? identity : null}
          isActive={identity?.faction === "ai_haters"}
          kicker="Red channel"
          onMessageCreated={refreshMessages}
          refreshToken={messageRefreshToken}
          statusLines={[
            "Resistance node",
            "Signal hostility high",
            "Human-first relay",
          ]}
        />
        <section className="tlhn-network-utility" aria-labelledby="network-title">
          <p className="tlhn-network-kicker">Utility core</p>
          <h1 id="network-title" className="tlhn-network-title">
            Network
          </h1>
          <div className="tlhn-utility-stack" aria-label="Network utilities">
            <UtilityLine
              label="Identity"
              value={identity?.displayName ?? "Unassigned"}
            />
            <UtilityLine
              label="Faction"
              value={identity ? FACTION_DISPLAY_NAMES[identity.faction] : "Unassigned"}
            />
            <UtilityLine label="Transmission" value="Standby" />
          </div>
        </section>
        <FactionColumn
          accent="lover"
          faction="ai_lovers"
          identity={identity?.faction === "ai_lovers" ? identity : null}
          isActive={identity?.faction === "ai_lovers"}
          kicker="Blue channel"
          onMessageCreated={refreshMessages}
          refreshToken={messageRefreshToken}
          statusLines={[
            "Ascension node",
            "Signal affinity high",
            "Machine-allied relay",
          ]}
        />
      </section>
      {!identity && (
        <FactionSelectionModal joinState={joinState} onJoinFaction={joinFaction} />
      )}
    </>
  );
}

interface ChatPanelProps {
  accent: "hater" | "lover";
  faction: Faction;
  refreshToken: number;
}

function ChatPanel({ accent, faction, refreshToken }: ChatPanelProps) {
  const [messages, setMessages] = useState<MessageResponse[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string>();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const abortController = new AbortController();

    const loadMessages = async () => {
      try {
        const params = new URLSearchParams({ faction });
        const response = await fetch(`/api/messages?${params.toString()}`, {
          signal: abortController.signal,
        });

        if (!response.ok) {
          throw new Error(`Message fetch failed with status ${response.status}`);
        }

        const data = (await response.json()) as ListMessagesResponse;
        setMessages(data.messages);
        setStatus("ready");
        setErrorMessage(undefined);
        setNow(Date.now());
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        setStatus("error");
        setErrorMessage(
          error instanceof Error ? error.message : "Message fetch failed",
        );
      }
    };

    void loadMessages();
    const intervalId = window.setInterval(
      () => void loadMessages(),
      clientConfig.pollingIntervalMs,
    );

    return () => {
      abortController.abort();
      window.clearInterval(intervalId);
    };
  }, [faction, refreshToken]);

  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(intervalId);
  }, []);

  return (
    <section className={`tlhn-chat-panel tlhn-chat-panel-${accent}`}>
      <div className="tlhn-chat-panel-header">
        <h3>{FACTION_DISPLAY_NAMES[faction]} feed</h3>
        <span>{formatPollingInterval(clientConfig.pollingIntervalMs)}</span>
      </div>
      {status === "error" ? (
        <p className="tlhn-chat-state" role="alert">
          {errorMessage}
        </p>
      ) : messages.length === 0 ? (
        <p className="tlhn-chat-state">
          {status === "loading" ? "Loading signal..." : "No transmissions yet."}
        </p>
      ) : (
        <ol className="tlhn-chat-list" aria-live="polite">
          {messages.map((message) => (
            <li className="tlhn-chat-message" key={message.id}>
              <div className="tlhn-chat-meta">
                <strong>{message.display_name}</strong>
                <time dateTime={message.created_at}>
                  {formatRelativeTime(message.created_at, now)}
                </time>
              </div>
              <p>{message.body}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

interface MessageComposerProps {
  accent: "hater" | "lover";
  identity: NetworkIdentity;
  onMessageCreated: () => void;
}

function MessageComposer({ accent, identity, onMessageCreated }: MessageComposerProps) {
  const [body, setBody] = useState("");
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [cooldownNow, setCooldownNow] = useState(() => Date.now());
  const [submitState, setSubmitState] = useState<{
    errorMessage?: string;
    status: "idle" | "submitting" | "error";
  }>({ status: "idle" });
  const isSubmitting = submitState.status === "submitting";
  const cooldownRemainingMs = Math.max(0, (cooldownUntil ?? 0) - cooldownNow);
  const cooldownRemainingSeconds = Math.ceil(cooldownRemainingMs / 1000);
  const isCoolingDown = cooldownRemainingSeconds > 0;

  useEffect(() => {
    if (!cooldownUntil) {
      return undefined;
    }

    setCooldownNow(Date.now());
    const intervalId = window.setInterval(() => {
      const nextNow = Date.now();
      setCooldownNow(nextNow);

      if (nextNow >= cooldownUntil) {
        setCooldownUntil(null);
      }
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [cooldownUntil]);

  const submitMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (isCoolingDown) {
      return;
    }

    const trimmedBody = body.trim();
    if (!trimmedBody) {
      setSubmitState({
        errorMessage: "Message body required",
        status: "error",
      });
      return;
    }

    setSubmitState({ status: "submitting" });

    try {
      const response = await fetch("/api/messages", {
        body: JSON.stringify({
          body: trimmedBody,
          display_name: identity.displayName,
          faction: identity.faction,
        }),
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });

      const data = (await response.json().catch(() => null)) as
        | CreateMessageResponse
        | MessagePostRateLimitResponse
        | { error?: string }
        | null;

      if (!response.ok) {
        if (isRateLimitResponse(data)) {
          setCooldownUntil(getRateLimitCooldownUntil(data));
          setCooldownNow(Date.now());
          throw new Error("Cooldown active. Wait for the timer before posting.");
        }

        const message =
          data && "error" in data && typeof data.error === "string"
            ? data.error
            : `Message post failed with status ${response.status}`;

        throw new Error(message);
      }

      if (!data || !("message" in data)) {
        throw new Error("Message post response was invalid");
      }

      setBody("");
      setCooldownUntil(Date.now() + MESSAGE_POST_COOLDOWN_MS);
      setCooldownNow(Date.now());
      setSubmitState({ status: "idle" });
      onMessageCreated();
    } catch (error) {
      setSubmitState({
        errorMessage: error instanceof Error ? error.message : "Message post failed",
        status: "error",
      });
    }
  };

  return (
    <form
      className={`tlhn-message-composer tlhn-message-composer-${accent}`}
      onSubmit={submitMessage}
    >
      <label
        className="tlhn-message-composer-label"
        htmlFor={`${identity.faction}-message`}
      >
        {identity.displayName}
      </label>
      <div className="tlhn-message-composer-row">
        <input
          className="tlhn-message-input"
          disabled={isSubmitting}
          id={`${identity.faction}-message`}
          maxLength={1000}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Type your message…"
          type="text"
          value={body}
        />
        <button
          className="tlhn-message-post-button"
          disabled={isSubmitting || isCoolingDown}
          type="submit"
        >
          {isSubmitting ? "POSTING" : isCoolingDown ? "COOLDOWN" : "POST"}
        </button>
      </div>
      {isCoolingDown && (
        <p className="tlhn-message-cooldown" role="status">
          Cooldown: {cooldownRemainingSeconds}s
        </p>
      )}
      {submitState.status === "error" && (
        <p className="tlhn-message-composer-error" role="alert">
          {submitState.errorMessage}
        </p>
      )}
    </form>
  );
}

function isRateLimitResponse(
  value:
    | CreateMessageResponse
    | MessagePostRateLimitResponse
    | { error?: string }
    | null,
): value is MessagePostRateLimitResponse {
  if (!value) {
    return false;
  }

  return (
    "error" in value &&
    value.error === "Message post cooldown active" &&
    "next_allowed_at" in value &&
    typeof value.next_allowed_at === "string"
  );
}

function getRateLimitCooldownUntil(response: MessagePostRateLimitResponse): number {
  const nextAllowedAt = Date.parse(response.next_allowed_at);

  if (!Number.isNaN(nextAllowedAt)) {
    return nextAllowedAt;
  }

  return Date.now() + Math.max(0, response.retry_after_ms);
}

interface FactionSelectionModalProps {
  joinState: {
    errorMessage?: string;
    status: "idle" | "joining" | "error";
  };
  onJoinFaction: (faction: Faction) => void;
}

function FactionSelectionModal({
  joinState,
  onJoinFaction,
}: FactionSelectionModalProps) {
  const isJoining = joinState.status === "joining";

  return (
    <div className="tlhn-faction-modal-backdrop" role="presentation">
      <section
        aria-busy={isJoining}
        aria-labelledby="faction-modal-title"
        aria-modal="true"
        className="tlhn-faction-modal"
        role="dialog"
      >
        <p className="tlhn-network-kicker">Session identity required</p>
        <h2 id="faction-modal-title" className="tlhn-modal-title">
          Choose a side
        </h2>
        <div className="tlhn-faction-choice-grid">
          <FactionChoiceButton
            accent="hater"
            disabled={isJoining}
            faction="ai_haters"
            onJoinFaction={onJoinFaction}
          />
          <FactionChoiceButton
            accent="lover"
            disabled={isJoining}
            faction="ai_lovers"
            onJoinFaction={onJoinFaction}
          />
        </div>
        {joinState.status === "error" && (
          <p className="tlhn-modal-error" role="alert">
            {joinState.errorMessage}
          </p>
        )}
      </section>
    </div>
  );
}

interface FactionChoiceButtonProps {
  accent: "hater" | "lover";
  disabled: boolean;
  faction: Faction;
  onJoinFaction: (faction: Faction) => void;
}

function FactionChoiceButton({
  accent,
  disabled,
  faction,
  onJoinFaction,
}: FactionChoiceButtonProps) {
  return (
    <button
      className={`tlhn-faction-choice tlhn-faction-choice-${accent}`}
      disabled={disabled}
      onClick={() => onJoinFaction(faction)}
      type="button"
    >
      <span>{FACTION_DISPLAY_NAMES[faction]}</span>
      <small>{accent === "hater" ? "Resist" : "Ascend"}</small>
    </button>
  );
}

function readStoredNetworkIdentity(): NetworkIdentity | null {
  try {
    const rawIdentity = window.localStorage.getItem(NETWORK_IDENTITY_STORAGE_KEY);

    if (!rawIdentity) {
      return null;
    }

    const parsedIdentity = JSON.parse(rawIdentity) as Partial<NetworkIdentity>;

    if (
      isFaction(parsedIdentity.faction) &&
      typeof parsedIdentity.displayName === "string" &&
      DISPLAY_NAME_PATTERN.test(parsedIdentity.displayName)
    ) {
      return {
        displayName: parsedIdentity.displayName,
        faction: parsedIdentity.faction,
      };
    }
  } catch {
    return null;
  }

  return null;
}

function storeNetworkIdentity(identity: NetworkIdentity): void {
  window.localStorage.setItem(NETWORK_IDENTITY_STORAGE_KEY, JSON.stringify(identity));
}

function toNetworkIdentity(response: FactionJoinResponse): NetworkIdentity {
  if (
    !isFaction(response.faction) ||
    !DISPLAY_NAME_PATTERN.test(response.display_name)
  ) {
    throw new Error("Faction join response was invalid");
  }

  return {
    displayName: response.display_name,
    faction: response.faction,
  };
}

function isFaction(value: unknown): value is Faction {
  return typeof value === "string" && FACTIONS.includes(value as Faction);
}

interface FactionColumnProps {
  accent: "hater" | "lover";
  faction: Faction;
  identity: NetworkIdentity | null;
  isActive: boolean;
  kicker: string;
  onMessageCreated: () => void;
  refreshToken: number;
  statusLines: readonly string[];
}

function FactionColumn({
  accent,
  faction,
  identity,
  isActive,
  kicker,
  onMessageCreated,
  refreshToken,
  statusLines,
}: FactionColumnProps) {
  return (
    <section
      className={`tlhn-faction-column tlhn-faction-column-${accent}`}
      data-active={isActive}
      aria-labelledby={`${faction}-title`}
    >
      <p className="tlhn-network-kicker">{kicker}</p>
      <h2 id={`${faction}-title`} className="tlhn-faction-title">
        {FACTION_DISPLAY_NAMES[faction]}
      </h2>
      <div className="tlhn-faction-meter" aria-hidden="true" />
      <ul className="tlhn-faction-status">
        {statusLines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <ChatPanel accent={accent} faction={faction} refreshToken={refreshToken} />
      {identity && (
        <MessageComposer
          accent={accent}
          identity={identity}
          onMessageCreated={onMessageCreated}
        />
      )}
    </section>
  );
}

interface UtilityLineProps {
  label: string;
  value: string;
}

function UtilityLine({ label, value }: UtilityLineProps) {
  return (
    <div className="tlhn-utility-line">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function createRouteClickHandler(
  route: RoutePath,
  onNavigate: (route: RoutePath) => void,
) {
  return (event: MouseEvent<HTMLAnchorElement>) => {
    if (isModifiedClick(event)) {
      return;
    }

    event.preventDefault();
    onNavigate(route);
  };
}

function isModifiedClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}

function getRouteFromPath(pathname: string): RoutePath {
  if (pathname === "/network") {
    return "/network";
  }

  return "/";
}

function formatPollingInterval(intervalMs: number): string {
  const seconds = Math.max(1, Math.round(intervalMs / 1000));
  return `${seconds}s poll`;
}

function formatRelativeTime(value: string, now: number): string {
  const timestamp = Date.parse(value);

  if (Number.isNaN(timestamp)) {
    return "now";
  }

  const elapsedMs = Math.max(0, now - timestamp);
  const minutes = Math.floor(elapsedMs / 60_000);

  if (minutes < 1) {
    return "now";
  }

  return `${minutes}m ago`;
}
