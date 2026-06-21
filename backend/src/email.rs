use crate::config::ServerConfig;
use reqwest::StatusCode;
use serde::Serialize;
use std::{future::Future, pin::Pin};
use thiserror::Error;

const WELCOME_SUBJECT: &str = "Welcome to The Last Human Network";

#[derive(Clone, Debug)]
pub struct EmailClient {
    mode: EmailClientMode,
    http_client: reqwest::Client,
}

#[derive(Clone, Debug)]
enum EmailClientMode {
    Disabled {
        reason: &'static str,
    },
    Platform {
        endpoint_url: String,
        app_token: String,
        reply_to: Option<String>,
    },
}

#[derive(Debug, Error)]
pub enum EmailError {
    #[error("email send was rate limited")]
    RateLimited,
    #[error("email send failed with status {status}: {body}")]
    SendFailed { status: StatusCode, body: String },
    #[error("email request failed: {0}")]
    Request(#[from] reqwest::Error),
}

pub trait WelcomeEmailSender: Send + Sync {
    fn send_welcome_email<'a>(
        &'a self,
        email: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<(), EmailError>> + Send + 'a>>;
}

#[derive(Serialize)]
struct SendEmailRequest<'a> {
    to: &'a str,
    subject: &'a str,
    html: String,
    text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    reply_to: Option<&'a str>,
}

impl EmailClient {
    pub fn from_config(config: &ServerConfig) -> Self {
        let mode = match (
            config.mctai_email_url.as_ref(),
            config.mctai_email_app_token.as_ref(),
        ) {
            (Some(endpoint_url), Some(app_token)) => EmailClientMode::Platform {
                endpoint_url: endpoint_url.clone(),
                app_token: app_token.clone(),
                reply_to: config.newsletter_from_email.clone(),
            },
            (None, _) => EmailClientMode::Disabled {
                reason: "MCTAI_EMAIL_URL is not configured",
            },
            (_, None) => EmailClientMode::Disabled {
                reason: "MCTAI_EMAIL_APP_TOKEN is not configured",
            },
        };

        if let EmailClientMode::Disabled { reason } = &mode {
            tracing::warn!(
                reason,
                legacy_resend_configured = config.resend_api_key.is_some(),
                "Email client disabled; welcome emails will be skipped"
            );
        }

        Self {
            mode,
            http_client: reqwest::Client::new(),
        }
    }

    async fn send_welcome_email_internal(&self, email: &str) -> Result<(), EmailError> {
        let EmailClientMode::Platform {
            endpoint_url,
            app_token,
            reply_to,
        } = &self.mode
        else {
            tracing::info!(
                recipient = %email,
                "Email client is disabled; skipped welcome email"
            );
            return Ok(());
        };

        let request = SendEmailRequest {
            to: email,
            subject: WELCOME_SUBJECT,
            html: welcome_email_html(),
            text: welcome_email_text(),
            reply_to: reply_to.as_deref(),
        };

        let response = self
            .http_client
            .post(endpoint_url)
            .bearer_auth(app_token)
            .json(&request)
            .send()
            .await?;

        if response.status() == StatusCode::TOO_MANY_REQUESTS {
            return Err(EmailError::RateLimited);
        }

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_else(|error| {
                tracing::warn!(%error, "Failed to read email error response body");
                String::new()
            });
            return Err(EmailError::SendFailed { status, body });
        }

        tracing::info!(recipient = %email, "Welcome email sent");
        Ok(())
    }
}

impl WelcomeEmailSender for EmailClient {
    fn send_welcome_email<'a>(
        &'a self,
        email: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<(), EmailError>> + Send + 'a>> {
        Box::pin(self.send_welcome_email_internal(email))
    }
}

pub async fn send_welcome_email(
    email_client: &dyn WelcomeEmailSender,
    email: &str,
) -> Result<(), EmailError> {
    email_client.send_welcome_email(email).await
}

fn welcome_email_html() -> String {
    "<p>Welcome to The Last Human Network.</p><p>Your signal is locked to the last human channel.</p>"
        .to_owned()
}

fn welcome_email_text() -> String {
    "Welcome to The Last Human Network.\n\nYour signal is locked to the last human channel."
        .to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::ServerConfig;

    fn base_config() -> ServerConfig {
        ServerConfig {
            database_url: "postgresql://example.test/db".to_owned(),
            host: "0.0.0.0".to_owned(),
            port: 8080,
            node_env: "test".to_owned(),
            polling_interval_ms: 5_000,
            countdown_deadline_iso: "2029-12-01T07:00:00.000Z".to_owned(),
            resend_api_key: None,
            newsletter_from_email: None,
            mctai_email_url: None,
            mctai_email_app_token: None,
        }
    }

    #[tokio::test]
    async fn disabled_client_skips_welcome_email() {
        let client = EmailClient::from_config(&base_config());
        client
            .send_welcome_email_internal("human@example.test")
            .await
            .expect("disabled email client should be a no-op");
    }

    #[test]
    fn platform_client_uses_optional_reply_to() {
        let mut config = base_config();
        config.mctai_email_url = Some("https://email.example.test/send".to_owned());
        config.mctai_email_app_token = Some("app-token".to_owned());
        config.newsletter_from_email = Some("reply@example.test".to_owned());

        let client = EmailClient::from_config(&config);
        let EmailClientMode::Platform { reply_to, .. } = client.mode else {
            panic!("client should be enabled");
        };

        assert_eq!(reply_to.as_deref(), Some("reply@example.test"));
    }
}
