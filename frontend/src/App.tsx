import { PRODUCT_NAME, PRODUCT_SHORT_NAME } from "@tlhn/shared";

export function App() {
  return (
    <main className="app-shell">
      <section className="status-panel" aria-labelledby="app-title">
        <p className="eyebrow">{PRODUCT_SHORT_NAME}</p>
        <h1 id="app-title">{PRODUCT_NAME}</h1>
        <p className="lede">
          React client and Express API are ready for the next implementation issue.
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
