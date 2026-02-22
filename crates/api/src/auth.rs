use axum::{
    extract::{FromRequestParts, State},
    http::{header, Request},
    middleware::Next,
    response::Response,
};
use jsonwebtoken::{decode, Algorithm, DecodingKey, Validation};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use uuid::Uuid;

use crate::{error::ApiError, state::AppState};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum Plan {
    Free,
    Pro,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct UserClaims {
    pub sub: String,
    pub plan: Plan,
    pub iat: Option<u64>,
    pub exp: Option<u64>,
}

/// Extractor: requires authenticated user (401 if absent).
pub struct Claims(pub UserClaims);

impl<S: Send + Sync> FromRequestParts<S> for Claims {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        _state: &S,
    ) -> Result<Self, Self::Rejection> {
        parts
            .extensions
            .get::<UserClaims>()
            .cloned()
            .map(Claims)
            .ok_or(ApiError::Unauthorized)
    }
}

/// Extractor: optionally authenticated user (None if absent).
pub struct OptionalClaims(pub Option<UserClaims>);

impl<S: Send + Sync> FromRequestParts<S> for OptionalClaims {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        _state: &S,
    ) -> Result<Self, Self::Rejection> {
        Ok(OptionalClaims(parts.extensions.get::<UserClaims>().cloned()))
    }
}

/// Parse user_id string to Uuid, returning Unauthorized on failure.
pub fn parse_user_id(claims: &UserClaims) -> Result<Uuid, ApiError> {
    Uuid::parse_str(&claims.sub).map_err(|_| ApiError::Unauthorized)
}

/// Middleware: extract Bearer token, validate JWT or API key, inject UserClaims.
pub async fn optional_auth(
    State(state): State<AppState>,
    mut req: Request<axum::body::Body>,
    next: Next,
) -> Response {
    let bearer_token = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(|s| s.to_string());

    // Path 1: JWT from Bearer token
    if let (Some(ref secret), Some(ref token)) = (&state.jwt_secret, &bearer_token) {
        if let Some(claims) = validate_jwt(secret, token, &state).await {
            req.extensions_mut().insert(claims);
        }
    }

    // Path 2: API key as Bearer token (Authorization: Bearer tf_...)
    if req.extensions().get::<UserClaims>().is_none() {
        if let Some(ref token) = bearer_token {
            if is_api_key(token) {
                if let Some(ref db) = state.db {
                    if let Some(claims) = validate_api_key(db, token).await {
                        req.extensions_mut().insert(claims);
                    }
                }
            }
        }
    }

    // Path 3: API key query parameter (?key=tf_...)
    if req.extensions().get::<UserClaims>().is_none() {
        if let Some(ref db) = state.db {
            if let Some(api_key) = extract_api_key_from_query(req.uri()) {
                if let Some(claims) = validate_api_key(db, &api_key).await {
                    req.extensions_mut().insert(claims);
                }
            }
        }
    }

    next.run(req).await
}

/// Verify admin secret from Authorization header. Returns error if invalid.
pub fn verify_admin(state: &AppState, req: &Request<axum::body::Body>) -> Result<(), ApiError> {
    let admin_secret = state.admin_secret.as_ref().ok_or(ApiError::Forbidden)?;
    let auth_header = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .ok_or(ApiError::Unauthorized)?;
    if auth_header != admin_secret {
        return Err(ApiError::Forbidden);
    }
    Ok(())
}

pub(crate) fn is_api_key(token: &str) -> bool {
    token.starts_with("tf_") && token.len() == 35
}

async fn validate_jwt(secret: &str, token: &str, state: &AppState) -> Option<UserClaims> {
    let key = DecodingKey::from_secret(secret.as_bytes());
    let mut validation = Validation::new(Algorithm::HS256);
    validation.set_required_spec_claims(&["sub", "exp"]);

    let data = decode::<UserClaims>(token, &key, &validation).ok()?;

    // Verify user is not deactivated
    if let Some(ref db) = state.db {
        if let Ok(user_id) = Uuid::parse_str(&data.claims.sub) {
            let deactivated: Option<(bool,)> = sqlx::query_as(
                "SELECT deactivated_at IS NOT NULL FROM users WHERE id = $1",
            )
            .bind(user_id)
            .fetch_optional(db)
            .await
            .ok()
            .flatten();
            if let Some((true,)) = deactivated {
                return None;
            }
        }
    }

    Some(data.claims)
}

pub(crate) fn extract_api_key_from_query(uri: &axum::http::Uri) -> Option<String> {
    let query = uri.query()?;
    for pair in query.split('&') {
        if let Some(val) = pair.strip_prefix("key=") {
            if is_api_key(val) {
                return Some(val.to_string());
            }
        }
    }
    None
}

pub(crate) async fn validate_api_key(db: &PgPool, raw_key: &str) -> Option<UserClaims> {
    let hash = hex::encode(Sha256::digest(raw_key.as_bytes()));
    let row: Option<(String, String)> = sqlx::query_as(
        "SELECT u.id::text, u.plan
         FROM api_keys ak JOIN users u ON u.id = ak.user_id
         WHERE ak.key_hash = $1 AND ak.revoked_at IS NULL AND u.deactivated_at IS NULL",
    )
    .bind(&hash)
    .fetch_optional(db)
    .await
    .ok()?;

    let (user_id, plan_str) = row?;
    let plan = match plan_str.as_str() {
        "pro" => Plan::Pro,
        _ => Plan::Free,
    };
    Some(UserClaims {
        sub: user_id,
        plan,
        iat: None,
        exp: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---- is_api_key ----

    #[test]
    fn valid_api_key_format() {
        // tf_ + 32 hex chars = 35 total
        assert!(is_api_key("tf_0123456789abcdef0123456789abcdef"));
    }

    #[test]
    fn api_key_wrong_prefix() {
        assert!(!is_api_key("xx_0123456789abcdef0123456789abcdef"));
    }

    #[test]
    fn api_key_too_short() {
        assert!(!is_api_key("tf_abc"));
    }

    #[test]
    fn api_key_too_long() {
        assert!(!is_api_key("tf_0123456789abcdef0123456789abcdef0"));
    }

    #[test]
    fn api_key_empty() {
        assert!(!is_api_key(""));
    }

    // ---- extract_api_key_from_query ----

    #[test]
    fn extract_key_from_query_string() {
        let uri: axum::http::Uri = "/api/tiles?key=tf_0123456789abcdef0123456789abcdef"
            .parse()
            .unwrap();
        let key = extract_api_key_from_query(&uri);
        assert_eq!(key.as_deref(), Some("tf_0123456789abcdef0123456789abcdef"));
    }

    #[test]
    fn extract_key_among_other_params() {
        let uri: axum::http::Uri =
            "/api/tiles?tile_size=256&key=tf_0123456789abcdef0123456789abcdef&max_zoom=5"
                .parse()
                .unwrap();
        let key = extract_api_key_from_query(&uri);
        assert!(key.is_some());
    }

    #[test]
    fn no_key_in_query() {
        let uri: axum::http::Uri = "/api/tiles?tile_size=256".parse().unwrap();
        assert!(extract_api_key_from_query(&uri).is_none());
    }

    #[test]
    fn invalid_key_in_query() {
        let uri: axum::http::Uri = "/api/tiles?key=not_a_valid_key".parse().unwrap();
        assert!(extract_api_key_from_query(&uri).is_none());
    }

    #[test]
    fn no_query_string() {
        let uri: axum::http::Uri = "/api/tiles".parse().unwrap();
        assert!(extract_api_key_from_query(&uri).is_none());
    }

    // ---- parse_user_id ----

    #[test]
    fn parse_valid_user_id() {
        let claims = UserClaims {
            sub: "550e8400-e29b-41d4-a716-446655440000".into(),
            plan: Plan::Free,
            iat: None,
            exp: None,
        };
        assert!(parse_user_id(&claims).is_ok());
    }

    #[test]
    fn parse_invalid_user_id() {
        let claims = UserClaims {
            sub: "not-a-uuid".into(),
            plan: Plan::Free,
            iat: None,
            exp: None,
        };
        assert!(parse_user_id(&claims).is_err());
    }

    // ---- Plan serialization ----

    #[test]
    fn plan_serializes_lowercase() {
        assert_eq!(serde_json::to_string(&Plan::Free).unwrap(), "\"free\"");
        assert_eq!(serde_json::to_string(&Plan::Pro).unwrap(), "\"pro\"");
    }

    #[test]
    fn plan_deserializes_lowercase() {
        assert_eq!(serde_json::from_str::<Plan>("\"free\"").unwrap(), Plan::Free);
        assert_eq!(serde_json::from_str::<Plan>("\"pro\"").unwrap(), Plan::Pro);
    }
}
