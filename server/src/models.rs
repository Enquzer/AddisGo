use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
pub struct PublicUser {
    pub id: i64,
    pub name: String,
    pub role: String,
    pub bio: String,
    pub languages: Vec<String>,
    pub avatar_color: String,
    pub is_verified: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct SelfUser {
    pub id: i64,
    pub name: String,
    pub email: String,
    pub phone: String,
    pub role: String,
    pub bio: String,
    pub languages: Vec<String>,
    pub avatar_color: String,
    pub is_verified: bool,
    pub status: String,
    pub created_at: String,
    pub driver: Option<Driver>,
}

#[derive(Clone, Debug, Serialize)]
pub struct Driver {
    pub id: i64,
    pub user_id: i64,
    pub vehicle_class: String,
    pub make_model: String,
    pub plate: String,
    pub color: String,
    pub license_no: String,
    pub status: String,
    pub is_online: bool,
    pub lat: Option<f64>,
    pub lng: Option<f64>,
    pub rating: f64,
    pub rating_count: i64,
    pub trips: i64,
    pub created_at: String,
    pub approved_at: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct DriverSummary {
    pub id: i64,
    pub user_id: i64,
    pub name: String,
    pub avatar_color: String,
    pub rating: f64,
    pub rating_count: i64,
    pub trips: i64,
    pub vehicle_class: String,
    pub make_model: String,
    pub plate: String,
    pub color: String,
    pub is_online: bool,
    pub lat: Option<f64>,
    pub lng: Option<f64>,
}

#[derive(Clone, Debug, Serialize)]
pub struct NearbyDriver {
    #[serde(flatten)]
    pub driver: DriverSummary,
    pub distance_km: f64,
    pub eta_min: i64,
}

#[derive(Clone, Debug, Serialize)]
pub struct BookingView {
    pub id: i64,
    pub code: String,
    pub status: String,
    pub pickup: String,
    pub pickup_lat: f64,
    pub pickup_lng: f64,
    pub dropoff: String,
    pub dropoff_lat: f64,
    pub dropoff_lng: f64,
    pub vehicle_class: String,
    pub distance_km: f64,
    pub duration_min: i64,
    pub fare: i64,
    pub scheduled_for: Option<String>,
    pub notes: String,
    pub rating: Option<i64>,
    pub review: String,
    pub created_at: String,
    pub accepted_at: Option<String>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub cancelled_at: Option<String>,
    pub customer: PublicUser,
    pub customer_phone: Option<String>,
    pub driver: Option<DriverSummary>,
    pub driver_phone: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct TourView {
    pub id: i64,
    pub title: String,
    pub description: String,
    pub meeting_point: String,
    pub lat: f64,
    pub lng: f64,
    pub starts_at: String,
    pub duration_min: i64,
    pub capacity: i64,
    pub price: i64,
    pub theme: String,
    pub status: String,
    pub created_at: String,
    pub host: PublicUser,
    pub member_count: i64,
    pub spots_left: i64,
    pub is_member: bool,
    pub is_host: bool,
    pub members: Vec<PublicUser>,
}

#[derive(Clone, Debug, Serialize)]
pub struct MessageView {
    pub id: i64,
    pub body: String,
    pub created_at: String,
    pub user: PublicUser,
    pub is_own: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct NotificationView {
    pub id: i64,
    pub kind: String,
    pub title: String,
    pub body: String,
    pub is_read: bool,
    pub created_at: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct TourMessage {
    pub id: i64,
    pub body: String,
    pub created_at: String,
    pub user: PublicUser,
    pub is_own: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct AdminUser {
    pub id: i64,
    pub name: String,
    pub email: String,
    pub phone: String,
    pub role: String,
    pub status: String,
    pub is_verified: bool,
    pub avatar_color: String,
    pub created_at: String,
    pub driver_status: Option<String>,
    pub bookings: i64,
}

#[derive(Clone, Debug, Serialize)]
pub struct AdminDriver {
    pub id: i64,
    pub user_id: i64,
    pub name: String,
    pub email: String,
    pub phone: String,
    pub avatar_color: String,
    pub vehicle_class: String,
    pub make_model: String,
    pub plate: String,
    pub color: String,
    pub license_no: String,
    pub status: String,
    pub user_status: String,
    pub is_online: bool,
    pub lat: Option<f64>,
    pub lng: Option<f64>,
    pub rating: f64,
    pub rating_count: i64,
    pub trips: i64,
    pub created_at: String,
    pub approved_at: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct ReportView {
    pub id: i64,
    pub target_type: String,
    pub target_id: i64,
    pub reason: String,
    pub detail: String,
    pub status: String,
    pub created_at: String,
    pub resolved_at: Option<String>,
    pub reporter_id: i64,
    pub reporter_name: String,
    pub reporter_email: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct AuditEntry {
    pub id: i64,
    pub action: String,
    pub detail: String,
    pub created_at: String,
    pub actor_name: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct DriverStats {
    pub earnings_today: i64,
    pub earnings_week: i64,
    pub earnings_total: i64,
    pub trips_total: i64,
    pub active_bookings: i64,
    pub requests_available: i64,
}

#[derive(Clone, Debug, Serialize)]
pub struct Estimate {
    pub distance_km: f64,
    pub duration_min: i64,
    pub fare: i64,
    pub vehicle_class: String,
    pub route: Vec<[f64; 2]>,
}

#[derive(Clone, Debug, Serialize)]
pub struct DriverProfile {
    pub driver: Driver,
    pub stats: DriverStats,
}
