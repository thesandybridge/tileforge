use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{self, Command};
use std::thread;
use std::time::Duration;

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    match args.first().map(|s| s.as_str()) {
        Some("dev") => dev(),
        Some(cmd) => {
            eprintln!("Unknown xtask command: {cmd}");
            process::exit(1);
        }
        None => {
            eprintln!("Usage: cargo xtask <command>\n\nCommands:\n  dev   Start all services in mprocs TUI");
            process::exit(1);
        }
    }
}

fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("xtask must live one level below workspace root")
        .to_path_buf()
}

fn dev() {
    let root = workspace_root();

    // ── Check env files ──────────────────────────────────────────
    check_file(&root.join(".env"), "Missing .env — see README for required variables");
    check_file(
        &root.join("web/.env.local"),
        "Missing web/.env.local — see README for required variables",
    );

    // ── Load .env into process environment ───────────────────────
    load_dotenv(&root.join(".env"));

    // ── Preflight: required tools ────────────────────────────────
    for tool in ["docker", "cargo", "node", "npm", "mprocs"] {
        require_cmd(tool);
    }

    // ── Start infrastructure ─────────────────────────────────────
    log("Starting Docker services (Postgres, Redis, MinIO)...");
    run(&root, "docker", &["compose", "up", "-d"]);

    log("Waiting for Postgres...");
    wait_for(30, || {
        Command::new("docker")
            .args(["compose", "exec", "-T", "postgres", "pg_isready", "-U", "tileforge"])
            .current_dir(&root)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    });
    log("Postgres ready.");

    log("Waiting for Redis...");
    wait_for(30, || {
        Command::new("docker")
            .args(["compose", "exec", "-T", "redis", "redis-cli", "ping"])
            .current_dir(&root)
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).contains("PONG"))
            .unwrap_or(false)
    });
    log("Redis ready.");

    log("Waiting for MinIO...");
    wait_for(30, || {
        Command::new("curl")
            .args(["-sf", "http://localhost:9000/minio/health/live"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    });
    log("MinIO ready.");

    // ── Install web deps if needed ───────────────────────────────
    if !root.join("web/node_modules").exists() {
        log("Installing web dependencies...");
        run(&root.join("web"), "npm", &["install"]);
    }

    // ── Launch mprocs ─────────────────────────────────────────────
    log("Launching mprocs...");
    let status = Command::new("mprocs")
        .arg("--config")
        .arg(root.join("mprocs.yaml"))
        .current_dir(&root)
        .status();

    // ── Tear down infrastructure ─────────────────────────────────
    log("Stopping Docker services...");
    let _ = Command::new("docker")
        .args(["compose", "down"])
        .current_dir(&root)
        .status();
    log("Done.");

    match status {
        Ok(s) if s.success() => {}
        Ok(s) => process::exit(s.code().unwrap_or(1)),
        Err(e) => {
            eprintln!("\x1b[31m[xtask]\x1b[0m Failed to run mprocs: {e}");
            process::exit(1);
        }
    }
}

// ── Helpers ──────────────────────────────────────────────────────

fn log(msg: &str) {
    eprintln!("\x1b[32m[xtask]\x1b[0m {msg}");
}

fn check_file(path: &Path, msg: &str) {
    if !path.exists() {
        eprintln!("\x1b[31m[xtask]\x1b[0m {msg}");
        process::exit(1);
    }
}

fn require_cmd(name: &str) {
    if Command::new("which")
        .arg(name)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
    {
        return;
    }
    eprintln!("\x1b[31m[xtask]\x1b[0m Required command not found: {name}");
    process::exit(1);
}

fn run(dir: &Path, cmd: &str, args: &[&str]) {
    let status = Command::new(cmd)
        .args(args)
        .current_dir(dir)
        .status()
        .unwrap_or_else(|e| {
            eprintln!("\x1b[31m[xtask]\x1b[0m Failed to run {cmd}: {e}");
            process::exit(1);
        });
    if !status.success() {
        eprintln!("\x1b[31m[xtask]\x1b[0m {cmd} exited with {status}");
        process::exit(1);
    }
}

fn load_dotenv(path: &Path) {
    let contents = fs::read_to_string(path).unwrap_or_else(|e| {
        eprintln!("\x1b[31m[xtask]\x1b[0m Failed to read {}: {e}", path.display());
        process::exit(1);
    });
    for line in contents.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((key, value)) = line.split_once('=') {
            let key = key.trim();
            let value = value.trim().trim_matches('"').trim_matches('\'');
            env::set_var(key, value);
        }
    }
}

fn wait_for(timeout_secs: u64, check: impl Fn() -> bool) {
    for _ in 0..timeout_secs {
        if check() {
            return;
        }
        thread::sleep(Duration::from_secs(1));
    }
    eprintln!("\x1b[31m[xtask]\x1b[0m Timed out waiting for service");
    process::exit(1);
}
