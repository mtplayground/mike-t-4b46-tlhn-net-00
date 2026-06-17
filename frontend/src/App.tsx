import { PRODUCT_NAME, PRODUCT_SHORT_NAME } from "@tlhn/shared";
import { clientConfig } from "./config";

export function App() {
  return (
    <main className="app-shell">
      <section className="status-panel" aria-labelledby="app-title">
        <p className="eyebrow">{PRODUCT_SHORT_NAME}</p>
        <h1 id="app-title">{PRODUCT_NAME}</h1>
        <p className="lede">
          React client and Express API are ready for the next implementation issue.
        </p>
        <p className="config-note">
          Polling defaults to {clientConfig.pollingIntervalMs}ms. Countdown target is{" "}
          {clientConfig.countdownDeadlineIso}.
        </p>
        <ApiStatus />
      </section>
    </main>
  );
}

function ApiStatus() {
  return (
    <a className="health-link" href="/api/health">
      API health
    </a>
  );
}
