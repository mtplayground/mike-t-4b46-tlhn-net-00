use crate::{config::ServerConfig, routes::health::health};
use axum::{http::StatusCode, response::IntoResponse, routing::get, Json, Router};
use serde::Serialize;
use sqlx::PgPool;
use std::sync::Arc;
use tower::ServiceBuilder;
use tower_http::{
    compression::CompressionLayer,
    cors::{AllowHeaders, AllowMethods, AllowOrigin, CorsLayer},
    trace::TraceLayer,
};

#[allow(dead_code)]
#[derive(Clone)]
pub struct AppDependencies {
    pub config: Arc<ServerConfig>,
    pub db_pool: PgPool,
}

impl AppDependencies {
    pub fn new(config: ServerConfig, db_pool: PgPool) -> Self {
        Self {
            config: Arc::new(config),
            db_pool,
        }
    }
}

#[derive(Serialize)]
struct ErrorResponse {
    error: &'static str,
}

pub fn create_app(dependencies: AppDependencies) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::mirror_request())
        .allow_methods(AllowMethods::mirror_request())
        .allow_headers(AllowHeaders::mirror_request())
        .allow_credentials(true);

    Router::new()
        .route("/api/health", get(health))
        .fallback(not_found)
        .layer(
            ServiceBuilder::new()
                .layer(TraceLayer::new_for_http())
                .layer(CompressionLayer::new())
                .layer(cors),
        )
        .with_state(dependencies)
}

async fn not_found() -> impl IntoResponse {
    (
        StatusCode::NOT_FOUND,
        Json(ErrorResponse { error: "Not found" }),
    )
}
