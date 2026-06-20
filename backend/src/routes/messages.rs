use crate::{app::AppDependencies, models::Faction};
use axum::{
    extract::{rejection::JsonRejection, RawQuery, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use std::{collections::HashMap, time::SystemTime};
use url::form_urlencoded;

const DEFAULT_LIMIT: i64 = 25;
const MAX_LIMIT: i64 = 50;
const MESSAGE_POST_COOLDOWN_MS: u64 = 30_000;

#[derive(Clone, Debug)]
struct ListMessagesQuery {
    faction: Option<Faction>,
    limit: i64,
    before_id: Option<i32>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct CreateMessageRequest {
    pub faction: Option<String>,
    pub display_name: Option<String>,
    pub body: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct MessageResponse {
    pub id: i32,
    pub faction: Faction,
    pub display_name: String,
    pub body: String,
    pub user: Option<String>,
    pub created_at: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct ListMessagesResponse {
    pub has_more: bool,
    pub messages: Vec<MessageResponse>,
}

#[derive(Clone, Debug, Serialize)]
pub struct CreateMessageResponse {
    pub message: MessageResponse,
}

#[derive(Clone, Debug, Serialize)]
pub struct ErrorResponse {
    pub error: &'static str,
}

#[derive(Clone, Debug, Serialize)]
pub struct ValidationErrorResponse {
    pub error: &'static str,
    pub issues: HashMap<&'static str, Vec<&'static str>>,
}

#[derive(Clone, Debug, Serialize)]
pub struct MessagePostRateLimitResponse {
    pub error: &'static str,
    pub cooldown_ms: u64,
    pub retry_after_ms: u64,
    pub retry_after_seconds: u64,
    pub next_allowed_at: String,
}

#[derive(Clone, Debug)]
pub struct MessagePostRateLimitAllowed {
    pub key: String,
    pub next_allowed_at: SystemTime,
}

#[derive(Clone, Debug)]
pub struct MessagePostRateLimitDenied {
    pub cooldown_ms: u64,
    pub retry_after_ms: u64,
    pub retry_after_seconds: u64,
    pub next_allowed_at: SystemTime,
}

pub async fn list(State(state): State<AppDependencies>, RawQuery(raw_query): RawQuery) -> Response {
    let query = match parse_list_query(raw_query.as_deref()) {
        Ok(query) => query,
        Err(response) => return response.into_response(),
    };

    match load_messages(&state, query).await {
        Ok(response) => Json(response).into_response(),
        Err(error) => internal_server_error(error).into_response(),
    }
}

pub async fn create(
    State(state): State<AppDependencies>,
    headers: HeaderMap,
    body: Result<Json<CreateMessageRequest>, JsonRejection>,
) -> Response {
    let body = match body {
        Ok(Json(body)) => body,
        Err(_) => return invalid_message_payload("body", "Expected a JSON object").into_response(),
    };
    let message = match validate_create_message(body) {
        Ok(message) => message,
        Err(response) => return response.into_response(),
    };

    let rate_limit_key = get_message_post_rate_limit_key(&headers);
    let reservation = {
        let mut limiter = match state.message_post_rate_limiter.lock() {
            Ok(limiter) => limiter,
            Err(error) => {
                tracing::error!(
                    name = "PoisonError",
                    message = %error,
                    "Message post rate limiter lock poisoned"
                );
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        error: "Internal server error",
                    }),
                )
                    .into_response();
            }
        };
        limiter.reserve(rate_limit_key)
    };

    let allowed = match reservation {
        RateLimitDecision::Allowed(allowed) => allowed,
        RateLimitDecision::Denied(denied) => {
            return send_rate_limit_response(denied).into_response()
        }
    };

    match insert_message(&state, &message).await {
        Ok(message) => {
            (StatusCode::CREATED, Json(CreateMessageResponse { message })).into_response()
        }
        Err(error) => {
            release_rate_limit_reservation(&state, &allowed);
            internal_server_error(error).into_response()
        }
    }
}

#[derive(Clone, Debug)]
struct ValidCreateMessage {
    faction: Faction,
    display_name: String,
    body: String,
}

#[derive(Clone, Debug)]
enum RateLimitDecision {
    Allowed(MessagePostRateLimitAllowed),
    Denied(MessagePostRateLimitDenied),
}

#[derive(Debug)]
pub struct MessagePostRateLimiter {
    cooldown_ms: u64,
    next_allowed_at_by_key: HashMap<String, SystemTime>,
}

impl Default for MessagePostRateLimiter {
    fn default() -> Self {
        Self::new(MESSAGE_POST_COOLDOWN_MS)
    }
}

impl MessagePostRateLimiter {
    pub fn new(cooldown_ms: u64) -> Self {
        Self {
            cooldown_ms,
            next_allowed_at_by_key: HashMap::new(),
        }
    }

    fn reserve(&mut self, key: String) -> RateLimitDecision {
        let now = SystemTime::now();
        self.delete_expired_entries(now);

        if let Some(next_allowed_at) = self.next_allowed_at_by_key.get(&key).copied() {
            if next_allowed_at > now {
                let retry_after_ms = next_allowed_at
                    .duration_since(now)
                    .map(|duration| duration.as_millis().try_into().unwrap_or(u64::MAX))
                    .unwrap_or(0);
                return RateLimitDecision::Denied(MessagePostRateLimitDenied {
                    cooldown_ms: self.cooldown_ms,
                    retry_after_ms,
                    retry_after_seconds: retry_after_ms.div_ceil(1_000),
                    next_allowed_at,
                });
            }
        }

        let next_allowed_at = now + std::time::Duration::from_millis(self.cooldown_ms);
        self.next_allowed_at_by_key
            .insert(key.clone(), next_allowed_at);
        RateLimitDecision::Allowed(MessagePostRateLimitAllowed {
            key,
            next_allowed_at,
        })
    }

    fn release(&mut self, key: &str, next_allowed_at: SystemTime) {
        if self.next_allowed_at_by_key.get(key).copied() == Some(next_allowed_at) {
            self.next_allowed_at_by_key.remove(key);
        }
    }

    fn delete_expired_entries(&mut self, now: SystemTime) {
        self.next_allowed_at_by_key
            .retain(|_, next_allowed_at| *next_allowed_at > now);
    }
}

async fn load_messages(
    state: &AppDependencies,
    query: ListMessagesQuery,
) -> Result<ListMessagesResponse, sqlx::Error> {
    let fetch_limit = query.limit + 1;
    let rows = match (query.faction, query.before_id) {
        (Some(faction), Some(before_id)) => {
            sqlx::query(
                r#"
                select id, faction::text as faction, display_name, body, "user", to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at
                from messages
                where faction = $1::faction and id < $2
                order by id desc
                limit $3
                "#,
            )
            .bind(faction.as_str())
            .bind(before_id)
            .bind(fetch_limit)
            .fetch_all(&state.db_pool)
            .await?
        }
        (Some(faction), None) => {
            sqlx::query(
                r#"
                select id, faction::text as faction, display_name, body, "user", to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at
                from messages
                where faction = $1::faction
                order by id desc
                limit $2
                "#,
            )
            .bind(faction.as_str())
            .bind(fetch_limit)
            .fetch_all(&state.db_pool)
            .await?
        }
        (None, Some(before_id)) => {
            sqlx::query(
                r#"
                select id, faction::text as faction, display_name, body, "user", to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at
                from messages
                where id < $1
                order by id desc
                limit $2
                "#,
            )
            .bind(before_id)
            .bind(fetch_limit)
            .fetch_all(&state.db_pool)
            .await?
        }
        (None, None) => {
            sqlx::query(
                r#"
                select id, faction::text as faction, display_name, body, "user", to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at
                from messages
                order by id desc
                limit $1
                "#,
            )
            .bind(fetch_limit)
            .fetch_all(&state.db_pool)
            .await?
        }
    };

    let has_more = rows.len() as i64 > query.limit;
    let messages = rows
        .into_iter()
        .take(query.limit as usize)
        .map(row_to_message_response)
        .collect::<Result<Vec<_>, _>>()?;

    Ok(ListMessagesResponse { has_more, messages })
}

async fn insert_message(
    state: &AppDependencies,
    message: &ValidCreateMessage,
) -> Result<MessageResponse, sqlx::Error> {
    let row = sqlx::query(
        r#"
        insert into messages (faction, display_name, body, "user")
        values ($1::faction, $2, $3, null)
        returning id, faction::text as faction, display_name, body, "user", to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at
        "#,
    )
    .bind(message.faction.as_str())
    .bind(&message.display_name)
    .bind(&message.body)
    .fetch_one(&state.db_pool)
    .await?;

    row_to_message_response(row)
}

fn row_to_message_response(row: sqlx::postgres::PgRow) -> Result<MessageResponse, sqlx::Error> {
    let faction: String = row.try_get("faction")?;
    Ok(MessageResponse {
        id: row.try_get("id")?,
        faction: Faction::parse(&faction).unwrap_or(Faction::AiHaters),
        display_name: row.try_get("display_name")?,
        body: row.try_get("body")?,
        user: row.try_get("user")?,
        created_at: row.try_get("created_at")?,
    })
}

fn parse_list_query(
    raw_query: Option<&str>,
) -> Result<ListMessagesQuery, (StatusCode, Json<ValidationErrorResponse>)> {
    let mut faction = None;
    let mut limit = DEFAULT_LIMIT;
    let mut before_id = None;

    if let Some(raw_query) = raw_query {
        for (key, value) in form_urlencoded::parse(raw_query.as_bytes()) {
            match key.as_ref() {
                "faction" => {
                    faction = Some(
                        Faction::parse(&value)
                            .ok_or_else(|| invalid_message_query("faction", "Invalid faction"))?,
                    );
                }
                "limit" => {
                    limit = value
                        .parse::<i64>()
                        .ok()
                        .filter(|value| (1..=MAX_LIMIT).contains(value))
                        .ok_or_else(|| {
                            invalid_message_query("limit", "Expected an integer from 1 to 50")
                        })?;
                }
                "before_id" => {
                    before_id = Some(
                        value
                            .parse::<i32>()
                            .ok()
                            .filter(|value| *value >= 1)
                            .ok_or_else(|| {
                                invalid_message_query("before_id", "Expected a positive integer")
                            })?,
                    );
                }
                _ => return Err(invalid_message_query("query", "Unknown query parameter")),
            }
        }
    }

    Ok(ListMessagesQuery {
        faction,
        limit,
        before_id,
    })
}

fn validate_create_message(
    request: CreateMessageRequest,
) -> Result<ValidCreateMessage, (StatusCode, Json<ValidationErrorResponse>)> {
    let faction = match request.faction.as_deref().and_then(Faction::parse) {
        Some(faction) => faction,
        None => return Err(invalid_message_payload("faction", "Invalid faction")),
    };

    let display_name = request.display_name.unwrap_or_default().trim().to_owned();
    if display_name.is_empty() || display_name.len() > 80 {
        return Err(invalid_message_payload(
            "display_name",
            "Expected 1 to 80 characters",
        ));
    }

    let body = request.body.unwrap_or_default().trim().to_owned();
    if body.is_empty() || body.len() > 1_000 {
        return Err(invalid_message_payload(
            "body",
            "Expected 1 to 1000 characters",
        ));
    }

    Ok(ValidCreateMessage {
        faction,
        display_name,
        body,
    })
}

fn invalid_message_query(
    field: &'static str,
    message: &'static str,
) -> (StatusCode, Json<ValidationErrorResponse>) {
    invalid_response("Invalid message query", field, message)
}

fn invalid_message_payload(
    field: &'static str,
    message: &'static str,
) -> (StatusCode, Json<ValidationErrorResponse>) {
    invalid_response("Invalid message payload", field, message)
}

fn invalid_response(
    error: &'static str,
    field: &'static str,
    message: &'static str,
) -> (StatusCode, Json<ValidationErrorResponse>) {
    let mut issues = HashMap::new();
    issues.insert(field, vec![message]);
    (
        StatusCode::BAD_REQUEST,
        Json(ValidationErrorResponse { error, issues }),
    )
}

fn send_rate_limit_response(
    rate_limit: MessagePostRateLimitDenied,
) -> (StatusCode, HeaderMap, Json<MessagePostRateLimitResponse>) {
    let mut headers = HeaderMap::new();
    if let Ok(value) = HeaderValue::from_str(&rate_limit.retry_after_seconds.to_string()) {
        headers.insert(header::RETRY_AFTER, value);
    }

    (
        StatusCode::TOO_MANY_REQUESTS,
        headers,
        Json(MessagePostRateLimitResponse {
            error: "Message post cooldown active",
            cooldown_ms: rate_limit.cooldown_ms,
            retry_after_ms: rate_limit.retry_after_ms,
            retry_after_seconds: rate_limit.retry_after_seconds,
            next_allowed_at: system_time_to_iso(rate_limit.next_allowed_at),
        }),
    )
}

fn release_rate_limit_reservation(state: &AppDependencies, allowed: &MessagePostRateLimitAllowed) {
    match state.message_post_rate_limiter.lock() {
        Ok(mut limiter) => limiter.release(&allowed.key, allowed.next_allowed_at),
        Err(error) => tracing::error!(
            name = "PoisonError",
            message = %error,
            "Message post rate limiter lock poisoned while releasing reservation"
        ),
    }
}

fn internal_server_error(error: sqlx::Error) -> (StatusCode, Json<ErrorResponse>) {
    tracing::error!(
        name = "sqlx::Error",
        code = ?error.as_database_error().and_then(|db_error| db_error.code()),
        message = %error,
        "Messages endpoint database operation failed"
    );

    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(ErrorResponse {
            error: "Internal server error",
        }),
    )
}

fn get_message_post_rate_limit_key(headers: &HeaderMap) -> String {
    get_first_header_value(headers, "x-forwarded-for")
        .or_else(|| get_first_header_value(headers, "fly-client-ip"))
        .or_else(|| get_first_header_value(headers, "cf-connecting-ip"))
        .or_else(|| get_first_header_value(headers, "x-real-ip"))
        .unwrap_or_else(|| "unknown-client".to_owned())
}

fn get_first_header_value(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(',').next())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn system_time_to_iso(value: SystemTime) -> String {
    DateTime::<Utc>::from(value).to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_default_list_query() {
        let query = parse_list_query(None).expect("query should parse");
        assert_eq!(query.faction, None);
        assert_eq!(query.limit, DEFAULT_LIMIT);
        assert_eq!(query.before_id, None);
    }

    #[test]
    fn parses_list_query_values() {
        let query = parse_list_query(Some("faction=ai_lovers&limit=50&before_id=12"))
            .expect("query should parse");
        assert_eq!(query.faction, Some(Faction::AiLovers));
        assert_eq!(query.limit, 50);
        assert_eq!(query.before_id, Some(12));
    }

    #[test]
    fn rejects_invalid_list_query_values() {
        assert!(parse_list_query(Some("faction=robots")).is_err());
        assert!(parse_list_query(Some("limit=0")).is_err());
        assert!(parse_list_query(Some("before_id=-1")).is_err());
        assert!(parse_list_query(Some("extra=1")).is_err());
    }

    #[test]
    fn validates_and_trims_create_message() {
        let message = validate_create_message(CreateMessageRequest {
            faction: Some("ai_haters".to_owned()),
            display_name: Some("  Sentinel  ".to_owned()),
            body: Some("  Hold the line  ".to_owned()),
        })
        .expect("message should validate");

        assert_eq!(message.faction, Faction::AiHaters);
        assert_eq!(message.display_name, "Sentinel");
        assert_eq!(message.body, "Hold the line");
    }

    #[test]
    fn rejects_invalid_create_message() {
        assert!(validate_create_message(CreateMessageRequest {
            faction: Some("robots".to_owned()),
            display_name: Some("name".to_owned()),
            body: Some("body".to_owned()),
        })
        .is_err());
        assert!(validate_create_message(CreateMessageRequest {
            faction: Some("ai_haters".to_owned()),
            display_name: Some(" ".to_owned()),
            body: Some("body".to_owned()),
        })
        .is_err());
        assert!(validate_create_message(CreateMessageRequest {
            faction: Some("ai_haters".to_owned()),
            display_name: Some("name".to_owned()),
            body: Some(" ".to_owned()),
        })
        .is_err());
    }

    #[test]
    fn chooses_first_client_ip_header_value() {
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-forwarded-for",
            HeaderValue::from_static("203.0.113.1, 10.0.0.1"),
        );
        assert_eq!(get_message_post_rate_limit_key(&headers), "203.0.113.1");
    }

    #[test]
    fn rate_limiter_denies_repeated_reservation_and_releases() {
        let mut limiter = MessagePostRateLimiter::new(30_000);
        let first = limiter.reserve("client".to_owned());
        let RateLimitDecision::Allowed(first) = first else {
            panic!("first reservation should be allowed");
        };

        assert!(matches!(
            limiter.reserve("client".to_owned()),
            RateLimitDecision::Denied(_)
        ));

        limiter.release(&first.key, first.next_allowed_at);
        assert!(matches!(
            limiter.reserve("client".to_owned()),
            RateLimitDecision::Allowed(_)
        ));
    }
}
