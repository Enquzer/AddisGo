use std::time::Duration;

use axum::extract::{Path, Query, State};
use axum::Json;
use chrono::{DateTime, Utc};
use rusqlite::params;
use serde::Deserialize;
use serde_json::json;

use crate::auth::AuthUser;
use crate::db::{self, public_user, tour_chat_messages, tour_view};
use crate::error::{ApiResult, AppError};
use crate::models::{MessageView, TourView};
use crate::state::AppState;
use crate::util::{now_iso, parse_scheduled, valid_coords};

#[derive(Deserialize)]
pub struct ListQuery {
    #[serde(default)]
    pub q: Option<String>,
    #[serde(default)]
    pub mine: Option<i64>,
    #[serde(default)]
    pub past: Option<i64>,
}

pub async fn list(
    State(state): State<AppState>,
    auth: Option<AuthUser>,
    Query(query): Query<ListQuery>,
) -> ApiResult<Json<serde_json::Value>> {
    let conn = state.db.get()?;
    let viewer = auth.as_ref().map(|a| a.id);
    let mut sql = String::from("SELECT t.id FROM tours t");
    let mut args: Vec<rusqlite::types::Value> = Vec::new();

    if query.mine == Some(1) {
        let Some(my_id) = viewer else {
            return Err(AppError::unauthorized("Sign in to see your tours."));
        };
        sql.push_str(" JOIN tour_members m ON m.tour_id = t.id AND m.user_id = ?");
        args.push(rusqlite::types::Value::Integer(my_id));
    }
    sql.push_str(" WHERE 1 = 1");
    if query.past == Some(1) {
        sql.push_str(" AND (t.status != 'upcoming' OR t.starts_at <= ?)");
        args.push(rusqlite::types::Value::Text(now_iso()));
    } else {
        sql.push_str(" AND t.status = 'upcoming' AND t.starts_at > ?");
        args.push(rusqlite::types::Value::Text(now_iso()));
    }
    if let Some(q) = query.q.as_deref().map(str::trim).filter(|q| !q.is_empty()) {
        sql.push_str(" AND (t.title LIKE ? ESCAPE '\\' OR t.description LIKE ? ESCAPE '\\' OR t.meeting_point LIKE ? ESCAPE '\\')");
        let like = format!("%{}%", q.replace('%', "\\%").replace('_', "\\_"));
        for _ in 0..3 {
            args.push(rusqlite::types::Value::Text(like.clone()));
        }
    }
    sql.push_str(" ORDER BY t.starts_at ASC LIMIT 60");

    let mut stmt = conn.prepare(&sql)?;
    let ids = stmt
        .query_map(rusqlite::params_from_iter(args.iter()), |row| row.get::<_, i64>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    drop(stmt);
    let mut tours = Vec::new();
    for id in ids {
        if let Some(tour) = tour_view(&conn, id, viewer)? {
            tours.push(tour);
        }
    }
    Ok(Json(json!({ "tours": tours })))
}

pub async fn detail(
    State(state): State<AppState>,
    auth: Option<AuthUser>,
    Path(id): Path<i64>,
) -> ApiResult<Json<TourView>> {
    let conn = state.db.get()?;
    let tour = tour_view(&conn, id, auth.as_ref().map(|a| a.id))?
        .ok_or_else(|| AppError::not_found("Tour not found."))?;
    Ok(Json(tour))
}

#[derive(Deserialize)]
pub struct CreateTourReq {
    pub title: String,
    pub description: String,
    pub meeting_point: String,
    pub lat: f64,
    pub lng: f64,
    pub starts_at: String,
    pub duration_min: i64,
    pub capacity: i64,
    pub price: i64,
    #[serde(default)]
    pub theme: Option<String>,
}

pub async fn create(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<CreateTourReq>,
) -> ApiResult<Json<TourView>> {
    let title = req.title.trim();
    if !(4..=80).contains(&title.chars().count()) {
        return Err(AppError::bad("Tour title must be 4–80 characters."));
    }
    let description = req.description.trim();
    if !(20..=1200).contains(&description.chars().count()) {
        return Err(AppError::bad("Describe the tour in 20–1200 characters."));
    }
    let meeting = req.meeting_point.trim();
    if !(3..=140).contains(&meeting.chars().count()) {
        return Err(AppError::bad("Meeting point must be 3–140 characters."));
    }
    if !valid_coords(req.lat, req.lng) {
        return Err(AppError::bad("The meeting point must be inside Addis Ababa."));
    }
    if !(30..=720).contains(&req.duration_min) {
        return Err(AppError::bad("Tour length must be between 30 minutes and 12 hours."));
    }
    if !(2..=30).contains(&req.capacity) {
        return Err(AppError::bad("Group size must be between 2 and 30 people."));
    }
    if !(0..=100_000).contains(&req.price) {
        return Err(AppError::bad("Price must be between 0 and 100,000 ETB."));
    }
    let starts_at = parse_scheduled(&req.starts_at, 90).map_err(AppError::bad)?;
    let theme = req.theme.as_deref().unwrap_or("entoto").trim().to_lowercase();
    if !matches!(theme.as_str(), "entoto" | "merkato" | "museum" | "bole" | "custom") {
        return Err(AppError::bad("Please choose a valid tour theme."));
    }

    let conn = state.db.get()?;
    let host = public_user(&conn, auth.id)?.ok_or_else(|| AppError::not_found("Account not found."))?;
    if host.role == "driver" {
        return Err(AppError::forbidden("Switch to a rider account to host a city tour."));
    }
    let upcoming: i64 = conn.query_row(
        "SELECT COUNT(*) FROM tours WHERE host_id = ?1 AND status = 'upcoming' AND starts_at > ?2",
        params![auth.id, now_iso()],
        |row| row.get(0),
    )?;
    if upcoming >= 6 {
        return Err(AppError::conflict("You already have 6 upcoming tours. Finish or cancel one first."));
    }

    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO tours (host_id, title, description, meeting_point, lat, lng, starts_at, duration_min, capacity, price, theme, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'upcoming', ?12)",
        params![
            auth.id,
            title,
            description,
            meeting,
            req.lat,
            req.lng,
            starts_at,
            req.duration_min,
            req.capacity,
            req.price,
            theme,
            now_iso()
        ],
    )?;
    let tour_id = tx.last_insert_rowid();
    tx.execute(
        "INSERT INTO tour_members (tour_id, user_id, joined_at) VALUES (?1, ?2, ?3)",
        params![tour_id, auth.id, now_iso()],
    )?;
    tx.commit()?;

    let tour = tour_view(&conn, tour_id, Some(auth.id))?
        .ok_or_else(|| AppError::internal("Tour was created but could not be loaded."))?;
    Ok(Json(tour))
}

pub async fn join(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<i64>,
) -> ApiResult<Json<TourView>> {
    let conn = state.db.get()?;
    let tour = tour_view(&conn, id, Some(auth.id))?
        .ok_or_else(|| AppError::not_found("Tour not found."))?;
    if tour.status != "upcoming" {
        return Err(AppError::conflict("This tour is no longer open for joining."));
    }
    if starts_in_past(&tour.starts_at) {
        return Err(AppError::conflict("This tour has already started."));
    }
    if tour.is_member {
        return Ok(Json(tour));
    }
    if tour.member_count >= tour.capacity {
        return Err(AppError::conflict("This tour is full. Try another date or host."));
    }
    if tour.is_host {
        return Err(AppError::conflict("You are hosting this tour."));
    }

    let inserted = conn.execute(
        "INSERT OR IGNORE INTO tour_members (tour_id, user_id, joined_at) VALUES (?1, ?2, ?3)",
        params![id, auth.id, now_iso()],
    )?;
    if inserted > 0 {
        let _ = db::notify(
            &conn,
            tour.host.id,
            "tour",
            "New tour member",
            &format!("{} joined {}.", auth_role_name(&conn, auth.id), tour.title),
        );
    }
    let updated = tour_view(&conn, id, Some(auth.id))?
        .ok_or_else(|| AppError::not_found("Tour not found."))?;
    Ok(Json(updated))
}

fn auth_role_name(conn: &rusqlite::Connection, user_id: i64) -> String {
    conn.query_row("SELECT name FROM users WHERE id = ?1", [user_id], |row| row.get(0))
        .unwrap_or_else(|_| "A new traveller".to_string())
}

fn starts_in_past(starts_at: &str) -> bool {
    DateTime::parse_from_rfc3339(starts_at)
        .map(|d| d.with_timezone(&Utc) <= Utc::now())
        .unwrap_or(true)
}

pub async fn leave(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<i64>,
) -> ApiResult<Json<TourView>> {
    let conn = state.db.get()?;
    let tour = tour_view(&conn, id, Some(auth.id))?
        .ok_or_else(|| AppError::not_found("Tour not found."))?;
    if tour.is_host {
        return Err(AppError::conflict("Hosts cannot leave their own tour. Cancel the tour instead."));
    }
    if !tour.is_member {
        return Ok(Json(tour));
    }
    if starts_in_past(&tour.starts_at) {
        return Err(AppError::conflict("This tour has already started."));
    }
    conn.execute(
        "DELETE FROM tour_members WHERE tour_id = ?1 AND user_id = ?2",
        params![id, auth.id],
    )?;
    let updated = tour_view(&conn, id, Some(auth.id))?
        .ok_or_else(|| AppError::not_found("Tour not found."))?;
    Ok(Json(updated))
}

pub async fn cancel(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<i64>,
) -> ApiResult<Json<TourView>> {
    let conn = state.db.get()?;
    let tour = tour_view(&conn, id, Some(auth.id))?
        .ok_or_else(|| AppError::not_found("Tour not found."))?;
    if auth.role != "admin" && tour.host.id != auth.id {
        return Err(AppError::forbidden("Only the host can cancel this tour."));
    }
    if tour.status != "upcoming" {
        return Err(AppError::conflict("This tour is already closed."));
    }
    conn.execute("UPDATE tours SET status = 'cancelled' WHERE id = ?1", [id])?;
    let mut stmt = conn.prepare("SELECT user_id FROM tour_members WHERE tour_id = ?1")?;
    let members = stmt
        .query_map([id], |row| row.get::<_, i64>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    drop(stmt);
    for member in members {
        if member != auth.id {
            let _ = db::notify(
                &conn,
                member,
                "tour",
                "Tour cancelled",
                &format!("{} was cancelled. Any planned ride is unaffected.", tour.title),
            );
        }
    }
    let updated = tour_view(&conn, id, Some(auth.id))?
        .ok_or_else(|| AppError::not_found("Tour not found."))?;
    Ok(Json(updated))
}

pub async fn messages_get(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<i64>,
) -> ApiResult<Json<serde_json::Value>> {
    let conn = state.db.get()?;
    let tour = tour_view(&conn, id, Some(auth.id))?
        .ok_or_else(|| AppError::not_found("Tour not found."))?;
    if !tour.is_member && auth.role != "admin" {
        return Err(AppError::forbidden("Join the tour to read the group chat."));
    }
    let messages = tour_chat_messages(&conn, id, auth.id)?;
    Ok(Json(json!({ "messages": messages })))
}

#[derive(Deserialize)]
pub struct MessageReq {
    pub body: String,
}

pub async fn messages_post(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<i64>,
    Json(req): Json<MessageReq>,
) -> ApiResult<Json<MessageView>> {
    if !state.limiter.allow(&format!("chat:{}", auth.id), 20, Duration::from_secs(60)) {
        return Err(AppError::too_many("You are sending messages too quickly."));
    }
    let body = req.body.trim();
    if body.is_empty() {
        return Err(AppError::bad("Write a message first."));
    }
    if body.chars().count() > 500 {
        return Err(AppError::bad("Messages must be 500 characters or fewer."));
    }
    let conn = state.db.get()?;
    let tour = tour_view(&conn, id, Some(auth.id))?
        .ok_or_else(|| AppError::not_found("Tour not found."))?;
    if !tour.is_member {
        return Err(AppError::forbidden("Join the tour before posting in the group chat."));
    }
    if tour.status != "upcoming" {
        return Err(AppError::conflict("This tour chat is closed."));
    }
    conn.execute(
        "INSERT INTO messages (room_type, room_id, user_id, body, created_at) VALUES ('tour', ?1, ?2, ?3, ?4)",
        params![id, auth.id, body, now_iso()],
    )?;
    let message_id = conn.last_insert_rowid();
    if tour.host.id != auth.id {
        let _ = db::notify(
            &conn,
            tour.host.id,
            "tour",
            "New message in your tour",
            &format!("{}: {}", auth_role_name(&conn, auth.id), body.chars().take(120).collect::<String>()),
        );
    }
    let user = public_user(&conn, auth.id)?.ok_or_else(|| AppError::not_found("Account not found."))?;
    Ok(Json(MessageView {
        id: message_id,
        body: body.to_string(),
        created_at: now_iso(),
        user,
        is_own: true,
    }))
}
