use clap::{Parser, Subcommand};
use std::fs;
use std::path::PathBuf;
use tileforge_core::{StreamingTiler, TileConfig, TileFormat, Tiler, ZipTileWriter};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use rand::{rngs::OsRng, RngCore};
use std::io::{Read, Write};
use std::net::TcpListener;

#[derive(Parser)]
#[command(name = "tileforge", about = "TileForge CLI — tile images and manage accounts")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Slice an image into XYZ tile sets
    Tiles(TilesArgs),
    /// Set a user's plan (free or pro)
    SetPlan(SetPlanArgs),
    /// Submit and manage jobs using the hosted API
    Cloud(CloudArgs),
    /// Sign the CLI in or manage its saved credentials
    Auth(AuthArgs),
}

#[derive(Parser)]
struct AuthArgs {
    #[command(subcommand)]
    command: AuthCommand,
}

#[derive(Subcommand)]
enum AuthCommand {
    /// Open TileForge in a browser and authorize this CLI
    Login {
        #[arg(long, env = "TILEFORGE_APP_URL", default_value = "https://tileforge.sandybridge.io")]
        app_url: String,
    },
    /// Remove the locally saved credential
    Logout,
    /// Show whether a credential is saved
    Status,
}

#[derive(Parser)]
struct CloudArgs {
    /// TileForge API base URL
    #[arg(long, env = "TILEFORGE_API_URL", default_value = "https://api.tileforge.sandybridge.io")]
    api_url: String,
    /// API key created in TileForge settings
    #[arg(long, env = "TILEFORGE_API_KEY", hide_env_values = true)]
    api_key: Option<String>,
    #[command(subcommand)]
    command: CloudCommand,
}

#[derive(Subcommand)]
enum CloudCommand {
    /// Upload an image and create a durable processing job
    Submit(CloudSubmitArgs),
    /// List recent processing jobs
    Jobs,
    /// Show one job and optionally wait for completion
    Status { job_id: String, #[arg(long)] wait: bool },
    /// Retry a failed job
    Retry { job_id: String },
    /// Cancel a queued or processing job
    Cancel { job_id: String },
    /// Download a completed ZIP or PMTiles archive
    Download {
        job_id: String,
        #[arg(short, long, default_value = "tiles.zip")]
        output: PathBuf,
        #[arg(long)]
        pmtiles: bool,
    },
}

#[derive(Parser)]
struct CloudSubmitArgs {
    input: PathBuf,
    #[arg(long, default_value_t = 256)]
    tile_size: u32,
    #[arg(long)]
    min_zoom: Option<u32>,
    #[arg(long)]
    max_zoom: Option<u32>,
    #[arg(long)]
    projection: Option<String>,
    #[arg(long, value_parser = ["png", "jpeg", "webp"], default_value = "png")]
    format: String,
    #[arg(long, default_value_t = 85, value_parser = clap::value_parser!(u8).range(1..=100))]
    quality: u8,
    /// Stable key used to make repeated submissions safe
    #[arg(long)]
    idempotency_key: Option<String>,
    /// Wait until the job reaches a terminal state
    #[arg(long)]
    wait: bool,
}

#[derive(Debug, Deserialize)]
struct CloudJob {
    id: String,
    status: String,
    file_name: Option<String>,
    progress: i32,
    error: Option<String>,
}

#[derive(Deserialize)]
struct AcceptedJob { job_id: String }

#[derive(Serialize, Deserialize)]
struct SavedCredential { key: String, key_id: String }

#[derive(Parser)]
struct TilesArgs {
    /// Path to the source image
    input: PathBuf,

    /// Output zip file path
    #[arg(short, long, default_value = "tiles.zip")]
    output: PathBuf,

    /// Tile size in pixels
    #[arg(short, long, default_value_t = 256)]
    tile_size: u32,

    /// Minimum zoom level (default: 0)
    #[arg(long)]
    min_zoom: Option<u32>,

    /// Maximum zoom level (auto-calculated if omitted)
    #[arg(long)]
    max_zoom: Option<u32>,

    /// Force streaming mode (row-by-row decode, lower memory)
    #[arg(long)]
    streaming: bool,

    /// Force naive mode (full decode, faster for small images)
    #[arg(long, conflicts_with = "streaming")]
    naive: bool,

    /// Map projection: flat (equirectangular) or mercator (Web Mercator)
    #[arg(long, default_value = "flat")]
    projection: String,
    /// Tile encoding: png, jpeg, or webp
    #[arg(long, value_parser = ["png", "jpeg", "webp"], default_value = "png")]
    format: String,
    /// JPEG quality (1-100); ignored for PNG and lossless WebP
    #[arg(long, default_value_t = 85, value_parser = clap::value_parser!(u8).range(1..=100))]
    quality: u8,
}

#[derive(Parser)]
struct SetPlanArgs {
    /// User ID (UUID), GitHub username, or email
    user: String,

    /// Plan to set
    #[arg(value_parser = ["free", "pro"])]
    plan: String,

    /// Database URL (defaults to $DATABASE_URL)
    #[arg(long, env = "DATABASE_URL")]
    database_url: String,
}

fn progress_callback(p: tileforge_core::TileProgress) {
    eprint!(
        "\rProcessing: z{} ({}/{} tiles, {:.0}%)",
        p.zoom,
        p.tiles_done,
        p.tiles_total,
        (p.tiles_done as f64 / p.tiles_total as f64) * 100.0
    );
}

fn main() {
    let _ = dotenvy::dotenv();
    let cli = Cli::parse();

    match cli.command {
        Command::Tiles(args) => run_tiles(args),
        Command::SetPlan(args) => run_set_plan(args),
        Command::Cloud(args) => run_cloud(args),
        Command::Auth(args) => run_auth(args),
    }
}

fn cloud_request(client: &reqwest::blocking::Client, method: reqwest::Method, url: &str, key: &str) -> reqwest::blocking::RequestBuilder {
    client.request(method, url).bearer_auth(key)
}

fn require_success(response: reqwest::blocking::Response) -> reqwest::blocking::Response {
    if response.status().is_success() { return response; }
    let status = response.status();
    let message = response.text().unwrap_or_default();
    eprintln!("TileForge API returned {status}: {message}");
    std::process::exit(1);
}

fn get_cloud_job(client: &reqwest::blocking::Client, base: &str, key: &str, job_id: &str) -> CloudJob {
    require_success(cloud_request(client, reqwest::Method::GET, &format!("{base}/api/jobs/{job_id}"), key)
        .send().unwrap_or_else(cloud_error))
        .json().unwrap_or_else(cloud_error)
}

fn cloud_error<T>(error: reqwest::Error) -> T {
    eprintln!("Cloud request failed: {error}");
    std::process::exit(1);
}

fn print_cloud_job(job: &CloudJob) {
    println!("{}  {:>10}  {:>3}%  {}{}", job.id, job.status, job.progress,
        job.file_name.as_deref().unwrap_or("(unnamed)"),
        job.error.as_ref().map(|error| format!(" — {error}")).unwrap_or_default());
}

fn wait_for_cloud_job(client: &reqwest::blocking::Client, base: &str, key: &str, job_id: &str) {
    loop {
        let job = get_cloud_job(client, base, key, job_id);
        eprint!("\r{}: {}%   ", job.status, job.progress);
        if matches!(job.status.as_str(), "complete" | "failed" | "cancelled") {
            eprintln!();
            print_cloud_job(&job);
            if job.status != "complete" { std::process::exit(1); }
            return;
        }
        std::thread::sleep(Duration::from_secs(2));
    }
}

fn run_cloud(args: CloudArgs) {
    let api_key = args.api_key.or_else(read_saved_api_key).unwrap_or_else(|| {
        eprintln!("Not signed in. Run `tileforge auth login` or set TILEFORGE_API_KEY.");
        std::process::exit(1);
    });
    let base = args.api_url.trim_end_matches('/');
    let client = reqwest::blocking::Client::builder().timeout(Duration::from_secs(120)).build()
        .unwrap_or_else(cloud_error);
    match args.command {
        CloudCommand::Submit(submit) => {
            let bytes = fs::read(&submit.input).unwrap_or_else(|error| {
                eprintln!("Failed to read {}: {error}", submit.input.display());
                std::process::exit(1);
            });
            let mut url = reqwest::Url::parse(&format!("{base}/api/tiles")).unwrap_or_else(|error| {
                eprintln!("Invalid API URL: {error}"); std::process::exit(1);
            });
            {
                let mut query = url.query_pairs_mut();
                query.append_pair("tile_size", &submit.tile_size.to_string());
                query.append_pair("file_name", submit.input.file_name().and_then(|v| v.to_str()).unwrap_or("upload"));
                if let Some(value) = submit.min_zoom { query.append_pair("min_zoom", &value.to_string()); }
                if let Some(value) = submit.max_zoom { query.append_pair("max_zoom", &value.to_string()); }
                if let Some(value) = submit.projection.as_deref() { query.append_pair("projection", value); }
                query.append_pair("format", &submit.format);
                query.append_pair("quality", &submit.quality.to_string());
            }
            let mut request = cloud_request(&client, reqwest::Method::POST, url.as_str(), &api_key)
                .header(reqwest::header::CONTENT_TYPE, "application/octet-stream").body(bytes);
            if let Some(value) = submit.idempotency_key { request = request.header("Idempotency-Key", value); }
            let accepted: AcceptedJob = require_success(request.send().unwrap_or_else(cloud_error))
                .json().unwrap_or_else(cloud_error);
            println!("Job queued: {}", accepted.job_id);
            if submit.wait { wait_for_cloud_job(&client, base, &api_key, &accepted.job_id); }
        }
        CloudCommand::Jobs => {
            let jobs: Vec<CloudJob> = require_success(cloud_request(&client, reqwest::Method::GET,
                &format!("{base}/api/jobs?per_page=100"), &api_key).send().unwrap_or_else(cloud_error))
                .json().unwrap_or_else(cloud_error);
            for job in &jobs { print_cloud_job(job); }
        }
        CloudCommand::Status { job_id, wait } => {
            if wait { wait_for_cloud_job(&client, base, &api_key, &job_id); }
            else { print_cloud_job(&get_cloud_job(&client, base, &api_key, &job_id)); }
        }
        CloudCommand::Retry { job_id } => {
            let job: CloudJob = require_success(cloud_request(&client, reqwest::Method::POST,
                &format!("{base}/api/jobs/{job_id}/retry"), &api_key).send().unwrap_or_else(cloud_error))
                .json().unwrap_or_else(cloud_error);
            print_cloud_job(&job);
        }
        CloudCommand::Cancel { job_id } => {
            let job: CloudJob = require_success(cloud_request(&client, reqwest::Method::POST,
                &format!("{base}/api/jobs/{job_id}/cancel"), &api_key).send().unwrap_or_else(cloud_error))
                .json().unwrap_or_else(cloud_error);
            print_cloud_job(&job);
        }
        CloudCommand::Download { job_id, output, pmtiles } => {
            let suffix = if pmtiles { "/pmtiles" } else { "" };
            let bytes = require_success(cloud_request(&client, reqwest::Method::GET,
                &format!("{base}/api/tiles/{job_id}/download{suffix}"), &api_key).send().unwrap_or_else(cloud_error))
                .bytes().unwrap_or_else(cloud_error);
            fs::write(&output, bytes).unwrap_or_else(|error| { eprintln!("Failed to write {}: {error}", output.display()); std::process::exit(1); });
            println!("Downloaded {}", output.display());
        }
    }
}

fn credential_path() -> PathBuf {
    let base = std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|path| PathBuf::from(path).join(".config")))
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("tileforge").join("credentials")
}

fn read_saved_api_key() -> Option<String> {
    let value = fs::read_to_string(credential_path()).ok()?;
    serde_json::from_str::<SavedCredential>(&value).map(|credential| credential.key).ok()
}

fn read_saved_credential() -> Option<SavedCredential> {
    serde_json::from_str(&fs::read_to_string(credential_path()).ok()?).ok()
}

fn save_api_key(key: &str, key_id: &str) -> std::io::Result<()> {
    let path = credential_path();
    if let Some(parent) = path.parent() { fs::create_dir_all(parent)?; }
    fs::write(&path, serde_json::to_vec(&SavedCredential { key: key.into(), key_id: key_id.into() }).unwrap())?;
    #[cfg(unix)] {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

fn open_browser(url: &str) -> std::io::Result<()> {
    #[cfg(target_os = "macos")]
    { std::process::Command::new("open").arg(url).spawn()?; }
    #[cfg(target_os = "linux")]
    { std::process::Command::new("xdg-open").arg(url).spawn()?; }
    #[cfg(target_os = "windows")]
    { std::process::Command::new("cmd").args(["/C", "start", "", url]).spawn()?; }
    Ok(())
}

fn run_auth(args: AuthArgs) {
    match args.command {
        AuthCommand::Logout => {
            if let Some(credential) = read_saved_credential() {
                let api_url = std::env::var("TILEFORGE_API_URL").unwrap_or_else(|_| "https://api.tileforge.sandybridge.io".into());
                let client = reqwest::blocking::Client::new();
                let response = client.delete(format!("{}/api/keys/self", api_url.trim_end_matches('/')))
                    .bearer_auth(&credential.key).send();
                match response {
                    Ok(response) if !response.status().is_success() => eprintln!("Warning: server credential could not be revoked ({})", response.status()),
                    Err(error) => eprintln!("Warning: server credential could not be revoked: {error}"),
                    _ => {}
                }
            }
            match fs::remove_file(credential_path()) {
                Ok(()) => println!("Signed out."),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => println!("Already signed out."),
                Err(error) => { eprintln!("Failed to remove credential: {error}"); std::process::exit(1); }
            }
        }
        AuthCommand::Status => println!("{}", if read_saved_api_key().is_some() { "Signed in." } else { "Not signed in." }),
        AuthCommand::Login { app_url } => {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap_or_else(|error| {
                eprintln!("Could not start local callback: {error}"); std::process::exit(1);
            });
            let port = listener.local_addr().unwrap().port();
            let mut state_bytes = [0u8; 24];
            OsRng.fill_bytes(&mut state_bytes);
            let state = hex::encode(state_bytes);
            let mut url = reqwest::Url::parse(&format!("{}/cli-auth", app_url.trim_end_matches('/'))).unwrap();
            url.query_pairs_mut().append_pair("callback", &format!("http://127.0.0.1:{port}/callback"))
                .append_pair("state", &state)
                .append_pair("device_name", &std::env::var("HOSTNAME").unwrap_or_else(|_| "Unknown device".into()))
                .append_pair("os", std::env::consts::OS)
                .append_pair("arch", std::env::consts::ARCH);
            println!("Opening TileForge to authorize the CLI…\n{}", url);
            if let Err(error) = open_browser(url.as_str()) { eprintln!("Could not open browser: {error}"); }
            listener.set_nonblocking(false).ok();
            let (mut stream, _) = listener.accept().unwrap_or_else(|error| { eprintln!("Authorization failed: {error}"); std::process::exit(1); });
            let mut request = [0u8; 8192];
            let size = stream.read(&mut request).unwrap_or(0);
            let request_text = String::from_utf8_lossy(&request[..size]);
            let body = request_text.split("\r\n\r\n").nth(1).unwrap_or("");
            let callback = reqwest::Url::parse(&format!("http://127.0.0.1/?{body}")).unwrap();
            let params: std::collections::HashMap<_, _> = callback.query_pairs().into_owned().collect();
            let valid = params.get("state") == Some(&state);
            let key = params.get("token").filter(|_| valid);
            let key_id = params.get("key_id").filter(|_| valid);
            let (status, message) = if let (Some(key), Some(key_id)) = (key, key_id) {
                match save_api_key(key, key_id) {
                    Ok(()) => ("200 OK", "TileForge CLI is signed in. You can close this tab."),
                    Err(_) => ("500 Internal Server Error", "The CLI could not save the credential."),
                }
            } else { ("400 Bad Request", "Authorization state was invalid.") };
            let body = format!("<html><body><h1>{message}</h1></body></html>");
            let _ = write!(stream, "HTTP/1.1 {status}\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
            if key.is_some() { println!("Signed in successfully."); } else { eprintln!("Authorization failed."); std::process::exit(1); }
        }
    }
}

fn run_set_plan(args: SetPlanArgs) {
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();

    rt.block_on(async {
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(1)
            .connect(&args.database_url)
            .await
            .unwrap_or_else(|e| {
                eprintln!("Failed to connect to database: {e}");
                std::process::exit(1);
            });

        let result = sqlx::query_scalar::<_, String>(
            "UPDATE users SET plan = $1, updated_at = now() WHERE id::text = $2 OR username = $2 OR email = $2 RETURNING username",
        )
        .bind(&args.plan)
        .bind(&args.user)
        .fetch_optional(&pool)
        .await
        .unwrap_or_else(|e| {
            eprintln!("Database error: {e}");
            std::process::exit(1);
        });

        match result {
            Some(username) => println!("Set {username} to '{}'", args.plan),
            None => {
                eprintln!("No user found matching '{}'", args.user);
                std::process::exit(1);
            }
        }
    });
}

fn run_tiles(args: TilesArgs) {
    let bytes = fs::read(&args.input).unwrap_or_else(|e| {
        eprintln!("Failed to read {}: {e}", args.input.display());
        std::process::exit(1);
    });

    let projection = match args.projection.as_str() {
        "flat" => tileforge_core::Projection::Flat,
        "mercator" => tileforge_core::Projection::Mercator,
        "isometric" => tileforge_core::Projection::Isometric,
        other => {
            eprintln!("Unknown projection '{other}'. Use 'flat', 'mercator', or 'isometric'.");
            std::process::exit(1);
        }
    };

    let config = TileConfig {
        tile_size: args.tile_size,
        min_zoom: args.min_zoom,
        max_zoom: args.max_zoom,
        projection,
        scale: None,
        background: None,
        scale_metadata: None,
        format: match args.format.as_str() { "jpeg" => TileFormat::Jpeg, "webp" => TileFormat::Webp, _ => TileFormat::Png },
        quality: args.quality,
    };

    let file = fs::File::create(&args.output).unwrap_or_else(|e| {
        eprintln!("Failed to create {}: {e}", args.output.display());
        std::process::exit(1);
    });
    let mut zip_writer = ZipTileWriter::with_format(file, config.format);

    let output = if args.streaming {
        let is_png = tileforge_core::streaming::read_png_dimensions(&bytes).is_some();
        let tiler = StreamingTiler::new(config);
        if is_png {
            eprintln!("Mode: streaming (PNG row-by-row)");
            tiler
                .process_png(std::io::BufReader::new(std::io::Cursor::new(&bytes)), &mut zip_writer, progress_callback)
                .unwrap_or_else(|e| {
                    eprintln!("\nFailed to process image: {e}");
                    std::process::exit(1);
                })
        } else {
            eprintln!("Mode: streaming (decode + strip extraction)");
            let img = image::load_from_memory(&bytes).unwrap_or_else(|e| {
                eprintln!("Failed to decode image: {e}");
                std::process::exit(1);
            });
            tiler
                .process_image(&img, &mut zip_writer, progress_callback)
                .unwrap_or_else(|e| {
                    eprintln!("\nFailed to process image: {e}");
                    std::process::exit(1);
                })
        }
    } else if args.naive {
        eprintln!("Mode: naive");
        let tiler = Tiler::new(config);
        tiler
            .process_bytes_naive(&bytes, &mut zip_writer, progress_callback)
            .unwrap_or_else(|e| {
                eprintln!("\nFailed to process image: {e}");
                std::process::exit(1);
            })
    } else {
        let is_streaming = tileforge_core::streaming::should_use_streaming(
            &bytes,
            tileforge_core::STREAMING_THRESHOLD,
        );
        eprintln!("Mode: auto ({})", if is_streaming { "streaming" } else { "naive" });
        let tiler = Tiler::new(config);
        tiler
            .process_bytes(&bytes, &mut zip_writer, progress_callback)
            .unwrap_or_else(|e| {
                eprintln!("\nFailed to process image: {e}");
                std::process::exit(1);
            })
    };

    eprintln!();
    println!(
        "Image: {}x{} | Tile size: {} | Zoom: {}-{} | Tiles: {} → {}",
        output.width,
        output.height,
        args.tile_size,
        output.min_zoom,
        output.max_zoom,
        output.total_tiles,
        args.output.display()
    );
}
