use axum::extract::{Path, Query, State};
use axum::Json;
use chrono::{Duration, Utc};
use rusqlite::{params, params_from_iter, OptionalExtension, Row};
use serde::Deserialize;
use serde_json::json;

use crate::auth::AuthUser;
use crate::db::{self, booking_from_row, tour_view, BOOKING_SELECT};
use crate::error::{ApiResult, AppError};
use crate::models::{AdminDriver, AdminUser, AuditEntry, BookingView, ReportView};
use crate::state::AppState;
use crate::util::now_iso;

const ADMIN_DRIVER_SELECT: &str = "SELECT d.id, d.user_id, u.name, u.email, u.phone, u.avatar_color,
    d.vehicle_class, d.make_model, d.plate, d.color, d.license_no, d.status, u.status,
    d.is_online, d.lat, d.lng, d.rating, d.rating_count, d.trips, d.created_at, d.approved_at
 FROM drivers d JOIN users u ON u.id = d.user_id";

fn admin_driver_from_row(row: &Row<'_>) -> rusqlite::Result<AdminDriver> {
    Ok(AdminDriver {
        id: row.get(0)?,
        user_id: row.get(1)?,
        name: row.get(2)?,
        email: row.get(3)?,
        phone: row.get(4)?,
        avatar_color: row.get(5)?,
        vehicle_class: row.get(6)?,
        make_model: row.get(7)?,
        plate: row.get(8)?,
        color: row.get(9)?,
        license_no: row.get(10)?,
        status: row.get(11)?,
        user_status: row.get(12)?,
        is_online: row.get::<_, i64>(13)? != 0,
        lat: row.get(14)?,
        lng: row.get(15)?,
        rating: row.get(16)?,
        rating_count: row.get(17)?,
        trips: row.get(18)?,
        created_at: row.get(19)?,
        approved_at: row.get(20)?,
    })
}

pub async fn overview(State(state): State<AppState>, auth: AuthUser) -> ApiResult<Json<serde_json::Value>> {
    auth.require_admin()?;
    let conn = state.db.get()?;
    let today = Utc::now().date_naive().format("%Y-%m-%d").to_string();

    let scalar = |sql: &str| -> ApiResult<i64> { Ok(conn.query_row(sql, [], |row| row.get(0))?) };
    let total_users = scalar("SELECT COUNT(*) FROM users")?;
    let customers = scalar("SELECT COUNT(*) FROM users WHERE role = 'customer'")?;
    let drivers_total = scalar("SELECT COUNT(*) FROM drivers WHERE status = 'approved'")?;
    let drivers_pending = scalar("SELECT COUNT(*) FROM drivers WHERE status = 'pending'")?;
    let drivers_online = scalar("SELECT COUNT(*) FROM drivers WHERE status = 'approved' AND is_online = 1")?;
    let active_rides = scalar("SELECT COUNT(*) FROM bookings WHERE status IN ('requested', 'accepted', 'arriving', 'in_progress')")?;
    let today_bookings = scalar(&format!(
        "SELECT COUNT(*) FROM bookings WHERE substr(created_at, 1, 10) = '{today}'"
    ))?;
    let completed_total = scalar("SELECT COUNT(*) FROM bookings WHERE status = 'completed'")?;
    let revenue_total = scalar("SELECT COALESCE(SUM(fare), 0) FROM bookings WHERE status = 'completed'")?;
    let revenue_today = scalar(&format!(
        "SELECT COALESCE(SUM(fare), 0) FROM bookings WHERE status = 'completed' AND substr(completed_at, 1, 10) = '{today}'"
    ))?;
    let tours_upcoming = scalar("SELECT COUNT(*) FROM tours WHERE status = 'upcoming'")?;
    let reports_open = scalar("SELECT COUNT(*) FROM reports WHERE status = 'open'")?;
    let avg_rating: f64 = conn
        .query_row(
            "SELECT COALESCE(AVG(rating), 5.0) FROM drivers WHERE status = 'approved'",
            [],
            |row| row.get(0),
        )
        .unwrap_or(5.0);

    let mut chart = Vec::new();
    for offset in (0..7).rev() {
        let date = (Utc::now() - Duration::days(offset)).date_naive().format("%Y-%m-%d").to_string();
        let rides: i64 = conn.query_row(
            "SELECT COUNT(*) FROM bookings WHERE substr(created_at, 1, 10) = ?1",
            [&date],
            |row| row.get(0),
        )?;
        let revenue: i64 = conn.query_row(
            "SELECT COALESCE(SUM(fare), 0) FROM bookings WHERE status = 'completed' AND substr(completed_at, 1, 10) = ?1",
            [&date],
            |row| row.get(0),
        )?;
        chart.push(json!({ "date": date, "rides": rides, "revenue": revenue }));
    }

    let sql = format!("{BOOKING_SELECT} ORDER BY b.created_at DESC LIMIT 8");
    let mut stmt = conn.prepare(&sql)?;
    let recent_bookings = stmt
        .query_map([], booking_from_row)?
        .collect::<rusqlite::Result<Vec<BookingView>>>()?;
    drop(stmt);

    let mut stmt = conn.prepare(&format!("{ADMIN_DRIVER_SELECT} WHERE d.status = 'pending' ORDER BY d.created_at ASC LIMIT 6"))?;
    let pending_drivers = stmt
        .query_map([], admin_driver_from_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    Ok(Json(json!({
        "stats": {
            "total_users": total_users,
            "customers": customers,
            "drivers_total": drivers_total,
            "drivers_pending": drivers_pending,
            "drivers_online": drivers_online,
            "active_rides": active_rides,
            "today_bookings": today_bookings,
            "completed_total": completed_total,
            "revenue_total": revenue_total,
            "revenue_today": revenue_today,
            "tours_upcoming": tours_upcoming,
            "reports_open": reports_open,
            "avg_rating": (avg_rating * 10.0).round() / 10.0
        },
        "chart": chart,
        "recent_bookings": recent_bookings,
        "pending_drivers": pending_drivers
    })))
}

#[derive(Deserialize)]
pub struct DriverQuery {
    #[serde(default)]
    pub status: Option<String>,
}

pub async fn drivers(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(query): Query<DriverQuery>,
) -> ApiResult<Json<serde_json::Value>> {
    auth.require_admin()?;
    let conn = state.db.get()?;
    if let Some(status) = query.status.as_deref() {
        if !matches!(status, "pending" | "approved" | "suspended") {
            return Err(AppError::bad("Unknown driver status."));
        }
        let mut stmt = conn.prepare(&format!("{ADMIN_DRIVER_SELECT} WHERE d.status = ?1 ORDER BY d.created_at DESC"))?;
        let items = stmt
            .query_map([status], admin_driver_from_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        return Ok(Json(json!({ "drivers": items })));
    }
    let mut stmt = conn.prepare(&format!("{ADMIN_DRIVER_SELECT} ORDER BY d.created_at DESC"))?;
    let items = stmt
        .query_map([], admin_driver_from_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(Json(json!({ "drivers": items })))
}

#[derive(Deserialize)]
pub struct DriverStatusReq {
    pub status: String,
}

pub async fn set_driver_status(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<i64>,
    Json(req): Json<DriverStatusReq>,
) -> ApiResult<Json<AdminDriver>> {
    auth.require_admin()?;
    let status = req.status.trim().to_lowercase();
    if !matches!(status.as_str(), "pending" | "approved" | "suspended") {
        return Err(AppError::bad("Unknown driver status."));
    }
    let conn = state.db.get()?;
    let found: Option<(i64, String, String)> = conn
        .query_row(
            "SELECT d.user_id, u.name, u.status FROM drivers d JOIN users u ON u.id = d.user_id WHERE d.id = ?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?;
    let Some((user_id, name, user_status)) = found else {
        return Err(AppError::not_found("Driver not found."));
    };
    if user_status == "suspended" && status == "approved" {
        return Err(AppError::conflict("Reactivate this user's account before approving them as a driver."));
    }

    conn.execute(
        "UPDATE drivers SET status = ?1, is_online = CASE WHEN ?1 = 'approved' THEN is_online ELSE 0 END,
            approved_at = CASE WHEN ?1 = 'approved' AND approved_at IS NULL THEN ?2 ELSE approved_at END
         WHERE id = ?3",
        params![status, now_iso(), id],
    )?;
    if status == "approved" {
        conn.execute("UPDATE users SET is_verified = 1 WHERE id = ?1", [user_id])?;
        let _ = db::notify(
            &conn,
            user_id,
            "driver",
            "You're approved to drive",
            "Welcome to AddisGo. Go online in the driver dashboard to start receiving nearby requests.",
        );
    } else if status == "suspended" {
        let _ = db::notify(
            &conn,
            user_id,
            "driver",
            "Driver account suspended",
            "Your driver access has been paused. Contact support@addisgo.et for a review.",
        );
    }
    db::audit(
        &conn,
        auth.id,
        "driver.status_changed",
        &format!("Driver #{id} ({name}) set to {status}"),
    );

    let driver = conn
        .query_row(&format!("{ADMIN_DRIVER_SELECT} WHERE d.id = ?1"), [id], admin_driver_from_row)?;
    Ok(Json(driver))
}

#[derive(Deserialize)]
pub struct UserQuery {
    #[serde(default)]
    pub q: Option<String>,
    #[serde(default)]
    pub role: Option<String>,
}

pub async fn users(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(query): Query<UserQuery>,
) -> ApiResult<Json<serde_json::Value>> {
    auth.require_admin()?;
    let conn = state.db.get()?;
    let mut sql = String::from(
        "SELECT u.id, u.name, u.email, u.phone, u.role, u.status, u.is_verified, u.avatar_color, u.created_at,
            (SELECT status FROM drivers WHERE user_id = u.id) AS driver_status,
            (SELECT COUNT(*) FROM bookings b WHERE b.customer_id = u.id OR b.driver_id = (SELECT id FROM drivers WHERE user_id = u.id)) AS bookings
         FROM users u WHERE 1 = 1",
    );
    let mut args: Vec<rusqlite::types::Value> = Vec::new();
    if let Some(q) = query.q.as_deref().map(str::trim).filter(|q| !q.is_empty()) {
        sql.push_str(" AND (u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)");
        let like = format!("%{}%", q.replace('%', "\\%").replace('_', "\\_"));
        for _ in 0..3 {
            args.push(rusqlite::types::Value::Text(like.clone()));
        }
    }
    if let Some(role) = query.role.as_deref() {
        if !matches!(role, "customer" | "driver" | "admin") {
            return Err(AppError::bad("Unknown role."));
        }
        sql.push_str(" AND u.role = ?");
        args.push(rusqlite::types::Value::Text(role.to_string()));
    }
    sql.push_str(" ORDER BY u.created_at DESC LIMIT 120");
    let mut stmt = conn.prepare(&sql)?;
    let items = stmt
        .query_map(params_from_iter(args.iter()), |row| {
            Ok(AdminUser {
                id: row.get(0)?,
                name: row.get(1)?,
                email: row.get(2)?,
                phone: row.get(3)?,
                role: row.get(4)?,
                status: row.get(5)?,
                is_verified: row.get::<_, i64>(6)? != 0,
                avatar_color: row.get(7)?,
                created_at: row.get(8)?,
                driver_status: row.get(9)?,
                bookings: row.get(10)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(Json(json!({ "users": items })))
}

#[derive(Deserialize)]
pub struct UserUpdateReq {
    pub status: Option<String>,
    pub is_verified: Option<bool>,
}

pub async fn set_user(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<i64>,
    Json(req): Json<UserUpdateReq>,
) -> ApiResult<Json<serde_json::Value>> {
    auth.require_admin()?;
    if id == auth.id {
        return Err(AppError::bad("Use your profile settings to update your own account."));
    }
    let conn = state.db.get()?;
    let found: Option<(String, String, String)> = conn
        .query_row("SELECT name, role, status FROM users WHERE id = ?1", [id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })
        .optional()?;
    let Some((name, role, current_status)) = found else {
        return Err(AppError::not_found("User not found."));
    };
    if role == "admin" {
        return Err(AppError::forbidden("Admin accounts cannot be modified here."));
    }

    let mut new_status = current_status.clone();
    if let Some(status) = req.status.as_deref() {
        if !matches!(status, "active" | "suspended") {
            return Err(AppError::bad("Unknown account status."));
        }
        new_status = status.to_string();
    }
    let verified = req.is_verified;
    if new_status != current_status {
        conn.execute("UPDATE users SET status = ?1 WHERE id = ?2", params![new_status, id])?;
        if new_status == "suspended" {
            conn.execute("UPDATE drivers SET is_online = 0 WHERE user_id = ?1", [id])?;
        }
        let _ = db::notify(
            &conn,
            id,
            "account",
            if new_status == "suspended" { "Account suspended" } else { "Account reactivated" },
            if new_status == "suspended" {
                "Your AddisGo account has been suspended. Contact support@addisgo.et to appeal."
            } else {
                "Your AddisGo account is active again. Welcome back."
            },
        );
        db::audit(
            &conn,
            auth.id,
            "user.status_changed",
            &format!("User #{id} ({name}) set to {new_status}"),
        );
    }
    if let Some(verified) = verified {
        conn.execute("UPDATE users SET is_verified = ?1 WHERE id = ?2", params![if verified { 1 } else { 0 }, id])?;
        db::audit(
            &conn,
            auth.id,
            "user.verification_changed",
            &format!("User #{id} ({name}) verified = {verified}"),
        );
    }
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
pub struct BookingQuery {
    #[serde(default)]
    pub status: Option<String>,
}

pub async fn bookings(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(query): Query<BookingQuery>,
) -> ApiResult<Json<serde_json::Value>> {
    auth.require_admin()?;
    let conn = state.db.get()?;
    let mut sql = format!("{BOOKING_SELECT} WHERE 1 = 1");
    let mut args: Vec<rusqlite::types::Value> = Vec::new();
    if let Some(status) = query.status.as_deref().filter(|s| !s.is_empty()) {
        if !matches!(
            status,
            "requested" | "accepted" | "arriving" | "in_progress" | "completed" | "cancelled"
        ) {
            return Err(AppError::bad("Unknown booking status."));
        }
        sql.push_str(" AND b.status = ?");
        args.push(rusqlite::types::Value::Text(status.to_string()));
    }
    sql.push_str(" ORDER BY b.created_at DESC LIMIT 150");
    let mut stmt = conn.prepare(&sql)?;
    let items = stmt
        .query_map(params_from_iter(args.iter()), booking_from_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(Json(json!({ "bookings": items })))
}

pub async fn tours(State(state): State<AppState>, auth: AuthUser) -> ApiResult<Json<serde_json::Value>> {
    auth.require_admin()?;
    let conn = state.db.get()?;
    let mut stmt = conn.prepare("SELECT id FROM tours ORDER BY starts_at DESC LIMIT 100")?;
    let ids = stmt
        .query_map([], |row| row.get::<_, i64>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    drop(stmt);
    let mut items = Vec::new();
    for id in ids {
        if let Some(tour) = tour_view(&conn, id, Some(auth.id))? {
            items.push(tour);
        }
    }
    Ok(Json(json!({ "tours": items })))
}

#[derive(Deserialize)]
pub struct ReportQuery {
    #[serde(default)]
    pub status: Option<String>,
}

pub async fn reports(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(query): Query<ReportQuery>,
) -> ApiResult<Json<serde_json::Value>> {
    auth.require_admin()?;
    let status = query.status.as_deref().unwrap_or("open");
    if !matches!(status, "open" | "resolved" | "dismissed" | "all") {
        return Err(AppError::bad("Unknown report status."));
    }
    let conn = state.db.get()?;
    let mut sql = String::from(
        "SELECT r.id, r.target_type, r.target_id, r.reason, r.detail, r.status, r.created_at, r.resolved_at,
                u.id, u.name, u.email
         FROM reports r JOIN users u ON u.id = r.reporter_id",
    );
    let mut args: Vec<rusqlite::types::Value> = Vec::new();
    if status != "all" {
        sql.push_str(" WHERE r.status = ?");
        args.push(rusqlite::types::Value::Text(status.to_string()));
    }
    sql.push_str(" ORDER BY r.created_at DESC LIMIT 100");
    let mut stmt = conn.prepare(&sql)?;
    let items = stmt
        .query_map(params_from_iter(args.iter()), |row| {
            Ok(ReportView {
                id: row.get(0)?,
                target_type: row.get(1)?,
                target_id: row.get(2)?,
                reason: row.get(3)?,
                detail: row.get(4)?,
                status: row.get(5)?,
                created_at: row.get(6)?,
                resolved_at: row.get(7)?,
                reporter_id: row.get(8)?,
                reporter_name: row.get(9)?,
                reporter_email: row.get(10)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    drop(stmt);
    Ok(Json(json!({ "reports": items })))
}

#[derive(Deserialize)]
pub struct ReportUpdateReq {
    pub status: String,
}

pub async fn resolve_report(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<i64>,
    Json(req): Json<ReportUpdateReq>,
) -> ApiResult<Json<serde_json::Value>> {
    auth.require_admin()?;
    let status = req.status.trim().to_lowercase();
    if !matches!(status.as_str(), "resolved" | "dismissed") {
        return Err(AppError::bad("Reports can be resolved or dismissed."));
    }
    let conn = state.db.get()?;
    let reporter: Option<i64> = conn
        .query_row("SELECT reporter_id FROM reports WHERE id = ?1", [id], |row| row.get(0))
        .optional()?;
    let Some(reporter) = reporter else {
        return Err(AppError::not_found("Report not found."));
    };
    conn.execute(
        "UPDATE reports SET status = ?1, resolved_at = ?2 WHERE id = ?3",
        params![status, now_iso(), id],
    )?;
    let _ = db::notify(
        &conn,
        reporter,
        "safety",
        "Safety report reviewed",
        "Thanks for helping keep AddisGo safe. Our team has reviewed your report.",
    );
    db::audit(&conn, auth.id, "safety.report_reviewed", &format!("Report #{id} marked {status}"));
    Ok(Json(json!({ "ok": true })))
}

pub async fn audit(State(state): State<AppState>, auth: AuthUser) -> ApiResult<Json<serde_json::Value>> {
    auth.require_admin()?;
    let conn = state.db.get()?;
    let mut stmt = conn.prepare(
        "SELECT a.id, a.action, a.detail, a.created_at, u.name
         FROM audit_log a JOIN users u ON u.id = a.actor_id
         ORDER BY a.id DESC LIMIT 120",
    )?;
    let items = stmt
        .query_map([], |row| {
            Ok(AuditEntry {
                id: row.get(0)?,
                action: row.get(1)?,
                detail: row.get(2)?,
                created_at: row.get(3)?,
                actor_name: row.get(4)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(Json(json!({ "audit": items })))
}
