use crate::config::{PlatformAuthConfig, ServerConfig};
use async_trait::async_trait;
use axum::http::{header, HeaderMap};
use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use thiserror::Error;
use url::Url;

pub const PLATFORM_SESSION_COOKIE: &str = "mctai_session";

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct AuthSession {
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

#[derive(Debug, Error)]
pub enum AuthVerificationError {
    #[error("Platform auth is not configured")]
    NotConfigured,
    #[error("Platform auth JWKS request failed: {0}")]
    JwksRequest(#[from] reqwest::Error),
    #[error("Platform auth JWKS does not contain a matching signing key")]
    MissingSigningKey,
    #[error("Platform auth token header is invalid: {0}")]
    InvalidTokenHeader(#[from] jsonwebtoken::errors::Error),
    #[error("Platform auth token signing key is invalid: {0}")]
    InvalidSigningKey(String),
}

#[async_trait]
pub trait SessionVerifier: Send + Sync {
    async fn verify_session(
        &self,
        headers: &HeaderMap,
    ) -> Result<Option<AuthSession>, AuthVerificationError>;
}

pub type SharedSessionVerifier = Arc<dyn SessionVerifier>;

pub fn production_session_verifier(config: &ServerConfig) -> SharedSessionVerifier {
    Arc::new(PlatformSessionVerifier::new(config.platform_auth.clone()))
}

#[derive(Clone)]
pub struct PlatformSessionVerifier {
    config: Option<PlatformAuthConfig>,
    http_client: reqwest::Client,
}

impl PlatformSessionVerifier {
    pub fn new(config: Option<PlatformAuthConfig>) -> Self {
        Self {
            config,
            http_client: reqwest::Client::new(),
        }
    }
}

#[async_trait]
impl SessionVerifier for PlatformSessionVerifier {
    async fn verify_session(
        &self,
        headers: &HeaderMap,
    ) -> Result<Option<AuthSession>, AuthVerificationError> {
        let Some(token) = session_cookie(headers) else {
            return Ok(None);
        };
        let Some(config) = &self.config else {
            return Err(AuthVerificationError::NotConfigured);
        };

        let token_header = match decode_header(&token) {
            Ok(token_header) => token_header,
            Err(_) => return Ok(None),
        };
        let Some(key_id) = token_header.kid else {
            return Ok(None);
        };
        let jwks = self
            .http_client
            .get(&config.jwks_url)
            .send()
            .await?
            .error_for_status()?
            .json::<JwksResponse>()
            .await?;
        let Some(jwk) = jwks.keys.into_iter().find(|key| key.kid == key_id) else {
            return Ok(None);
        };
        let decoding_key = DecodingKey::from_rsa_components(&jwk.n, &jwk.e)
            .map_err(|error| AuthVerificationError::InvalidSigningKey(error.to_string()))?;
        let mut validation = Validation::new(Algorithm::RS256);
        validation.set_audience(&[config.app_token.as_str()]);
        validation.set_issuer(&[config.auth_url.as_str()]);

        match decode::<PlatformClaims>(&token, &decoding_key, &validation) {
            Ok(token_data) => Ok(Some(token_data.claims.into_auth_session())),
            Err(error) if is_invalid_session_error(error.kind()) => Ok(None),
            Err(error) => Err(AuthVerificationError::InvalidTokenHeader(error)),
        }
    }
}

pub fn platform_login_url(
    config: &ServerConfig,
    headers: &HeaderMap,
) -> Result<String, AuthVerificationError> {
    let Some(platform_auth) = &config.platform_auth else {
        return Err(AuthVerificationError::NotConfigured);
    };
    let return_to = public_frontend_root(config, headers);
    let mut login_url = Url::parse(&format!("{}/login", platform_auth.auth_url)).map_err(|error| {
        AuthVerificationError::InvalidSigningKey(format!("invalid platform auth URL: {error}"))
    })?;
    login_url
        .query_pairs_mut()
        .append_pair("app_token", &platform_auth.app_token)
        .append_pair("return_to", &return_to);
    Ok(login_url.to_string())
}

pub fn public_frontend_root(config: &ServerConfig, headers: &HeaderMap) -> String {
    if let Some(public_base_url) = config.public_base_url.as_deref() {
        return public_base_url.trim_end_matches('/').to_owned();
    }

    let proto = first_header_value(headers, "x-forwarded-proto").unwrap_or_else(|| "http".to_owned());
    let host = first_header_value(headers, "x-forwarded-host")
        .or_else(|| first_header_value(headers, header::HOST.as_str()))
        .unwrap_or_else(|| format!("{}:{}", config.host, config.port));
    format!("{}://{}", proto, host)
}

pub fn session_cookie(headers: &HeaderMap) -> Option<String> {
    headers
        .get(header::COOKIE)
        .and_then(|value| value.to_str().ok())
        .and_then(|cookies| cookie_value(cookies, PLATFORM_SESSION_COOKIE))
}

fn cookie_value(cookies: &str, name: &str) -> Option<String> {
    for cookie in cookies.split(';') {
        if let Some((cookie_name, cookie_value)) = cookie.trim().split_once('=') {
            if cookie_name == name && !cookie_value.is_empty() {
                return Some(cookie_value.to_owned());
            }
        }
    }
    None
}

fn first_header_value(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(',').next())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn is_invalid_session_error(kind: &jsonwebtoken::errors::ErrorKind) -> bool {
    matches!(
        kind,
        jsonwebtoken::errors::ErrorKind::InvalidToken
            | jsonwebtoken::errors::ErrorKind::InvalidSignature
            | jsonwebtoken::errors::ErrorKind::ExpiredSignature
            | jsonwebtoken::errors::ErrorKind::InvalidIssuer
            | jsonwebtoken::errors::ErrorKind::InvalidAudience
            | jsonwebtoken::errors::ErrorKind::ImmatureSignature
    )
}

#[derive(Debug, Deserialize)]
struct JwksResponse {
    keys: Vec<JwkKey>,
}

#[derive(Debug, Deserialize)]
struct JwkKey {
    kid: String,
    n: String,
    e: String,
}

#[derive(Clone, Debug, Deserialize)]
struct PlatformClaims {
    sub: String,
    email: Option<String>,
    email_verified: Option<bool>,
    name: Option<String>,
    picture: Option<String>,
}

impl PlatformClaims {
    fn into_auth_session(self) -> AuthSession {
        AuthSession {
            sub: self.sub,
            email: self.email,
            email_verified: self.email_verified,
            name: self.name,
            picture: self.picture,
        }
    }
}

#[derive(Clone)]
pub struct StaticSessionVerifier {
    session: Option<AuthSession>,
}

impl StaticSessionVerifier {
    pub fn authenticated(session: AuthSession) -> Self {
        Self {
            session: Some(session),
        }
    }

    pub fn unauthenticated() -> Self {
        Self { session: None }
    }
}

#[async_trait]
impl SessionVerifier for StaticSessionVerifier {
    async fn verify_session(
        &self,
        _headers: &HeaderMap,
    ) -> Result<Option<AuthSession>, AuthVerificationError> {
        Ok(self.session.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    #[test]
    fn extracts_platform_session_cookie() {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::COOKIE,
            HeaderValue::from_static("theme=dark; mctai_session=session-token; other=value"),
        );

        assert_eq!(session_cookie(&headers), Some("session-token".to_owned()));
    }

    #[test]
    fn derives_public_frontend_root_from_forwarded_headers() {
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-forwarded-proto",
            HeaderValue::from_static("https"),
        );
        headers.insert(
            "x-forwarded-host",
            HeaderValue::from_static("tlhn-public.mctai.app"),
        );
        let config = ServerConfig {
            database_url: "postgresql://example.test/db".to_owned(),
            host: "0.0.0.0".to_owned(),
            port: 8080,
            node_env: "test".to_owned(),
            polling_interval_ms: 5_000,
            countdown_deadline_iso: "2029-12-01T07:00:00.000Z".to_owned(),
            public_base_url: None,
            platform_auth: None,
            news_bot_token: None,
        };

        assert_eq!(
            public_frontend_root(&config, &headers),
            "https://tlhn-public.mctai.app"
        );
    }
}
