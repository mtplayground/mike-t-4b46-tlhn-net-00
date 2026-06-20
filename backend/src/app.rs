use crate::{
    config::ServerConfig,
    routes::{factions, health::health, messages, subscriptions},
};
use axum::{http::StatusCode, response::IntoResponse, routing::get, Json, Router};
use serde::Serialize;
use sqlx::PgPool;
use std::sync::{Arc, Mutex};
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
    pub message_post_rate_limiter: Arc<Mutex<messages::MessagePostRateLimiter>>,
}

impl AppDependencies {
    pub fn new(config: ServerConfig, db_pool: PgPool) -> Self {
        Self {
            config: Arc::new(config),
            db_pool,
            message_post_rate_limiter: Arc::new(Mutex::new(
                messages::MessagePostRateLimiter::default(),
            )),
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
        .route("/api/factions/counts", get(factions::counts))
        .route("/api/messages", get(messages::list).post(messages::create))
        .route(
            "/api/subscriptions",
            axum::routing::post(subscriptions::create),
        )
        .route(
            "/api/factions/{faction}/join",
            axum::routing::post(factions::join),
        )
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
