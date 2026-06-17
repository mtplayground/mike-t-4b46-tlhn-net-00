import { PRODUCT_NAME, PRODUCT_SHORT_NAME } from "@tlhn/shared";
import { clientConfig } from "./config";

export function App() {
  return (
    <main className="tlhn-screen">
      <section className="tlhn-panel" aria-labelledby="app-title">
        <p className="font-terminal text-sm font-bold uppercase tracking-[0.16em] text-hater-500 text-glow-hater">
          {PRODUCT_SHORT_NAME}
        </p>
        <h1
          id="app-title"
          className="mt-2 max-w-4xl text-[clamp(2.35rem,8vw,5.6rem)] font-black leading-[0.95] text-tlhn-bone text-glow-terminal"
        >
          {PRODUCT_NAME}
        </h1>
        <p className="mt-5 max-w-3xl text-lg text-tlhn-bone/75">
          React client and Express API are ready for the next implementation issue.
        </p>
        <p className="mt-3 font-terminal text-sm text-tlhn-ash">
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
    <a className="tlhn-terminal-button" href="/api/health">
      API health
    </a>
  );
}
