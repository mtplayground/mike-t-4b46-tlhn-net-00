use crate::{
    config::ServerConfig,
    email::EmailClient,
    routes::{factions, health::health, messages, subscriptions},
};
use axum::{
    http::{header, HeaderValue, StatusCode},
    middleware,
    response::{IntoResponse, Response},
    routing::{any, get},
    Json, Router,
};
use serde::Serialize;
use sqlx::PgPool;
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tower::ServiceBuilder;
use tower_http::{
    compression::CompressionLayer,
    cors::{AllowHeaders, AllowMethods, AllowOrigin, CorsLayer},
    services::{ServeDir, ServeFile},
    trace::TraceLayer,
};

#[allow(dead_code)]
#[derive(Clone)]
pub struct AppDependencies {
    pub config: Arc<ServerConfig>,
    pub db_pool: PgPool,
    pub email_client: Arc<EmailClient>,
    pub message_post_rate_limiter: Arc<Mutex<messages::MessagePostRateLimiter>>,
}

impl AppDependencies {
    pub fn new(config: ServerConfig, db_pool: PgPool) -> Self {
        let email_client = Arc::new(EmailClient::from_config(&config));
        Self {
            config: Arc::new(config),
            db_pool,
            email_client,
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
    let frontend_dist_path = frontend_dist_path();
    let index_path = frontend_dist_path.join("index.html");
    let static_service = ServeDir::new(frontend_dist_path).fallback(ServeFile::new(index_path));

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
        .route("/api/{*path}", any(api_not_found))
        .fallback_service(static_service)
        .layer(
            ServiceBuilder::new()
                .layer(TraceLayer::new_for_http())
                .layer(CompressionLayer::new())
                .layer(cors)
                .layer(middleware::map_response(add_security_headers)),
        )
        .with_state(dependencies)
}

async fn api_not_found() -> impl IntoResponse {
    (
        StatusCode::NOT_FOUND,
        Json(ErrorResponse { error: "Not found" }),
    )
}

async fn add_security_headers(mut response: Response) -> Response {
    let headers = response.headers_mut();
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        header::X_FRAME_OPTIONS,
        HeaderValue::from_static("SAMEORIGIN"),
    );
    headers.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    headers.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static(
            "default-src 'self'; base-uri 'self'; connect-src 'self'; frame-ancestors 'self'; form-action 'self'; img-src 'self' data:; script-src 'self'; style-src 'self' 'unsafe-inline'",
        ),
    );
    headers.insert(
        header::HeaderName::from_static("permissions-policy"),
        HeaderValue::from_static("camera=(), microphone=(), geolocation=()"),
    );
    headers.insert(
        header::HeaderName::from_static("x-dns-prefetch-control"),
        HeaderValue::from_static("off"),
    );

    response
}

fn frontend_dist_path() -> PathBuf {
    let current_dir = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    for candidate in [
        current_dir.join("frontend/dist"),
        current_dir.join("../frontend/dist"),
        PathBuf::from("/opt/app/frontend/dist"),
    ] {
        if candidate.exists() {
            return candidate;
        }
    }

    current_dir.join("frontend/dist")
}
