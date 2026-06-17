import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import {
  FACTION_DISPLAY_NAMES,
  PRODUCT_NAME,
  PRODUCT_SHORT_NAME,
  type Faction,
} from "@tlhn/shared";

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
  return (
    <section className="tlhn-network-layout" aria-labelledby="network-title">
      <FactionColumn
        accent="hater"
        faction="ai_haters"
        kicker="Red channel"
        statusLines={["Resistance node", "Signal hostility high", "Human-first relay"]}
      />
      <section className="tlhn-network-utility" aria-labelledby="network-title">
        <p className="tlhn-network-kicker">Utility core</p>
        <h1 id="network-title" className="tlhn-network-title">
          Network
        </h1>
        <div className="tlhn-utility-stack" aria-label="Network utilities">
          <UtilityLine label="Identity" value="Unassigned" />
          <UtilityLine label="Countdown" value="Awaiting sync" />
          <UtilityLine label="Transmission" value="Standby" />
        </div>
      </section>
      <FactionColumn
        accent="lover"
        faction="ai_lovers"
        kicker="Blue channel"
        statusLines={["Ascension node", "Signal affinity high", "Machine-allied relay"]}
      />
    </section>
  );
}

interface FactionColumnProps {
  accent: "hater" | "lover";
  faction: Faction;
  kicker: string;
  statusLines: readonly string[];
}

function FactionColumn({ accent, faction, kicker, statusLines }: FactionColumnProps) {
  return (
    <section
      className={`tlhn-faction-column tlhn-faction-column-${accent}`}
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
