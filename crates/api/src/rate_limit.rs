use axum::{
    extract::{ConnectInfo, State},
    http::{header, HeaderValue, Request, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use redis::AsyncCommands;
use serde::Serialize;
use std::net::SocketAddr;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::auth::{Plan, UserClaims};

#[derive(Clone)]
pub struct RateLimit {
    pub redis: Option<redis::aio::MultiplexedConnection>,
}

#[derive(Clone, Copy)]
pub struct RateLimitTier {
    anonymous: u64,
    free: u64,
    pro: u64,
}

impl RateLimitTier {
    pub const fn new(anonymous: u64, free: u64, pro: u64) -> Self {
        Self { anonymous, free, pro }
    }

    pub(crate) const fn get(&self, plan: Option<Plan>) -> u64 {
        match plan {
            None => self.anonymous,
            Some(Plan::Free) => self.free,
            Some(Plan::Pro) => self.pro,
        }
    }
}

// Requests per minute per endpoint
pub const TIER_TILES: RateLimitTier = RateLimitTier::new(5, 10, 60);
pub const TIER_PROGRESS: RateLimitTier = RateLimitTier::new(30, 60, 300);
pub const TIER_DOWNLOAD: RateLimitTier = RateLimitTier::new(15, 30, 120);
pub const TIER_MUTATIONS: RateLimitTier = RateLimitTier::new(10, 30, 120);

#[derive(Serialize)]
struct RateLimitBody {
    error: String,
    retry_after: u64,
}

#[derive(Clone, Copy)]
struct RateLimitInfo {
    limit: u64,
    remaining: u64,
    reset: u64,
}

impl RateLimit {
    async fn check(
        &self,
        ip: &str,
        user: Option<&UserClaims>,
        endpoint: &str,
        tier: RateLimitTier,
    ) -> Result<RateLimitInfo, Response> {
        const WINDOW_SECS: u64 = 60;

        let plan = user.map(|u| u.plan);
        let max_requests = tier.get(plan);

        let identity = match user {
            Some(u) => format!("user:{}", u.sub),
            None => format!("ip:{}", ip),
        };

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let window = now / WINDOW_SECS;
        let reset = (window + 1) * WINDOW_SECS;

        let unlimited = RateLimitInfo { limit: max_requests, remaining: max_requests, reset };

        let mut conn = match self.redis {
            Some(ref c) => c.clone(),
            None => return Ok(unlimited),
        };

        let key = format!("ratelimit:{identity}:{endpoint}:{window}");

        let count: u64 = match conn.incr(&key, 1u64).await {
            Ok(c) => c,
            Err(_) => return Ok(unlimited), // fail open
        };

        if count == 1 {
            let _: redis::RedisResult<()> = conn.expire(&key, WINDOW_SECS as i64).await;
        }

        if count > max_requests {
            let retry_after = WINDOW_SECS - (now % WINDOW_SECS);
            return Err((
                StatusCode::TOO_MANY_REQUESTS,
                [
                    (header::RETRY_AFTER, retry_after.to_string().parse::<HeaderValue>().unwrap()),
                    ("X-RateLimit-Limit".parse().unwrap(), max_requests.to_string().parse().unwrap()),
                    ("X-RateLimit-Remaining".parse().unwrap(), "0".parse().unwrap()),
                    ("X-RateLimit-Reset".parse().unwrap(), reset.to_string().parse().unwrap()),
                ],
                Json(RateLimitBody { error: "Rate limit exceeded".into(), retry_after }),
            )
                .into_response());
        }

        Ok(RateLimitInfo {
            limit: max_requests,
            remaining: max_requests.saturating_sub(count),
            reset,
        })
    }
}

fn inject_headers(mut response: Response, info: RateLimitInfo) -> Response {
    let headers = response.headers_mut();
    if let Ok(v) = info.limit.to_string().parse() {
        headers.insert("X-RateLimit-Limit", v);
    }
    if let Ok(v) = info.remaining.to_string().parse() {
        headers.insert("X-RateLimit-Remaining", v);
    }
    if let Ok(v) = info.reset.to_string().parse() {
        headers.insert("X-RateLimit-Reset", v);
    }
    response
}

pub(crate) fn extract_client_ip<B>(req: &Request<B>, peer: Option<SocketAddr>) -> String {
    if let Some(cf_ip) = req.headers().get("cf-connecting-ip") {
        if let Ok(ip) = cf_ip.to_str() {
            return ip.trim().to_string();
        }
    }
    if let Some(xff) = req.headers().get("x-forwarded-for") {
        if let Ok(val) = xff.to_str() {
            if let Some(first) = val.split(',').next() {
                return first.trim().to_string();
            }
        }
    }
    peer.map(|a| a.ip().to_string()).unwrap_or_else(|| "unknown".into())
}

/// Generic rate-limit middleware. Use with `from_fn_with_state` and a closure
/// that supplies the endpoint name and tier.
async fn rate_limit_inner(
    rl: &RateLimit,
    endpoint: &str,
    tier: RateLimitTier,
    addr: SocketAddr,
    req: Request<axum::body::Body>,
    next: Next,
) -> Response {
    let ip = extract_client_ip(&req, Some(addr));
    let user = req.extensions().get::<UserClaims>().cloned();
    let info = match rl.check(&ip, user.as_ref(), endpoint, tier).await {
        Ok(info) => info,
        Err(resp) => return resp,
    };
    inject_headers(next.run(req).await, info)
}

pub async fn rate_limit_tiles(
    State(rl): State<RateLimit>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    req: Request<axum::body::Body>,
    next: Next,
) -> Response {
    rate_limit_inner(&rl, "post_tiles", TIER_TILES, addr, req, next).await
}

pub async fn rate_limit_progress(
    State(rl): State<RateLimit>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    req: Request<axum::body::Body>,
    next: Next,
) -> Response {
    rate_limit_inner(&rl, "progress", TIER_PROGRESS, addr, req, next).await
}

pub async fn rate_limit_download(
    State(rl): State<RateLimit>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    req: Request<axum::body::Body>,
    next: Next,
) -> Response {
    rate_limit_inner(&rl, "download", TIER_DOWNLOAD, addr, req, next).await
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---- RateLimitTier::get ----

    #[test]
    fn tier_anonymous() {
        assert_eq!(TIER_TILES.get(None), 5);
        assert_eq!(TIER_PROGRESS.get(None), 30);
        assert_eq!(TIER_DOWNLOAD.get(None), 15);
        assert_eq!(TIER_MUTATIONS.get(None), 10);
    }

    #[test]
    fn tier_free() {
        assert_eq!(TIER_TILES.get(Some(Plan::Free)), 10);
        assert_eq!(TIER_PROGRESS.get(Some(Plan::Free)), 60);
        assert_eq!(TIER_DOWNLOAD.get(Some(Plan::Free)), 30);
        assert_eq!(TIER_MUTATIONS.get(Some(Plan::Free)), 30);
    }

    #[test]
    fn tier_pro() {
        assert_eq!(TIER_TILES.get(Some(Plan::Pro)), 60);
        assert_eq!(TIER_PROGRESS.get(Some(Plan::Pro)), 300);
        assert_eq!(TIER_DOWNLOAD.get(Some(Plan::Pro)), 120);
        assert_eq!(TIER_MUTATIONS.get(Some(Plan::Pro)), 120);
    }

    #[test]
    fn custom_tier() {
        let tier = RateLimitTier::new(1, 5, 100);
        assert_eq!(tier.get(None), 1);
        assert_eq!(tier.get(Some(Plan::Free)), 5);
        assert_eq!(tier.get(Some(Plan::Pro)), 100);
    }

    // ---- extract_client_ip ----

    fn make_request_with_headers(headers: Vec<(&str, &str)>) -> Request<axum::body::Body> {
        let mut builder = Request::builder().uri("/test");
        for (name, value) in headers {
            builder = builder.header(name, value);
        }
        builder.body(axum::body::Body::empty()).unwrap()
    }

    #[test]
    fn ip_from_cf_connecting_ip() {
        let req = make_request_with_headers(vec![
            ("cf-connecting-ip", "1.2.3.4"),
            ("x-forwarded-for", "5.6.7.8"),
        ]);
        let ip = extract_client_ip(&req, Some("9.9.9.9:1234".parse().unwrap()));
        assert_eq!(ip, "1.2.3.4");
    }

    #[test]
    fn ip_from_x_forwarded_for() {
        let req = make_request_with_headers(vec![
            ("x-forwarded-for", "10.0.0.1, 10.0.0.2, 10.0.0.3"),
        ]);
        let ip = extract_client_ip(&req, Some("9.9.9.9:1234".parse().unwrap()));
        assert_eq!(ip, "10.0.0.1");
    }

    #[test]
    fn ip_from_peer_address() {
        let req = make_request_with_headers(vec![]);
        let peer: SocketAddr = "192.168.1.1:5000".parse().unwrap();
        let ip = extract_client_ip(&req, Some(peer));
        assert_eq!(ip, "192.168.1.1");
    }

    #[test]
    fn ip_unknown_when_nothing_available() {
        let req = make_request_with_headers(vec![]);
        let ip = extract_client_ip(&req, None);
        assert_eq!(ip, "unknown");
    }

    // ---- RateLimit without Redis (fail open) ----

    #[tokio::test]
    async fn no_redis_allows_all() {
        let rl = RateLimit { redis: None };
        let user = UserClaims {
            sub: "user1".into(),
            plan: Plan::Free,
            iat: None,
            exp: None,
        };
        let result = rl.check("1.2.3.4", Some(&user), "test", TIER_TILES).await;
        let info = result.expect("should allow without redis");
        assert_eq!(info.limit, 10); // free tier
        assert_eq!(info.remaining, 10);
    }
}

pub async fn rate_limit_mutations(
    State(rl): State<RateLimit>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    req: Request<axum::body::Body>,
    next: Next,
) -> Response {
    rate_limit_inner(&rl, "mutations", TIER_MUTATIONS, addr, req, next).await
}
