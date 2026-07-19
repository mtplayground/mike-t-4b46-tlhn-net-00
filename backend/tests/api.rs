use axum::{
    body::{to_bytes, Body},
    http::{header, Method, Request, StatusCode},
    Router,
};
use serde_json::{json, Value};
use sqlx::postgres::PgPoolOptions;
use std::{
    fs,
    net::TcpListener,
    path::PathBuf,
    process::Command,
    sync::{
        Arc, Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tlhn_backend::{
    app::{create_app, AppDependencies},
    auth::{AuthSession, StaticSessionVerifier},
    config::ServerConfig,
    routes::messages::MessagePostRateLimiter,
};
use tower::ServiceExt;

const POSTGRES_BIN: &str = "/usr/lib/postgresql/16/bin";

#[tokio::test(flavor = "multi_thread")]
async fn rust_api_integration_flow_covers_existing_node_suite_behavior(
) -> Result<(), Box<dyn std::error::Error>> {
    let postgres = TestPostgres::start()?;
    postgres.apply_migrations()?;
    let mut app = build_app(&postgres.database_url()).await?;

    let health = request_json(&mut app, Method::GET, "/api/health", None, &[]).await?;
    assert_eq!(health.status, StatusCode::OK);
    assert_eq!(health.json["status"], "ok");
    assert_eq!(health.json["product"], "The Last Human Network");
    assert_eq!(health.json["database"]["status"], "ok");

    let unauthenticated_session =
        request_json(&mut app, Method::GET, "/api/auth/session", None, &[]).await?;
    assert_eq!(unauthenticated_session.status, StatusCode::OK);
    assert_eq!(
        unauthenticated_session.json,
        json!({"authenticated": false})
    );

    let mut authenticated_app =
        build_app_with_auth_session(&postgres.database_url(), Some(test_auth_session())).await?;
    let authenticated_session =
        request_json(&mut authenticated_app, Method::GET, "/api/auth/session", None, &[]).await?;
    assert_eq!(authenticated_session.status, StatusCode::OK);
    assert_eq!(authenticated_session.json["authenticated"], true);
    assert_eq!(
        authenticated_session.json["user"]["sub"],
        "platform-user-1"
    );
    assert_eq!(
        authenticated_session.json["user"]["email"],
        "human@example.test"
    );
    assert_eq!(authenticated_session.json["user"]["email_verified"], true);
    assert_eq!(authenticated_session.json["user"]["name"], "TLHN Human");
    assert_eq!(
        authenticated_session.json["user"]["picture"],
        "https://cdn.example.test/avatar.png"
    );
    assert_eq!(
        authenticated_session.json["user"]["newly_registered"],
        true
    );
    let account_pseudonym = authenticated_session.json["user"]["pseudonym"]
        .as_str()
        .ok_or("missing account pseudonym")?
        .to_owned();
    let account_faction = authenticated_session.json["user"]["faction"]
        .as_str()
        .ok_or("missing account faction")?
        .to_owned();
    assert!(is_generated_display_name(&account_pseudonym));
    assert!(matches!(
        account_faction.as_str(),
        "ai_haters" | "ai_lovers"
    ));

    let repeated_authenticated_session =
        request_json(&mut authenticated_app, Method::GET, "/api/auth/session", None, &[]).await?;
    assert_eq!(repeated_authenticated_session.status, StatusCode::OK);
    assert_eq!(
        repeated_authenticated_session.json["user"]["newly_registered"],
        false
    );
    assert_eq!(
        repeated_authenticated_session.json["user"]["pseudonym"].as_str(),
        Some(account_pseudonym.as_str())
    );
    assert_eq!(
        repeated_authenticated_session.json["user"]["faction"].as_str(),
        Some(account_faction.as_str())
    );

    let mut login_app = build_app_with_platform_auth(&postgres.database_url()).await?;
    let login = request_json(
        &mut login_app,
        Method::GET,
        "/api/auth/login",
        None,
        &[
            ("x-forwarded-proto", "https"),
            ("x-forwarded-host", "tlhn-public.mctai.app"),
        ],
    )
    .await?;
    assert_eq!(login.status, StatusCode::OK);
    let login_url = login.json["login_url"]
        .as_str()
        .ok_or("missing login_url")?;
    assert!(login_url.starts_with("https://auth.mctai.app/login?"));
    assert!(login_url.contains("app_token=app_test"));
    assert!(login_url.contains("return_to=https%3A%2F%2Ftlhn-public.mctai.app"));

    let mut news_app = build_app_with_news_bot_token(&postgres.database_url(), "news-token").await?;
    let news_payload = json!({
        "external_id": "wire:2026-07-19:001",
        "title": "AI data center vote clears final committee",
        "url": "https://news.example.test/ai-data-center-vote",
        "summary": "A city committee advanced a contested AI infrastructure plan after hours of testimony.",
        "source_name": "Example Wire",
        "published_at": "2026-07-19T00:15:30Z"
    });

    let missing_news_token = request_json(
        &mut news_app,
        Method::POST,
        "/api/news",
        Some(news_payload.clone()),
        &[(header::CONTENT_TYPE.as_str(), "application/json")],
    )
    .await?;
    assert_eq!(missing_news_token.status, StatusCode::UNAUTHORIZED);
    assert_eq!(missing_news_token.json["error"], "News bot token required");

    let invalid_news_token = request_json(
        &mut news_app,
        Method::POST,
        "/api/news",
        Some(news_payload.clone()),
        &[
            (header::CONTENT_TYPE.as_str(), "application/json"),
            (header::AUTHORIZATION.as_str(), "Bearer wrong-token"),
        ],
    )
    .await?;
    assert_eq!(invalid_news_token.status, StatusCode::FORBIDDEN);
    assert_eq!(invalid_news_token.json["error"], "Invalid news bot token");

    let invalid_news_payload = request_json(
        &mut news_app,
        Method::POST,
        "/api/news",
        Some(json!({
            "external_id": "wire:bad",
            "title": "",
            "url": "not-a-url",
            "summary": "Missing a title and valid URL.",
            "source_name": "Example Wire",
            "published_at": "not-a-date"
        })),
        &[
            (header::CONTENT_TYPE.as_str(), "application/json"),
            (header::AUTHORIZATION.as_str(), "Bearer news-token"),
        ],
    )
    .await?;
    assert_eq!(invalid_news_payload.status, StatusCode::BAD_REQUEST);
    assert_eq!(invalid_news_payload.json["error"], "Invalid news payload");

    let created_news = request_json(
        &mut news_app,
        Method::POST,
        "/api/news",
        Some(news_payload.clone()),
        &[
            (header::CONTENT_TYPE.as_str(), "application/json"),
            (header::AUTHORIZATION.as_str(), "Bearer news-token"),
        ],
    )
    .await?;
    assert_eq!(created_news.status, StatusCode::CREATED);
    assert_eq!(
        created_news.json["article"]["external_id"],
        "wire:2026-07-19:001"
    );
    assert_eq!(
        created_news.json["article"]["title"],
        "AI data center vote clears final committee"
    );
    assert_eq!(
        created_news.json["article"]["published_at"],
        "2026-07-19T00:15:30.000Z"
    );
    let news_id = created_news.json["article"]["id"]
        .as_i64()
        .ok_or("missing news item id")?;

    let updated_news = request_json(
        &mut news_app,
        Method::POST,
        "/api/news",
        Some(json!({
            "external_id": "wire:2026-07-19:001",
            "title": "AI data center vote clears full council",
            "url": "https://news.example.test/ai-data-center-vote-updated",
            "summary": "The same external story was updated after the full council vote.",
            "source_name": "Example Wire",
            "published_at": "2026-07-19T01:00:00Z"
        })),
        &[
            (header::CONTENT_TYPE.as_str(), "application/json"),
            (header::AUTHORIZATION.as_str(), "Bearer news-token"),
        ],
    )
    .await?;
    assert_eq!(updated_news.status, StatusCode::CREATED);
    assert_eq!(updated_news.json["article"]["id"].as_i64(), Some(news_id));
    assert_eq!(
        updated_news.json["article"]["title"],
        "AI data center vote clears full council"
    );
    assert_eq!(count_news_items(&postgres.database_url()).await?, 1);

    let initial_counts =
        request_json(&mut app, Method::GET, "/api/factions/counts", None, &[]).await?;
    assert_eq!(initial_counts.status, StatusCode::OK);
    assert_eq!(
        initial_counts.json["counts"],
        json!({"ai_haters": 0, "ai_lovers": 0})
    );

    let join = request_json(
        &mut app,
        Method::POST,
        "/api/factions/ai_haters/join",
        None,
        &[],
    )
    .await?;
    assert_eq!(join.status, StatusCode::OK);
    assert_eq!(join.json["joined"], true);
    assert_eq!(join.json["already_joined"], false);
    assert_eq!(join.json["faction"], "ai_haters");
    assert_eq!(join.json["counts"], json!({"ai_haters": 1, "ai_lovers": 0}));
    let display_name = join.json["display_name"]
        .as_str()
        .ok_or("missing display name")?
        .to_owned();
    assert!(is_generated_display_name(&display_name));
    let cookie_header = cookie_header(&join)?;

    let repeated_join = request_json(
        &mut app,
        Method::POST,
        "/api/factions/ai_lovers/join",
        None,
        &[(header::COOKIE.as_str(), cookie_header.as_str())],
    )
    .await?;
    assert_eq!(repeated_join.status, StatusCode::OK);
    assert_eq!(repeated_join.json["already_joined"], true);
    assert_eq!(repeated_join.json["faction"], "ai_haters");
    assert_eq!(
        repeated_join.json["counts"],
        json!({"ai_haters": 1, "ai_lovers": 0})
    );

    let unauthenticated_message = request_json(
        &mut app,
        Method::POST,
        "/api/messages",
        Some(json!({"body":"No session signal."})),
        &[(header::CONTENT_TYPE.as_str(), "application/json")],
    )
    .await?;
    assert_eq!(unauthenticated_message.status, StatusCode::UNAUTHORIZED);
    assert_eq!(
        unauthenticated_message.json["error"],
        "Authentication required"
    );

    let invalid_message = request_json(
        &mut authenticated_app,
        Method::POST,
        "/api/messages",
        Some(json!({"body":""})),
        &[(header::CONTENT_TYPE.as_str(), "application/json")],
    )
    .await?;
    assert_eq!(invalid_message.status, StatusCode::BAD_REQUEST);
    assert_eq!(invalid_message.json["error"], "Invalid message payload");

    let message_payload = json!({
        "faction": if account_faction == "ai_haters" { "ai_lovers" } else { "ai_haters" },
        "display_name": "spoofed_abc12",
        "body": "End-to-end human signal."
    });
    let created_message = request_json(
        &mut authenticated_app,
        Method::POST,
        "/api/messages",
        Some(message_payload.clone()),
        &[
            (header::CONTENT_TYPE.as_str(), "application/json"),
            ("x-forwarded-for", "192.0.2.24"),
        ],
    )
    .await?;
    assert_eq!(created_message.status, StatusCode::CREATED);
    assert_eq!(
        created_message.json["message"]["body"],
        "End-to-end human signal."
    );
    assert_eq!(
        created_message.json["message"]["display_name"].as_str(),
        Some(account_pseudonym.as_str())
    );
    assert_eq!(
        created_message.json["message"]["faction"].as_str(),
        Some(account_faction.as_str())
    );
    assert_eq!(
        created_message.json["message"]["user"].as_str(),
        Some(account_pseudonym.as_str())
    );

    let second_immediate_message = request_json(
        &mut authenticated_app,
        Method::POST,
        "/api/messages",
        Some(json!({"body":"Second immediate signal."})),
        &[
            (header::CONTENT_TYPE.as_str(), "application/json"),
            ("x-forwarded-for", "192.0.2.24"),
        ],
    )
    .await?;
    assert_eq!(second_immediate_message.status, StatusCode::CREATED);
    assert_eq!(
        second_immediate_message.json["message"]["body"],
        "Second immediate signal."
    );

    let third_immediate_message = request_json(
        &mut authenticated_app,
        Method::POST,
        "/api/messages",
        Some(json!({"body":"Third immediate signal."})),
        &[
            (header::CONTENT_TYPE.as_str(), "application/json"),
            ("x-forwarded-for", "192.0.2.24"),
        ],
    )
    .await?;
    assert_eq!(third_immediate_message.status, StatusCode::CREATED);
    assert_eq!(
        third_immediate_message.json["message"]["body"],
        "Third immediate signal."
    );

    let fourth_immediate_message = request_json(
        &mut authenticated_app,
        Method::POST,
        "/api/messages",
        Some(json!({"body":"Fourth immediate signal."})),
        &[
            (header::CONTENT_TYPE.as_str(), "application/json"),
            ("x-forwarded-for", "192.0.2.24"),
        ],
    )
    .await?;
    assert_eq!(fourth_immediate_message.status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(
        fourth_immediate_message.json["error"],
        "Message post rate limit active"
    );
    assert_eq!(
        fourth_immediate_message
            .headers
            .get(header::RETRY_AFTER)
            .and_then(|value| value.to_str().ok()),
        Some("5")
    );
    assert_eq!(
        fourth_immediate_message.json["retry_after_seconds"],
        json!(5)
    );
    assert!(fourth_immediate_message.json["retry_after_ms"]
        .as_u64()
        .is_some_and(|retry_after_ms| (1..=5_000).contains(&retry_after_ms)));
    assert!(fourth_immediate_message.json["next_allowed_at"].is_string());

    for index in 1..=28 {
        insert_message(
            postgres.database_url().as_str(),
            account_faction.as_str(),
            "sentinel_pg001",
            format!("Paged signal {index}").as_str(),
        )
        .await?;
    }
    let opposite_faction = if account_faction == "ai_haters" {
        "ai_lovers"
    } else {
        "ai_haters"
    };
    for index in 1..=3 {
        insert_message(
            postgres.database_url().as_str(),
            opposite_faction,
            "oracle_cd456",
            format!("Blue signal {index}").as_str(),
        )
        .await?;
    }

    let first_page_uri = format!("/api/messages?faction={account_faction}&limit=25");
    let first_page = request_json(
        &mut app,
        Method::GET,
        &first_page_uri,
        None,
        &[],
    )
    .await?;
    assert_eq!(first_page.status, StatusCode::OK);
    assert_eq!(first_page.json["has_more"], true);
    let messages = first_page.json["messages"]
        .as_array()
        .ok_or("messages should be an array")?;
    assert_eq!(messages.len(), 25);
    assert_eq!(messages[0]["body"], "Paged signal 28");
    assert_eq!(messages[24]["body"], "Paged signal 4");
    let before_id = messages[24]["id"].as_i64().ok_or("missing before id")?;

    let second_page_uri =
        format!("/api/messages?faction={account_faction}&limit=25&before_id={before_id}");
    let second_page = request_json(&mut app, Method::GET, &second_page_uri, None, &[]).await?;
    assert_eq!(second_page.status, StatusCode::OK);
    assert_eq!(second_page.json["has_more"], false);
    let second_messages = second_page.json["messages"]
        .as_array()
        .ok_or("messages should be an array")?;
    assert_eq!(
        second_messages
            .iter()
            .map(|message| message["body"].as_str().unwrap_or_default())
            .collect::<Vec<_>>(),
        vec![
            "Paged signal 3",
            "Paged signal 2",
            "Paged signal 1",
            "Third immediate signal.",
            "Second immediate signal.",
            "End-to-end human signal."
        ]
    );

    let invalid_subscription = request_json(
        &mut app,
        Method::POST,
        "/api/subscriptions",
        Some(json!({"email":"not-an-email"})),
        &[(header::CONTENT_TYPE.as_str(), "application/json")],
    )
    .await?;
    assert_eq!(invalid_subscription.status, StatusCode::BAD_REQUEST);
    let first_subscription = request_json(
        &mut app,
        Method::POST,
        "/api/subscriptions",
        Some(json!({"email":"Flow@Human.NET"})),
        &[(header::CONTENT_TYPE.as_str(), "application/json")],
    )
    .await?;
    assert_eq!(first_subscription.status, StatusCode::CREATED);
    assert_eq!(
        first_subscription.json,
        json!({"already_subscribed": false, "email": "flow@human.net", "subscribed": true})
    );
    let duplicate_subscription = request_json(
        &mut app,
        Method::POST,
        "/api/subscriptions",
        Some(json!({"email":"flow@human.net"})),
        &[(header::CONTENT_TYPE.as_str(), "application/json")],
    )
    .await?;
    assert_eq!(duplicate_subscription.status, StatusCode::OK);
    assert_eq!(
        duplicate_subscription.json,
        json!({"already_subscribed": true, "email": "flow@human.net", "subscribed": true})
    );

    let root = request_text(&mut app, Method::GET, "/", None, &[]).await?;
    assert_eq!(root.status, StatusCode::OK);
    assert!(root.body.contains("<div id=\"root\"></div>"));

    let spa = request_text(&mut app, Method::GET, "/network/history", None, &[]).await?;
    assert_eq!(spa.status, StatusCode::OK);
    assert!(spa.body.contains("<div id=\"root\"></div>"));

    let api_not_found = request_json(&mut app, Method::GET, "/api/nope", None, &[]).await?;
    assert_eq!(api_not_found.status, StatusCode::NOT_FOUND);
    assert_eq!(api_not_found.json["error"], "Not found");

    Ok(())
}

async fn build_app(database_url: &str) -> Result<Router, Box<dyn std::error::Error>> {
    let config = ServerConfig::from_env_reader(|name| match name {
        "DATABASE_URL" => Some(database_url.to_owned()),
        "HOST" => Some("127.0.0.1".to_owned()),
        "PORT" => Some("8080".to_owned()),
        _ => None,
    })?;
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(database_url)
        .await?;
    Ok(create_app(AppDependencies {
        config: Arc::new(config),
        db_pool: pool,
        auth_verifier: Arc::new(StaticSessionVerifier::unauthenticated()),
        message_post_rate_limiter: Arc::new(Mutex::new(MessagePostRateLimiter::new(3, 5_000))),
    }))
}

async fn build_app_with_auth_session(
    database_url: &str,
    session: Option<AuthSession>,
) -> Result<Router, Box<dyn std::error::Error>> {
    let config = ServerConfig::from_env_reader(|name| match name {
        "DATABASE_URL" => Some(database_url.to_owned()),
        "HOST" => Some("127.0.0.1".to_owned()),
        "PORT" => Some("8080".to_owned()),
        _ => None,
    })?;
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(database_url)
        .await?;
    let auth_verifier = match session {
        Some(session) => StaticSessionVerifier::authenticated(session),
        None => StaticSessionVerifier::unauthenticated(),
    };
    Ok(create_app(AppDependencies {
        config: Arc::new(config),
        db_pool: pool,
        auth_verifier: Arc::new(auth_verifier),
        message_post_rate_limiter: Arc::new(Mutex::new(MessagePostRateLimiter::new(3, 5_000))),
    }))
}

async fn build_app_with_platform_auth(
    database_url: &str,
) -> Result<Router, Box<dyn std::error::Error>> {
    let config = ServerConfig::from_env_reader(|name| match name {
        "DATABASE_URL" => Some(database_url.to_owned()),
        "HOST" => Some("127.0.0.1".to_owned()),
        "PORT" => Some("8080".to_owned()),
        "MCTAI_AUTH_URL" => Some("https://auth.mctai.app".to_owned()),
        "MCTAI_AUTH_APP_TOKEN" => Some("app_test".to_owned()),
        "MCTAI_AUTH_JWKS_URL" => {
            Some("https://auth.mctai.app/.well-known/jwks.json".to_owned())
        }
        _ => None,
    })?;
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(database_url)
        .await?;
    Ok(create_app(AppDependencies {
        config: Arc::new(config),
        db_pool: pool,
        auth_verifier: Arc::new(StaticSessionVerifier::unauthenticated()),
        message_post_rate_limiter: Arc::new(Mutex::new(MessagePostRateLimiter::new(3, 1_000))),
    }))
}

async fn build_app_with_news_bot_token(
    database_url: &str,
    news_bot_token: &str,
) -> Result<Router, Box<dyn std::error::Error>> {
    let config = ServerConfig::from_env_reader(|name| match name {
        "DATABASE_URL" => Some(database_url.to_owned()),
        "HOST" => Some("127.0.0.1".to_owned()),
        "PORT" => Some("8080".to_owned()),
        "NEWS_BOT_TOKEN" => Some(news_bot_token.to_owned()),
        _ => None,
    })?;
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(database_url)
        .await?;
    Ok(create_app(AppDependencies {
        config: Arc::new(config),
        db_pool: pool,
        auth_verifier: Arc::new(StaticSessionVerifier::unauthenticated()),
        message_post_rate_limiter: Arc::new(Mutex::new(MessagePostRateLimiter::new(3, 5_000))),
    }))
}

fn test_auth_session() -> AuthSession {
    AuthSession {
        sub: "platform-user-1".to_owned(),
        email: Some("human@example.test".to_owned()),
        email_verified: Some(true),
        name: Some("TLHN Human".to_owned()),
        picture: Some("https://cdn.example.test/avatar.png".to_owned()),
    }
}

struct TestResponse {
    status: StatusCode,
    headers: axum::http::HeaderMap,
    json: Value,
}

struct TextResponse {
    status: StatusCode,
    body: String,
}

async fn request_json(
    app: &mut Router,
    method: Method,
    uri: &str,
    body: Option<Value>,
    headers: &[(&str, &str)],
) -> Result<TestResponse, Box<dyn std::error::Error>> {
    let response = request(app, method, uri, body, headers).await?;
    let status = response.status();
    let headers = response.headers().clone();
    let bytes = to_bytes(response.into_body(), usize::MAX).await?;
    let json = serde_json::from_slice(&bytes)?;
    Ok(TestResponse {
        status,
        headers,
        json,
    })
}

async fn request_text(
    app: &mut Router,
    method: Method,
    uri: &str,
    body: Option<Value>,
    headers: &[(&str, &str)],
) -> Result<TextResponse, Box<dyn std::error::Error>> {
    let response = request(app, method, uri, body, headers).await?;
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX).await?;
    let body = String::from_utf8(bytes.to_vec())?;
    Ok(TextResponse { status, body })
}

async fn request(
    app: &mut Router,
    method: Method,
    uri: &str,
    body: Option<Value>,
    headers: &[(&str, &str)],
) -> Result<axum::response::Response, Box<dyn std::error::Error>> {
    let body = match body {
        Some(value) => Body::from(serde_json::to_vec(&value)?),
        None => Body::empty(),
    };
    let mut builder = Request::builder().method(method).uri(uri);
    for (name, value) in headers {
        builder = builder.header(*name, *value);
    }
    let request = builder.body(body)?;
    Ok(app.clone().oneshot(request).await?)
}

fn cookie_header(response: &TestResponse) -> Result<String, Box<dyn std::error::Error>> {
    let mut cookies = Vec::new();
    for value in response.headers.get_all(header::SET_COOKIE) {
        let value = value.to_str()?;
        let first_pair = value.split(';').next().ok_or("empty set-cookie header")?;
        cookies.push(first_pair.to_owned());
    }
    Ok(cookies.join("; "))
}

fn is_generated_display_name(value: &str) -> bool {
    let Some((prefix, suffix)) = value.split_once('_') else {
        return false;
    };
    !prefix.is_empty()
        && prefix
            .as_bytes()
            .first()
            .is_some_and(|byte| byte.is_ascii_lowercase())
        && prefix
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
        && suffix.len() == 5
        && suffix
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
}

async fn insert_message(
    database_url: &str,
    faction: &str,
    display_name: &str,
    body: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(database_url)
        .await?;
    sqlx::query(
        r#"
        insert into messages (faction, display_name, body, "user")
        values ($1::faction, $2, $3, null)
        "#,
    )
    .bind(faction)
    .bind(display_name)
    .bind(body)
    .execute(&pool)
    .await?;
    pool.close().await;
    Ok(())
}

async fn count_news_items(database_url: &str) -> Result<i64, Box<dyn std::error::Error>> {
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(database_url)
        .await?;
    let count = sqlx::query_scalar::<_, i64>("select count(*) from news_items")
        .fetch_one(&pool)
        .await?;
    pool.close().await;
    Ok(count)
}

struct TestPostgres {
    data_dir: PathBuf,
    work_dir: PathBuf,
    port: u16,
}

impl TestPostgres {
    fn start() -> Result<Self, Box<dyn std::error::Error>> {
        let work_dir = unique_temp_dir();
        let data_dir = work_dir.join("data");
        fs::create_dir_all(&data_dir)?;
        run_command(
            Command::new("chown")
                .arg("-R")
                .arg("postgres:postgres")
                .arg(&work_dir),
        )?;
        run_as_postgres(
            Command::new(format!("{POSTGRES_BIN}/initdb"))
                .arg("-D")
                .arg(&data_dir)
                .arg("-A")
                .arg("trust")
                .arg("--no-sync"),
        )?;
        let port = unused_port()?;
        let log_path = work_dir.join("postgres.log");
        run_as_postgres(
            Command::new(format!("{POSTGRES_BIN}/pg_ctl"))
                .arg("-D")
                .arg(&data_dir)
                .arg("-l")
                .arg(&log_path)
                .arg("-o")
                .arg(format!("-h 127.0.0.1 -p {port}"))
                .arg("-w")
                .arg("start"),
        )?;
        Ok(Self {
            data_dir,
            work_dir,
            port,
        })
    }

    fn database_url(&self) -> String {
        format!("postgresql://postgres@127.0.0.1:{}/postgres", self.port)
    }

    fn apply_migrations(&self) -> Result<(), Box<dyn std::error::Error>> {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        for migration in [
            manifest_dir.join("drizzle/0000_baseline.sql"),
            manifest_dir.join("drizzle/0001_create_core_tables.sql"),
            manifest_dir.join("drizzle/0002_create_users.sql"),
            manifest_dir.join("drizzle/0003_create_news_items.sql"),
        ] {
            run_command(
                Command::new("psql")
                    .arg(self.database_url())
                    .arg("-v")
                    .arg("ON_ERROR_STOP=1")
                    .arg("-f")
                    .arg(migration),
            )?;
        }
        Ok(())
    }
}

impl Drop for TestPostgres {
    fn drop(&mut self) {
        let _ = run_as_postgres(
            Command::new(format!("{POSTGRES_BIN}/pg_ctl"))
                .arg("-D")
                .arg(&self.data_dir)
                .arg("-m")
                .arg("fast")
                .arg("-w")
                .arg("stop"),
        );
        let _ = fs::remove_dir_all(&self.work_dir);
    }
}

fn run_as_postgres(command: &mut Command) -> Result<(), Box<dyn std::error::Error>> {
    let program = command.get_program().to_owned();
    let args = command
        .get_args()
        .map(|arg| arg.to_owned())
        .collect::<Vec<_>>();
    let mut runuser = Command::new("runuser");
    runuser
        .arg("-u")
        .arg("postgres")
        .arg("--")
        .arg(program)
        .args(args);
    run_command(&mut runuser)
}

fn run_command(command: &mut Command) -> Result<(), Box<dyn std::error::Error>> {
    let output = command.output()?;
    if !output.status.success() {
        return Err(format!(
            "command failed: status={} stdout={} stderr={}",
            output.status,
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        )
        .into());
    }
    Ok(())
}

fn unique_temp_dir() -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    std::env::temp_dir().join(format!("tlhn-rust-api-test-{}-{nanos}", std::process::id()))
}

fn unused_port() -> Result<u16, Box<dyn std::error::Error>> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();
    drop(listener);
    Ok(port)
}
