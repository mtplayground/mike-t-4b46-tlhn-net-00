mod app;
mod config;
mod db;

use app::{create_app, AppDependencies};
use config::ServerConfig;
use db::create_pg_pool;
use std::error::Error;
use tokio::{net::TcpListener, signal};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    dotenvy::dotenv().ok();
    init_tracing();

    let config = ServerConfig::from_env()?;
    let db_pool = create_pg_pool(&config).await?;
    let listener = TcpListener::bind((config.host.as_str(), config.port)).await?;
    let local_addr = listener.local_addr()?;
    let app = create_app(AppDependencies::new(config.clone(), db_pool));

    tracing::info!(
        host = %config.host,
        port = config.port,
        node_env = %config.node_env,
        polling_interval_ms = config.polling_interval_ms,
        countdown_deadline_iso = %config.countdown_deadline_iso,
        "TLHN Rust API listening on {local_addr}"
    );

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    Ok(())
}

fn init_tracing() {
    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("tlhn_backend=info,tower_http=info"));

    tracing_subscriber::registry()
        .with(env_filter)
        .with(tracing_subscriber::fmt::layer())
        .init();
}

async fn shutdown_signal() {
    let ctrl_c = async {
        if let Err(error) = signal::ctrl_c().await {
            tracing::error!(%error, "failed to install Ctrl+C shutdown handler");
        }
    };

    #[cfg(unix)]
    {
        let terminate = async {
            match signal::unix::signal(signal::unix::SignalKind::terminate()) {
                Ok(mut signal) => {
                    signal.recv().await;
                }
                Err(error) => {
                    tracing::error!(%error, "failed to install SIGTERM shutdown handler");
                }
            }
        };

        tokio::select! {
            _ = ctrl_c => {},
            _ = terminate => {},
        }
    }

    #[cfg(not(unix))]
    {
        ctrl_c.await;
    }
}
