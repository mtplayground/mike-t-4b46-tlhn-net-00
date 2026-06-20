use crate::config::ServerConfig;
use serde::Serialize;
use sqlx::{postgres::PgPoolOptions, PgPool};
use std::time::Instant;

pub fn create_pg_pool(config: &ServerConfig) -> Result<PgPool, sqlx::Error> {
    PgPoolOptions::new()
        .max_connections(5)
        .connect_lazy(&config.database_url)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ServiceStatus {
    Ok,
    Error,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseHealth {
    pub status: ServiceStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latency_ms: Option<u128>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

pub async fn check_database_health(pool: &PgPool) -> DatabaseHealth {
    let started = Instant::now();

    match sqlx::query_scalar::<_, i32>("select 1")
        .fetch_one(pool)
        .await
    {
        Ok(1) => DatabaseHealth {
            status: ServiceStatus::Ok,
            latency_ms: Some(started.elapsed().as_millis()),
            message: None,
        },
        Ok(unexpected) => {
            tracing::error!(
                unexpected_result = unexpected,
                "PostgreSQL health check returned an unexpected result"
            );
            DatabaseHealth {
                status: ServiceStatus::Error,
                latency_ms: Some(started.elapsed().as_millis()),
                message: Some("PostgreSQL health query returned an unexpected result".to_owned()),
            }
        }
        Err(error) => {
            tracing::error!(
                name = "sqlx::Error",
                code = ?error.as_database_error().and_then(|db_error| db_error.code()),
                message = %error,
                "PostgreSQL health check failed"
            );
            DatabaseHealth {
                status: ServiceStatus::Error,
                latency_ms: Some(started.elapsed().as_millis()),
                message: Some("PostgreSQL health check failed".to_owned()),
            }
        }
    }
}
