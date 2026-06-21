use chrono::{DateTime, SecondsFormat, Utc};
use std::env;
use thiserror::Error;
use url::Url;

pub const DEFAULT_HOST: &str = "0.0.0.0";
pub const DEFAULT_PORT: u16 = 8080;
pub const DEFAULT_POLLING_INTERVAL_MS: u64 = 5_000;
pub const DEFAULT_COUNTDOWN_DEADLINE_ISO: &str = "2029-12-01T07:00:00.000Z";

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ServerConfig {
    pub database_url: String,
    pub host: String,
    pub port: u16,
    pub node_env: String,
    pub polling_interval_ms: u64,
    pub countdown_deadline_iso: String,
    pub resend_api_key: Option<String>,
    pub newsletter_from_email: Option<String>,
    pub mctai_email_url: Option<String>,
    pub mctai_email_app_token: Option<String>,
}

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("Missing required environment variable: {0}")]
    MissingEnv(&'static str),
    #[error("Invalid {name} value: {value}")]
    InvalidValue { name: &'static str, value: String },
    #[error("Invalid DATABASE_URL value: {0}")]
    InvalidDatabaseUrl(#[from] url::ParseError),
}

impl ServerConfig {
    pub fn from_env() -> Result<Self, ConfigError> {
        Self::from_env_reader(|name| env::var(name).ok())
    }

    pub fn from_env_reader(read_env: impl Fn(&str) -> Option<String>) -> Result<Self, ConfigError> {
        let database_url = read_env("DATABASE_URL")
            .filter(|value| !value.trim().is_empty())
            .ok_or(ConfigError::MissingEnv("DATABASE_URL"))?;

        Ok(Self {
            database_url: normalize_database_url(&database_url)?,
            host: read_env("HOST").unwrap_or_else(|| DEFAULT_HOST.to_owned()),
            port: parse_port(read_env("PORT"), "PORT")?,
            node_env: read_env("NODE_ENV").unwrap_or_else(|| "development".to_owned()),
            polling_interval_ms: parse_positive_integer(
                read_env("POLLING_INTERVAL_MS"),
                "POLLING_INTERVAL_MS",
                DEFAULT_POLLING_INTERVAL_MS,
            )?,
            countdown_deadline_iso: parse_iso_date(
                read_env("COUNTDOWN_DEADLINE_ISO"),
                "COUNTDOWN_DEADLINE_ISO",
                DEFAULT_COUNTDOWN_DEADLINE_ISO,
            )?,
            resend_api_key: optional_non_empty(read_env("RESEND_API_KEY")),
            newsletter_from_email: optional_non_empty(read_env("NEWSLETTER_FROM_EMAIL")),
            mctai_email_url: optional_non_empty(read_env("MCTAI_EMAIL_URL")),
            mctai_email_app_token: optional_non_empty(read_env("MCTAI_EMAIL_APP_TOKEN")),
        })
    }
}

fn optional_non_empty(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn parse_port(value: Option<String>, name: &'static str) -> Result<u16, ConfigError> {
    match value {
        Some(raw_value) => {
            let parsed = raw_value
                .parse::<u16>()
                .map_err(|_| ConfigError::InvalidValue {
                    name,
                    value: raw_value.clone(),
                })?;

            if parsed == 0 {
                Err(ConfigError::InvalidValue {
                    name,
                    value: raw_value,
                })
            } else {
                Ok(parsed)
            }
        }
        None => Ok(DEFAULT_PORT),
    }
}

fn parse_positive_integer(
    value: Option<String>,
    name: &'static str,
    fallback: u64,
) -> Result<u64, ConfigError> {
    match value {
        Some(raw_value) => raw_value
            .parse::<u64>()
            .ok()
            .filter(|parsed| *parsed > 0)
            .ok_or(ConfigError::InvalidValue {
                name,
                value: raw_value,
            }),
        None => Ok(fallback),
    }
}

fn parse_iso_date(
    value: Option<String>,
    name: &'static str,
    fallback: &str,
) -> Result<String, ConfigError> {
    let candidate = value.unwrap_or_else(|| fallback.to_owned());
    let parsed =
        DateTime::parse_from_rfc3339(&candidate).map_err(|_| ConfigError::InvalidValue {
            name,
            value: candidate.clone(),
        })?;

    Ok(parsed
        .with_timezone(&Utc)
        .to_rfc3339_opts(SecondsFormat::Millis, true))
}

fn normalize_database_url(value: &str) -> Result<String, ConfigError> {
    let url = Url::parse(value)?;
    Ok(url.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn config_from(entries: &[(&str, &str)]) -> Result<ServerConfig, ConfigError> {
        let env: HashMap<&str, &str> = entries.iter().copied().collect();
        ServerConfig::from_env_reader(|name| env.get(name).map(|value| (*value).to_owned()))
    }

    #[test]
    fn reads_defaults_and_normalizes_dates() {
        let config = config_from(&[(
            "DATABASE_URL",
            "postgresql://tlhn:secret@example.test:5432/tlhn?sslmode=require",
        )])
        .expect("config should parse");

        assert_eq!(config.host, DEFAULT_HOST);
        assert_eq!(config.port, DEFAULT_PORT);
        assert_eq!(config.polling_interval_ms, DEFAULT_POLLING_INTERVAL_MS);
        assert_eq!(
            config.countdown_deadline_iso,
            DEFAULT_COUNTDOWN_DEADLINE_ISO
        );
        assert!(config.database_url.contains("sslmode=require"));
        assert_eq!(config.resend_api_key, None);
        assert_eq!(config.newsletter_from_email, None);
        assert_eq!(config.mctai_email_url, None);
        assert_eq!(config.mctai_email_app_token, None);
    }

    #[test]
    fn reads_email_configuration() {
        let config = config_from(&[
            ("DATABASE_URL", "postgresql://example.test/db"),
            ("RESEND_API_KEY", " resend_legacy_key "),
            ("NEWSLETTER_FROM_EMAIL", " hello@example.test "),
            ("MCTAI_EMAIL_URL", " https://email.example.test/send "),
            ("MCTAI_EMAIL_APP_TOKEN", " app_token "),
        ])
        .expect("config should parse");

        assert_eq!(config.resend_api_key.as_deref(), Some("resend_legacy_key"));
        assert_eq!(
            config.newsletter_from_email.as_deref(),
            Some("hello@example.test")
        );
        assert_eq!(
            config.mctai_email_url.as_deref(),
            Some("https://email.example.test/send")
        );
        assert_eq!(config.mctai_email_app_token.as_deref(), Some("app_token"));
    }

    #[test]
    fn rejects_missing_database_url() {
        assert!(matches!(
            config_from(&[]),
            Err(ConfigError::MissingEnv("DATABASE_URL"))
        ));
    }

    #[test]
    fn rejects_invalid_port() {
        assert!(matches!(
            config_from(&[
                ("DATABASE_URL", "postgresql://example.test/db"),
                ("PORT", "0")
            ]),
            Err(ConfigError::InvalidValue { name: "PORT", .. })
        ));
    }
}
