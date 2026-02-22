pub struct AppConfig {
    pub port: u16,
    pub max_upload_bytes: usize,
    pub redis_url: Option<String>,
    pub nats_url: Option<String>,
    pub cors_origin: Option<String>,
    pub database_url: Option<String>,
    pub jwt_secret: Option<String>,
    pub admin_secret: Option<String>,
}

impl AppConfig {
    pub fn from_env() -> Self {
        Self {
            port: std::env::var("PORT")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(8080),
            max_upload_bytes: std::env::var("MAX_UPLOAD_BYTES")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(500 * 1024 * 1024),
            redis_url: std::env::var("REDIS_URL").ok(),
            nats_url: std::env::var("NATS_URL").ok(),
            cors_origin: std::env::var("CORS_ORIGIN").ok(),
            database_url: std::env::var("DATABASE_URL").ok(),
            jwt_secret: std::env::var("JWT_SECRET").ok(),
            admin_secret: std::env::var("ADMIN_SECRET").ok(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_port() {
        std::env::remove_var("PORT");
        let config = AppConfig::from_env();
        assert_eq!(config.port, 8080);
    }

    #[test]
    fn port_from_env() {
        std::env::set_var("PORT", "3000");
        let config = AppConfig::from_env();
        assert_eq!(config.port, 3000);
        std::env::remove_var("PORT");
    }

    #[test]
    fn invalid_port_falls_back_to_default() {
        std::env::set_var("PORT", "not_a_number");
        let config = AppConfig::from_env();
        assert_eq!(config.port, 8080);
        std::env::remove_var("PORT");
    }

    #[test]
    fn max_upload_bytes_from_env() {
        std::env::set_var("MAX_UPLOAD_BYTES", "1048576");
        let config = AppConfig::from_env();
        assert_eq!(config.max_upload_bytes, 1048576);
        std::env::remove_var("MAX_UPLOAD_BYTES");
    }
}
