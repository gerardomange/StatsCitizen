//! Local HTTP server for OBS Browser Sources.
//!
//!   GET /overlay/<layout>[/<widget>]  → overlay page (Vite dev server redirect in debug builds)
//!   GET /events?layout=<id>           → Server-Sent Events: hello snapshot, then live messages
//!   GET /api/state.json               → compact read-only state for chat bots
//!   GET …/assets/*                    → bundled JS/CSS/fonts
//!
//! Read-only by design: nothing here can trigger game actions or touch files.

use super::hub::HUB;
use super::store::OverlaySettings;
use axum::{
    body::Body,
    extract::{ConnectInfo, Query, Request, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    middleware::{self, Next},
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Redirect, Response,
    },
    routing::get,
    Router,
};
use futures_util::stream::{self, Stream, StreamExt};
use serde::Deserialize;
use std::convert::Infallible;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::{LazyLock, Mutex};
use std::sync::Arc;
use tauri::AppHandle;
use tokio::sync::{broadcast::error::RecvError, watch};

#[cfg(debug_assertions)]
const VITE_DEV_URL: &str = "http://localhost:5173";

/// Origins allowed to read the SSE stream cross-origin (the desktop app itself + Vite dev).
const ALLOWED_ORIGINS: &[&str] = &[
    "http://tauri.localhost",
    "https://tauri.localhost",
    "tauri://localhost",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
];

/// Looks up a bundled asset: (bytes, mime). Decoupled from AppHandle so the server is testable.
type AssetFn = Arc<dyn Fn(&str) -> Option<(Vec<u8>, String)> + Send + Sync>;

#[derive(Clone)]
struct Ctx {
    assets: AssetFn,
    settings: OverlaySettings,
    port: u16,
    shutdown: watch::Receiver<bool>,
}

struct Running {
    port: u16,
    lan: bool,
    stop: watch::Sender<bool>,
    task: tauri::async_runtime::JoinHandle<()>,
}

static RUNNING: LazyLock<Mutex<Option<Running>>> = LazyLock::new(|| Mutex::new(None));

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerStatus {
    pub running: bool,
    pub port: u16,
    pub lan: bool,
    pub lan_ips: Vec<String>,
}

pub fn status() -> ServerStatus {
    let guard = RUNNING.lock().unwrap();
    ServerStatus {
        running: guard.is_some(),
        port: guard.as_ref().map(|r| r.port).unwrap_or(0),
        lan: guard.as_ref().map(|r| r.lan).unwrap_or(false),
        lan_ips: if guard.as_ref().map(|r| r.lan).unwrap_or(false) { lan_ips() } else { vec![] },
    }
}

/// Best-effort local IPv4 discovery (no extra deps): the source address the OS would use for an outbound route.
fn lan_ips() -> Vec<String> {
    std::net::UdpSocket::bind("0.0.0.0:0")
        .and_then(|s| {
            s.connect("192.0.2.1:9")?; // TEST-NET-1, never actually contacted (UDP connect sends nothing)
            s.local_addr()
        })
        .map(|a| vec![a.ip().to_string()])
        .unwrap_or_default()
}

pub fn stop() {
    if let Some(r) = RUNNING.lock().unwrap().take() {
        let _ = r.stop.send(true);
        r.task.abort();
    }
}

pub async fn start(app: AppHandle, settings: OverlaySettings) -> Result<ServerStatus, String> {
    stop();
    let ip = if settings.allow_lan {
        IpAddr::V4(Ipv4Addr::UNSPECIFIED)
    } else {
        IpAddr::V4(Ipv4Addr::LOCALHOST)
    };
    let base = if settings.port == 0 { super::store::DEFAULT_PORT } else { settings.port };

    // Fall back to the next ports if the preferred one is busy.
    let mut listener = None;
    let mut last_err = String::new();
    for port in base..base.saturating_add(10) {
        match tokio::net::TcpListener::bind(SocketAddr::new(ip, port)).await {
            Ok(l) => {
                listener = Some((l, port));
                break;
            }
            Err(e) => last_err = e.to_string(),
        }
    }
    let (listener, port) =
        listener.ok_or_else(|| format!("Could not open a port near {base}: {last_err}"))?;

    let (stop_tx, stop_rx) = watch::channel(false);
    let assets: AssetFn = Arc::new(move |path: &str| {
        app.asset_resolver().get(path.to_string()).map(|a| (a.bytes().to_vec(), a.mime_type().to_string()))
    });
    let ctx = Ctx { assets, settings: settings.clone(), port, shutdown: stop_rx };
    let router = build_router(ctx);

    let task = tauri::async_runtime::spawn(async move {
        let _ = axum::serve(listener, router.into_make_service_with_connect_info::<SocketAddr>()).await;
    });

    *RUNNING.lock().unwrap() = Some(Running { port, lan: settings.allow_lan, stop: stop_tx, task });
    Ok(status())
}

fn build_router(ctx: Ctx) -> Router {
    Router::new()
        .route("/", get(|| async { Redirect::temporary("/overlay/cockpit-classic") }))
        .route("/overlay/*rest", get(overlay_page))
        .route("/events", get(events))
        .route("/api/state.json", get(api_state))
        .fallback(get(asset))
        .layer(middleware::from_fn_with_state(ctx.clone(), guard))
        .with_state(ctx)
}

// ---------------------------------------------------------------- security

#[derive(Deserialize, Default)]
struct TokenQuery {
    k: Option<String>,
}

fn is_loopback_host(host: &str) -> bool {
    let name = if let Some(rest) = host.strip_prefix('[') {
        rest.split(']').next().unwrap_or("")
    } else {
        host.split(':').next().unwrap_or("")
    };
    matches!(name, "127.0.0.1" | "localhost" | "::1")
}

/// Loopback peers must use a loopback Host header (blocks DNS-rebinding pages from reading the stream).
/// Non-loopback peers only exist in LAN mode and must present the token.
async fn guard(
    State(ctx): State<Ctx>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Query(q): Query<TokenQuery>,
    req: Request,
    next: Next,
) -> Response {
    let host = req
        .headers()
        .get(header::HOST)
        .and_then(|h| h.to_str().ok())
        .unwrap_or("");
    if peer.ip().is_loopback() {
        if !is_loopback_host(host) {
            return (StatusCode::FORBIDDEN, "Forbidden host").into_response();
        }
    } else {
        let token_ok = ctx.settings.allow_lan
            && !ctx.settings.token.is_empty()
            && q.k.as_deref() == Some(ctx.settings.token.as_str());
        // Assets are referenced relatively and don't carry ?k=; they are static and public anyway.
        let is_asset = req.uri().path().contains("/assets/");
        if !token_ok && !is_asset {
            return (StatusCode::UNAUTHORIZED, "Missing or invalid token").into_response();
        }
    }
    next.run(req).await
}

fn with_cors(headers: &HeaderMap, mut res: Response) -> Response {
    if let Some(origin) = headers.get(header::ORIGIN).and_then(|o| o.to_str().ok()) {
        if ALLOWED_ORIGINS.contains(&origin) {
            if let Ok(v) = HeaderValue::from_str(origin) {
                res.headers_mut().insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, v);
                res.headers_mut().insert(header::VARY, HeaderValue::from_static("Origin"));
            }
        }
    }
    res
}

// ---------------------------------------------------------------- routes

#[derive(Deserialize, Default)]
struct EventsQuery {
    layout: Option<String>,
}

async fn events(
    State(ctx): State<Ctx>,
    headers: HeaderMap,
    Query(q): Query<EventsQuery>,
) -> Response {
    let layout = q.layout;
    let hello = HUB.snapshot(layout.as_deref());
    let rx = HUB.subscribe();
    let shutdown = ctx.shutdown.clone();

    let first = stream::once(async move { Ok::<Event, Infallible>(Event::default().data(hello.to_string())) });
    let rest = stream::unfold((rx, shutdown, layout), |(mut rx, mut shutdown, layout)| async move {
        loop {
            tokio::select! {
                msg = rx.recv() => match msg {
                    Ok(m) => return Some((Ok(Event::default().data(&*m)), (rx, shutdown, layout))),
                    // Fell behind (slow client): resync with a fresh snapshot instead of dropping state.
                    Err(RecvError::Lagged(_)) => {
                        let snap = HUB.snapshot(layout.as_deref()).to_string();
                        return Some((Ok(Event::default().data(snap)), (rx, shutdown, layout)));
                    }
                    Err(RecvError::Closed) => return None,
                },
                _ = shutdown.changed() => return None,
            }
        }
    });
    let stream: std::pin::Pin<Box<dyn Stream<Item = Result<Event, Infallible>> + Send>> =
        Box::pin(first.chain(rest));
    with_cors(&headers, Sse::new(stream).keep_alive(KeepAlive::default()).into_response())
}

async fn api_state(headers: HeaderMap) -> Response {
    let mut res = axum::Json(HUB.bot_state()).into_response();
    res.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    with_cors(&headers, res)
}

async fn overlay_page(State(ctx): State<Ctx>, req: Request) -> Response {
    // The page loads "./assets/x.js" relative to /overlay/<layout>/…, which lands on this route too.
    if let Some(i) = req.uri().path().find("/assets/") {
        let path = req.uri().path()[i + 1..].to_string();
        return serve_asset(&ctx.assets, &path);
    }
    #[cfg(debug_assertions)]
    {
        // `npm run dev`: hand off to Vite so the overlay gets hot reload. The page talks back to this server via `api`.
        let path = req.uri().path().to_string();
        let query = req.uri().query().map(|q| format!("&{q}")).unwrap_or_default();
        let target = format!(
            "{VITE_DEV_URL}/overlay.html?path={}&api=http://127.0.0.1:{}{}",
            urlencode(&path),
            ctx.port,
            query
        );
        return Redirect::temporary(&target).into_response();
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = &req;
        serve_asset(&ctx.assets, "overlay.html")
    }
}

async fn asset(State(ctx): State<Ctx>, req: Request) -> Response {
    let path = req.uri().path();
    // Pages live at /overlay/<layout>/<widget>, so relative "./assets/x.js" can arrive under any prefix.
    match path.find("/assets/") {
        Some(i) => serve_asset(&ctx.assets, &path[i + 1..]),
        None => (StatusCode::NOT_FOUND, "Not found").into_response(),
    }
}

fn serve_asset(assets: &AssetFn, path: &str) -> Response {
    if path.contains("..") {
        return (StatusCode::BAD_REQUEST, "Bad path").into_response();
    }
    let Some((bytes, mime)) = assets(path) else {
        return (StatusCode::NOT_FOUND, "Not found").into_response();
    };
    // The resolver falls back to index.html for unknown paths — don't serve that for a missing JS/CSS file.
    if mime.contains("html") && !path.ends_with(".html") {
        return (StatusCode::NOT_FOUND, "Not found").into_response();
    }
    let cache = if path.starts_with("assets/") { "public, max-age=31536000, immutable" } else { "no-cache" };
    Response::builder()
        .header(header::CONTENT_TYPE, mime)
        .header(header::CACHE_CONTROL, cache)
        .body(Body::from(bytes))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

#[cfg(debug_assertions)]
fn urlencode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'/' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::is_loopback_host;

    #[test]
    fn host_check() {
        assert!(is_loopback_host("127.0.0.1:47800"));
        assert!(is_loopback_host("localhost:47800"));
        assert!(is_loopback_host("[::1]:47800"));
        assert!(!is_loopback_host("evil.example:47800"));
        assert!(!is_loopback_host("127.0.0.1.evil.example"));
    }
}

#[cfg(test)]
mod http_tests {
    use super::*;
    use std::time::Duration;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    async fn spawn_server(settings: OverlaySettings) -> u16 {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let (tx, rx) = watch::channel(false);
        std::mem::forget(tx); // keep the shutdown channel open for the test's lifetime
        let assets: AssetFn = Arc::new(|p: &str| match p {
            "assets/app.js" => Some((b"console.log(1)".to_vec(), "text/javascript".into())),
            "overlay.html" => Some((b"<html>overlay</html>".to_vec(), "text/html".into())),
            // Mimic Tauri: unknown paths fall back to index.html.
            _ => Some((b"<html>index</html>".to_vec(), "text/html".into())),
        });
        let ctx = Ctx { assets, settings, port, shutdown: rx };
        tokio::spawn(async move {
            axum::serve(listener, build_router(ctx).into_make_service_with_connect_info::<SocketAddr>())
                .await
                .unwrap();
        });
        port
    }

    /// Raw HTTP/1.1 GET; returns whatever arrives within the timeout (SSE never closes).
    async fn get(port: u16, path: &str, host: &str, origin: Option<&str>) -> String {
        let mut s = tokio::net::TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        let origin = origin.map(|o| format!("Origin: {o}\r\n")).unwrap_or_default();
        let req = format!("GET {path} HTTP/1.1\r\nHost: {host}\r\n{origin}Connection: close\r\n\r\n");
        s.write_all(req.as_bytes()).await.unwrap();
        let mut buf = Vec::new();
        let mut chunk = [0u8; 4096];
        let deadline = tokio::time::Instant::now() + Duration::from_millis(600);
        loop {
            match tokio::time::timeout_at(deadline, s.read(&mut chunk)).await {
                Ok(Ok(0)) | Err(_) | Ok(Err(_)) => break,
                Ok(Ok(n)) => buf.extend_from_slice(&chunk[..n]),
            }
        }
        String::from_utf8_lossy(&buf).to_lowercase()
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn serves_local_clients_and_rejects_foreign_hosts() {
        let port = spawn_server(OverlaySettings::default()).await;
        let host = format!("127.0.0.1:{port}");

        let state = get(port, "/api/state.json", &host, None).await;
        assert!(state.starts_with("http/1.1 200"), "{state}");
        assert!(state.contains("\"uecdelta\""));

        // DNS-rebinding style request: loopback peer, foreign Host header.
        let evil = get(port, "/api/state.json", "evil.example", None).await;
        assert!(evil.starts_with("http/1.1 403"), "{evil}");

        let sse = get(port, "/events?layout=cockpit-classic", &host, Some("http://tauri.localhost")).await;
        assert!(sse.contains("text/event-stream"), "{sse}");
        assert!(sse.contains("\"t\":\"hello\""), "{sse}");
        assert!(sse.contains("access-control-allow-origin: http://tauri.localhost"));

        let foreign = get(port, "/events", &host, Some("https://evil.example")).await;
        assert!(!foreign.contains("access-control-allow-origin"));

        let js = get(port, "/overlay/cockpit-classic/assets/app.js", &host, None).await;
        assert!(js.starts_with("http/1.1 200") && js.contains("console.log(1)"), "{js}");

        // Missing asset must 404 instead of serving the index.html fallback as JS.
        let missing = get(port, "/overlay/x/assets/missing.js", &host, None).await;
        assert!(missing.starts_with("http/1.1 404"), "{missing}");

        let page = get(port, "/overlay/cockpit-classic/profit", &host, None).await;
        #[cfg(debug_assertions)]
        assert!(page.contains("location: http://localhost:5173/overlay.html?path=/overlay/cockpit-classic/profit"), "{page}");
        #[cfg(not(debug_assertions))]
        assert!(page.contains("<html>overlay</html>"), "{page}");
    }
}
