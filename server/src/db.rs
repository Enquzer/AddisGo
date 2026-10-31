use std::error::Error;
use std::path::Path;

use r2d2::{Pool, PooledConnection};
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::{params, OptionalExtension, Row};

use crate::error::{ApiResult, AppError};
use crate::models::{
    BookingView, Driver, DriverSummary, MessageView, NotificationView, PublicUser, SelfUser, TourView,
};
use crate::util::{now_iso, split_languages};

pub type DbPool = Pool<SqliteConnectionManager>;
pub type DbConn = PooledConnection<SqliteConnectionManager>;

pub fn init(path: &Path) -> Result<DbPool, Box<dyn Error>> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let manager = SqliteConnectionManager::file(path).with_init(|conn| {
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA busy_timeout = 5000;
             PRAGMA synchronous = NORMAL;",
        )
    });
    let pool = Pool::builder().max_size(8).build(manager)?;
    {
        let conn = pool.get()?;
        conn.execute_batch(include_str!("schema.sql"))?;
        conn.execute_batch("PRAGMA journal_mode = WAL;")?;
    }
    Ok(pool)
}

pub fn load_jwt_secret(path: &Path) -> Result<Vec<u8>, Box<dyn Error>> {
    use base64::Engine;
    let engine = base64::engine::general_purpose::STANDARD;
    if let Ok(secret) = std::env::var("ADDSIGO_JWT_SECRET") {
        if secret.len() >= 32 {
            return Ok(secret.into_bytes());
        }
        return Err("ADDSIGO_JWT_SECRET must be at least 32 characters".into());
    }
    if path.exists() {
        let encoded = std::fs::read_to_string(path)?;
        if let Ok(bytes) = engine.decode(encoded.trim()) {
            if bytes.len() >= 32 {
                return Ok(bytes);
            }
        }
    }
    use rand::RngCore;
    let mut secret = vec![0u8; 48];
    rand::thread_rng().fill_bytes(&mut secret);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, engine.encode(&secret))?;
    Ok(secret)
}

fn public_user_at(row: &Row<'_>, start: usize) -> rusqlite::Result<PublicUser> {
    let languages: String = row.get(start + 4)?;
    Ok(PublicUser {
        id: row.get(start)?,
        name: row.get(start + 1)?,
        role: row.get(start + 2)?,
        bio: row.get(start + 3)?,
        languages: split_languages(&languages),
        avatar_color: row.get(start + 5)?,
        is_verified: row.get::<_, i64>(start + 6)? != 0,
    })
}

pub fn public_user_at_pub(row: &Row<'_>, start: usize) -> rusqlite::Result<PublicUser> {
    public_user_at(row, start)
}

pub fn driver_from_row(row: &Row<'_>) -> rusqlite::Result<Driver> {
    Ok(Driver {
        id: row.get(0)?,
        user_id: row.get(1)?,
        vehicle_class: row.get(2)?,
        make_model: row.get(3)?,
        plate: row.get(4)?,
        color: row.get(5)?,
        license_no: row.get(6)?,
        status: row.get(7)?,
        is_online: row.get::<_, i64>(8)? != 0,
        lat: row.get(9)?,
        lng: row.get(10)?,
        rating: row.get(11)?,
        rating_count: row.get(12)?,
        trips: row.get(13)?,
        created_at: row.get(14)?,
        approved_at: row.get(15)?,
    })
}

const DRIVER_COLUMNS: &str = "id, user_id, vehicle_class, make_model, plate, color, license_no, status, is_online, lat, lng, rating, rating_count, trips, created_at, approved_at";

pub fn get_driver(conn: &rusqlite::Connection, driver_id: i64) -> ApiResult<Option<Driver>> {
    let sql = format!("SELECT {DRIVER_COLUMNS} FROM drivers WHERE id = ?1");
    Ok(conn.query_row(&sql, [driver_id], driver_from_row).optional()?)
}

pub fn driver_for_user(conn: &rusqlite::Connection, user_id: i64) -> ApiResult<Option<Driver>> {
    let sql = format!("SELECT {DRIVER_COLUMNS} FROM drivers WHERE user_id = ?1");
    Ok(conn.query_row(&sql, [user_id], driver_from_row).optional()?)
}

fn driver_summary_at(row: &Row<'_>, start: usize) -> rusqlite::Result<DriverSummary> {
    Ok(DriverSummary {
        id: row.get(start)?,
        user_id: row.get(start + 1)?,
        name: row.get(start + 2)?,
        avatar_color: row.get(start + 3)?,
        rating: row.get(start + 4)?,
        rating_count: row.get(start + 5)?,
        trips: row.get(start + 6)?,
        vehicle_class: row.get(start + 7)?,
        make_model: row.get(start + 8)?,
        plate: row.get(start + 9)?,
        color: row.get(start + 10)?,
        is_online: row.get::<_, i64>(start + 11)? != 0,
        lat: row.get(start + 12)?,
        lng: row.get(start + 13)?,
    })
}

pub fn get_self_user(conn: &rusqlite::Connection, user_id: i64) -> ApiResult<SelfUser> {
    let found: Option<SelfUser> = conn
        .query_row(
            "SELECT id, name, email, phone, role, bio, languages, avatar_color, is_verified, status, created_at
             FROM users WHERE id = ?1",
            [user_id],
            |row| {
                let languages: String = row.get(6)?;
                Ok(SelfUser {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    email: row.get(2)?,
                    phone: row.get(3)?,
                    role: row.get(4)?,
                    bio: row.get(5)?,
                    languages: split_languages(&languages),
                    avatar_color: row.get(7)?,
                    is_verified: row.get::<_, i64>(8)? != 0,
                    status: row.get(9)?,
                    created_at: row.get(10)?,
                    driver: None,
                })
            },
        )
        .optional()?;
    let mut user = found.ok_or_else(|| AppError::not_found("Account not found."))?;
    if user.role == "driver" {
        user.driver = driver_for_user(conn, user_id)?;
    }
    Ok(user)
}

pub fn public_user(conn: &rusqlite::Connection, user_id: i64) -> ApiResult<Option<PublicUser>> {
    Ok(conn
        .query_row(
            "SELECT id, name, role, bio, languages, avatar_color, is_verified FROM users WHERE id = ?1",
            [user_id],
            |row| public_user_at(row, 0),
        )
        .optional()?)
}

pub const BOOKING_SELECT: &str = "SELECT
    b.id, b.code, b.status, b.pickup, b.pickup_lat, b.pickup_lng, b.dropoff, b.dropoff_lat, b.dropoff_lng,
    b.vehicle_class, b.distance_km, b.duration_min, b.fare, b.scheduled_for, b.notes, b.rating, b.review,
    b.created_at, b.accepted_at, b.started_at, b.completed_at, b.cancelled_at,
    cu.id, cu.name, cu.role, cu.bio, cu.languages, cu.avatar_color, cu.is_verified, cu.phone,
    d.id, d.user_id, du.name, du.avatar_color, d.rating, d.rating_count, d.trips, d.vehicle_class,
    d.make_model, d.plate, d.color, d.is_online, d.lat, d.lng, du.phone
 FROM bookings b
 JOIN users cu ON cu.id = b.customer_id
 LEFT JOIN drivers d ON d.id = b.driver_id
 LEFT JOIN users du ON du.id = d.user_id";

pub fn booking_from_row(row: &Row<'_>) -> rusqlite::Result<BookingView> {
    let driver = match row.get::<_, Option<i64>>(30)? {
        Some(_) => Some(driver_summary_at(row, 30)?),
        None => None,
    };
    Ok(BookingView {
        id: row.get(0)?,
        code: row.get(1)?,
        status: row.get(2)?,
        pickup: row.get(3)?,
        pickup_lat: row.get(4)?,
        pickup_lng: row.get(5)?,
        dropoff: row.get(6)?,
        dropoff_lat: row.get(7)?,
        dropoff_lng: row.get(8)?,
        vehicle_class: row.get(9)?,
        distance_km: row.get(10)?,
        duration_min: row.get(11)?,
        fare: row.get(12)?,
        scheduled_for: row.get(13)?,
        notes: row.get(14)?,
        rating: row.get(15)?,
        review: row.get(16)?,
        created_at: row.get(17)?,
        accepted_at: row.get(18)?,
        started_at: row.get(19)?,
        completed_at: row.get(20)?,
        cancelled_at: row.get(21)?,
        customer: public_user_at(row, 22)?,
        customer_phone: row.get(29)?,
        driver,
        driver_phone: row.get(44)?,
    })
}

pub fn get_booking(conn: &rusqlite::Connection, id: i64) -> ApiResult<Option<BookingView>> {
    let sql = format!("{BOOKING_SELECT} WHERE b.id = ?1");
    Ok(conn.query_row(&sql, [id], booking_from_row).optional()?)
}

pub fn booking_by_code(conn: &rusqlite::Connection, code: &str) -> ApiResult<Option<BookingView>> {
    let sql = format!("{BOOKING_SELECT} WHERE b.code = ?1");
    Ok(conn.query_row(&sql, [code], booking_from_row).optional()?)
}

pub const TOUR_SELECT: &str = "SELECT
    t.id, t.title, t.description, t.meeting_point, t.lat, t.lng, t.starts_at, t.duration_min,
    t.capacity, t.price, t.theme, t.status, t.created_at,
    u.id, u.name, u.role, u.bio, u.languages, u.avatar_color, u.is_verified
 FROM tours t JOIN users u ON u.id = t.host_id";

pub fn tour_view(conn: &rusqlite::Connection, tour_id: i64, viewer: Option<i64>) -> ApiResult<Option<TourView>> {
    let base: Option<TourView> = conn
        .query_row(
            &format!("{TOUR_SELECT} WHERE t.id = ?1"),
            [tour_id],
            |row| {
                let member_count: i64 = conn.query_row(
                    "SELECT COUNT(*) FROM tour_members WHERE tour_id = ?1",
                    [row.get::<_, i64>(0)?],
                    |r| r.get(0),
                )?;
                let capacity: i64 = row.get(8)?;
                let host = public_user_at(row, 13)?;
                Ok(TourView {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    description: row.get(2)?,
                    meeting_point: row.get(3)?,
                    lat: row.get(4)?,
                    lng: row.get(5)?,
                    starts_at: row.get(6)?,
                    duration_min: row.get(7)?,
                    capacity,
                    price: row.get(9)?,
                    theme: row.get(10)?,
                    status: row.get(11)?,
                    created_at: row.get(12)?,
                    is_host: viewer.map(|v| v == host.id).unwrap_or(false),
                    host,
                    member_count,
                    spots_left: (capacity - member_count).max(0),
                    is_member: false,
                    members: Vec::new(),
                })
            },
        )
        .optional()?;
    let Some(mut tour) = base else {
        return Ok(None);
    };
    let mut stmt = conn.prepare(
        "SELECT u.id, u.name, u.role, u.bio, u.languages, u.avatar_color, u.is_verified
         FROM tour_members m JOIN users u ON u.id = m.user_id
         WHERE m.tour_id = ?1 ORDER BY m.joined_at ASC, m.id ASC",
    )?;
    let members = stmt
        .query_map([tour.id], |row| public_user_at(row, 0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    if let Some(viewer) = viewer {
        tour.is_member = members.iter().any(|m| m.id == viewer);
        tour.is_host = tour.host.id == viewer;
    }
    tour.member_count = members.len() as i64;
    tour.spots_left = (tour.capacity - tour.member_count).max(0);
    tour.members = members;
    Ok(Some(tour))
}

pub fn is_tour_member(conn: &rusqlite::Connection, tour_id: i64, user_id: i64) -> ApiResult<bool> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM tour_members WHERE tour_id = ?1 AND user_id = ?2",
        params![tour_id, user_id],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

pub fn tour_chat_messages(
    conn: &rusqlite::Connection,
    tour_id: i64,
    viewer_id: i64,
) -> ApiResult<Vec<MessageView>> {
    let mut stmt = conn.prepare(
        "SELECT m.id, m.body, m.created_at, u.id, u.name, u.role, u.bio, u.languages, u.avatar_color, u.is_verified
         FROM messages m JOIN users u ON u.id = m.user_id
         WHERE m.room_type = 'tour' AND m.room_id = ?1
         ORDER BY m.id ASC LIMIT 200",
    )?;
    let rows = stmt
        .query_map([tour_id], |row| {
            let user = public_user_at(row, 3)?;
            Ok(MessageView {
                id: row.get(0)?,
                body: row.get(1)?,
                created_at: row.get(2)?,
                is_own: user.id == viewer_id,
                user,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn notify(
    conn: &rusqlite::Connection,
    user_id: i64,
    kind: &str,
    title: &str,
    body: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO notifications (user_id, kind, title, body, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![user_id, kind, title, body, now_iso()],
    )?;
    Ok(())
}

pub fn notifications(conn: &rusqlite::Connection, user_id: i64) -> ApiResult<Vec<NotificationView>> {
    let mut stmt = conn.prepare(
        "SELECT id, kind, title, body, is_read, created_at FROM notifications
         WHERE user_id = ?1 ORDER BY id DESC LIMIT 50",
    )?;
    let rows = stmt
        .query_map([user_id], |row| {
            Ok(NotificationView {
                id: row.get(0)?,
                kind: row.get(1)?,
                title: row.get(2)?,
                body: row.get(3)?,
                is_read: row.get::<_, i64>(4)? != 0,
                created_at: row.get(5)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn audit(conn: &rusqlite::Connection, actor_id: i64, action: &str, detail: &str) {
    let _ = conn.execute(
        "INSERT INTO audit_log (actor_id, action, detail, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![actor_id, action, detail, now_iso()],
    );
}
