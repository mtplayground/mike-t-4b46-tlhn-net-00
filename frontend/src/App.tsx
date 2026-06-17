import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { PRODUCT_NAME, PRODUCT_SHORT_NAME } from "@tlhn/shared";

type RoutePath = "/" | "/network";

const ROUTES: Record<RoutePath, string> = {
  "/": "Landing",
  "/network": "Network",
};

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
      {route === "/network" ? <NetworkPage /> : <LandingPage />}
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

function LandingPage() {
  return (
    <section className="tlhn-page-panel" aria-labelledby="landing-title">
      <p className="font-terminal text-sm uppercase text-lover-300 text-glow-lover">
        Signal acquired
      </p>
      <h1
        id="landing-title"
        className="mt-3 max-w-5xl text-[clamp(2.6rem,8vw,6rem)] font-black leading-[0.95] text-tlhn-bone text-glow-terminal"
      >
        {PRODUCT_NAME}
      </h1>
      <p className="mt-6 max-w-3xl text-lg text-tlhn-bone/75">
        A dark terminal for the last human signal, split between suspicion and devotion
        as the network comes online.
      </p>
    </section>
  );
}

function NetworkPage() {
  return (
    <section className="tlhn-page-panel" aria-labelledby="network-title">
      <p className="font-terminal text-sm uppercase text-hater-500 text-glow-hater">
        Signal route
      </p>
      <h1
        id="network-title"
        className="mt-3 text-[clamp(2.25rem,7vw,5rem)] font-black leading-none text-tlhn-bone text-glow-terminal"
      >
        Network
      </h1>
      <p className="mt-6 max-w-3xl text-lg text-tlhn-bone/75">
        Faction terminals are booting under the same fractured signal.
      </p>
    </section>
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
