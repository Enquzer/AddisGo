use std::time::Duration;

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use rusqlite::{params, OptionalExtension};
use serde::Deserialize;
use serde_json::json;

use crate::auth::{
    attach_cookie, clear_cookie, create_token, hash_password, session_cookie, verify_password, AuthUser,
};
use crate::db::{self, get_self_user};
use crate::error::{ApiResult, AppError};
use crate::state::AppState;
use crate::util::{join_languages, valid_color, valid_email, valid_phone};

#[derive(Deserialize)]
pub struct RegisterReq {
    pub name: String,
    pub email: String,
    pub phone: String,
    pub password: String,
    #[serde(default)]
    pub role: Option<String>,
    #[serde(default)]
    pub vehicle: Option<VehicleReq>,
}

#[derive(Deserialize)]
pub struct VehicleReq {
    pub vehicle_class: String,
    pub make_model: String,
    pub plate: String,
    #[serde(default)]
    pub color: Option<String>,
    pub license_no: String,
}

#[derive(Deserialize)]
pub struct LoginReq {
    pub email: String,
    pub password: String,
}

fn clean_name(value: &str) -> Result<String, AppError> {
    let name = value.trim();
    let count = name.chars().count();
    if !(2..=60).contains(&count) {
        return Err(AppError::bad("Please enter your full name (2–60 characters)."));
    }
    if name.chars().any(|c| c.is_control()) {
        return Err(AppError::bad("That name contains unsupported characters."));
    }
    Ok(name.to_string())
}

fn clean_password(value: &str) -> Result<(), AppError> {
    let len = value.chars().count();
    if !(8..=128).contains(&len) {
        return Err(AppError::bad("Password must be 8–128 characters long."));
    }
    if !value.chars().any(|c| c.is_ascii_alphabetic()) || !value.chars().any(|c| c.is_ascii_digit()) {
        return Err(AppError::bad("Password must include at least one letter and one number."));
    }
    Ok(())
}

fn clean_vehicle(v: &VehicleReq) -> Result<(String, String, String, String, String), AppError> {
    let class = v.vehicle_class.trim().to_lowercase();
    if !matches!(class.as_str(), "e2" | "comfort" | "van" | "bajaj") {
        return Err(AppError::bad("Please choose a valid vehicle class."));
    }
    let make_model = v.make_model.trim();
    if !(2..=60).contains(&make_model.chars().count()) {
        return Err(AppError::bad("Vehicle make and model must be 2–60 characters."));
    }
    let plate = v.plate.trim().to_uppercase();
    if !(2..=20).contains(&plate.chars().count()) {
        return Err(AppError::bad("Please enter a valid plate number."));
    }
    let color = v.color.as_deref().unwrap_or("").trim().chars().take(30).collect::<String>();
    let license = v.license_no.trim().to_uppercase();
    if !(3..=30).contains(&license.chars().count()) {
        return Err(AppError::bad("Please enter a valid driving licence number."));
    }
    Ok((class, make_model.to_string(), plate, color, license))
}

pub async fn register(State(state): State<AppState>, Json(req): Json<RegisterReq>) -> ApiResult<Response> {
    let name = clean_name(&req.name)?;
    let email = req.email.trim().to_lowercase();
    if !valid_email(&email) {
        return Err(AppError::bad("Please enter a valid email address."));
    }
    let phone = req.phone.trim().to_string();
    if !valid_phone(&phone) {
        return Err(AppError::bad("Please enter a valid phone number."));
    }
    clean_password(&req.password)?;

    let role = req.role.as_deref().unwrap_or("customer").to_lowercase();
    if !matches!(role.as_str(), "customer" | "driver") {
        return Err(AppError::bad("Please choose rider or driver."));
    }
    let vehicle = if role == "driver" {
        let vehicle = req
            .vehicle
            .as_ref()
            .ok_or_else(|| AppError::bad("Driver applications need vehicle details."))?;
        Some(clean_vehicle(vehicle)?)
    } else {
        None
    };

    let password_hash = hash_password(&req.password)?;
    let mut conn = state.db.get()?;

    let exists: i64 = conn.query_row("SELECT COUNT(*) FROM users WHERE email = ?1", [&email], |row| row.get(0))?;
    if exists > 0 {
        return Err(AppError::conflict("An account with this email already exists. Try signing in."));
    }

    let tx = conn.transaction()?;
    let insert = tx.execute(
        "INSERT INTO users (name, email, phone, password_hash, role, bio, languages, avatar_color, is_verified, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, '', 'English, Amharic', ?6, 0, 'active', ?7)",
        params![
            name,
            email,
            phone,
            password_hash,
            role,
            ["#145c45", "#e86a4a", "#4a7c9e", "#b06ab3", "#c47c2b", "#3b6ea5"]
                .get((name.as_bytes()[0] as usize) % 6)
                .unwrap_or(&"#145c45"),
            crate::util::now_iso()
        ],
    );
    if let Err(err) = insert {
        if err.to_string().contains("UNIQUE") {
            return Err(AppError::conflict("An account with this email already exists. Try signing in."));
        }
        return Err(err.into());
    }
    let user_id = tx.last_insert_rowid();
    if let Some((class, make_model, plate, color, license)) = vehicle {
        tx.execute(
            "INSERT INTO drivers (user_id, vehicle_class, make_model, plate, color, license_no, status, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', ?7)",
            params![user_id, class, make_model, plate, color, license, crate::util::now_iso()],
        )?;
    }
    tx.commit()?;

    let conn = state.db.get()?;
    let user = get_self_user(&conn, user_id)?;
    let token = create_token(user.id, &user.role, &state.jwt_secret);
    Ok(attach_cookie(Json(user).into_response(), session_cookie(&token)))
}

pub async fn login(State(state): State<AppState>, Json(req): Json<LoginReq>) -> ApiResult<Response> {
    let email = req.email.trim().to_lowercase();
    if email.is_empty() || req.password.is_empty() {
        return Err(AppError::bad("Enter your email and password."));
    }
    let key = format!("login:{email}");
    if !state.limiter.allow(&key, 20, Duration::from_secs(600)) {
        return Err(AppError::too_many("Too many sign-in attempts. Please wait 10 minutes and try again."));
    }

    let conn = state.db.get()?;
    let found: Option<(i64, String, String, String)> = conn
        .query_row(
            "SELECT id, password_hash, role, status FROM users WHERE email = ?1",
            [&email],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()?;

    let Some((id, hash, _role, status)) = found else {
        return Err(AppError::new(StatusCode::UNAUTHORIZED, "invalid_credentials", "Invalid email or password."));
    };
    if !verify_password(&hash, &req.password) {
        return Err(AppError::new(StatusCode::UNAUTHORIZED, "invalid_credentials", "Invalid email or password."));
    }
    if status != "active" {
        return Err(AppError::forbidden("This account is suspended. Please contact support."));
    }
    state.limiter.clear(&key);

    let user = get_self_user(&conn, id)?;
    let token = create_token(user.id, &user.role, &state.jwt_secret);
    Ok(attach_cookie(Json(user).into_response(), session_cookie(&token)))
}

pub async fn logout() -> Response {
    attach_cookie(Json(json!({ "ok": true })).into_response(), clear_cookie())
}

pub async fn me(State(state): State<AppState>, auth: AuthUser) -> ApiResult<Json<crate::models::SelfUser>> {
    let conn = state.db.get()?;
    Ok(Json(get_self_user(&conn, auth.id)?))
}

#[derive(Deserialize)]
pub struct ProfileReq {
    pub name: Option<String>,
    pub phone: Option<String>,
    pub bio: Option<String>,
    pub languages: Option<Vec<String>>,
    pub avatar_color: Option<String>,
}

pub async fn update_profile(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<ProfileReq>,
) -> ApiResult<Json<crate::models::SelfUser>> {
    let conn = state.db.get()?;
    let mut user = get_self_user(&conn, auth.id)?;

    if let Some(name) = req.name {
        user.name = clean_name(&name)?;
    }
    if let Some(phone) = req.phone {
        let phone = phone.trim().to_string();
        if phone.is_empty() {
            return Err(AppError::bad("Phone number cannot be empty."));
        }
        if !valid_phone(&phone) {
            return Err(AppError::bad("Please enter a valid phone number."));
        }
        user.phone = phone;
    }
    if let Some(bio) = req.bio {
        let bio = bio.trim();
        if bio.chars().count() > 400 {
            return Err(AppError::bad("Bio must be 400 characters or fewer."));
        }
        user.bio = bio.to_string();
    }
    if let Some(languages) = req.languages {
        if languages.len() > 6 {
            return Err(AppError::bad("Choose up to 6 languages."));
        }
        user.languages = crate::util::split_languages(&join_languages(&languages));
    }
    if let Some(color) = req.avatar_color {
        if !valid_color(color.trim()) {
            return Err(AppError::bad("Please choose a valid avatar colour."));
        }
        user.avatar_color = color.trim().to_string();
    }

    conn.execute(
        "UPDATE users SET name = ?1, phone = ?2, bio = ?3, languages = ?4, avatar_color = ?5 WHERE id = ?6",
        params![
            user.name,
            user.phone,
            user.bio,
            user.languages.join(", "),
            user.avatar_color,
            auth.id
        ],
    )?;
    Ok(Json(get_self_user(&conn, auth.id)?))
}

#[derive(Deserialize)]
pub struct PasswordReq {
    pub current_password: String,
    pub new_password: String,
}

pub async fn change_password(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<PasswordReq>,
) -> ApiResult<Json<serde_json::Value>> {
    if !state.limiter.allow(&format!("pwd:{}", auth.id), 5, Duration::from_secs(3600)) {
        return Err(AppError::too_many("Too many password changes. Please try again later."));
    }
    clean_password(&req.new_password)?;
    let conn = state.db.get()?;
    let hash: String = conn.query_row("SELECT password_hash FROM users WHERE id = ?1", [auth.id], |row| row.get(0))?;
    if !verify_password(&hash, &req.current_password) {
        return Err(AppError::new(StatusCode::UNAUTHORIZED, "invalid_credentials", "Your current password is incorrect."));
    }
    let new_hash = hash_password(&req.new_password)?;
    conn.execute("UPDATE users SET password_hash = ?1 WHERE id = ?2", params![new_hash, auth.id])?;
    db::audit(&conn, auth.id, "account.password_changed", "Password updated by account owner");
    Ok(Json(json!({ "ok": true })))
}
