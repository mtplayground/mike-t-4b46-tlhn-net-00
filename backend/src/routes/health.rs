use crate::{
    app::AppDependencies,
    db::{check_database_health, DatabaseHealth, ServiceStatus},
    models::{PRODUCT_NAME, PRODUCT_SHORT_NAME},
};
use axum::{extract::State, http::StatusCode, Json};
use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthResponse {
    pub status: ServiceStatus,
    pub api: ServiceStatus,
    pub product: &'static str,
    pub product_short_name: &'static str,
    pub database: DatabaseHealth,
}

pub async fn health(State(state): State<AppDependencies>) -> (StatusCode, Json<HealthResponse>) {
    let database = check_database_health(&state.db_pool).await;
    let status = if database.status == ServiceStatus::Ok {
        ServiceStatus::Ok
    } else {
        ServiceStatus::Error
    };
    let status_code = if status == ServiceStatus::Ok {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };

    (
        status_code,
        Json(HealthResponse {
            status,
            api: ServiceStatus::Ok,
            product: PRODUCT_NAME,
            product_short_name: PRODUCT_SHORT_NAME,
            database,
        }),
    )
}
