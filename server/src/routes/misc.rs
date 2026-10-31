use std::time::Duration;

use axum::extract::State;
use axum::Json;
use rusqlite::{params, OptionalExtension};
use serde::Deserialize;
use serde_json::json;

use crate::auth::AuthUser;
use crate::db;
use crate::error::{ApiResult, AppError};
use crate::state::AppState;
use crate::util::now_iso;

pub async fn health() -> Json<serde_json::Value> {
    Json(json!({
        "status": "ok",
        "service": "addisgo",
        "version": env!("CARGO_PKG_VERSION"),
        "time": now_iso()
    }))
}

pub async fn public_stats(State(state): State<AppState>) -> ApiResult<Json<serde_json::Value>> {
    let conn = state.db.get()?;
    let drivers_online: i64 = conn.query_row(
        "SELECT COUNT(*) FROM drivers WHERE status = 'approved' AND is_online = 1",
        [],
        |row| row.get(0),
    )?;
    let drivers_total: i64 = conn.query_row("SELECT COUNT(*) FROM drivers WHERE status = 'approved'", [], |row| row.get(0))?;
    let tours_upcoming: i64 = conn.query_row(
        "SELECT COUNT(*) FROM tours WHERE status = 'upcoming' AND starts_at > ?1",
        [now_iso()],
        |row| row.get(0),
    )?;
    let trips_completed: i64 = conn.query_row("SELECT COUNT(*) FROM bookings WHERE status = 'completed'", [], |row| row.get(0))?;
    let avg_rating: f64 = conn
        .query_row(
            "SELECT COALESCE(AVG(rating), 5.0) FROM drivers WHERE status = 'approved' AND rating_count > 0",
            [],
            |row| row.get(0),
        )
        .unwrap_or(5.0);
    Ok(Json(json!({
        "drivers_online": drivers_online,
        "drivers_total": drivers_total,
        "tours_upcoming": tours_upcoming,
        "trips_completed": trips_completed,
        "avg_rating": (avg_rating * 10.0).round() / 10.0
    })))
}

pub async fn notifications(State(state): State<AppState>, auth: AuthUser) -> ApiResult<Json<serde_json::Value>> {
    let conn = state.db.get()?;
    let items = db::notifications(&conn, auth.id)?;
    let unread = items.iter().filter(|n| !n.is_read).count();
    Ok(Json(json!({ "notifications": items, "unread": unread })))
}

pub async fn mark_notifications_read(State(state): State<AppState>, auth: AuthUser) -> ApiResult<Json<serde_json::Value>> {
    let conn = state.db.get()?;
    conn.execute("UPDATE notifications SET is_read = 1 WHERE user_id = ?1 AND is_read = 0", [auth.id])?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
pub struct ReportReq {
    pub target_type: String,
    pub target_id: i64,
    pub reason: String,
    #[serde(default)]
    pub detail: Option<String>,
}

pub async fn create_report(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<ReportReq>,
) -> ApiResult<Json<serde_json::Value>> {
    if !state.limiter.allow(&format!("report:{}", auth.id), 5, Duration::from_secs(3600)) {
        return Err(AppError::too_many("You have submitted several reports recently. Our team is on it."));
    }
    let target_type = req.target_type.trim().to_lowercase();
    if !matches!(target_type.as_str(), "message" | "user" | "tour" | "booking") {
        return Err(AppError::bad("Unknown report type."));
    }
    let reason = req.reason.trim();
    if !(3..=200).contains(&reason.chars().count()) {
        return Err(AppError::bad("Tell us briefly what happened (3–200 characters)."));
    }
    let detail = req.detail.as_deref().unwrap_or("").trim().chars().take(1000).collect::<String>();
    let conn = state.db.get()?;

    let table = match target_type.as_str() {
        "message" => "messages",
        "user" => "users",
        "tour" => "tours",
        "booking" => "bookings",
        _ => unreachable!(),
    };
    if table == "users" && req.target_id == auth.id {
        return Err(AppError::bad("You cannot report your own account."));
    }
    let exists: Option<i64> = conn
        .query_row(&format!("SELECT id FROM {table} WHERE id = ?1"), [req.target_id], |row| row.get(0))
        .optional()?;
    if exists.is_none() {
        return Err(AppError::not_found("That item no longer exists."));
    }
    let duplicate: Option<i64> = conn
        .query_row(
            "SELECT id FROM reports WHERE reporter_id = ?1 AND target_type = ?2 AND target_id = ?3 AND status = 'open'",
            params![auth.id, target_type, req.target_id],
            |row| row.get(0),
        )
        .optional()?;
    if duplicate.is_some() {
        return Err(AppError::conflict("You already reported this. Our safety team is reviewing it."));
    }

    conn.execute(
        "INSERT INTO reports (reporter_id, target_type, target_id, reason, detail, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'open', ?6)",
        params![auth.id, target_type, req.target_id, reason, detail, now_iso()],
    )?;
    let mut stmt = conn.prepare("SELECT id FROM users WHERE role = 'admin' AND status = 'active'")?;
    let admins = stmt.query_map([], |row| row.get::<_, i64>(0))?.collect::<rusqlite::Result<Vec<_>>>()?;
    drop(stmt);
    for admin in admins {
        let _ = db::notify(
            &conn,
            admin,
            "safety",
            "New safety report",
            &format!("A {target_type} was reported: {reason}"),
        );
    }
    db::audit(&conn, auth.id, "safety.report_created", &format!("{target_type} #{} — {reason}", req.target_id));
    Ok(Json(json!({ "ok": true, "message": "Thanks — our safety team will review this." })))
}
