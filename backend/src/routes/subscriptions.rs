use crate::{app::AppDependencies, email::send_welcome_email};
use axum::{
    extract::{rejection::JsonRejection, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

const MAX_EMAIL_LENGTH: usize = 320;

#[derive(Clone, Debug, Deserialize)]
pub struct CreateSubscriptionRequest {
    pub email: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct SubscriptionResponse {
    pub email: String,
    pub subscribed: bool,
    pub already_subscribed: bool,
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
    body: Result<Json<CreateSubscriptionRequest>, JsonRejection>,
) -> Response {
    let body = match body {
        Ok(Json(body)) => body,
        Err(_) => {
            return invalid_subscription_payload("email", "Expected a JSON object").into_response()
        }
    };

    let email = match normalize_and_validate_email(body.email) {
        Ok(email) => email,
        Err(response) => return response.into_response(),
    };

    match insert_subscription(&state, &email).await {
        Ok(created) => {
            if created {
                if let Err(error) = send_welcome_email(state.email_client.as_ref(), &email).await {
                    tracing::error!(
                        name = "EmailError",
                        message = %error,
                        recipient = %email,
                        "Welcome email send failed after new subscription"
                    );
                }
            }
            let status = if created {
                StatusCode::CREATED
            } else {
                StatusCode::OK
            };
            (
                status,
                Json(SubscriptionResponse {
                    email,
                    subscribed: true,
                    already_subscribed: !created,
                }),
            )
                .into_response()
        }
        Err(error) => internal_server_error(error).into_response(),
    }
}

async fn insert_subscription(state: &AppDependencies, email: &str) -> Result<bool, sqlx::Error> {
    let created = sqlx::query(
        r#"
        insert into subscriptions (email)
        values ($1)
        on conflict (email) do nothing
        returning email
        "#,
    )
    .bind(email)
    .fetch_optional(&state.db_pool)
    .await?;

    Ok(created.is_some())
}

fn normalize_and_validate_email(
    value: Option<String>,
) -> Result<String, (StatusCode, Json<ValidationErrorResponse>)> {
    let email = value.unwrap_or_default().trim().to_lowercase();

    if email.is_empty() || email.len() > MAX_EMAIL_LENGTH || !is_valid_email(&email) {
        return Err(invalid_subscription_payload(
            "email",
            "Invalid email address",
        ));
    }

    Ok(email)
}

fn is_valid_email(email: &str) -> bool {
    if email.bytes().any(|byte| byte.is_ascii_whitespace()) {
        return false;
    }

    let Some((local, domain)) = email.split_once('@') else {
        return false;
    };

    if local.is_empty() || domain.is_empty() || local.len() > 64 || domain.len() > 255 {
        return false;
    }

    if domain.starts_with('.') || domain.ends_with('.') || !domain.contains('.') {
        return false;
    }

    if domain.split('.').any(|label| label.is_empty()) {
        return false;
    }

    email.matches('@').count() == 1
}

fn invalid_subscription_payload(
    field: &'static str,
    message: &'static str,
) -> (StatusCode, Json<ValidationErrorResponse>) {
    let mut issues = HashMap::new();
    issues.insert(field, vec![message]);
    (
        StatusCode::BAD_REQUEST,
        Json(ValidationErrorResponse {
            error: "Invalid subscription payload",
            issues,
        }),
    )
}

fn internal_server_error(error: sqlx::Error) -> (StatusCode, Json<ErrorResponse>) {
    tracing::error!(
        name = "sqlx::Error",
        code = ?error.as_database_error().and_then(|db_error| db_error.code()),
        message = %error,
        "Subscriptions endpoint database operation failed"
    );

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
    fn normalizes_valid_email() {
        let email = normalize_and_validate_email(Some("  USER@Example.COM  ".to_owned()))
            .expect("email should validate");
        assert_eq!(email, "user@example.com");
    }

    #[test]
    fn rejects_invalid_email() {
        assert!(normalize_and_validate_email(None).is_err());
        assert!(normalize_and_validate_email(Some("not-an-email".to_owned())).is_err());
        assert!(normalize_and_validate_email(Some("a@b".to_owned())).is_err());
        assert!(normalize_and_validate_email(Some("a b@example.com".to_owned())).is_err());
        assert!(
            normalize_and_validate_email(Some(format!("{}@example.com", "a".repeat(321)))).is_err()
        );
    }
}
