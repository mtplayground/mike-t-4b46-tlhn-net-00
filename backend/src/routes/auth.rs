use crate::{
    app::AppDependencies,
    auth::{platform_login_url, AuthSession},
};
use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
pub struct AuthSessionResponse {
    pub authenticated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<AuthUserResponse>,
}

#[derive(Clone, Debug, Serialize)]
pub struct AuthUserResponse {
    pub sub: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email_verified: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub picture: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct AuthLoginResponse {
    pub login_url: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct ErrorResponse {
    pub error: &'static str,
}

pub async fn session(State(state): State<AppDependencies>, headers: HeaderMap) -> Response {
    match state.auth_verifier.verify_session(&headers).await {
        Ok(Some(session)) => Json(AuthSessionResponse {
            authenticated: true,
            user: Some(AuthUserResponse::from(session)),
        })
        .into_response(),
        Ok(None) => Json(AuthSessionResponse {
            authenticated: false,
            user: None,
        })
        .into_response(),
        Err(error) => {
            tracing::error!(%error, "Platform session verification failed");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(ErrorResponse {
                    error: "Auth verification unavailable",
                }),
            )
                .into_response()
        }
    }
}

pub async fn login(State(state): State<AppDependencies>, headers: HeaderMap) -> Response {
    match platform_login_url(&state.config, &headers) {
        Ok(login_url) => Json(AuthLoginResponse { login_url }).into_response(),
        Err(error) => {
            tracing::error!(%error, "Platform login URL could not be generated");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(ErrorResponse {
                    error: "Auth login unavailable",
                }),
            )
                .into_response()
        }
    }
}

impl From<AuthSession> for AuthUserResponse {
    fn from(session: AuthSession) -> Self {
        Self {
            sub: session.sub,
            email: session.email,
            email_verified: session.email_verified,
            name: session.name,
            picture: session.picture,
        }
    }
}
