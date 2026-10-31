use std::time::{SystemTime, UNIX_EPOCH};

use argon2::password_hash::rand_core::OsRng;
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use axum::extract::{FromRequestParts, OptionalFromRequestParts};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use hmac::{Hmac, Mac};
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use sha2::Sha256;

use crate::error::AppError;
use crate::state::AppState;

pub const COOKIE_NAME: &str = "addisgo_session";
const TOKEN_TTL_SECONDS: i64 = 7 * 24 * 60 * 60;

type HmacSha256 = Hmac<Sha256>;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: i64,
    pub role: String,
    pub iat: i64,
    pub exp: i64,
}

pub fn hash_password(password: &str) -> Result<String, AppError> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|err| AppError::internal(format!("password hash: {err}")))
}

pub fn verify_password(hash: &str, password: &str) -> bool {
    match PasswordHash::new(hash) {
        Ok(parsed) => Argon2::default().verify_password(password.as_bytes(), &parsed).is_ok(),
        Err(_) => false,
    }
}

pub fn create_token(user_id: i64, role: &str, secret: &[u8]) -> String {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
    let claims = Claims { sub: user_id, role: role.to_string(), iat: now, exp: now + TOKEN_TTL_SECONDS };
    let header = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
    let payload = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&claims).unwrap_or_default());
    let signing_input = format!("{header}.{payload}");
    let mut mac = HmacSha256::new_from_slice(secret).expect("hmac accepts any key length");
    mac.update(signing_input.as_bytes());
    let signature = URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes());
    format!("{signing_input}.{signature}")
}

pub fn verify_token(token: &str, secret: &[u8]) -> Option<Claims> {
    let mut parts = token.split('.');
    let (header, payload, signature) = (parts.next()?, parts.next()?, parts.next()?);
    if parts.next().is_some() {
        return None;
    }
    let signing_input = format!("{header}.{payload}");
    let signature = URL_SAFE_NO_PAD.decode(signature).ok()?;
    let mut mac = HmacSha256::new_from_slice(secret).ok()?;
    mac.update(signing_input.as_bytes());
    mac.verify_slice(&signature).ok()?;
    let claims: Claims = serde_json::from_slice(&URL_SAFE_NO_PAD.decode(payload).ok()?).ok()?;
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
    if claims.exp <= now || claims.sub <= 0 || !matches!(claims.role.as_str(), "customer" | "driver" | "admin") {
        return None;
    }
    Some(claims)
}

pub fn token_from_headers(headers: &HeaderMap) -> Option<String> {
    if let Some(auth) = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok()) {
        if let Some(token) = auth.strip_prefix("Bearer ") {
            if !token.is_empty() {
                return Some(token.to_string());
            }
        }
    }
    let cookies = headers.get(header::COOKIE)?.to_str().ok()?;
    for part in cookies.split(';') {
        let mut kv = part.trim().splitn(2, '=');
        if kv.next() == Some(COOKIE_NAME) {
            return kv.next().map(|s| s.to_string());
        }
    }
    None
}

pub fn session_cookie(token: &str) -> String {
    let secure = std::env::var("ADDSIGO_COOKIE_SECURE").map(|v| v == "1").unwrap_or(false);
    format!(
        "{COOKIE_NAME}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={TOKEN_TTL_SECONDS}{}",
        if secure { "; Secure" } else { "" }
    )
}

pub fn clear_cookie() -> String {
    format!("{COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0")
}

pub fn attach_cookie(mut response: Response, cookie: String) -> Response {
    if let Ok(value) = HeaderValue::from_str(&cookie) {
        response.headers_mut().insert(header::SET_COOKIE, value);
    }
    response
}

#[derive(Clone, Debug)]
pub struct AuthUser {
    pub id: i64,
    pub role: String,
}

impl AuthUser {
    pub fn require_admin(&self) -> Result<(), AppError> {
        if self.role == "admin" {
            Ok(())
        } else {
            Err(AppError::forbidden("Admin access only."))
        }
    }

    pub fn require_driver(&self) -> Result<(), AppError> {
        if self.role == "driver" {
            Ok(())
        } else {
            Err(AppError::forbidden("This area is for registered drivers."))
        }
    }
}

fn user_from_claims(claims: &Claims, state: &AppState) -> Result<Option<AuthUser>, AppError> {
    let conn = state.db.get()?;
    let found: Option<(i64, String, String)> = conn
        .query_row(
            "SELECT id, role, status FROM users WHERE id = ?1",
            [claims.sub],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?;
    Ok(match found {
        Some((id, role, status)) if status == "active" && role == claims.role => {
            Some(AuthUser { id, role })
        }
        _ => None,
    })
}

impl FromRequestParts<AppState> for AuthUser {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut axum::http::request::Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        let token = token_from_headers(&parts.headers)
            .ok_or_else(|| AppError::unauthorized("Please sign in to continue."))?;
        let claims = verify_token(&token, &state.jwt_secret)
            .ok_or_else(|| AppError::unauthorized("Your session has expired. Please sign in again."))?;
        user_from_claims(&claims, state)?.ok_or_else(|| {
            AppError::new(StatusCode::UNAUTHORIZED, "unauthenticated", "Please sign in to continue.")
        })
    }
}

impl OptionalFromRequestParts<AppState> for AuthUser {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut axum::http::request::Parts, state: &AppState) -> Result<Option<Self>, Self::Rejection> {
        let Some(token) = token_from_headers(&parts.headers) else {
            return Ok(None);
        };
        let Some(claims) = verify_token(&token, &state.jwt_secret) else {
            return Ok(None);
        };
        Ok(user_from_claims(&claims, state)?)
    }
}

pub fn bearer_check(_headers: &HeaderMap) -> Option<()> {
    // Kept for API clients: Authorization: Bearer <token> is supported above.
    Some(())
}
