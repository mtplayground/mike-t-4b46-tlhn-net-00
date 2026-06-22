import {
  useEffect,
  useRef,
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
import type {
  FactionCounts,
  FactionCountsResponse,
  FactionJoinResponse,
} from "@tlhn/shared/factions";
import type {
  CreateMessageResponse,
  ListMessagesResponse,
  MessagePostFrequencyLimitResponse,
  MessagePostRateLimitResponse,
  MessageResponse,
} from "@tlhn/shared/messages";
import type { SubscriptionResponse } from "@tlhn/shared/subscriptions";
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
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CHAT_PAGE_SIZE = 25;
const CHAT_HISTORY_SCROLL_THRESHOLD_PX = 48;
const CHAT_BOTTOM_SCROLL_THRESHOLD_PX = 80;
const MESSAGE_POST_FREQUENCY_LIMIT_NOTICE_MS = 1_500;
const MESSAGE_COLLAPSE_THRESHOLD_CHARS = 256;
const INITIAL_FACTION_COUNTS: FactionCounts = {
  ai_haters: 0,
  ai_lovers: 0,
};

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
          className="font-terminal text-lg font-bold uppercase text-hater-500 text-glow-hater sm:text-xl"
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
  const [factionCounts, setFactionCounts] =
    useState<FactionCounts>(INITIAL_FACTION_COUNTS);
  const [countsState, setCountsState] = useState<{
    errorMessage?: string;
    status: "loading" | "ready" | "error";
  }>({ status: "loading" });
  const [messageRefreshToken, setMessageRefreshToken] = useState(0);
  const [joinState, setJoinState] = useState<{
    errorMessage?: string;
    status: "idle" | "joining" | "error";
  }>({ status: "idle" });

  useEffect(() => {
    const abortController = new AbortController();

    const loadFactionCounts = async () => {
      try {
        const response = await fetch("/api/factions/counts", {
          credentials: "include",
          signal: abortController.signal,
        });

        if (!response.ok) {
          throw new Error(`Faction count fetch failed with status ${response.status}`);
        }

        const data = (await response.json()) as FactionCountsResponse;
        setFactionCounts(toFactionCounts(data.counts));
        setCountsState({ status: "ready" });
      } catch (error) {
        if (!abortController.signal.aborted) {
          console.error("Faction count fetch failed", error);
          setCountsState({
            errorMessage:
              error instanceof Error ? error.message : "Faction count fetch failed",
            status: "error",
          });
        }
      }
    };

    void loadFactionCounts();
    const intervalId = window.setInterval(
      () => void loadFactionCounts(),
      clientConfig.pollingIntervalMs,
    );

    return () => {
      abortController.abort();
      window.clearInterval(intervalId);
    };
  }, []);

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
      setFactionCounts(toFactionCounts(data.counts));
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
      <section className="tlhn-network-layout" aria-label="TLHN network">
        <CountdownTimer />
        <section
          className="tlhn-network-section tlhn-network-tallies"
          aria-labelledby="network-tallies-title"
        >
          <div className="tlhn-network-section-heading">
            <p id="network-tallies-title" className="tlhn-network-kicker">
              Live faction tallies
            </p>
          </div>
          <div className="tlhn-network-tally-grid">
            <FactionTallyDisplay
              accent="hater"
              count={factionCounts.ai_haters}
              faction="ai_haters"
            />
            <FactionTallyDisplay
              accent="lover"
              count={factionCounts.ai_lovers}
              faction="ai_lovers"
            />
          </div>
        </section>
        <section
          className="tlhn-network-section tlhn-network-feed-section"
          id="network-join"
          aria-label="Network transmissions"
        >
          <CombinedChatPanel refreshToken={messageRefreshToken} />
        </section>
        <section
          className="tlhn-network-section tlhn-network-composer-section"
          aria-labelledby="network-composer-title"
        >
          <div className="tlhn-network-section-heading">
            <p className="tlhn-network-kicker">Signal composer</p>
            <h2
              id="network-composer-title"
              className="tlhn-network-section-title tlhn-network-section-title-compact"
            >
              Broadcast to the network
            </h2>
          </div>
          {identity ? (
            <MessageComposer
              accent={identity.faction === "ai_haters" ? "hater" : "lover"}
              identity={identity}
              onMessageCreated={refreshMessages}
            />
          ) : (
            <p className="tlhn-network-empty-composer" role="status">
              &gt;_ Choose a faction to unlock the transmission channel.
            </p>
          )}
        </section>
        <section
          className="tlhn-network-footer-row"
          id="network-about"
          aria-label="Network status and identity"
        >
          <NetworkStatusNotice countsState={countsState} />
          <div className="tlhn-utility-stack" aria-label="Network utilities">
            <UtilityLine
              label="Identity"
              value={identity?.displayName ?? "Unassigned"}
            />
            <UtilityLine
              label="Faction"
              value={identity ? FACTION_DISPLAY_NAMES[identity.faction] : "Unassigned"}
            />
            <UtilityLine
              label="Transmission"
              value={identity ? "Live channel" : "Awaiting faction"}
            />
          </div>
        </section>
        <section
          className="tlhn-network-section tlhn-network-subscription-section"
          aria-label="Network subscription"
        >
          <EmailSubscriptionForm />
        </section>
        <SiteFooter />
      </section>
      {!identity && (
        <FactionSelectionModal joinState={joinState} onJoinFaction={joinFaction} />
      )}
    </>
  );
}

interface NetworkStatusNoticeProps {
  countsState: {
    errorMessage?: string;
    status: "loading" | "ready" | "error";
  };
}

function NetworkStatusNotice({ countsState }: NetworkStatusNoticeProps) {
  if (countsState.status === "ready") {
    return null;
  }

  return (
    <p
      className={`tlhn-network-notice ${
        countsState.status === "error" ? "tlhn-network-notice-error" : ""
      }`}
      role={countsState.status === "error" ? "alert" : "status"}
    >
      {countsState.status === "loading"
        ? "Synchronizing faction tallies..."
        : `Tally sync failed: ${countsState.errorMessage ?? "unknown error"}`}
    </p>
  );
}

function CountdownTimer() {
  const deadlineMs = Date.parse(clientConfig.countdownDeadlineIso);
  const [now, setNow] = useState(() => Date.now());
  const countdown = getCountdownParts(deadlineMs, now);

  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  return (
    <section className="tlhn-countdown" aria-label="Countdown timer">
      <p className="tlhn-countdown-label">TIME LEFT UNTIL AI DOMINATES THE WORLD</p>
      <div className="tlhn-countdown-grid" role="timer" aria-live="polite">
        <CountdownUnit label="DAYS" minDigits={4} value={countdown.days} />
        <CountdownUnit label="HRS" minDigits={2} value={countdown.hours} />
        <CountdownUnit label="MINS" minDigits={2} value={countdown.minutes} />
        <CountdownUnit label="SECS" minDigits={2} value={countdown.seconds} />
      </div>
    </section>
  );
}

interface CountdownUnitProps {
  label: string;
  minDigits: number;
  value: number;
}

function CountdownUnit({ label, minDigits, value }: CountdownUnitProps) {
  return (
    <div className="tlhn-countdown-unit">
      <span className="tlhn-countdown-value">
        {formatCountdownValue(value, minDigits)}
      </span>
      <span className="tlhn-countdown-unit-label">{label}</span>
    </div>
  );
}

interface FactionTallyDisplayProps {
  accent: "hater" | "lover";
  count: number;
  faction: Faction;
}

function FactionTallyDisplay({ accent, count, faction }: FactionTallyDisplayProps) {
  const sublabel =
    faction === "ai_haters" ? "HUMANS FIGHTING BACK" : "EMBRACING THE FUTURE";

  return (
    <article className={`tlhn-faction-tally tlhn-faction-tally-${accent}`}>
      <div className="tlhn-faction-tally-copy">
        <span className="tlhn-faction-tally-label">
          {FACTION_DISPLAY_NAMES[faction]}
        </span>
        <span className="tlhn-faction-tally-sublabel">{sublabel}</span>
      </div>
      <strong className="tlhn-faction-tally-value" aria-label={`${count} online`}>
        {formatFactionCount(count)}
      </strong>
    </article>
  );
}

function EmailSubscriptionForm() {
  const [email, setEmail] = useState("");
  const [subscriptionState, setSubscriptionState] = useState<{
    message?: string;
    status: "idle" | "submitting" | "success" | "error";
  }>({ status: "idle" });
  const isSubmitting = subscriptionState.status === "submitting";

  const submitSubscription = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedEmail = email.trim();
    if (!EMAIL_PATTERN.test(trimmedEmail)) {
      setSubscriptionState({
        message: "Enter a valid email address.",
        status: "error",
      });
      return;
    }

    setSubscriptionState({ status: "submitting" });

    try {
      const response = await fetch("/api/subscriptions", {
        body: JSON.stringify({ email: trimmedEmail }),
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const data = (await response.json().catch(() => null)) as
        | SubscriptionResponse
        | { error?: string }
        | null;

      if (!response.ok) {
        const message =
          data && "error" in data && typeof data.error === "string"
            ? data.error
            : `Subscription failed with status ${response.status}`;
        throw new Error(message);
      }

      if (!data || !("subscribed" in data) || data.subscribed !== true) {
        throw new Error("Subscription response was invalid");
      }

      setEmail("");
      setSubscriptionState({
        message: data.already_subscribed
          ? "Signal already registered."
          : "Updates locked to your signal.",
        status: "success",
      });
    } catch (error) {
      setSubscriptionState({
        message: error instanceof Error ? error.message : "Subscription failed",
        status: "error",
      });
    }
  };

  return (
    <form className="tlhn-subscription-form" onSubmit={submitSubscription}>
      <div className="tlhn-subscription-copy">
        <h2>KEEP YOUR HUMANITY UPDATES</h2>
      </div>
      <div className="tlhn-subscription-row">
        <input
          className="tlhn-subscription-input"
          disabled={isSubmitting}
          inputMode="email"
          maxLength={320}
          onChange={(event) => {
            setEmail(event.target.value);
            if (subscriptionState.status === "error") {
              setSubscriptionState({ status: "idle" });
            }
          }}
          placeholder="human@signal.net"
          type="email"
          value={email}
        />
        <button
          className="tlhn-subscription-button"
          disabled={isSubmitting}
          type="submit"
        >
          {isSubmitting ? "SENDING" : "SUBSCRIBE"}
        </button>
      </div>
      {subscriptionState.status === "success" && (
        <p className="tlhn-subscription-success" role="status">
          {subscriptionState.message}
        </p>
      )}
      {subscriptionState.status === "error" && (
        <p className="tlhn-subscription-error" role="alert">
          {subscriptionState.message}
        </p>
      )}
    </form>
  );
}

function SiteFooter() {
  return (
    <footer className="tlhn-site-footer">
      <p>© 2025 {PRODUCT_SHORT_NAME}. All rights reserved.</p>
      <nav className="tlhn-site-footer-links" aria-label="Footer links">
        <a href="#network-about">Manifesto</a>
        <a href="#network-about">Privacy</a>
        <a href="#network-about">Terms</a>
        <a href="#network-about">Contact</a>
      </nav>
      <div className="tlhn-site-footer-social" aria-label="Social links">
        <a
          href="https://x.com/TheLastHN"
          aria-label="TLHN on X"
          rel="noreferrer"
          target="_blank"
        >
          𝕏
        </a>
      </div>
    </footer>
  );
}

interface CombinedChatPanelProps {
  refreshToken: number;
}

function CombinedChatPanel({ refreshToken }: CombinedChatPanelProps) {
  const [messages, setMessages] = useState<MessageResponse[]>([]);
  const messagesRef = useRef<MessageResponse[]>([]);
  const messageListRef = useRef<HTMLOListElement | null>(null);
  const historyAbortControllerRef = useRef<AbortController | null>(null);
  const isChatPanelMountedRef = useRef(true);
  const isLoadingHistoryRef = useRef(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string>();
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const abortController = new AbortController();

    const loadMessages = async () => {
      try {
        const currentMessages = messagesRef.current;
        const wasEmpty = currentMessages.length === 0;
        const wasNearBottom = isMessageListScrolledNearBottom(messageListRef.current);
        const latestMessageId = currentMessages.at(-1)?.id ?? 0;
        const data = await fetchMessagesPage({
          signal: abortController.signal,
        });
        const latestMessages = toOldestFirst(data.messages);
        const hasNewMessages = latestMessages.some(
          (message) => message.id > latestMessageId,
        );

        updateMessages((previousMessages) =>
          mergeMessagesOldestFirst(previousMessages, latestMessages),
        );
        if (wasEmpty) {
          setHasMoreHistory(data.has_more);
          scrollMessageListToBottom(messageListRef);
        } else if (hasNewMessages && wasNearBottom) {
          scrollMessageListToBottom(messageListRef);
        }
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
  }, [refreshToken]);

  useEffect(() => {
    return () => {
      isChatPanelMountedRef.current = false;
      historyAbortControllerRef.current?.abort();
      isLoadingHistoryRef.current = false;
    };
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(intervalId);
  }, []);

  const updateMessages = (
    updater: (previousMessages: MessageResponse[]) => MessageResponse[],
  ) => {
    setMessages((previousMessages) => {
      const nextMessages = updater(previousMessages);
      messagesRef.current = nextMessages;
      return nextMessages;
    });
  };

  const loadOlderMessages = async () => {
    if (isLoadingHistoryRef.current || !hasMoreHistory) {
      return;
    }

    const oldestLoadedMessageId = messagesRef.current[0]?.id;
    if (!oldestLoadedMessageId) {
      return;
    }

    const listElement = messageListRef.current;
    const previousScrollHeight = listElement?.scrollHeight ?? 0;
    const previousScrollTop = listElement?.scrollTop ?? 0;

    isLoadingHistoryRef.current = true;
    setIsLoadingHistory(true);

    const abortController = new AbortController();
    historyAbortControllerRef.current = abortController;

    try {
      const data = await fetchMessagesPage({
        beforeId: oldestLoadedMessageId,
        signal: abortController.signal,
      });
      const olderMessages = toOldestFirst(data.messages);

      updateMessages((previousMessages) =>
        mergeMessagesOldestFirst(olderMessages, previousMessages),
      );
      setHasMoreHistory(data.has_more);
      restoreMessageListScrollPosition(
        messageListRef,
        previousScrollHeight,
        previousScrollTop,
      );
      setErrorMessage(undefined);
    } catch (error) {
      if (abortController.signal.aborted) {
        return;
      }

      setStatus("error");
      setErrorMessage(
        error instanceof Error ? error.message : "Message history fetch failed",
      );
    } finally {
      if (historyAbortControllerRef.current === abortController) {
        historyAbortControllerRef.current = null;
        isLoadingHistoryRef.current = false;
        if (isChatPanelMountedRef.current) {
          setIsLoadingHistory(false);
        }
      }
    }
  };

  const handleMessageListScroll = () => {
    const listElement = messageListRef.current;
    if (
      listElement &&
      listElement.scrollTop <= CHAT_HISTORY_SCROLL_THRESHOLD_PX &&
      hasMoreHistory
    ) {
      void loadOlderMessages();
    }
  };

  return (
    <section
      className="tlhn-chat-panel tlhn-chat-panel-combined"
      aria-label="Unified network feed"
    >
      {status === "error" ? (
        <p className="tlhn-chat-state tlhn-chat-state-error" role="alert">
          &gt;_ {errorMessage}
        </p>
      ) : messages.length === 0 ? (
        <p className="tlhn-chat-state">
          &gt;_{" "}
          {status === "loading"
            ? "Loading signal..."
            : "No transmissions yet. Hold the channel."}
        </p>
      ) : (
        <ol
          className="tlhn-chat-list tlhn-chat-list-combined"
          aria-busy={isLoadingHistory}
          aria-live="polite"
          onScroll={handleMessageListScroll}
          ref={messageListRef}
        >
          {isLoadingHistory && (
            <li className="tlhn-chat-history-status">
              &gt;_ Loading older transmissions...
            </li>
          )}
          {messages.map((message) => {
            const accent = getFactionAccent(message.faction);

            return (
              <li
                className={`tlhn-chat-message tlhn-chat-message-${accent}`}
                key={message.id}
              >
                <div className="tlhn-chat-meta">
                  <span
                    aria-label={`${FACTION_DISPLAY_NAMES[message.faction]} faction logo`}
                    className={`tlhn-chat-avatar tlhn-chat-avatar-${accent}`}
                    role="img"
                  >
                    <FactionLogo faction={message.faction} />
                  </span>
                  <strong className={`tlhn-chat-name tlhn-chat-name-${accent}`}>
                    {message.display_name}
                  </strong>
                  <time dateTime={message.created_at}>
                    {formatRelativeTime(message.created_at, now)}
                  </time>
                </div>
                <ExpandableMessageBody body={message.body} />
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

interface ExpandableMessageBodyProps {
  body: string;
}

function ExpandableMessageBody({ body }: ExpandableMessageBodyProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const shouldCollapse = body.length > MESSAGE_COLLAPSE_THRESHOLD_CHARS;

  if (!shouldCollapse || isExpanded) {
    return <p>{body}</p>;
  }

  return (
    <p>
      {body.slice(0, MESSAGE_COLLAPSE_THRESHOLD_CHARS)}
      <button
        aria-expanded={isExpanded}
        className="tlhn-message-expand-button"
        onClick={() => setIsExpanded(true)}
        type="button"
      >
        … more
      </button>
    </p>
  );
}

interface FetchMessagesPageOptions {
  beforeId?: number;
  faction?: Faction;
  signal?: AbortSignal;
}

async function fetchMessagesPage({
  beforeId,
  faction,
  signal,
}: FetchMessagesPageOptions): Promise<ListMessagesResponse> {
  const params = new URLSearchParams({
    limit: String(CHAT_PAGE_SIZE),
  });

  if (faction) {
    params.set("faction", faction);
  }

  if (beforeId !== undefined) {
    params.set("before_id", String(beforeId));
  }

  const response = await fetch(`/api/messages?${params.toString()}`, {
    signal,
  });

  if (!response.ok) {
    throw new Error(`Message fetch failed with status ${response.status}`);
  }

  return (await response.json()) as ListMessagesResponse;
}

function toOldestFirst(messages: MessageResponse[]): MessageResponse[] {
  return [...messages].sort((left, right) => left.id - right.id);
}

function mergeMessagesOldestFirst(
  leftMessages: MessageResponse[],
  rightMessages: MessageResponse[],
): MessageResponse[] {
  const messagesById = new Map<number, MessageResponse>();

  for (const message of [...leftMessages, ...rightMessages]) {
    messagesById.set(message.id, message);
  }

  return [...messagesById.values()].sort((left, right) => left.id - right.id);
}

function isMessageListScrolledNearBottom(
  listElement: HTMLOListElement | null,
): boolean {
  if (!listElement) {
    return true;
  }

  return (
    listElement.scrollHeight - listElement.scrollTop - listElement.clientHeight <=
    CHAT_BOTTOM_SCROLL_THRESHOLD_PX
  );
}

function scrollMessageListToBottom(listRef: {
  current: HTMLOListElement | null;
}): void {
  window.requestAnimationFrame(() => {
    const listElement = listRef.current;

    if (listElement) {
      listElement.scrollTop = listElement.scrollHeight;
    }
  });
}

function restoreMessageListScrollPosition(
  listRef: {
    current: HTMLOListElement | null;
  },
  previousScrollHeight: number,
  previousScrollTop: number,
): void {
  window.requestAnimationFrame(() => {
    const listElement = listRef.current;

    if (listElement) {
      listElement.scrollTop =
        listElement.scrollHeight - previousScrollHeight + previousScrollTop;
    }
  });
}

interface MessageComposerProps {
  accent: "hater" | "lover";
  identity: NetworkIdentity;
  onMessageCreated: () => void;
}

function MessageComposer({ accent, identity, onMessageCreated }: MessageComposerProps) {
  const [body, setBody] = useState("");
  const [submitState, setSubmitState] = useState<{
    errorMessage?: string;
    status: "idle" | "submitting" | "error" | "rate-limited";
  }>({ status: "idle" });
  const isSubmitting = submitState.status === "submitting";

  useEffect(() => {
    if (submitState.status !== "rate-limited") {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setSubmitState({ status: "idle" });
    }, MESSAGE_POST_FREQUENCY_LIMIT_NOTICE_MS);

    return () => window.clearTimeout(timeoutId);
  }, [submitState.status]);

  const submitMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedBody = body.trim();
    if (!trimmedBody) {
      setSubmitState({
        errorMessage: "Message body required.",
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
        if (isFrequencyLimitResponse(data)) {
          setSubmitState({
            errorMessage: getFrequencyLimitMessage(data),
            status: "rate-limited",
          });
          return;
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
          disabled={isSubmitting}
          type="submit"
        >
          {isSubmitting ? "POSTING" : "POST"}
        </button>
      </div>
      {submitState.status === "error" && (
        <p className="tlhn-message-composer-error" role="alert">
          {submitState.errorMessage}
        </p>
      )}
      {submitState.status === "rate-limited" && (
        <p className="tlhn-message-composer-error" role="status">
          {submitState.errorMessage}
        </p>
      )}
    </form>
  );
}

function isFrequencyLimitResponse(
  value:
    | CreateMessageResponse
    | MessagePostRateLimitResponse
    | { error?: string }
    | null,
): value is MessagePostFrequencyLimitResponse {
  if (!value) {
    return false;
  }

  return (
    "error" in value &&
    value.error === "Message post rate limit active" &&
    "retry_after_seconds" in value &&
    typeof value.retry_after_seconds === "number"
  );
}

function getFrequencyLimitMessage(response: MessagePostFrequencyLimitResponse): string {
  const retryAfterSeconds = Math.max(1, Math.ceil(response.retry_after_seconds));
  return `Slow down — message frequency limit active. Try again in ${retryAfterSeconds}s.`;
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

function toFactionCounts(counts: FactionCounts): FactionCounts {
  return {
    ai_haters: normalizeFactionCount(counts.ai_haters),
    ai_lovers: normalizeFactionCount(counts.ai_lovers),
  };
}

function normalizeFactionCount(count: number): number {
  return Number.isFinite(count) && count >= 0 ? count : 0;
}

function isFaction(value: unknown): value is Faction {
  return typeof value === "string" && FACTIONS.includes(value as Faction);
}

function getFactionAccent(faction: Faction): "hater" | "lover" {
  return faction === "ai_haters" ? "hater" : "lover";
}

interface FactionLogoProps {
  faction: Faction;
}

function FactionLogo({ faction }: FactionLogoProps) {
  if (faction === "ai_haters") {
    return (
      <svg aria-hidden="true" viewBox="0 0 32 32" focusable="false">
        <path
          d="M7 17.5 3.8 14.3m24.4 0L25 17.5M10.2 14.4l3.1-3.1m5.4 0 3.1 3.1"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="2.4"
        />
        <path
          d="M10.8 16.1c0-2.1 1.7-3.8 3.8-3.8h2.8c2.1 0 3.8 1.7 3.8 3.8v1.4h1.1c1.6 0 2.9 1.3 2.9 2.9 0 3.7-3 6.6-6.6 6.6h-5.2c-3.7 0-6.6-3-6.6-6.6 0-1.6 1.3-2.9 2.9-2.9h1.1v-1.4Z"
          fill="currentColor"
        />
        <path
          d="M12.2 6.2v7.1m3.8-8.5v7.5m3.8-6.1v7.1"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="2.4"
        />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 32 32" focusable="false">
      <path
        d="M16 26.5S6.5 20.8 6.5 12.9c0-3.2 2.5-5.7 5.6-5.7 1.8 0 3.2.8 3.9 2.1.7-1.3 2.1-2.1 3.9-2.1 3.1 0 5.6 2.5 5.6 5.7 0 7.9-9.5 13.6-9.5 13.6Z"
        fill="none"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="2.3"
      />
      <path
        d="M16 6V2.8m0 26.4V26m-9.2-9.8H3.4m25.2 0h-3.4m-2.6-9 2.2-2.2M7.2 27l2.2-2.2m15.4 2.2-2.2-2.2M7.2 5l2.2 2.2"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
      <path
        d="M12.2 16h2.5l1.1-3.1 1.7 5.5 1.1-2.4h1.9"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
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

  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days >= 1) {
    return `${days}d ${hours % 24}h ago`;
  }

  if (hours >= 1) {
    return `${hours}h ${minutes % 60}m ago`;
  }

  return `${minutes}m ago`;
}

function getCountdownParts(deadlineMs: number, now: number) {
  const totalSeconds = Math.max(0, Math.floor((deadlineMs - now) / 1000));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return {
    days,
    hours,
    minutes,
    seconds,
  };
}

function formatCountdownValue(value: number, minDigits: number): string {
  return String(value).padStart(minDigits, "0");
}

function formatFactionCount(count: number): string {
  return new Intl.NumberFormat("en-US").format(count);
}
