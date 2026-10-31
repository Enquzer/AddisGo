use std::path::Path;
use std::sync::Arc;

use axum::extract::Request;
use axum::http::{header, HeaderName, HeaderValue, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use serde_json::json;
use tower_http::compression::CompressionLayer;
use tower_http::limit::RequestBodyLimitLayer;
use tower_http::services::{ServeDir, ServeFile};
use tower_http::set_header::SetResponseHeaderLayer;
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

mod auth;
mod db;
mod error;
mod models;
mod routes;
mod seed;
mod state;
mod util;

use state::{AppState, RateLimiter};

const CSP: &str = "default-src 'self'; img-src 'self' data: blob: https://*.tile.openstreetmap.org; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self' data:; connect-src 'self'; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

async fn origin_guard(req: Request, next: Next) -> Response {
    if matches!(
        *req.method(),
        axum::http::Method::POST
            | axum::http::Method::PATCH
            | axum::http::Method::PUT
            | axum::http::Method::DELETE
    ) {
        if let Some(origin) = req.headers().get(header::ORIGIN).and_then(|v| v.to_str().ok()) {
            let host = req
                .headers()
                .get(header::HOST)
                .and_then(|v| v.to_str().ok())
                .unwrap_or_default();
            let allowed_extra = std::env::var("ADDSIGO_ALLOWED_ORIGINS").unwrap_or_default();
            let local_dev = origin.starts_with("http://localhost:") || origin.starts_with("http://127.0.0.1:");
            let allowed = local_dev
                || ["http://", "https://"].iter().any(|scheme| origin == format!("{scheme}{host}"))
                || allowed_extra.split(',').map(str::trim).any(|item| item == origin);
            if !allowed {
                return (
                    StatusCode::FORBIDDEN,
                    Json(json!({ "error": "Cross-origin request blocked.", "code": "forbidden" })),
                )
                    .into_response();
            }
        }
    }
    next.run(req).await
}

async fn shutdown() {
    let _ = tokio::signal::ctrl_c().await;
    tracing::info!("Shutting down.");
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("addisgo=info,tower_http=warn"));
    tracing_subscriber::fmt().with_env_filter(filter).compact().init();

    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    let data_dir = std::env::var("ADDSIGO_DATA_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| manifest.join("data"));
    let db_path = std::env::var("ADDSIGO_DB")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| data_dir.join("addisgo.db"));
    let secret_path = data_dir.join("jwt_secret");

    let pool = db::init(&db_path)?;
    seed::seed(&pool)?;
    let jwt_secret = db::load_jwt_secret(&secret_path)?;
    let state = AppState {
        db: pool,
        jwt_secret: Arc::new(jwt_secret),
        limiter: Arc::new(RateLimiter::default()),
    };

    let api = routes::router(state);
    let web_dist = std::env::var("ADDSIGO_WEB_DIST")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| {
            manifest
                .parent()
                .unwrap_or(Path::new("."))
                .join("web")
        });
    let index = web_dist.join("index.html");
    if !index.exists() {
        tracing::warn!("web frontend not found at {}", index.display());
    }
    let fallback = ServeDir::new(&web_dist).not_found_service(ServeFile::new(&index));

    let app = Router::new()
        .nest("/api", api)
        .route("/healthz", get(|| async { "ok" }))
        .fallback_service(fallback)
        .layer(middleware::from_fn(origin_guard))
        .layer(CompressionLayer::new())
        .layer(SetResponseHeaderLayer::overriding(
            HeaderName::from_static("content-security-policy"),
            HeaderValue::from_static(CSP),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            header::X_CONTENT_TYPE_OPTIONS,
            HeaderValue::from_static("nosniff"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            header::X_FRAME_OPTIONS,
            HeaderValue::from_static("DENY"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            header::REFERRER_POLICY,
            HeaderValue::from_static("strict-origin-when-cross-origin"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            HeaderName::from_static("permissions-policy"),
            HeaderValue::from_static("geolocation=(self), camera=(self), microphone=()"),
        ))
        .layer(RequestBodyLimitLayer::new(2 * 1024 * 1024))
        .layer(TraceLayer::new_for_http());

    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(3003);
    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], port));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!("AddisGo listening on http://localhost:{port} (LAN: http://<your-ip>:{port})");
    axum::serve(listener, app).with_graceful_shutdown(shutdown()).await?;
    Ok(())
}
