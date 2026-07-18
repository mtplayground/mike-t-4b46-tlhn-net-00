use crate::{
    app::AppDependencies,
    auth::AuthSession,
    models::{Faction, USERS_TABLE},
};
use rand::{distributions::Uniform, rngs::OsRng, Rng};
use serde::Serialize;
use sqlx::Row;

const PSEUDONYM_SUFFIX_LENGTH: usize = 5;
const PSEUDONYM_SUFFIX_ALPHABET: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";
const USER_IDENTITY_INSERT_MAX_ATTEMPTS: usize = 5;

#[derive(Clone, Debug, Serialize)]
pub struct AccountIdentity {
    pub sub: String,
    pub email: String,
    pub email_verified: Option<bool>,
    pub name: Option<String>,
    pub picture_url: Option<String>,
    pub faction: Faction,
    pub pseudonym: String,
    pub created_at: String,
    pub last_seen_at: String,
    pub newly_registered: bool,
}

#[derive(Clone, Debug)]
struct NewAccountIdentity {
    faction: Faction,
    pseudonym: String,
}

pub async fn get_or_create_account_identity(
    state: &AppDependencies,
    session: &AuthSession,
) -> Result<AccountIdentity, sqlx::Error> {
    let email = session.email.clone().unwrap_or_default();

    for _ in 0..USER_IDENTITY_INSERT_MAX_ATTEMPTS {
        let new_identity = generate_new_account_identity();
        match upsert_account_identity(state, session, &email, &new_identity).await {
            Ok(account) => return Ok(account),
            Err(error) if is_unique_violation(&error) => continue,
            Err(error) => return Err(error),
        }
    }

    let new_identity = generate_new_account_identity();
    upsert_account_identity(state, session, &email, &new_identity).await
}

async fn upsert_account_identity(
    state: &AppDependencies,
    session: &AuthSession,
    email: &str,
    new_identity: &NewAccountIdentity,
) -> Result<AccountIdentity, sqlx::Error> {
    let row = sqlx::query(
        r#"
        insert into users (sub, email, email_verified, name, picture_url, faction, pseudonym)
        values ($1, $2, $3, $4, $5, $6::faction, $7)
        on conflict (sub) do update
        set email = excluded.email,
            email_verified = excluded.email_verified,
            name = excluded.name,
            picture_url = excluded.picture_url,
            last_seen_at = now()
        returning
            sub,
            email,
            email_verified,
            name,
            picture_url,
            faction::text as faction,
            pseudonym,
            to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at,
            to_char(last_seen_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as last_seen_at,
            (xmax = 0) as newly_registered
        "#,
    )
    .bind(&session.sub)
    .bind(email)
    .bind(session.email_verified)
    .bind(&session.name)
    .bind(&session.picture)
    .bind(new_identity.faction.as_str())
    .bind(&new_identity.pseudonym)
    .fetch_one(&state.db_pool)
    .await?;

    row_to_account_identity(row)
}

fn row_to_account_identity(
    row: sqlx::postgres::PgRow,
) -> Result<AccountIdentity, sqlx::Error> {
    let faction: String = row.try_get("faction")?;

    Ok(AccountIdentity {
        sub: row.try_get("sub")?,
        email: row.try_get("email")?,
        email_verified: row.try_get("email_verified")?,
        name: row.try_get("name")?,
        picture_url: row.try_get("picture_url")?,
        faction: Faction::parse(&faction).unwrap_or(Faction::AiHaters),
        pseudonym: row.try_get("pseudonym")?,
        created_at: row.try_get("created_at")?,
        last_seen_at: row.try_get("last_seen_at")?,
        newly_registered: row.try_get("newly_registered")?,
    })
}

fn generate_new_account_identity() -> NewAccountIdentity {
    let faction = if OsRng.gen_bool(0.5) {
        Faction::AiHaters
    } else {
        Faction::AiLovers
    };
    let prefixes = faction.display_name_prefixes();
    let prefix = prefixes[OsRng.gen_range(0..prefixes.len())];

    NewAccountIdentity {
        faction,
        pseudonym: format!("{prefix}_{}", generate_suffix(PSEUDONYM_SUFFIX_LENGTH)),
    }
}

fn generate_suffix(length: usize) -> String {
    let distribution = Uniform::from(0..PSEUDONYM_SUFFIX_ALPHABET.len());
    let mut rng = OsRng;
    (0..length)
        .map(|_| PSEUDONYM_SUFFIX_ALPHABET[rng.sample(distribution)] as char)
        .collect()
}

fn is_unique_violation(error: &sqlx::Error) -> bool {
    error
        .as_database_error()
        .and_then(|database_error| database_error.code())
        .is_some_and(|code| code == "23505")
}

pub fn log_account_identity_error(error: &sqlx::Error) {
    tracing::error!(
        table = USERS_TABLE,
        name = "sqlx::Error",
        code = ?error.as_database_error().and_then(|db_error| db_error.code()),
        message = %error,
        "Account identity database operation failed"
    );
}
