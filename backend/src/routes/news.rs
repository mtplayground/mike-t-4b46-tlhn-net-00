use crate::app::AppDependencies;
use axum::{
    extract::{rejection::JsonRejection, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use std::collections::HashMap;
use url::Url;

const MAX_EXTERNAL_ID_LENGTH: usize = 256;
const MAX_TITLE_LENGTH: usize = 300;
const MAX_URL_LENGTH: usize = 2048;
const MAX_SUMMARY_LENGTH: usize = 2_000;
const MAX_SOURCE_NAME_LENGTH: usize = 160;

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
pub struct ErrorResponse {
    pub error: &'static str,
}

#[derive(Clone, Debug, Serialize)]
pub struct ValidationErrorResponse {
    pub error: &'static str,
    pub issues: HashMap<&'static str, Vec<&'static str>>,
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
