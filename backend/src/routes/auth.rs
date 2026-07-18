use crate::{
    accounts::{get_or_create_account_identity, log_account_identity_error, AccountIdentity},
    app::AppDependencies,
    auth::platform_login_url,
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
    pub email: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email_verified: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub picture: Option<String>,
    pub faction: crate::models::Faction,
    pub pseudonym: String,
    pub newly_registered: bool,
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
        Ok(Some(session)) => match get_or_create_account_identity(&state, &session).await {
            Ok(account) => Json(AuthSessionResponse {
                authenticated: true,
                user: Some(AuthUserResponse::from(account)),
            })
            .into_response(),
            Err(error) => {
                log_account_identity_error(&error);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        error: "Account identity unavailable",
                    }),
                )
                    .into_response()
            }
        },
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

impl From<AccountIdentity> for AuthUserResponse {
    fn from(account: AccountIdentity) -> Self {
        Self {
            sub: account.sub,
            email: account.email,
            email_verified: account.email_verified,
            name: account.name,
            picture: account.picture_url,
            faction: account.faction,
            pseudonym: account.pseudonym,
            newly_registered: account.newly_registered,
        }
    }
}
