use crate::{app::AppDependencies, models::Faction};
use axum::{
    extract::{Path, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use rand::{distributions::Uniform, rngs::OsRng, Rng};
use serde::Serialize;
use sqlx::Row;
use std::collections::HashMap;

const FACTION_JOIN_COOKIE: &str = "tlhn_faction_joined";
const FACTION_DISPLAY_NAME_COOKIE: &str = "tlhn_display_name";
const DISPLAY_NAME_SUFFIX_LENGTH: usize = 5;
const DISPLAY_NAME_SUFFIX_ALPHABET: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
pub struct FactionCounts {
    pub ai_haters: i32,
    pub ai_lovers: i32,
}

impl Default for FactionCounts {
    fn default() -> Self {
        Self {
            ai_haters: 0,
            ai_lovers: 0,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct FactionCountsResponse {
    pub counts: FactionCounts,
}

#[derive(Clone, Debug, Serialize)]
pub struct FactionJoinResponse {
    pub faction: Faction,
    pub display_name: String,
    pub counts: FactionCounts,
    pub joined: bool,
    pub already_joined: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct ErrorResponse {
    pub error: &'static str,
}

pub async fn counts(State(state): State<AppDependencies>) -> Response {
    match load_faction_counts(&state).await {
        Ok(counts) => Json(FactionCountsResponse { counts }).into_response(),
        Err(error) => internal_server_error(error).into_response(),
    }
}

pub async fn join(
    State(state): State<AppDependencies>,
    Path(faction_param): Path<String>,
    headers: HeaderMap,
) -> Response {
    let requested_faction = match Faction::parse(&faction_param) {
        Some(faction) => faction,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: "Invalid faction",
                }),
            )
                .into_response();
        }
    };

    let cookies = parse_cookies(&headers);
    let joined_faction = cookies
        .get(FACTION_JOIN_COOKIE)
        .and_then(|value| Faction::parse(value));

    if let Some(existing_faction) = joined_faction {
        return match load_faction_counts(&state).await {
            Ok(counts) => {
                let mut response_headers = HeaderMap::new();
                let display_name = match cookies.get(FACTION_DISPLAY_NAME_COOKIE) {
                    Some(value) if is_faction_display_name(value) => value.to_owned(),
                    _ => {
                        let generated = generate_faction_display_name(existing_faction);
                        append_session_cookie(
                            &mut response_headers,
                            FACTION_DISPLAY_NAME_COOKIE,
                            &generated,
                            is_https_request(&headers),
                        );
                        generated
                    }
                };

                (
                    response_headers,
                    Json(FactionJoinResponse {
                        faction: existing_faction,
                        display_name,
                        counts,
                        joined: true,
                        already_joined: true,
                    }),
                )
                    .into_response()
            }
            Err(error) => internal_server_error(error).into_response(),
        };
    }

    if let Err(error) = increment_faction_count(&state, requested_faction).await {
        return internal_server_error(error).into_response();
    }

    match load_faction_counts(&state).await {
        Ok(counts) => {
            let display_name = generate_faction_display_name(requested_faction);
            let mut response_headers = HeaderMap::new();
            let secure = is_https_request(&headers);
            append_session_cookie(
                &mut response_headers,
                FACTION_JOIN_COOKIE,
                requested_faction.as_str(),
                secure,
            );
            append_session_cookie(
                &mut response_headers,
                FACTION_DISPLAY_NAME_COOKIE,
                &display_name,
                secure,
            );

            (
                response_headers,
                Json(FactionJoinResponse {
                    faction: requested_faction,
                    display_name,
                    counts,
                    joined: true,
                    already_joined: false,
                }),
            )
                .into_response()
        }
        Err(error) => internal_server_error(error).into_response(),
    }
}

async fn load_faction_counts(state: &AppDependencies) -> Result<FactionCounts, sqlx::Error> {
    let rows = sqlx::query("select faction::text as faction, count from faction_counts")
        .fetch_all(&state.db_pool)
        .await?;
    let mut counts = FactionCounts::default();

    for row in rows {
        let faction: String = row.try_get("faction")?;
        let count: i32 = row.try_get("count")?;
        if let Some(parsed) = Faction::parse(&faction) {
            match parsed {
                Faction::AiHaters => counts.ai_haters = count,
                Faction::AiLovers => counts.ai_lovers = count,
            }
        }
    }

    Ok(counts)
}

async fn increment_faction_count(
    state: &AppDependencies,
    faction: Faction,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        insert into faction_counts (faction, count)
        values ($1::faction, 1)
        on conflict (faction) do update
        set count = faction_counts.count + 1
        "#,
    )
    .bind(faction.as_str())
    .execute(&state.db_pool)
    .await?;

    Ok(())
}

fn internal_server_error(error: sqlx::Error) -> (StatusCode, Json<ErrorResponse>) {
    tracing::error!(
        name = "sqlx::Error",
        code = ?error.as_database_error().and_then(|db_error| db_error.code()),
        message = %error,
        "Factions endpoint database operation failed"
    );

    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(ErrorResponse {
            error: "Internal server error",
        }),
    )
}

fn generate_faction_display_name(faction: Faction) -> String {
    let prefixes = faction.display_name_prefixes();
    let prefix = prefixes[OsRng.gen_range(0..prefixes.len())];
    format!("{prefix}_{}", generate_suffix(DISPLAY_NAME_SUFFIX_LENGTH))
}

fn generate_suffix(length: usize) -> String {
    let distribution = Uniform::from(0..DISPLAY_NAME_SUFFIX_ALPHABET.len());
    let mut rng = OsRng;
    (0..length)
        .map(|_| DISPLAY_NAME_SUFFIX_ALPHABET[rng.sample(distribution)] as char)
        .collect()
}

fn is_faction_display_name(value: &str) -> bool {
    let Some((prefix, suffix)) = value.split_once('_') else {
        return false;
    };

    !prefix.is_empty()
        && prefix
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
        && prefix
            .as_bytes()
            .first()
            .is_some_and(|byte| byte.is_ascii_lowercase())
        && suffix.len() == DISPLAY_NAME_SUFFIX_LENGTH
        && suffix
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
}

fn append_session_cookie(headers: &mut HeaderMap, name: &str, value: &str, secure: bool) {
    let mut cookie = format!(
        "{}={}; Path=/api/factions; HttpOnly; SameSite=Lax",
        name,
        percent_encode_cookie_value(value)
    );
    if secure {
        cookie.push_str("; Secure");
    }

    match HeaderValue::from_str(&cookie) {
        Ok(header_value) => {
            headers.append(header::SET_COOKIE, header_value);
        }
        Err(error) => {
            tracing::error!(
                name = "InvalidHeaderValue",
                message = %error,
                cookie_name = name,
                "Failed to set faction session cookie"
            );
        }
    }
}

fn parse_cookies(headers: &HeaderMap) -> HashMap<String, String> {
    let mut cookies = HashMap::new();
    let Some(cookie_header) = headers.get(header::COOKIE) else {
        return cookies;
    };
    let Ok(cookie_header) = cookie_header.to_str() else {
        return cookies;
    };

    for part in cookie_header.split(';') {
        let Some((raw_name, raw_value)) = part.trim().split_once('=') else {
            continue;
        };
        if !raw_name.is_empty() && !raw_value.is_empty() {
            cookies.insert(raw_name.to_owned(), safe_percent_decode(raw_value));
        }
    }

    cookies
}

fn safe_percent_decode(value: &str) -> String {
    let mut decoded = String::with_capacity(value.len());
    let bytes = value.as_bytes();
    let mut index = 0;

    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            let hex = &value[index + 1..index + 3];
            if let Ok(byte) = u8::from_str_radix(hex, 16) {
                decoded.push(byte as char);
                index += 3;
                continue;
            }
        }

        decoded.push(bytes[index] as char);
        index += 1;
    }

    decoded
}

fn percent_encode_cookie_value(value: &str) -> String {
    value
        .bytes()
        .flat_map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'_' | b'-' | b'.' => {
                vec![byte as char]
            }
            _ => format!("%{byte:02X}").chars().collect(),
        })
        .collect()
}

fn is_https_request(headers: &HeaderMap) -> bool {
    headers
        .get("x-forwarded-proto")
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.eq_ignore_ascii_case("https"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_faction_display_name_shape() {
        assert!(is_faction_display_name("luddite_abc12"));
        assert!(is_faction_display_name("ai9_00000"));
        assert!(!is_faction_display_name("Luddite_abc12"));
        assert!(!is_faction_display_name("luddite_abc1"));
        assert!(!is_faction_display_name("luddite_abc123"));
    }

    #[test]
    fn decodes_cookie_values_safely() {
        assert_eq!(safe_percent_decode("a%20b"), "a b");
        assert_eq!(safe_percent_decode("bad%xx"), "bad%xx");
    }
}
