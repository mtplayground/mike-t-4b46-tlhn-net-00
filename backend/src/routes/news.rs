use crate::app::AppDependencies;
use axum::{
    extract::{rejection::JsonRejection, RawQuery, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use std::collections::HashMap;
use url::{form_urlencoded, Url};

const MAX_EXTERNAL_ID_LENGTH: usize = 256;
const MAX_TITLE_LENGTH: usize = 300;
const MAX_URL_LENGTH: usize = 2048;
const MAX_SUMMARY_LENGTH: usize = 2_000;
const MAX_SOURCE_NAME_LENGTH: usize = 160;
const DEFAULT_LIMIT: i64 = 10;
const MAX_LIMIT: i64 = 50;

#[derive(Clone, Debug, Deserialize)]
pub struct CreateNewsItemRequest {
    pub external_id: Option<String>,
    pub title: Option<String>,
    pub url: Option<String>,
    pub summary: Option<String>,
    pub source_name: Option<String>,
    pub published_at: Option<String>,
}

#[derive(Clone, Debug)]
struct ListNewsQuery {
    limit: i64,
    before_id: Option<i32>,
}

#[derive(Clone, Debug)]
struct ValidCreateNewsItem {
    external_id: String,
    title: String,
    url: String,
    summary: String,
    source_name: String,
    published_at: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct NewsArticleResponse {
    pub id: i32,
    pub external_id: String,
    pub title: String,
    pub url: String,
    pub summary: String,
    pub source_name: String,
    pub published_at: String,
    pub created_at: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct CreateNewsItemResponse {
    pub article: NewsArticleResponse,
}

#[derive(Clone, Debug, Serialize)]
pub struct ListNewsResponse {
    pub has_more: bool,
    pub articles: Vec<NewsArticleResponse>,
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

pub async fn list(State(state): State<AppDependencies>, RawQuery(raw_query): RawQuery) -> Response {
    let query = match parse_list_query(raw_query.as_deref()) {
        Ok(query) => query,
        Err(response) => return response.into_response(),
    };

    match load_news_items(&state, query).await {
        Ok(response) => Json(response).into_response(),
        Err(error) => internal_server_error(error).into_response(),
    }
}

pub async fn create(
    State(state): State<AppDependencies>,
    headers: HeaderMap,
    body: Result<Json<CreateNewsItemRequest>, JsonRejection>,
) -> Response {
    if let Err(response) = authorize_news_bot(&state, &headers) {
        return response.into_response();
    }

    let body = match body {
        Ok(Json(body)) => body,
        Err(_) => return invalid_news_payload("body", "Expected a JSON object").into_response(),
    };
    let news_item = match validate_create_news_item(body) {
        Ok(news_item) => news_item,
        Err(response) => return response.into_response(),
    };

    match upsert_news_item(&state, &news_item).await {
        Ok(article) => (StatusCode::CREATED, Json(CreateNewsItemResponse { article }))
            .into_response(),
        Err(error) => internal_server_error(error).into_response(),
    }
}

fn authorize_news_bot(
    state: &AppDependencies,
    headers: &HeaderMap,
) -> Result<(), (StatusCode, Json<ErrorResponse>)> {
    let Some(expected_token) = state.config.news_bot_token.as_deref() else {
        tracing::error!("NEWS_BOT_TOKEN is not configured; news ingest is unavailable");
        return Err((
            StatusCode::SERVICE_UNAVAILABLE,
            Json(ErrorResponse {
                error: "News ingest unavailable",
            }),
        ));
    };

    let Some(provided_token) = bearer_token(headers) else {
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(ErrorResponse {
                error: "News bot token required",
            }),
        ));
    };

    if provided_token != expected_token {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ErrorResponse {
                error: "Invalid news bot token",
            }),
        ));
    }

    Ok(())
}

fn bearer_token(headers: &HeaderMap) -> Option<&str> {
    let value = headers.get(header::AUTHORIZATION)?.to_str().ok()?;
    let (scheme, token) = value.split_once(' ')?;
    if scheme.eq_ignore_ascii_case("Bearer") && !token.trim().is_empty() {
        Some(token.trim())
    } else {
        None
    }
}

fn parse_list_query(
    raw_query: Option<&str>,
) -> Result<ListNewsQuery, (StatusCode, Json<ValidationErrorResponse>)> {
    let mut limit = DEFAULT_LIMIT;
    let mut before_id = None;

    if let Some(raw_query) = raw_query {
        for (key, value) in form_urlencoded::parse(raw_query.as_bytes()) {
            match key.as_ref() {
                "limit" => {
                    let parsed = value
                        .parse::<i64>()
                        .ok()
                        .filter(|value| *value >= 1)
                        .ok_or_else(|| {
                            invalid_news_query("limit", "Expected a positive integer")
                        })?;
                    limit = parsed.min(MAX_LIMIT);
                }
                "before_id" => {
                    before_id = Some(
                        value
                            .parse::<i32>()
                            .ok()
                            .filter(|value| *value >= 1)
                            .ok_or_else(|| {
                                invalid_news_query("before_id", "Expected a positive integer")
                            })?,
                    );
                }
                _ => return Err(invalid_news_query("query", "Unknown query parameter")),
            }
        }
    }

    Ok(ListNewsQuery { limit, before_id })
}

async fn load_news_items(
    state: &AppDependencies,
    query: ListNewsQuery,
) -> Result<ListNewsResponse, sqlx::Error> {
    let fetch_limit = query.limit + 1;
    let rows = match query.before_id {
        Some(before_id) => {
            sqlx::query(
                r#"
                with cursor_item as (
                    select published_at, id
                    from news_items
                    where id = $1
                )
                select
                    news_items.id,
                    external_id,
                    title,
                    url,
                    summary,
                    source_name,
                    to_char(news_items.published_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as published_at,
                    to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at
                from news_items, cursor_item
                where
                    news_items.published_at < cursor_item.published_at
                    or (
                        news_items.published_at = cursor_item.published_at
                        and news_items.id < cursor_item.id
                    )
                order by news_items.published_at desc, news_items.id desc
                limit $2
                "#,
            )
            .bind(before_id)
            .bind(fetch_limit)
            .fetch_all(&state.db_pool)
            .await?
        }
        None => {
            sqlx::query(
                r#"
                select
                    id,
                    external_id,
                    title,
                    url,
                    summary,
                    source_name,
                    to_char(published_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as published_at,
                    to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at
                from news_items
                order by published_at desc, id desc
                limit $1
                "#,
            )
            .bind(fetch_limit)
            .fetch_all(&state.db_pool)
            .await?
        }
    };

    let has_more = rows.len() as i64 > query.limit;
    let articles = rows
        .into_iter()
        .take(query.limit as usize)
        .map(row_to_news_article_response)
        .collect::<Result<Vec<_>, _>>()?;

    Ok(ListNewsResponse { has_more, articles })
}

fn validate_create_news_item(
    request: CreateNewsItemRequest,
) -> Result<ValidCreateNewsItem, (StatusCode, Json<ValidationErrorResponse>)> {
    let external_id = required_trimmed(request.external_id, "external_id", MAX_EXTERNAL_ID_LENGTH)?;
    let title = required_trimmed(request.title, "title", MAX_TITLE_LENGTH)?;
    let url = required_trimmed(request.url, "url", MAX_URL_LENGTH)?;
    let summary = required_trimmed(request.summary, "summary", MAX_SUMMARY_LENGTH)?;
    let source_name = required_trimmed(request.source_name, "source_name", MAX_SOURCE_NAME_LENGTH)?;
    let published_at = required_trimmed(request.published_at, "published_at", 64)?;

    let parsed_url = Url::parse(&url)
        .map_err(|_| invalid_news_payload("url", "Expected an absolute HTTP or HTTPS URL"))?;
    if !matches!(parsed_url.scheme(), "http" | "https") {
        return Err(invalid_news_payload(
            "url",
            "Expected an absolute HTTP or HTTPS URL",
        ));
    }

    let published_at = DateTime::parse_from_rfc3339(&published_at)
        .map_err(|_| invalid_news_payload("published_at", "Expected an RFC3339 timestamp"))?
        .with_timezone(&Utc)
        .to_rfc3339_opts(SecondsFormat::Millis, true);

    Ok(ValidCreateNewsItem {
        external_id,
        title,
        url,
        summary,
        source_name,
        published_at,
    })
}

fn required_trimmed(
    value: Option<String>,
    field: &'static str,
    max_len: usize,
) -> Result<String, (StatusCode, Json<ValidationErrorResponse>)> {
    let value = value.unwrap_or_default().trim().to_owned();
    if value.is_empty() || value.len() > max_len {
        return Err(invalid_news_payload(
            field,
            "Expected a non-blank value within the maximum length",
        ));
    }
    Ok(value)
}

async fn upsert_news_item(
    state: &AppDependencies,
    news_item: &ValidCreateNewsItem,
) -> Result<NewsArticleResponse, sqlx::Error> {
    let row = sqlx::query(
        r#"
        insert into news_items (external_id, title, url, summary, source_name, published_at)
        values ($1, $2, $3, $4, $5, $6::timestamptz)
        on conflict (external_id) do update set
            title = excluded.title,
            url = excluded.url,
            summary = excluded.summary,
            source_name = excluded.source_name,
            published_at = excluded.published_at
        returning
            id,
            external_id,
            title,
            url,
            summary,
            source_name,
            to_char(published_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as published_at,
            to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at
        "#,
    )
    .bind(&news_item.external_id)
    .bind(&news_item.title)
    .bind(&news_item.url)
    .bind(&news_item.summary)
    .bind(&news_item.source_name)
    .bind(&news_item.published_at)
    .fetch_one(&state.db_pool)
    .await?;

    row_to_news_article_response(row)
}

fn row_to_news_article_response(
    row: sqlx::postgres::PgRow,
) -> Result<NewsArticleResponse, sqlx::Error> {
    Ok(NewsArticleResponse {
        id: row.try_get("id")?,
        external_id: row.try_get("external_id")?,
        title: row.try_get("title")?,
        url: row.try_get("url")?,
        summary: row.try_get("summary")?,
        source_name: row.try_get("source_name")?,
        published_at: row.try_get("published_at")?,
        created_at: row.try_get("created_at")?,
    })
}

fn invalid_news_query(
    field: &'static str,
    message: &'static str,
) -> (StatusCode, Json<ValidationErrorResponse>) {
    let mut issues = HashMap::new();
    issues.insert(field, vec![message]);
    (
        StatusCode::BAD_REQUEST,
        Json(ValidationErrorResponse {
            error: "Invalid news query",
            issues,
        }),
    )
}

fn invalid_news_payload(
    field: &'static str,
    message: &'static str,
) -> (StatusCode, Json<ValidationErrorResponse>) {
    let mut issues = HashMap::new();
    issues.insert(field, vec![message]);
    (
        StatusCode::BAD_REQUEST,
        Json(ValidationErrorResponse {
            error: "Invalid news payload",
            issues,
        }),
    )
}

fn internal_server_error(error: sqlx::Error) -> (StatusCode, Json<ErrorResponse>) {
    tracing::error!(%error, "News route database operation failed");
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(ErrorResponse {
            error: "Internal server error",
        }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_default_list_query() {
        let parsed = parse_list_query(None).expect("default query should parse");
        assert_eq!(parsed.limit, DEFAULT_LIMIT);
        assert_eq!(parsed.before_id, None);
    }

    #[test]
    fn caps_list_query_limit() {
        let parsed = parse_list_query(Some("limit=999&before_id=42"))
            .expect("capped query should parse");
        assert_eq!(parsed.limit, MAX_LIMIT);
        assert_eq!(parsed.before_id, Some(42));
    }

    #[test]
    fn rejects_invalid_list_query() {
        let error = parse_list_query(Some("limit=0")).expect_err("query should be invalid");
        assert_eq!(error.0, StatusCode::BAD_REQUEST);
    }

    #[test]
    fn bearer_token_accepts_case_insensitive_bearer_scheme() {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::AUTHORIZATION,
            axum::http::HeaderValue::from_static("bearer token-123"),
        );
        assert_eq!(bearer_token(&headers), Some("token-123"));
    }

    #[test]
    fn validate_create_news_item_trims_and_normalizes_timestamp() {
        let valid = validate_create_news_item(CreateNewsItemRequest {
            external_id: Some(" external-1 ".to_owned()),
            title: Some(" A signal ".to_owned()),
            url: Some("https://news.example.test/story".to_owned()),
            summary: Some(" Summary ".to_owned()),
            source_name: Some(" Example Source ".to_owned()),
            published_at: Some("2026-07-19T00:00:00+00:00".to_owned()),
        })
        .expect("news item should validate");

        assert_eq!(valid.external_id, "external-1");
        assert_eq!(valid.published_at, "2026-07-19T00:00:00.000Z");
    }
}
