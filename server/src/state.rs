use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;

#[derive(Clone)]
pub struct AppState {
    pub db: Pool<SqliteConnectionManager>,
    pub jwt_secret: Arc<Vec<u8>>,
    pub limiter: Arc<RateLimiter>,
}

#[derive(Default)]
pub struct RateLimiter {
    inner: Mutex<HashMap<String, Vec<Instant>>>,
}

impl RateLimiter {
    /// Returns true when the action is allowed.
    pub fn allow(&self, key: &str, max: usize, window: Duration) -> bool {
        let Ok(mut map) = self.inner.lock() else {
            return true;
        };
        let now = Instant::now();
        if map.len() > 5_000 {
            map.retain(|_, hits| hits.iter().any(|t| now.duration_since(*t) < window));
        }
        let hits = map.entry(key.to_string()).or_default();
        hits.retain(|t| now.duration_since(*t) < window);
        if hits.len() >= max {
            false
        } else {
            hits.push(now);
            true
        }
    }

    pub fn clear(&self, key: &str) {
        if let Ok(mut map) = self.inner.lock() {
            map.remove(key);
        }
    }
}
