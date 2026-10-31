pub mod admin;
pub mod auth;
pub mod bookings;
pub mod drivers;
pub mod misc;
pub mod tours;

use axum::routing::{get, patch, post};
use axum::Router;

use crate::state::AppState;

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(misc::health))
        .route("/public/stats", get(misc::public_stats))
        .route("/auth/register", post(auth::register))
        .route("/auth/login", post(auth::login))
        .route("/auth/logout", post(auth::logout))
        .route("/auth/me", get(auth::me))
        .route("/profile", patch(auth::update_profile))
        .route("/profile/password", post(auth::change_password))
        .route("/drivers/nearby", get(drivers::nearby))
        .route("/driver/me", get(drivers::driver_me))
        .route("/driver/status", patch(drivers::set_status))
        .route("/driver/profile", patch(drivers::update_profile))
        .route("/driver/requests", get(drivers::requests))
        .route("/driver/verify", post(drivers::verify))
        .route("/estimate", post(bookings::estimate))
        .route("/bookings", get(bookings::list).post(bookings::create))
        .route("/bookings/{id}", get(bookings::detail))
        .route("/bookings/{id}/accept", post(bookings::accept))
        .route("/bookings/{id}/status", patch(bookings::update_status))
        .route("/bookings/{id}/cancel", post(bookings::cancel))
        .route("/bookings/{id}/rate", post(bookings::rate))
        .route("/bookings/{id}/qr", get(bookings::qr))
        .route(
            "/bookings/{id}/messages",
            get(bookings::messages_get).post(bookings::messages_post),
        )
        .route("/tours", get(tours::list).post(tours::create))
        .route("/tours/{id}", get(tours::detail))
        .route("/tours/{id}/join", post(tours::join))
        .route("/tours/{id}/leave", post(tours::leave))
        .route("/tours/{id}/cancel", post(tours::cancel))
        .route(
            "/tours/{id}/messages",
            get(tours::messages_get).post(tours::messages_post),
        )
        .route("/notifications", get(misc::notifications))
        .route("/notifications/read", post(misc::mark_notifications_read))
        .route("/reports", post(misc::create_report))
        .route("/admin/overview", get(admin::overview))
        .route("/admin/drivers", get(admin::drivers))
        .route("/admin/drivers/{id}", patch(admin::set_driver_status))
        .route("/admin/users", get(admin::users))
        .route("/admin/users/{id}", patch(admin::set_user))
        .route("/admin/bookings", get(admin::bookings))
        .route("/admin/tours", get(admin::tours))
        .route("/admin/reports", get(admin::reports))
        .route("/admin/reports/{id}", patch(admin::resolve_report))
        .route("/admin/audit", get(admin::audit))
        .with_state(state)
}
