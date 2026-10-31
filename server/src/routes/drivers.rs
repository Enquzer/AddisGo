use std::cmp::Ordering;
use std::time::Duration;

use axum::extract::{Query, State};
use axum::Json;
use chrono::{Duration as ChronoDuration, Utc};
use rusqlite::params;
use serde::{Deserialize, Serialize};

use crate::auth::AuthUser;
use crate::db::{self, booking_from_row, get_driver, get_self_user, driver_for_user, BOOKING_SELECT};
use crate::error::{ApiResult, AppError};
use crate::models::{BookingView, Driver, DriverProfile, DriverStats, NearbyDriver, SelfUser};
use crate::state::AppState;
use crate::util::{haversine_km, valid_coords};

#[derive(Deserialize)]
pub struct NearbyQuery {
    pub lat: f64,
    pub lng: f64,
    #[serde(default)]
    pub class: Option<String>,
}

#[derive(Serialize)]
pub struct NearbyResponse {
    pub drivers: Vec<NearbyDriver>,
    pub online_total: i64,
}

pub async fn nearby(
    State(state): State<AppState>,
    _auth: AuthUser,
    Query(query): Query<NearbyQuery>,
) -> ApiResult<Json<NearbyResponse>> {
    if !valid_coords(query.lat, query.lng) {
        return Err(AppError::bad("Please choose a pickup point inside Addis Ababa."));
    }
    let conn = state.db.get()?;
    let mut stmt = conn.prepare(
        "SELECT d.id, d.user_id, u.name, u.avatar_color, d.rating, d.rating_count, d.trips,
                d.vehicle_class, d.make_model, d.plate, d.color, d.is_online, d.lat, d.lng
         FROM drivers d JOIN users u ON u.id = d.user_id
         WHERE d.status = 'approved' AND d.is_online = 1 AND u.status = 'active'
           AND d.lat IS NOT NULL AND d.lng IS NOT NULL",
    )?;
    let mut drivers = Vec::new();
    let rows = stmt.query_map([], |row| {
        Ok(NearbyDriver {
            driver: crate::models::DriverSummary {
                id: row.get(0)?,
                user_id: row.get(1)?,
                name: row.get(2)?,
                avatar_color: row.get(3)?,
                rating: row.get(4)?,
                rating_count: row.get(5)?,
                trips: row.get(6)?,
                vehicle_class: row.get(7)?,
                make_model: row.get(8)?,
                plate: row.get(9)?,
                color: row.get(10)?,
                is_online: row.get::<_, i64>(11)? != 0,
                lat: row.get(12)?,
                lng: row.get(13)?,
            },
            distance_km: 0.0,
            eta_min: 0,
        })
    })?;
    for item in rows {
        let mut item = item?;
        if let Some(class) = &query.class {
            if !class.is_empty() && &item.driver.vehicle_class != class {
                continue;
            }
        }
        let (Some(lat), Some(lng)) = (item.driver.lat, item.driver.lng) else {
            continue;
        };
        let distance = haversine_km(query.lat, query.lng, lat, lng);
        if distance > 40.0 {
            continue;
        }
        item.distance_km = (distance * 10.0).round() / 10.0;
        item.eta_min = ((distance / 24.0) * 60.0 + 2.0).round().max(2.0) as i64;
        drivers.push(item);
    }
    drivers.sort_by(|a, b| a.distance_km.partial_cmp(&b.distance_km).unwrap_or(Ordering::Equal));
    drivers.truncate(12);
    let online_total = drivers.len() as i64;
    Ok(Json(NearbyResponse { drivers, online_total }))
}

pub async fn driver_me(State(state): State<AppState>, auth: AuthUser) -> ApiResult<Json<DriverProfile>> {
    auth.require_driver()?;
    let conn = state.db.get()?;
    let driver = driver_for_user(&conn, auth.id)?
        .ok_or_else(|| AppError::not_found("Driver profile not found."))?;

    let now = Utc::now();
    let week_ago = (now - ChronoDuration::days(7)).to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    let today = now.date_naive().format("%Y-%m-%d").to_string();

    let earnings_today: i64 = conn.query_row(
        "SELECT COALESCE(SUM(fare), 0) FROM bookings WHERE driver_id = ?1 AND status = 'completed' AND substr(completed_at, 1, 10) = ?2",
        params![driver.id, today],
        |row| row.get(0),
    )?;
    let earnings_week: i64 = conn.query_row(
        "SELECT COALESCE(SUM(fare), 0) FROM bookings WHERE driver_id = ?1 AND status = 'completed' AND completed_at >= ?2",
        params![driver.id, week_ago],
        |row| row.get(0),
    )?;
    let earnings_total: i64 = conn.query_row(
        "SELECT COALESCE(SUM(fare), 0) FROM bookings WHERE driver_id = ?1 AND status = 'completed'",
        [driver.id],
        |row| row.get(0),
    )?;
    let active_bookings: i64 = conn.query_row(
        "SELECT COUNT(*) FROM bookings WHERE driver_id = ?1 AND status IN ('accepted', 'arriving', 'in_progress')",
        [driver.id],
        |row| row.get(0),
    )?;
    let requests_available: i64 = conn.query_row(
        "SELECT COUNT(*) FROM bookings WHERE status = 'requested' AND driver_id IS NULL",
        [],
        |row| row.get(0),
    )?;

    Ok(Json(DriverProfile {
        stats: DriverStats {
            earnings_today,
            earnings_week,
            earnings_total,
            trips_total: driver.trips,
            active_bookings,
            requests_available,
        },
        driver,
    }))
}

#[derive(Deserialize)]
pub struct DriverStatusReq {
    pub is_online: bool,
    #[serde(default)]
    pub lat: Option<f64>,
    #[serde(default)]
    pub lng: Option<f64>,
}

pub async fn set_status(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<DriverStatusReq>,
) -> ApiResult<Json<Driver>> {
    auth.require_driver()?;
    let conn = state.db.get()?;
    let driver = driver_for_user(&conn, auth.id)?
        .ok_or_else(|| AppError::not_found("Driver profile not found."))?;
    if driver.status != "approved" {
        return Err(AppError::forbidden("Your driver application is still being reviewed."));
    }

    let (lat, lng) = if req.is_online {
        let lat = req.lat.or(driver.lat);
        let lng = req.lng.or(driver.lng);
        match (lat, lng) {
            (Some(lat), Some(lng)) if valid_coords(lat, lng) => (Some(lat), Some(lng)),
            _ => return Err(AppError::bad("Turn on location to start receiving ride requests.")),
        }
    } else {
        (req.lat.or(driver.lat), req.lng.or(driver.lng))
    };

    conn.execute(
        "UPDATE drivers SET is_online = ?1, lat = ?2, lng = ?3 WHERE id = ?4",
        params![if req.is_online { 1 } else { 0 }, lat, lng, driver.id],
    )?;
    let updated = get_driver(&conn, driver.id)?.ok_or_else(|| AppError::not_found("Driver profile not found."))?;
    Ok(Json(updated))
}

#[derive(Deserialize)]
pub struct DriverUpdateReq {
    pub vehicle_class: Option<String>,
    pub make_model: Option<String>,
    pub plate: Option<String>,
    pub color: Option<String>,
    pub license_no: Option<String>,
}

pub async fn update_profile(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<DriverUpdateReq>,
) -> ApiResult<Json<SelfUser>> {
    auth.require_driver()?;
    let conn = state.db.get()?;
    let driver = driver_for_user(&conn, auth.id)?
        .ok_or_else(|| AppError::not_found("Driver profile not found."))?;
    if driver.status == "suspended" {
        return Err(AppError::forbidden("Your driver account is suspended. Please contact support."));
    }

    let class = match req.vehicle_class {
        Some(c) => {
            let c = c.trim().to_lowercase();
            if !matches!(c.as_str(), "e2" | "comfort" | "van" | "bajaj") {
                return Err(AppError::bad("Please choose a valid vehicle class."));
            }
            c
        }
        None => driver.vehicle_class,
    };
    let make_model = match req.make_model {
        Some(v) => {
            let v = v.trim().to_string();
            if !(2..=60).contains(&v.chars().count()) {
                return Err(AppError::bad("Vehicle make and model must be 2–60 characters."));
            }
            v
        }
        None => driver.make_model,
    };
    let plate = match req.plate {
        Some(v) => {
            let v = v.trim().to_uppercase();
            if !(2..=20).contains(&v.chars().count()) {
                return Err(AppError::bad("Please enter a valid plate number."));
            }
            v
        }
        None => driver.plate,
    };
    let color = req.color.map(|c| c.trim().chars().take(30).collect::<String>()).unwrap_or(driver.color);
    let license = match req.license_no {
        Some(v) => {
            let v = v.trim().to_uppercase();
            if !(3..=30).contains(&v.chars().count()) {
                return Err(AppError::bad("Please enter a valid driving licence number."));
            }
            v
        }
        None => driver.license_no,
    };

    conn.execute(
        "UPDATE drivers SET vehicle_class = ?1, make_model = ?2, plate = ?3, color = ?4, license_no = ?5 WHERE id = ?6",
        params![class, make_model, plate, color, license, driver.id],
    )?;
    Ok(Json(get_self_user(&conn, auth.id)?))
}

#[derive(Serialize)]
pub struct DriverRequest {
    #[serde(flatten)]
    pub booking: BookingView,
    pub driver_distance_km: f64,
    pub pickup_eta_min: i64,
}

pub async fn requests(
    State(state): State<AppState>,
    auth: AuthUser,
) -> ApiResult<Json<serde_json::Value>> {
    auth.require_driver()?;
    let conn = state.db.get()?;
    let driver = driver_for_user(&conn, auth.id)?
        .ok_or_else(|| AppError::not_found("Driver profile not found."))?;
    if driver.status != "approved" {
        return Err(AppError::forbidden("Your driver application is still being reviewed."));
    }
    if !driver.is_online {
        return Ok(Json(serde_json::json!({ "requests": [], "online": false })));
    }
    let (Some(driver_lat), Some(driver_lng)) = (driver.lat, driver.lng) else {
        return Ok(Json(serde_json::json!({ "requests": [], "online": false })));
    };

    let sql = format!("{BOOKING_SELECT} WHERE b.status = 'requested' AND b.driver_id IS NULL ORDER BY b.created_at ASC LIMIT 50");
    let mut stmt = conn.prepare(&sql)?;
    let mut items: Vec<DriverRequest> = Vec::new();
    let rows = stmt.query_map([], booking_from_row)?;
    for row in rows {
        let mut booking = row?;
        let distance = haversine_km(driver_lat, driver_lng, booking.pickup_lat, booking.pickup_lng);
        if distance > 35.0 {
            continue;
        }
        // Nearby drivers only see the trip details – customer contact stays private until acceptance.
        booking.customer_phone = None;
        booking.driver_phone = None;
        items.push(DriverRequest {
            driver_distance_km: (distance * 10.0).round() / 10.0,
            pickup_eta_min: ((distance / 24.0) * 60.0 + 2.0).round().max(2.0) as i64,
            booking,
        });
    }
    items.sort_by(|a, b| {
        a.booking
            .scheduled_for
            .cmp(&b.booking.scheduled_for)
            .then(a.driver_distance_km.partial_cmp(&b.driver_distance_km).unwrap_or(Ordering::Equal))
    });
    Ok(Json(serde_json::json!({ "requests": items, "online": true })))
}

#[derive(Deserialize)]
pub struct VerifyReq {
    pub code: String,
}

pub async fn verify(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<VerifyReq>,
) -> ApiResult<Json<serde_json::Value>> {
    auth.require_driver()?;
    if !state.limiter.allow(&format!("verify:{}", auth.id), 30, Duration::from_secs(60)) {
        return Err(AppError::too_many("Too many code checks. Please wait a moment."));
    }
    let code = req.code.trim().to_uppercase();
    if code.is_empty() || code.len() > 20 {
        return Err(AppError::bad("Enter the check-in code shown on the rider's QR pass."));
    }
    let conn = state.db.get()?;
    let driver = driver_for_user(&conn, auth.id)?
        .ok_or_else(|| AppError::not_found("Driver profile not found."))?;
    let booking = db::booking_by_code(&conn, &code)?.ok_or_else(|| {
        AppError::not_found("No trip matches that code. Ask the rider to refresh their QR pass.")
    })?;
    let Some(trip_driver) = booking.driver.as_ref() else {
        return Err(AppError::conflict("This trip has not been assigned to a driver yet."));
    };
    if trip_driver.id != driver.id {
        return Err(AppError::forbidden("This pass belongs to another driver's trip."));
    }
    match booking.status.as_str() {
        "completed" => return Err(AppError::conflict("This trip is already completed.")),
        "cancelled" => return Err(AppError::conflict("This trip was cancelled.")),
        "requested" => return Err(AppError::conflict("Accept the trip before checking in the rider.")),
        _ => {}
    }
    Ok(Json(serde_json::json!({ "valid": true, "booking": booking })))
}
