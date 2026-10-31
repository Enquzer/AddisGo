PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    phone         TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'customer'
                  CHECK (role IN ('customer', 'driver', 'admin')),
    bio           TEXT NOT NULL DEFAULT '',
    languages     TEXT NOT NULL DEFAULT 'English, Amharic',
    avatar_color  TEXT NOT NULL DEFAULT '#145c45',
    is_verified   INTEGER NOT NULL DEFAULT 0,
    status        TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'suspended')),
    created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS drivers (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    vehicle_class TEXT NOT NULL DEFAULT 'e2'
                  CHECK (vehicle_class IN ('e2', 'comfort', 'van', 'bajaj')),
    make_model    TEXT NOT NULL,
    plate         TEXT NOT NULL,
    color         TEXT NOT NULL DEFAULT '',
    license_no    TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'suspended')),
    is_online     INTEGER NOT NULL DEFAULT 0,
    lat           REAL,
    lng           REAL,
    rating        REAL NOT NULL DEFAULT 5.0,
    rating_count  INTEGER NOT NULL DEFAULT 0,
    trips         INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL,
    approved_at   TEXT
);

CREATE TABLE IF NOT EXISTS bookings (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    code          TEXT NOT NULL UNIQUE,
    customer_id   INTEGER NOT NULL REFERENCES users(id),
    driver_id     INTEGER REFERENCES drivers(id),
    pickup        TEXT NOT NULL,
    pickup_lat    REAL NOT NULL,
    pickup_lng    REAL NOT NULL,
    dropoff       TEXT NOT NULL,
    dropoff_lat   REAL NOT NULL,
    dropoff_lng   REAL NOT NULL,
    vehicle_class TEXT NOT NULL
                  CHECK (vehicle_class IN ('e2', 'comfort', 'van', 'bajaj')),
    distance_km   REAL NOT NULL,
    duration_min  INTEGER NOT NULL,
    fare          INTEGER NOT NULL,
    status        TEXT NOT NULL DEFAULT 'requested'
                  CHECK (status IN ('requested', 'accepted', 'arriving', 'in_progress', 'completed', 'cancelled')),
    scheduled_for TEXT,
    notes         TEXT NOT NULL DEFAULT '',
    rating        INTEGER,
    review        TEXT NOT NULL DEFAULT '',
    created_at    TEXT NOT NULL,
    accepted_at   TEXT,
    started_at    TEXT,
    completed_at  TEXT,
    cancelled_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_bookings_customer ON bookings(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_driver ON bookings(driver_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status, created_at DESC);

CREATE TABLE IF NOT EXISTS tours (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    host_id       INTEGER NOT NULL REFERENCES users(id),
    title         TEXT NOT NULL,
    description   TEXT NOT NULL,
    meeting_point TEXT NOT NULL,
    lat           REAL NOT NULL,
    lng           REAL NOT NULL,
    starts_at     TEXT NOT NULL,
    duration_min  INTEGER NOT NULL,
    capacity      INTEGER NOT NULL,
    price         INTEGER NOT NULL,
    theme         TEXT NOT NULL DEFAULT 'entoto',
    image_url     TEXT NOT NULL DEFAULT '',
    status        TEXT NOT NULL DEFAULT 'upcoming'
                  CHECK (status IN ('upcoming', 'cancelled', 'completed')),
    created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tours_start ON tours(starts_at);

CREATE TABLE IF NOT EXISTS tour_members (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    tour_id   INTEGER NOT NULL REFERENCES tours(id) ON DELETE CASCADE,
    user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at TEXT NOT NULL,
    UNIQUE (tour_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    room_type  TEXT NOT NULL CHECK (room_type IN ('tour', 'ride')),
    room_id    INTEGER NOT NULL,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body       TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room_type, room_id, id);

CREATE TABLE IF NOT EXISTS notifications (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL DEFAULT 'info',
    title      TEXT NOT NULL,
    body       TEXT NOT NULL DEFAULT '',
    link       TEXT NOT NULL DEFAULT '',
    is_read    INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read, id DESC);

CREATE TABLE IF NOT EXISTS reports (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    reporter_id INTEGER NOT NULL REFERENCES users(id),
    target_type TEXT NOT NULL CHECK (target_type IN ('message', 'user', 'tour', 'booking')),
    target_id   INTEGER NOT NULL,
    reason      TEXT NOT NULL,
    detail      TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'open'
                CHECK (status IN ('open', 'resolved', 'dismissed')),
    created_at  TEXT NOT NULL,
    resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id   INTEGER NOT NULL REFERENCES users(id),
    action     TEXT NOT NULL,
    detail     TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subscribers (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    email      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    source     TEXT NOT NULL DEFAULT 'landing',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS email_outbox (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    recipient  TEXT NOT NULL,
    subject    TEXT NOT NULL,
    template   TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'sent',
    error      TEXT,
    created_at TEXT NOT NULL
);

/* --- Admin-managed website content (CRM / CMS) ------------------------- */

CREATE TABLE IF NOT EXISTS fare_classes (
    key        TEXT PRIMARY KEY,
    label      TEXT NOT NULL,
    base       INTEGER NOT NULL,
    per_km     REAL NOT NULL,
    per_min    REAL NOT NULL,
    minimum    INTEGER NOT NULL,
    seats      INTEGER NOT NULL DEFAULT 4,
    is_active  INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    venue       TEXT NOT NULL DEFAULT '',
    lat         REAL,
    lng         REAL,
    starts_at   TEXT NOT NULL,
    ends_at     TEXT,
    category    TEXT NOT NULL DEFAULT 'culture'
                CHECK (category IN ('culture', 'music', 'food', 'sport', 'community', 'art', 'other')),
    price       INTEGER NOT NULL DEFAULT 0,
    image_url   TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'published'
                CHECK (status IN ('draft', 'published', 'cancelled')),
    created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_start ON events(starts_at);

CREATE TABLE IF NOT EXISTS city_routes (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    start_point  TEXT NOT NULL,
    end_point    TEXT NOT NULL,
    distance_km  REAL NOT NULL DEFAULT 0,
    duration_min INTEGER NOT NULL DEFAULT 0,
    vehicle_class TEXT NOT NULL DEFAULT 'e2'
                 CHECK (vehicle_class IN ('e2', 'comfort', 'van', 'bajaj')),
    fare         INTEGER NOT NULL DEFAULT 0,
    status       TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'inactive')),
    created_at   TEXT NOT NULL
);
