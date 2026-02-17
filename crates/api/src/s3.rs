pub use s3::Bucket;
use s3::{creds::Credentials, Region};

pub fn bucket_from_env() -> Option<Box<Bucket>> {
    let endpoint = std::env::var("S3_ENDPOINT").ok()?;
    let bucket_name = std::env::var("S3_BUCKET").ok()?;
    let access_key = std::env::var("S3_ACCESS_KEY").ok()?;
    let secret_key = std::env::var("S3_SECRET_KEY").ok()?;
    let region = std::env::var("S3_REGION").unwrap_or_else(|_| "us-east-1".into());

    let region = Region::Custom { region, endpoint };
    let creds = Credentials::new(Some(&access_key), Some(&secret_key), None, None, None).ok()?;
    Bucket::new(&bucket_name, region, creds)
        .ok()
        .map(|b| b.with_path_style())
}
