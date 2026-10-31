use std::error::Error;

use chrono::{DateTime, Duration, NaiveDateTime, Utc};
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::{params, Connection};

use crate::auth::hash_password;
use crate::util::{estimate, now_iso, road_distance_km};

type SeedResult<T> = Result<T, Box<dyn Error>>;

fn ts(dt: DateTime<Utc>) -> String {
    dt.to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

fn in_days_local(days: i64, hour: u32, minute: u32) -> String {
    // Addis Ababa is UTC+3 year round.
    let target = Utc::now() + Duration::days(days);
    let local_date = target.date_naive();
    let local_naive = local_date.and_hms_opt(hour, minute, 0).unwrap_or_else(|| local_date.and_hms_opt(9, 0, 0).unwrap());
    let utc_naive: NaiveDateTime = local_naive - Duration::hours(3);
    ts(DateTime::<Utc>::from_naive_utc_and_offset(utc_naive, Utc))
}

fn ago(days: i64, hours: i64) -> String {
    ts(Utc::now() - Duration::days(days) - Duration::hours(hours))
}

fn add_user(
    conn: &Connection,
    name: &str,
    email: &str,
    phone: &str,
    password: &str,
    role: &str,
    bio: &str,
    verified: bool,
    color: &str,
) -> SeedResult<i64> {
    let hash = hash_password(password)?;
    conn.execute(
        "INSERT INTO users (name, email, phone, password_hash, role, bio, languages, avatar_color, is_verified, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'active', ?10)",
        params![
            name,
            email,
            phone,
            hash,
            role,
            bio,
            "English, Amharic",
            color,
            if verified { 1 } else { 0 },
            ago(30, 0)
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

#[allow(clippy::too_many_arguments)]
fn add_driver(
    conn: &Connection,
    user_id: i64,
    class: &str,
    make_model: &str,
    plate: &str,
    color: &str,
    license: &str,
    status: &str,
    online: bool,
    lat: f64,
    lng: f64,
    rating: f64,
    rating_count: i64,
    trips: i64,
) -> SeedResult<i64> {
    conn.execute(
        "INSERT INTO drivers (user_id, vehicle_class, make_model, plate, color, license_no, status, is_online, lat, lng, rating, rating_count, trips, created_at, approved_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
        params![
            user_id,
            class,
            make_model,
            plate,
            color,
            license,
            status,
            if online { 1 } else { 0 },
            lat,
            lng,
            rating,
            rating_count,
            trips,
            ago(20, 0),
            if status == "approved" { Some(ago(15, 0)) } else { None }
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

#[allow(clippy::too_many_arguments)]
fn add_booking(
    conn: &Connection,
    code: &str,
    customer_id: i64,
    driver_id: Option<i64>,
    pickup: &str,
    p_lat: f64,
    p_lng: f64,
    dropoff: &str,
    d_lat: f64,
    d_lng: f64,
    class: &str,
    status: &str,
    scheduled_for: Option<&str>,
    rating: Option<i64>,
    review: &str,
    created_at: &str,
    accepted_at: Option<&str>,
    completed_at: Option<&str>,
    notes: &str,
) -> SeedResult<i64> {
    let km = road_distance_km(p_lat, p_lng, d_lat, d_lng);
    let (fare, duration) = estimate(class, km).unwrap_or((100, 10));
    conn.execute(
        "INSERT INTO bookings (code, customer_id, driver_id, pickup, pickup_lat, pickup_lng, dropoff, dropoff_lat, dropoff_lng,
            vehicle_class, distance_km, duration_min, fare, status, scheduled_for, notes, rating, review, created_at, accepted_at, started_at, completed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22)",
        params![
            code,
            customer_id,
            driver_id,
            pickup,
            p_lat,
            p_lng,
            dropoff,
            d_lat,
            d_lng,
            class,
            (km * 10.0).round() / 10.0,
            duration,
            fare,
            status,
            scheduled_for,
            notes,
            rating,
            review,
            created_at,
            accepted_at,
            accepted_at,
            completed_at
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn seed(pool: &Pool<SqliteConnectionManager>) -> SeedResult<()> {
    let mut conn = pool.get()?;
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM users", [], |row| row.get(0))?;
    if count > 0 {
        return Ok(());
    }

    let tx = conn.transaction()?;

    let admin = add_user(
        &tx,
        "Selamawit Bekele",
        "admin@addisgo.et",
        "+251 911 000 001",
        "Admin123!",
        "admin",
        "Operations lead at AddisGo. Keeping every trip safe and on time.",
        true,
        "#0d3b2e",
    )?;
    let meron = add_user(
        &tx,
        "Meron Tadesse",
        "meron@example.com",
        "+251 911 234 567",
        "Rider123!",
        "customer",
        "Product designer. Bole local, always chasing the best macchiato.",
        true,
        "#e86a4a",
    )?;
    let abel = add_user(
        &tx,
        "Abel Tesfaye",
        "abel@example.com",
        "+251 922 555 010",
        "Rider123!",
        "customer",
        "Coffee trader who moves between Kazanchis and Bole all week.",
        true,
        "#4a7c9e",
    )?;
    let liya = add_user(
        &tx,
        "Liya Haile",
        "liya@example.com",
        "+251 933 555 011",
        "Rider123!",
        "customer",
        "Architecture student, weekend tour regular.",
        false,
        "#b06ab3",
    )?;
    let jake = add_user(
        &tx,
        "Jake Miller",
        "jake@example.com",
        "+1 202 555 0142",
        "Rider123!",
        "customer",
        "Visiting Addis for a month. Here for the food, history and hikes.",
        false,
        "#d19a3e",
    )?;
    let selam = add_user(
        &tx,
        "Selam Girma",
        "selam@example.com",
        "+251 944 555 012",
        "Guide123!",
        "customer",
        "Born-and-raised Addis guide. Entoto sunsets, hidden galleries and strong coffee.",
        true,
        "#2f7d62",
    )?;
    let nahom = add_user(
        &tx,
        "Nahom Assefa",
        "nahom@example.com",
        "+251 955 555 013",
        "Guide123!",
        "customer",
        "Food historian and Merkato regular. I explain the spices, you taste them.",
        true,
        "#9c5b3b",
    )?;

    let dawit = add_user(
        &tx,
        "Dawit Mekonnen",
        "dawit@example.com",
        "+251 911 555 021",
        "Driver123!",
        "driver",
        "Quiet electric rides across Bole and the airport road.",
        true,
        "#145c45",
    )?;
    let hanna = add_user(
        &tx,
        "Hanna Getachew",
        "hanna@example.com",
        "+251 912 555 022",
        "Driver123!",
        "driver",
        "Comfort-class driver. Ask me where to find the best shiro.",
        true,
        "#c47c2b",
    )?;
    let yonas = add_user(
        &tx,
        "Yonas Alemu",
        "yonas@example.com",
        "+251 913 555 023",
        "Driver123!",
        "driver",
        "Piassa local, EV driver, five-star airport runs.",
        true,
        "#3b6ea5",
    )?;
    let marta = add_user(
        &tx,
        "Marta Haile",
        "marta@example.com",
        "+251 914 555 024",
        "Driver123!",
        "driver",
        "Megenagna to CMC comfort rides, weekday mornings.",
        true,
        "#a8578a",
    )?;
    let bereket = add_user(
        &tx,
        "Bereket Solomon",
        "bereket@example.com",
        "+251 915 555 025",
        "Driver123!",
        "driver",
        "Tour van driver for groups and airport luggage runs.",
        true,
        "#6b7f3a",
    )?;
    let lidya = add_user(
        &tx,
        "Lidya Tesfaye",
        "lidya@example.com",
        "+251 916 555 026",
        "Driver123!",
        "driver",
        "Electric E2 driver around Entoto and Sahlitemariam.",
        true,
        "#c4523e",
    )?;
    let rahel = add_user(
        &tx,
        "Rahel Worku",
        "rahel@example.com",
        "+251 917 555 027",
        "Driver123!",
        "driver",
        "Comfort driver covering Sarbet, Old Airport and CMC.",
        true,
        "#4f8b85",
    )?;
    let tesfaye = add_user(
        &tx,
        "Tesfaye Bekele",
        "tesfaye@example.com",
        "+251 918 555 028",
        "Driver123!",
        "driver",
        "Group van driver, available on request for full-day tours.",
        true,
        "#8a6d3b",
    )?;
    let samuel = add_user(
        &tx,
        "Samuel Girma",
        "samuel@example.com",
        "+251 919 555 029",
        "Driver123!",
        "driver",
        "New to AddisGo. Electric E2, Bole and Megenagna.",
        false,
        "#5c6b8a",
    )?;

    let d_dawit = add_driver(&tx, dawit, "e2", "BYD E2", "AA 2 12345", "Pearl white", "DL-AA-88421", "approved", true, 8.9950, 38.7870, 4.9, 128, 342)?;
    let d_hanna = add_driver(&tx, hanna, "comfort", "Toyota Corolla", "AA 2 44190", "Silver", "DL-AA-77120", "approved", true, 9.0140, 38.7620, 4.8, 96, 221)?;
    let d_yonas = add_driver(&tx, yonas, "e2", "BYD E2", "AA 3 90211", "Ocean blue", "DL-AA-65402", "approved", true, 9.0340, 38.7500, 4.7, 74, 180)?;
    let d_marta = add_driver(&tx, marta, "comfort", "Suzuki Dzire", "AA 2 55781", "White", "DL-AA-91003", "approved", true, 9.0200, 38.8010, 4.9, 61, 148)?;
    let d_bereket = add_driver(&tx, bereket, "van", "Toyota HiAce", "AA 1 33007", "White", "DL-AA-33219", "approved", true, 9.0000, 38.7350, 4.6, 39, 87)?;
    let d_lidya = add_driver(&tx, lidya, "e2", "BYD E2", "AA 3 78112", "Crimson", "DL-AA-44321", "approved", true, 9.0600, 38.7600, 5.0, 21, 46)?;
    let d_rahel = add_driver(&tx, rahel, "comfort", "Toyota Yaris", "AA 2 66402", "Graphite", "DL-AA-55012", "approved", true, 9.0190, 38.8270, 4.8, 33, 72)?;
    add_driver(&tx, tesfaye, "van", "Toyota HiAce", "AA 1 11882", "Silver", "DL-AA-22118", "approved", false, 9.0360, 38.8400, 4.5, 54, 110)?;
    add_driver(&tx, samuel, "e2", "BYD E2", "AA 4 00921", "Midnight black", "DL-AA-99410", "pending", false, 9.0500, 38.7900, 5.0, 0, 0)?;

    // Completed trips create the revenue history used by the CRM dashboard.
    let yesterday = ago(1, 4);
    let y_created = ago(1, 5);
    add_booking(
        &tx,
        "AG-7K2M4Q",
        meron,
        Some(d_dawit),
        "Bole International Airport, Terminal 2",
        8.9779,
        38.7993,
        "Bole Medhanialem Church",
        8.9950,
        38.7870,
        "e2",
        "completed",
        None,
        Some(5),
        "Smooth, quiet ride. Dawit knew a shortcut around the airport traffic.",
        &y_created,
        Some(&yesterday),
        Some(&yesterday),
        "Two large suitcases.",
    )?;
    let two_days = ago(2, 6);
    let two_created = ago(2, 7);
    add_booking(
        &tx,
        "AG-9P4X2B",
        abel,
        Some(d_hanna),
        "Piassa, Churchill Avenue",
        9.0340,
        38.7500,
        "Meskel Square",
        9.0100,
        38.7610,
        "comfort",
        "completed",
        None,
        Some(5),
        "Great conversation and a very clean car.",
        &two_created,
        Some(&two_days),
        Some(&two_days),
        "",
    )?;
    let four_days = ago(4, 3);
    let four_created = ago(4, 4);
    add_booking(
        &tx,
        "AG-3F8N6T",
        meron,
        Some(d_yonas),
        "Meskel Square",
        9.0100,
        38.7610,
        "Entoto Natural Park",
        9.0700,
        38.7650,
        "e2",
        "completed",
        None,
        Some(4),
        "Beautiful drive up the mountain. Would ride again.",
        &four_created,
        Some(&four_days),
        Some(&four_days),
        "",
    )?;
    add_booking(
        &tx,
        "AG-5R1W9A",
        liya,
        Some(d_marta),
        "Megenagna, Ring Road",
        9.0200,
        38.8010,
        "CMC Roundabout",
        9.0190,
        38.8270,
        "comfort",
        "completed",
        None,
        Some(4),
        "On time and friendly.",
        &ago(5, 2),
        Some(&ago(5, 3)),
        Some(&ago(5, 2)),
        "",
    )?;
    add_booking(
        &tx,
        "AG-8T5Y3E",
        jake,
        Some(d_bereket),
        "Sarbet, Ethio-China Road",
        9.0000,
        38.7350,
        "Bole International Airport",
        8.9779,
        38.7993,
        "van",
        "completed",
        None,
        Some(5),
        "Plenty of room for four bags. Made the flight with time to spare.",
        &ago(6, 4),
        Some(&ago(6, 5)),
        Some(&ago(6, 4)),
        "Four suitcases, international departure.",
    )?;
    add_booking(
        &tx,
        "AG-2C6V7U",
        abel,
        Some(d_rahel),
        "Kazanchis, ECA Road",
        9.0140,
        38.7620,
        "Piassa, Churchill Avenue",
        9.0340,
        38.7500,
        "comfort",
        "completed",
        None,
        Some(4),
        "Good route, avoided the ring road jam.",
        &ago(7, 3),
        Some(&ago(7, 4)),
        Some(&ago(7, 3)),
        "",
    )?;
    let today = ago(0, 5);
    let today_created = ago(0, 6);
    add_booking(
        &tx,
        "AG-6N8B1D",
        meron,
        Some(d_lidya),
        "Bole Medhanialem Church",
        8.9950,
        38.7870,
        "Kazanchis, ECA Road",
        9.0140,
        38.7620,
        "e2",
        "completed",
        None,
        None,
        "",
        &today_created,
        Some(&today),
        Some(&today),
        "",
    )?;

    // A live request so the driver dashboard has something to demo out of the box.
    add_booking(
        &tx,
        "AG-4H7J2L",
        abel,
        None,
        "Kazanchis, ECA Road",
        9.0140,
        38.7620,
        "Bole International Airport",
        8.9779,
        38.7993,
        "e2",
        "requested",
        None,
        None,
        "",
        &ago(0, 0),
        None,
        None,
        "One carry-on bag.",
    )?;
    add_booking(
        &tx,
        "AG-1Q5Z8M",
        liya,
        None,
        "Sarbet, Ethio-China Road",
        9.0000,
        38.7350,
        "Entoto Natural Park",
        9.0700,
        38.7650,
        "comfort",
        "requested",
        Some(&in_days_local(1, 8, 30)),
        None,
        "",
        &ago(0, 1),
        None,
        None,
        "Sunrise hike, please pick me up at the gate.",
    )?;

    // City tours
    let entoto = add_tour(
        &tx,
        selam,
        "Sunset over Entoto",
        "A slow golden-hour walk above the city. We start at the eucalyptus forest gate, follow the ridge trail to the viewpoint, then share coffee and injera at a family-run spot. Bring a light jacket — it gets breezy up here.",
        "Entoto Natural Park — main gate",
        9.0700,
        38.7650,
        &in_days_local(1, 16, 0),
        90,
        8,
        950,
        "entoto",
    )?;
    let merkato = add_tour(
        &tx,
        nahom,
        "Merkato spice & craft walk",
        "A guided loop through Africa's largest open-air market. We learn how berbere is blended, meet basket weavers, and finish with a tasting menu at a family kitchen. Small group, English and Amharic.",
        "Merkato — Gate 1",
        9.0350,
        38.7330,
        &in_days_local(2, 9, 30),
        150,
        6,
        1500,
        "merkato",
    )?;
    let museum = add_tour(
        &tx,
        selam,
        "Unity Park & museum morning",
        "Start with the palace grounds and Unity Park, then walk to the National Museum to meet Lucy. Tickets included, coffee stop on the way. Easy pace, mostly flat, ideal for first-time visitors.",
        "Unity Park — main gate",
        9.0200,
        38.7600,
        &in_days_local(3, 10, 0),
        180,
        10,
        1200,
        "museum",
    )?;
    let bole = add_tour(
        &tx,
        nahom,
        "Bole after dark: food crawl",
        "Four stops, four kitchens, one very full group. We try tibs, kitfo, and a modern Ethiopian tasting plate, then end at a rooftop for honey wine. Vegetarian route available — tell us when you join.",
        "Bole Medhanialem Church",
        8.9950,
        38.7870,
        &in_days_local(1, 19, 0),
        180,
        8,
        1800,
        "bole",
    )?;

    for (tour, user, hours_ago) in [
        (entoto, selam, 72),
        (entoto, meron, 48),
        (entoto, jake, 20),
        (entoto, liya, 8),
        (merkato, nahom, 60),
        (merkato, abel, 26),
        (museum, selam, 50),
        (museum, meron, 12),
        (bole, nahom, 40),
        (bole, jake, 18),
        (bole, liya, 10),
        (bole, abel, 4),
    ] {
        tx.execute(
            "INSERT OR IGNORE INTO tour_members (tour_id, user_id, joined_at) VALUES (?1, ?2, ?3)",
            params![tour, user, ago(0, hours_ago)],
        )?;
    }

    for (tour, user, body, hours_ago) in [
        (entoto, selam, "Welcome everyone! We meet at the main gate at 4:00 PM. I'll be in a green AddisGo cap.", 30),
        (entoto, meron, "Perfect. Is the trail okay with normal sneakers?", 26),
        (entoto, selam, "Yes, trainers are fine. We walk about 3 km at an easy pace.", 24),
        (entoto, jake, "Count me in. I'm staying near Bole, should I take a ride up?", 18),
        (entoto, selam, "A ride to the gate is easiest. Booking an E2 is around 300–400 ETB from Bole.", 16),
        (merkato, nahom, "Please wear closed shoes — the lanes can be uneven. Bring small cash for crafts.", 22),
        (merkato, abel, "Noted. Is photography okay inside the spice stalls?", 12),
        (merkato, nahom, "Ask first, but most vendors are happy to be photographed.", 9),
        (museum, selam, "Tickets are included in the price. We finish near the National Theatre, easy for a ride.", 10),
        (bole, nahom, "Vegetarian? Reply here and I'll arrange the tasting plate for you.", 5),
    ] {
        tx.execute(
            "INSERT INTO messages (room_type, room_id, user_id, body, created_at) VALUES ('tour', ?1, ?2, ?3, ?4)",
            params![tour, user, body, ago(0, hours_ago)],
        )?;
    }

    tx.execute(
        "INSERT INTO notifications (user_id, kind, title, body, is_read, created_at)
         VALUES (?1, 'ride', 'Rate your ride with Lidya', 'Your Bole → Kazanchis trip is complete. How did it go?', 0, ?2)",
        params![meron, ago(0, 4)],
    )?;
    tx.execute(
        "INSERT INTO notifications (user_id, kind, title, body, is_read, created_at)
         VALUES (?1, 'tour', 'You joined Sunset over Entoto', 'Selam posted the meeting details in the group chat.', 0, ?2)",
        params![meron, ago(0, 20)],
    )?;
    tx.execute(
        "INSERT INTO notifications (user_id, kind, title, body, is_read, created_at)
         VALUES (?1, 'driver', 'A driver is waiting for review', 'Samuel Girma submitted an E2 driver application.', 0, ?2)",
        params![admin, ago(0, 2)],
    )?;
    tx.execute(
        "INSERT INTO notifications (user_id, kind, title, body, is_read, created_at)
         VALUES (?1, 'ride', 'Your ride request is live', 'Nearby E2 drivers have been notified. We will update you when one accepts.', 0, ?2)",
        params![abel, ago(0, 0)],
    )?;

    tx.execute(
        "INSERT INTO audit_log (actor_id, action, detail, created_at) VALUES (?1, 'system.seed', 'Demo data seeded for AddisGo v1', ?2)",
        params![admin, now_iso()],
    )?;
    tx.execute(
        "INSERT INTO meta (key, value) VALUES ('seeded_at', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [now_iso()],
    )?;

    tx.commit()?;
    tracing::info!("Seeded demo data: 15 users, 9 drivers, 4 tours, 9 bookings");
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn add_tour(
    conn: &Connection,
    host_id: i64,
    title: &str,
    description: &str,
    meeting: &str,
    lat: f64,
    lng: f64,
    starts_at: &str,
    duration_min: i64,
    capacity: i64,
    price: i64,
    theme: &str,
) -> SeedResult<i64> {
    conn.execute(
        "INSERT INTO tours (host_id, title, description, meeting_point, lat, lng, starts_at, duration_min, capacity, price, theme, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'upcoming', ?12)",
        params![
            host_id,
            title,
            description,
            meeting,
            lat,
            lng,
            starts_at,
            duration_min,
            capacity,
            price,
            theme,
            ago(10, 0)
        ],
    )?;
    Ok(conn.last_insert_rowid())
}
