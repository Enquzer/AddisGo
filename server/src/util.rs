use chrono::{DateTime, Duration, SecondsFormat, Utc};

#[derive(Clone, Copy, Debug)]
pub struct ClassInfo {
    pub key: &'static str,
    pub label: &'static str,
    pub base: f64,
    pub per_km: f64,
    pub per_min: f64,
    pub minimum: f64,
    pub seats: i64,
}

pub const CLASSES: [ClassInfo; 4] = [
    ClassInfo { key: "e2", label: "Electric E2", base: 70.0, per_km: 20.0, per_min: 2.5, minimum: 90.0, seats: 4 },
    ClassInfo { key: "comfort", label: "Comfort", base: 105.0, per_km: 28.0, per_min: 3.0, minimum: 140.0, seats: 4 },
    ClassInfo { key: "van", label: "Tour Van", base: 180.0, per_km: 38.0, per_min: 4.0, minimum: 250.0, seats: 7 },
    ClassInfo { key: "bajaj", label: "Bajaj", base: 40.0, per_km: 14.0, per_min: 1.2, minimum: 60.0, seats: 3 },
];

pub fn class_info(key: &str) -> Option<ClassInfo> {
    CLASSES.iter().copied().find(|c| c.key == key)
}

pub fn haversine_km(a_lat: f64, a_lng: f64, b_lat: f64, b_lng: f64) -> f64 {
    const R: f64 = 6371.0;
    let d_lat = (b_lat - a_lat).to_radians();
    let d_lng = (b_lng - a_lng).to_radians();
    let lat1 = a_lat.to_radians();
    let lat2 = b_lat.to_radians();
    let h = (d_lat / 2.0).sin().powi(2) + lat1.cos() * lat2.cos() * (d_lng / 2.0).sin().powi(2);
    2.0 * R * h.sqrt().asin()
}

/// Addis traffic makes the road distance longer than a straight line.
pub fn road_distance_km(a_lat: f64, a_lng: f64, b_lat: f64, b_lng: f64) -> f64 {
    let straight = haversine_km(a_lat, a_lng, b_lat, b_lng);
    (straight * 1.28).max(0.4)
}

pub fn estimate(key: &str, distance_km: f64) -> Option<(i64, i64)> {
    let info = class_info(key)?;
    let duration = ((distance_km / 24.0) * 60.0 + 3.0).round().max(5.0) as i64;
    let raw = info.base + info.per_km * distance_km + info.per_min * duration as f64;
    let fare = ((raw.max(info.minimum) / 5.0).round() * 5.0) as i64;
    Some((fare, duration))
}

/// A smooth, deterministic approximate route for the map preview.
pub fn route_points(a_lat: f64, a_lng: f64, b_lat: f64, b_lng: f64) -> Vec<[f64; 2]> {
    let dx = b_lng - a_lng;
    let dy = b_lat - a_lat;
    let len = (dx * dx + dy * dy).sqrt();
    if len < 1e-9 {
        return vec![[a_lat, a_lng], [b_lat, b_lng]];
    }
    let bend = 0.09;
    let px = -dy / len * len * bend;
    let py = dx / len * len * bend;
    let mut points = Vec::with_capacity(18);
    for i in 0..=17 {
        let t = i as f64 / 17.0;
        let curve = 4.0 * t * (1.0 - t);
        points.push([a_lat + dy * t + py * curve, a_lng + dx * t + px * curve]);
    }
    points
}

pub fn valid_coords(lat: f64, lng: f64) -> bool {
    lat.is_finite() && lng.is_finite() && (4.0..=15.5).contains(&lat) && (32.0..=48.5).contains(&lng)
}

pub fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}

pub fn parse_scheduled(value: &str, max_days: i64) -> Result<String, String> {
    let dt = DateTime::parse_from_rfc3339(value.trim())
        .map_err(|_| "Please choose a valid date and time.".to_string())?
        .with_timezone(&Utc);
    let now = Utc::now();
    if dt < now + Duration::minutes(2) {
        return Err("Please choose a time in the future.".into());
    }
    if dt > now + Duration::days(max_days) {
        return Err(format!("Please choose a time within the next {max_days} days."));
    }
    Ok(dt.to_rfc3339_opts(SecondsFormat::Secs, true))
}

pub fn split_languages(value: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for part in value.split(',') {
        let part = part.trim();
        if part.is_empty() || part.chars().count() > 30 {
            continue;
        }
        if !out.iter().any(|v| v.eq_ignore_ascii_case(part)) {
            out.push(part.to_string());
        }
        if out.len() >= 6 {
            break;
        }
    }
    if out.is_empty() {
        out.push("English".to_string());
    }
    out
}

pub fn join_languages(langs: &[String]) -> String {
    let cleaned: Vec<String> = langs
        .iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty() && s.chars().count() <= 30)
        .take(6)
        .collect();
    if cleaned.is_empty() {
        "English".to_string()
    } else {
        cleaned.join(", ")
    }
}

pub fn valid_email(email: &str) -> bool {
    let email = email.trim();
    if email.len() > 254 || email.contains(char::is_whitespace) {
        return false;
    }
    let mut parts = email.split('@');
    match (parts.next(), parts.next(), parts.next()) {
        (Some(local), Some(domain), None) => {
            !local.is_empty()
                && local.len() <= 64
                && domain.contains('.')
                && !domain.starts_with('.')
                && !domain.ends_with('.')
        }
        _ => false,
    }
}

pub fn valid_phone(phone: &str) -> bool {
    let digits = phone.chars().filter(|c| c.is_ascii_digit()).count();
    (7..=15).contains(&digits)
        && phone
            .chars()
            .all(|c| c.is_ascii_digit() || matches!(c, '+' | '-' | ' ' | '(' | ')'))
}

pub fn valid_color(color: &str) -> bool {
    color.len() == 7
        && color.starts_with('#')
        && color[1..].chars().all(|c| c.is_ascii_hexdigit())
}

pub fn clamp_text(value: &str, max: usize) -> String {
    value.trim().chars().take(max).collect()
}

pub fn money(value: i64) -> String {
    format!("{value} ETB")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn distance_is_sane() {
        let d = haversine_km(8.9779, 38.7993, 9.0340, 38.7500);
        assert!(d > 5.0 && d < 12.0, "unexpected distance {d}");
    }

    #[test]
    fn fare_is_at_least_minimum() {
        let (fare, _) = estimate("e2", 0.5).unwrap();
        assert!(fare >= 90);
    }

    #[test]
    fn route_keeps_endpoints() {
        let pts = route_points(9.0, 38.7, 9.1, 38.8);
        assert_eq!(pts.first().unwrap()[0], 9.0);
        assert_eq!(pts.last().unwrap()[0], 9.1);
    }

    #[test]
    fn email_validation() {
        assert!(valid_email("a@b.co"));
        assert!(!valid_email("nope"));
        assert!(!valid_email("a @b.co"));
    }
}
