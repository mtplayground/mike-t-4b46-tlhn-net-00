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
    pub public_base_url: Option<String>,
    pub platform_auth: Option<PlatformAuthConfig>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlatformAuthConfig {
    pub auth_url: String,
    pub app_token: String,
    pub jwks_url: String,
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
            public_base_url: read_env("SELF_URL").filter(|value| !value.trim().is_empty()),
            platform_auth: parse_platform_auth_config(&read_env)?,
        })
    }
}

fn parse_platform_auth_config(
    read_env: &impl Fn(&str) -> Option<String>,
) -> Result<Option<PlatformAuthConfig>, ConfigError> {
    let auth_url = read_env("MCTAI_AUTH_URL").filter(|value| !value.trim().is_empty());
    let app_token = read_env("MCTAI_AUTH_APP_TOKEN").filter(|value| !value.trim().is_empty());
    let jwks_url = read_env("MCTAI_AUTH_JWKS_URL").filter(|value| !value.trim().is_empty());

    match (auth_url, app_token, jwks_url) {
        (None, None, None) => Ok(None),
        (Some(auth_url), Some(app_token), Some(jwks_url)) => Ok(Some(PlatformAuthConfig {
            auth_url: normalize_http_url(&auth_url, "MCTAI_AUTH_URL")?,
            app_token,
            jwks_url: normalize_http_url(&jwks_url, "MCTAI_AUTH_JWKS_URL")?,
        })),
        _ => Err(ConfigError::InvalidValue {
            name: "MCTAI_AUTH_*",
            value: "MCTAI_AUTH_URL, MCTAI_AUTH_APP_TOKEN, and MCTAI_AUTH_JWKS_URL must be set together"
                .to_owned(),
        }),
    }
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

fn normalize_http_url(value: &str, name: &'static str) -> Result<String, ConfigError> {
    let url = Url::parse(value).map_err(|_| ConfigError::InvalidValue {
        name,
        value: value.to_owned(),
    })?;

    match url.scheme() {
        "http" | "https" => Ok(url.to_string().trim_end_matches('/').to_owned()),
        _ => Err(ConfigError::InvalidValue {
            name,
            value: value.to_owned(),
        }),
    }
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
        assert_eq!(config.public_base_url, None);
        assert_eq!(config.platform_auth, None);
        assert!(config.database_url.contains("sslmode=require"));
    }

    #[test]
    fn reads_platform_auth_config_when_all_values_are_present() {
        let config = config_from(&[
            ("DATABASE_URL", "postgresql://example.test/db"),
            ("SELF_URL", "https://tlhn.example.test"),
            ("MCTAI_AUTH_URL", "https://auth.mctai.app/"),
            ("MCTAI_AUTH_APP_TOKEN", "app_test"),
            (
                "MCTAI_AUTH_JWKS_URL",
                "https://auth.mctai.app/.well-known/jwks.json",
            ),
        ])
        .expect("config should parse");

        assert_eq!(
            config.platform_auth,
            Some(PlatformAuthConfig {
                auth_url: "https://auth.mctai.app".to_owned(),
                app_token: "app_test".to_owned(),
                jwks_url: "https://auth.mctai.app/.well-known/jwks.json".to_owned(),
            })
        );
        assert_eq!(
            config.public_base_url,
            Some("https://tlhn.example.test".to_owned())
        );
    }

    #[test]
    fn rejects_partial_platform_auth_config() {
        assert!(matches!(
            config_from(&[
                ("DATABASE_URL", "postgresql://example.test/db"),
                ("MCTAI_AUTH_URL", "https://auth.mctai.app"),
            ]),
            Err(ConfigError::InvalidValue {
                name: "MCTAI_AUTH_*",
                ..
            })
        ));
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
