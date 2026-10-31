use std::time::Duration;

use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderMap, HeaderValue};
use axum::Json;
use rand::distributions::{Alphanumeric, DistString};
use rusqlite::{params, params_from_iter};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::auth::AuthUser;
use crate::db::{self, booking_from_row, get_booking, get_self_user, notify, BOOKING_SELECT};
use crate::error::{ApiResult, AppError};
use crate::models::{BookingView, Estimate, MessageView};
use crate::state::AppState;
use crate::util::{
    class_info, estimate as fare_estimate, haversine_km, now_iso, parse_scheduled, road_distance_km,
    route_points, valid_coords,
};

#[derive(Deserialize)]
pub struct EstimateReq {
    pub pickup_lat: f64,
    pub pickup_lng: f64,
    pub dropoff_lat: f64,
    pub dropoff_lng: f64,
    pub vehicle_class: String,
}

pub async fn estimate(
    State(_state): State<AppState>,
    _auth: AuthUser,
    Json(req): Json<EstimateReq>,
) -> ApiResult<Json<Estimate>> {
    if !valid_coords(req.pickup_lat, req.pickup_lng) || !valid_coords(req.dropoff_lat, req.dropoff_lng) {
        return Err(AppError::bad("Pickup and destination must be inside Addis Ababa."));
    }
    let class = req.vehicle_class.trim().to_lowercase();
    if class_info(&class).is_none() {
        return Err(AppError::bad("Please choose a valid ride class."));
    }
    let distance = road_distance_km(req.pickup_lat, req.pickup_lng, req.dropoff_lat, req.dropoff_lng);
    if distance > 80.0 {
        return Err(AppError::bad("Trips inside Addis Ababa must be under 80 km."));
    }
    let (fare, duration) = fare_estimate(&class, distance).ok_or_else(|| AppError::bad("Invalid ride class."))?;
    Ok(Json(Estimate {
        distance_km: (distance * 10.0).round() / 10.0,
        duration_min: duration,
        fare,
        vehicle_class: class,
        route: route_points(req.pickup_lat, req.pickup_lng, req.dropoff_lat, req.dropoff_lng),
    }))
}

#[derive(Deserialize)]
pub struct CreateBookingReq {
    pub pickup: String,
    pub pickup_lat: f64,
    pub pickup_lng: f64,
    pub dropoff: String,
    pub dropoff_lat: f64,
    pub dropoff_lng: f64,
    pub vehicle_class: String,
    #[serde(default)]
    pub scheduled_for: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
}

fn clean_label(value: &str, field: &str) -> Result<String, AppError> {
    let value = value.trim();
    if value.chars().count() < 2 || value.chars().count() > 140 {
        return Err(AppError::bad(format!("{field} must be 2–140 characters.")));
    }
    if value.chars().any(|c| c.is_control()) {
        return Err(AppError::bad(format!("{field} contains unsupported characters.")));
    }
    Ok(value.to_string())
}

pub async fn create(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<CreateBookingReq>,
) -> ApiResult<Json<BookingView>> {
    let pickup = clean_label(&req.pickup, "Pickup")?;
    let dropoff = clean_label(&req.dropoff, "Destination")?;
    if !valid_coords(req.pickup_lat, req.pickup_lng) || !valid_coords(req.dropoff_lat, req.dropoff_lng) {
        return Err(AppError::bad("Pickup and destination must be inside Addis Ababa."));
    }
    let class = req.vehicle_class.trim().to_lowercase();
    if class_info(&class).is_none() {
        return Err(AppError::bad("Please choose a valid ride class."));
    }
    let scheduled_for = match req.scheduled_for.as_deref() {
        Some(value) if !value.trim().is_empty() => Some(parse_scheduled(value, 30).map_err(AppError::bad)?),
        _ => None,
    };
    let notes = req.notes.as_deref().unwrap_or("").trim().chars().take(300).collect::<String>();
    let distance = road_distance_km(req.pickup_lat, req.pickup_lng, req.dropoff_lat, req.dropoff_lng);
    if distance > 80.0 {
        return Err(AppError::bad("Trips inside Addis Ababa must be under 80 km."));
    }
    let (fare, duration) = fare_estimate(&class, distance).ok_or_else(|| AppError::bad("Invalid ride class."))?;

    let conn = state.db.get()?;
    let active: i64 = conn.query_row(
        "SELECT COUNT(*) FROM bookings WHERE customer_id = ?1 AND status IN ('requested', 'accepted', 'arriving', 'in_progress')",
        [auth.id],
        |row| row.get(0),
    )?;
    if active > 0 {
        return Err(AppError::conflict("You already have an active ride. Complete or cancel it before booking another."));
    }

    let mut code = String::new();
    for _ in 0..10 {
        let candidate = format!("AG-{}", Alphanumeric.sample_string(&mut rand::thread_rng(), 6).to_uppercase());
        let exists: i64 = conn.query_row("SELECT COUNT(*) FROM bookings WHERE code = ?1", [&candidate], |row| row.get(0))?;
        if exists == 0 {
            code = candidate;
            break;
        }
    }
    if code.is_empty() {
        return Err(AppError::internal("Could not generate a unique booking code."));
    }

    conn.execute(
        "INSERT INTO bookings (code, customer_id, pickup, pickup_lat, pickup_lng, dropoff, dropoff_lat, dropoff_lng,
            vehicle_class, distance_km, duration_min, fare, status, scheduled_for, notes, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 'requested', ?13, ?14, ?15)",
        params![
            code,
            auth.id,
            pickup,
            req.pickup_lat,
            req.pickup_lng,
            dropoff,
            req.dropoff_lat,
            req.dropoff_lng,
            class,
            (distance * 10.0).round() / 10.0,
            duration,
            fare,
            scheduled_for,
            notes,
            now_iso()
        ],
    )?;
    let booking_id = conn.last_insert_rowid();

    // Alert nearby online drivers so the request feels live.
    let mut stmt = conn.prepare(
        "SELECT d.user_id, d.lat, d.lng FROM drivers d JOIN users u ON u.id = d.user_id
         WHERE d.status = 'approved' AND d.is_online = 1 AND u.status = 'active' AND d.lat IS NOT NULL AND d.lng IS NOT NULL",
    )?;
    let drivers = stmt
        .query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, f64>(1)?, row.get::<_, f64>(2)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut notified = 0;
    for (user_id, lat, lng) in drivers {
        if haversine_km(req.pickup_lat, req.pickup_lng, lat, lng) <= 25.0 && notified < 15 {
            let _ = notify(
                &conn,
                user_id,
                "ride",
                "New ride nearby",
                &format!("{pickup} → {dropoff} · {fare} ETB"),
            );
            notified += 1;
        }
    }

    let booking = get_booking(&conn, booking_id)?
        .ok_or_else(|| AppError::internal("Booking was saved but could not be loaded."))?;
    Ok(Json(booking))
}

#[derive(Deserialize)]
pub struct ListQuery {
    #[serde(default)]
    pub scope: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
}

pub async fn list(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(query): Query<ListQuery>,
) -> ApiResult<Json<serde_json::Value>> {
    let conn = state.db.get()?;
    let mut sql = format!("{BOOKING_SELECT} WHERE 1 = 1");
    let mut args: Vec<rusqlite::types::Value> = Vec::new();

    match auth.role.as_str() {
        "admin" => {}
        "driver" => {
            sql.push_str(" AND d.user_id = ?");
            args.push(rusqlite::types::Value::Integer(auth.id));
        }
        _ => {
            sql.push_str(" AND b.customer_id = ?");
            args.push(rusqlite::types::Value::Integer(auth.id));
        }
    }

    if let Some(status) = query.status.as_deref() {
        if !matches!(
            status,
            "requested" | "accepted" | "arriving" | "in_progress" | "completed" | "cancelled"
        ) {
            return Err(AppError::bad("Unknown booking status."));
        }
        sql.push_str(" AND b.status = ?");
        args.push(rusqlite::types::Value::Text(status.to_string()));
    }

    match query.scope.as_deref().unwrap_or("all") {
        "active" => sql.push_str(" AND b.status IN ('requested', 'accepted', 'arriving', 'in_progress')"),
        "recent" => sql.push_str(" AND b.status IN ('completed', 'cancelled')"),
        "all" => {}
        _ => return Err(AppError::bad("Unknown scope.")),
    }

    sql.push_str(" ORDER BY b.created_at DESC LIMIT 60");
    let mut stmt = conn.prepare(&sql)?;
    let bookings = stmt
        .query_map(params_from_iter(args.iter()), booking_from_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(Json(json!({ "bookings": bookings })))
}

fn can_view(auth: &AuthUser, booking: &BookingView) -> bool {
    auth.role == "admin"
        || booking.customer.id == auth.id
        || booking.driver.as_ref().map(|d| d.user_id == auth.id).unwrap_or(false)
}

pub async fn detail(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<i64>,
) -> ApiResult<Json<BookingView>> {
    let conn = state.db.get()?;
    let booking = get_booking(&conn, id)?.ok_or_else(|| AppError::not_found("Ride not found."))?;
    if !can_view(&auth, &booking) {
        return Err(AppError::not_found("Ride not found."));
    }
    Ok(Json(booking))
}

pub async fn accept(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<i64>,
) -> ApiResult<Json<BookingView>> {
    auth.require_driver()?;
    let mut conn = state.db.get()?;
    let driver = get_driver_by_user(&conn, auth.id)?;
    if driver.status != "approved" {
        return Err(AppError::forbidden("Your driver application is still being reviewed."));
    }
    if !driver.is_online {
        return Err(AppError::conflict("Go online before accepting a ride."));
    }
    let active: i64 = conn.query_row(
        "SELECT COUNT(*) FROM bookings WHERE driver_id = ?1 AND status IN ('accepted', 'arriving', 'in_progress')",
        [driver.id],
        |row| row.get(0),
    )?;
    if active > 0 {
        return Err(AppError::conflict("Finish your current trip before accepting another."));
    }
    let existing = get_booking(&conn, id)?.ok_or_else(|| AppError::not_found("Ride not found."))?;
    if existing.status != "requested" {
        return Err(AppError::conflict("Another driver just accepted this ride. Refresh to see the latest requests."));
    }

    let tx = conn.transaction()?;
    let changed = tx.execute(
        "UPDATE bookings SET driver_id = ?1, status = 'accepted', accepted_at = ?2
         WHERE id = ?3 AND status = 'requested' AND driver_id IS NULL",
        params![driver.id, now_iso(), id],
    )?;
    if changed == 0 {
        return Err(AppError::conflict("Another driver just accepted this ride."));
    }
    tx.commit()?;

    let booking = get_booking(&conn, id)?.ok_or_else(|| AppError::internal("Could not load accepted ride."))?;
    let name = get_self_user(&conn, auth.id).map(|u| u.name).unwrap_or_else(|_| "Your driver".into());
    let _ = notify(
        &conn,
        booking.customer.id,
        "ride",
        "Driver found",
        &format!("{name} accepted your ride and is heading to {}.", booking.pickup),
    );
    Ok(Json(booking))
}

fn get_driver_by_user(conn: &rusqlite::Connection, user_id: i64) -> ApiResult<crate::models::Driver> {
    db::driver_for_user(conn, user_id)?.ok_or_else(|| AppError::not_found("Driver profile not found."))
}

#[derive(Deserialize)]
pub struct StatusReq {
    pub status: String,
}

pub async fn update_status(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<i64>,
    Json(req): Json<StatusReq>,
) -> ApiResult<Json<BookingView>> {
    let conn = state.db.get()?;
    let booking = get_booking(&conn, id)?.ok_or_else(|| AppError::not_found("Ride not found."))?;
    let is_admin = auth.role == "admin";
    let is_driver = booking.driver.as_ref().map(|d| d.user_id == auth.id).unwrap_or(false);
    if !is_admin && !is_driver {
        return Err(AppError::forbidden("Only the assigned driver can update this trip."));
    }

    let new_status = req.status.trim().to_lowercase();
    let allowed = match (booking.status.as_str(), new_status.as_str()) {
        ("accepted", "arriving") => true,
        ("accepted", "in_progress") => true,
        ("arriving", "in_progress") => true,
        ("in_progress", "completed") => true,
        _ => false,
    };
    if !allowed {
        return Err(AppError::conflict(format!(
            "You cannot move this trip from {} to {}.",
            booking.status, new_status
        )));
    }

    let mut conn = state.db.get()?;
    let tx = conn.transaction()?;
    let changed = if new_status == "completed" {
        tx.execute(
            "UPDATE bookings SET status = 'completed', completed_at = ?1 WHERE id = ?2 AND status = ?3",
            params![now_iso(), id, booking.status],
        )?
    } else if new_status == "in_progress" {
        tx.execute(
            "UPDATE bookings SET status = 'in_progress', started_at = COALESCE(started_at, ?1) WHERE id = ?2 AND status = ?3",
            params![now_iso(), id, booking.status],
        )?
    } else {
        tx.execute(
            "UPDATE bookings SET status = ?1 WHERE id = ?2 AND status = ?3",
            params![new_status, id, booking.status],
        )?
    };
    if changed == 0 {
        return Err(AppError::conflict("This trip was updated somewhere else. Refresh and try again."));
    }
    if new_status == "completed" {
        if let Some(driver) = &booking.driver {
            tx.execute("UPDATE drivers SET trips = trips + 1 WHERE id = ?1", [driver.id])?;
        }
    }
    tx.commit()?;

    let updated = get_booking(&conn, id)?.ok_or_else(|| AppError::internal("Could not reload trip."))?;
    match new_status.as_str() {
        "arriving" => {
            let _ = notify(&conn, updated.customer.id, "ride", "Your driver is arriving", "Head to the pickup point — your driver is close.");
        }
        "in_progress" => {
            let _ = notify(&conn, updated.customer.id, "ride", "Trip started", "Sit back and enjoy the ride. You can message your driver in the app.");
        }
        "completed" => {
            let driver_name = updated.driver.as_ref().map(|d| d.name.as_str()).unwrap_or("your driver");
            let _ = notify(
                &conn,
                updated.customer.id,
                "ride",
                "Trip complete",
                &format!("How was your ride with {driver_name}? Tap to leave a rating."),
            );
        }
        _ => {}
    }
    Ok(Json(updated))
}

#[derive(Deserialize, Default)]
pub struct CancelReq {
    #[serde(default)]
    pub reason: Option<String>,
}

pub async fn cancel(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<i64>,
    Json(req): Json<CancelReq>,
) -> ApiResult<Json<BookingView>> {
    let conn = state.db.get()?;
    let booking = get_booking(&conn, id)?.ok_or_else(|| AppError::not_found("Ride not found."))?;
    if booking.status == "cancelled" {
        return Ok(Json(booking));
    }
    if booking.status == "completed" {
        return Err(AppError::conflict("Completed trips cannot be cancelled."));
    }
    let is_customer = booking.customer.id == auth.id;
    let is_driver = booking.driver.as_ref().map(|d| d.user_id == auth.id).unwrap_or(false);
    let is_admin = auth.role == "admin";
    if !is_customer && !is_driver && !is_admin {
        return Err(AppError::not_found("Ride not found."));
    }
    if is_customer && matches!(booking.status.as_str(), "accepted" | "arriving" | "requested") {
        // Allowed.
    } else if is_driver && matches!(booking.status.as_str(), "accepted" | "arriving") {
        // Allowed.
    } else if !is_admin {
        return Err(AppError::conflict("This trip can no longer be cancelled in the app. Contact support."));
    }

    conn.execute(
        "UPDATE bookings SET status = 'cancelled', cancelled_at = ?1 WHERE id = ?2 AND status = ?3",
        params![now_iso(), id, booking.status],
    )?;
    let updated = get_booking(&conn, id)?.ok_or_else(|| AppError::internal("Could not reload trip."))?;

    let reason = req.reason.as_deref().unwrap_or("").trim().chars().take(200).collect::<String>();
    let suffix = if reason.is_empty() { String::new() } else { format!(" Reason: {reason}") };
    if let Some(driver) = &updated.driver {
        if is_customer {
            let _ = notify(
                &conn,
                driver.user_id,
                "ride",
                "Ride cancelled",
                &format!("The rider cancelled {}.{suffix}", updated.pickup),
            );
        }
    }
    if is_driver {
        let _ = notify(
            &conn,
            updated.customer.id,
            "ride",
            "Driver cancelled",
            &format!("Your driver cancelled this ride. Please request another driver.{suffix}"),
        );
    }
    Ok(Json(updated))
}

#[derive(Deserialize)]
pub struct RateReq {
    pub rating: i64,
    #[serde(default)]
    pub review: Option<String>,
}

pub async fn rate(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<i64>,
    Json(req): Json<RateReq>,
) -> ApiResult<Json<BookingView>> {
    if !(1..=5).contains(&req.rating) {
        return Err(AppError::bad("Rating must be between 1 and 5 stars."));
    }
    let review = req.review.as_deref().unwrap_or("").trim().chars().take(400).collect::<String>();
    let mut conn = state.db.get()?;
    let booking = get_booking(&conn, id)?.ok_or_else(|| AppError::not_found("Ride not found."))?;
    if booking.customer.id != auth.id && auth.role != "admin" {
        return Err(AppError::forbidden("Only the rider can rate this trip."));
    }
    if booking.status != "completed" {
        return Err(AppError::conflict("You can rate a trip once it is complete."));
    }
    if booking.rating.is_some() {
        return Err(AppError::conflict("You already rated this trip."));
    }

    let tx = conn.transaction()?;
    if let Some(driver) = &booking.driver {
        let old: (f64, i64) = tx.query_row(
            "SELECT rating, rating_count FROM drivers WHERE id = ?1",
            [driver.id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        let new_count = old.1 + 1;
        let new_rating = ((old.0 * old.1 as f64) + req.rating as f64) / new_count as f64;
        tx.execute(
            "UPDATE drivers SET rating = ?1, rating_count = ?2 WHERE id = ?3",
            params![(new_rating * 100.0).round() / 100.0, new_count, driver.id],
        )?;
    }
    tx.execute(
        "UPDATE bookings SET rating = ?1, review = ?2 WHERE id = ?3",
        params![req.rating, review, id],
    )?;
    tx.commit()?;

    let updated = get_booking(&conn, id)?.ok_or_else(|| AppError::internal("Could not reload trip."))?;
    if let Some(driver) = &updated.driver {
        let _ = notify(
            &conn,
            driver.user_id,
            "rating",
            "New rating received",
            &format!("{} left you {} stars.", updated.customer.name, req.rating),
        );
    }
    Ok(Json(updated))
}

pub async fn qr(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<i64>,
) -> ApiResult<(HeaderMap, String)> {
    let conn = state.db.get()?;
    let booking = get_booking(&conn, id)?.ok_or_else(|| AppError::not_found("Ride not found."))?;
    if !can_view(&auth, &booking) {
        return Err(AppError::not_found("Ride not found."));
    }
    if !matches!(booking.status.as_str(), "accepted" | "arriving" | "in_progress") {
        return Err(AppError::conflict("A check-in pass is available once a driver accepts your ride."));
    }
    let payload = format!("ADDISGO|booking:{}", booking.code);
    let code = qrcode::QrCode::new(payload.as_bytes())
        .map_err(|err| AppError::internal(format!("qr encode: {err}")))?;
    let svg = code
        .render::<qrcode::render::svg::Color>()
        .min_dimensions(260, 260)
        .quiet_zone(true)
        .dark_color(qrcode::render::svg::Color("#0d3b2e"))
        .light_color(qrcode::render::svg::Color("#fbf7ef"))
        .build();

    let mut headers = HeaderMap::new();
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static("image/svg+xml; charset=utf-8"));
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_static("inline; filename=\"addisgo-check-in.svg\""),
    );
    Ok((headers, svg))
}

fn ride_access(auth: &AuthUser, booking: &BookingView) -> bool {
    auth.role == "admin"
        || booking.customer.id == auth.id
        || booking.driver.as_ref().map(|d| d.user_id == auth.id).unwrap_or(false)
}

pub async fn messages_get(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<i64>,
) -> ApiResult<Json<serde_json::Value>> {
    let conn = state.db.get()?;
    let booking = get_booking(&conn, id)?.ok_or_else(|| AppError::not_found("Ride not found."))?;
    if !ride_access(&auth, &booking) {
        return Err(AppError::not_found("Ride not found."));
    }
    let mut stmt = conn.prepare(
        "SELECT m.id, m.body, m.created_at, u.id, u.name, u.role, u.bio, u.languages, u.avatar_color, u.is_verified
         FROM messages m JOIN users u ON u.id = m.user_id
         WHERE m.room_type = 'ride' AND m.room_id = ?1 ORDER BY m.id ASC LIMIT 200",
    )?;
    let messages = stmt
        .query_map([id], |row| {
            let user = crate::db::public_user_at_pub(row, 3)?;
            Ok(MessageView {
                id: row.get(0)?,
                body: row.get(1)?,
                created_at: row.get(2)?,
                is_own: user.id == auth.id,
                user,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
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
    let booking = get_booking(&conn, id)?.ok_or_else(|| AppError::not_found("Ride not found."))?;
    if !ride_access(&auth, &booking) {
        return Err(AppError::not_found("Ride not found."));
    }
    if !matches!(booking.status.as_str(), "accepted" | "arriving" | "in_progress" | "completed") {
        return Err(AppError::conflict("Chat opens once a driver accepts the ride."));
    }
    conn.execute(
        "INSERT INTO messages (room_type, room_id, user_id, body, created_at) VALUES ('ride', ?1, ?2, ?3, ?4)",
        params![id, auth.id, body, now_iso()],
    )?;
    let message_id = conn.last_insert_rowid();
    let user = db::public_user(&conn, auth.id)?.ok_or_else(|| AppError::not_found("Account not found."))?;
    Ok(Json(MessageView {
        id: message_id,
        body: body.to_string(),
        created_at: now_iso(),
        user,
        is_own: true,
    }))
}
