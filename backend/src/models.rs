use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

pub const PRODUCT_NAME: &str = "The Last Human Network";
pub const PRODUCT_SHORT_NAME: &str = "TLHN";

#[allow(dead_code)]
pub const FACTION_ENUM_TYPE: &str = "faction";
#[allow(dead_code)]
pub const MESSAGES_TABLE: &str = "messages";
#[allow(dead_code)]
pub const SUBSCRIPTIONS_TABLE: &str = "subscriptions";
#[allow(dead_code)]
pub const FACTION_COUNTS_TABLE: &str = "faction_counts";

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Faction {
    AiHaters,
    AiLovers,
}

#[allow(dead_code)]
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct MessageRow {
    pub id: i32,
    pub faction: Faction,
    pub display_name: String,
    pub body: String,
    pub user: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[allow(dead_code)]
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SubscriptionRow {
    pub id: i32,
    pub email: String,
    pub created_at: DateTime<Utc>,
}

#[allow(dead_code)]
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct FactionCountRow {
    pub faction: Faction,
    pub count: i32,
}
