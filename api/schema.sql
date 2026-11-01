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
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    recipient       TEXT NOT NULL,
    subject         TEXT NOT NULL,
    template        TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'queued',
    error           TEXT,
    attempts        INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT,
    last_attempt_at TEXT,
    delivered_at    TEXT,
    payload         TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT
);

/* --- Request de-duplication (Idempotency-Key) --------------------------- */

CREATE TABLE IF NOT EXISTS request_keys (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scope      TEXT NOT NULL,
    key        TEXT NOT NULL,
    body_hash  TEXT NOT NULL,
    status     INTEGER NOT NULL DEFAULT 0,
    response   TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    UNIQUE (user_id, scope, key)
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

/* --- Feedback, dispatch supervision and cancellation forensics ---------- */

CREATE TABLE IF NOT EXISTS ratings (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_id     INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    rater_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rater_role     TEXT NOT NULL CHECK (rater_role IN ('rider', 'driver')),
    driver_id      INTEGER REFERENCES drivers(id) ON DELETE CASCADE,
    customer_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
    overall        INTEGER NOT NULL CHECK (overall BETWEEN 1 AND 5),
    car_condition  INTEGER,
    comfort        INTEGER,
    cleanliness    INTEGER,
    service        INTEGER,
    safety         INTEGER,
    punctuality    INTEGER,
    tags           TEXT NOT NULL DEFAULT '[]',
    review         TEXT NOT NULL DEFAULT '',
    created_at     TEXT NOT NULL,
    UNIQUE (booking_id, rater_role)
);

CREATE INDEX IF NOT EXISTS idx_ratings_driver ON ratings(driver_id, rater_role, id DESC);
CREATE INDEX IF NOT EXISTS idx_ratings_customer ON ratings(customer_id, rater_role, id DESC);

CREATE TABLE IF NOT EXISTS cancellations (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_id        INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    cancelled_by_role TEXT NOT NULL CHECK (cancelled_by_role IN ('rider', 'driver', 'admin', 'system')),
    cancelled_by_user INTEGER REFERENCES users(id),
    reason_code       TEXT NOT NULL,
    blame_party       TEXT NOT NULL CHECK (blame_party IN ('rider', 'driver', 'platform', 'none')),
    fee_applied       INTEGER NOT NULL DEFAULT 0,
    outcome           TEXT NOT NULL CHECK (outcome IN ('trip_cancelled', 'redispatch')),
    note              TEXT NOT NULL DEFAULT '',
    created_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cancellations_booking ON cancellations(booking_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_cancellations_reason ON cancellations(reason_code, created_at DESC);

CREATE TABLE IF NOT EXISTS dispatch_attempts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_id   INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    driver_id    INTEGER NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    round        INTEGER NOT NULL,
    offered_at   TEXT NOT NULL,
    expires_at   TEXT NOT NULL,
    outcome      TEXT NOT NULL DEFAULT 'pending'
                 CHECK (outcome IN ('pending', 'accepted', 'declined', 'timeout', 'superseded')),
    responded_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_dispatch_booking ON dispatch_attempts(booking_id, round);

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

/* --- Phase 2: driver presence, heartbeats and air-time ------------------- */

CREATE TABLE IF NOT EXISTS driver_sessions (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    driver_id      INTEGER NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    started_at     TEXT NOT NULL,
    last_heartbeat TEXT NOT NULL,
    ended_at       TEXT,
    end_reason     TEXT NOT NULL DEFAULT 'active'
                   CHECK (end_reason IN ('active', 'offline', 'app_closed', 'suspended', 'admin')),
    lat            REAL,
    lng            REAL
);

CREATE INDEX IF NOT EXISTS idx_driver_sessions_driver ON driver_sessions(driver_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_driver_sessions_open ON driver_sessions(driver_id, ended_at);

/* --- Phase 3: commission / incentive ledger ----------------------------- */

CREATE TABLE IF NOT EXISTS trip_ledger (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_id        INTEGER NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
    driver_id         INTEGER REFERENCES drivers(id) ON DELETE SET NULL,
    customer_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
    fare              INTEGER NOT NULL,
    model             TEXT NOT NULL CHECK (model IN ('commission', 'incentive')),
    commission_rate   REAL NOT NULL DEFAULT 0,
    commission_amount REAL NOT NULL DEFAULT 0,
    incentive_rate    REAL NOT NULL DEFAULT 0,
    incentive_amount  REAL NOT NULL DEFAULT 0,
    driver_earning    REAL NOT NULL,
    platform_earning  REAL NOT NULL,
    created_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_trip_ledger_driver ON trip_ledger(driver_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trip_ledger_created ON trip_ledger(created_at DESC);

/* --- Phase 5: privacy-safe website analytics (aggregate only) ----------- */

CREATE TABLE IF NOT EXISTS web_analytics (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    day           TEXT NOT NULL,
    path          TEXT NOT NULL,
    referrer_host TEXT NOT NULL DEFAULT '',
    event         TEXT NOT NULL DEFAULT 'pageview',
    count         INTEGER NOT NULL DEFAULT 0,
    UNIQUE (day, path, referrer_host, event)
);

CREATE INDEX IF NOT EXISTS idx_web_analytics_day ON web_analytics(day, event);
CREATE INDEX IF NOT EXISTS idx_web_analytics_path ON web_analytics(path, day);
