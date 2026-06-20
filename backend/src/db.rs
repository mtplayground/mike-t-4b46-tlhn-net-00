use crate::config::ServerConfig;
use sqlx::{postgres::PgPoolOptions, PgPool};

pub async fn create_pg_pool(config: &ServerConfig) -> Result<PgPool, sqlx::Error> {
    PgPoolOptions::new()
        .max_connections(5)
        .connect(&config.database_url)
        .await
}
