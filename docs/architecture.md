# Architecture

```
 StarCitizen.exe ──gRPC 127.0.0.1──► telemetry/grpc_client.rs ─┐
 Game.log ─────────tail────────────► live_watcher.rs ───────────┤   activity_parser.rs (shared parser)
 logbackups/*.log ──scan + cache───► log_indexer.rs             │
                                                                ▼
                                          overlay::publish_frame / publish_event
                                                 │                     │
                                     Tauri events (desktop UI)   overlay/hub.rs (state + ContractTracker)
                                                                       │ broadcast
                                                                overlay/server.rs (axum, SSE)
                                                                       │
                                                       OBS Browser Source → overlay.html
```

## Backend (`src-tauri/src`)

| Module | Role |
|---|---|
| `sc_detector.rs` | Finds the LIVE, PTU, EPTU and TECH-PREVIEW installs and checks whether the game is running. |
| `telemetry/proto_extractor.rs` | Pulls the `sc.game.telemetry.v1` `.proto` descriptors out of `StarCitizen.exe` at runtime, so the app keeps working across patches. Cached by file size and mtime. |
| `telemetry/grpc_client.rs` | Streams telemetry with `tonic` + `prost-reflect`, computes session metrics and emits frames (about 8 Hz to the UI) and events. |
| `telemetry/game_cfg.rs` | Safe edits to `user.cfg` (preserves your keys, keeps a `.bak`, asks for UAC elevation when the folder needs it) and the `GRPC_CLIENT_SERVER_ENABLED` user env var. |
| `activity_parser.rs` | Turns `Game.log` lines into events: contracts, objectives, zones, inventory, shards. `LineJoiner` re-joins HUD notifications that span two lines. |
| `live_watcher.rs` | Tails `Game.log`, follows purchases and rewards, and feeds the parser. |
| `log_indexer.rs` | Scans the history in parallel with a per-file disk cache (`%LOCALAPPDATA%\StatsCitizen\log-cache`). Bump `LOG_CACHE_VERSION` whenever the parser changes. |
| `overlay/hub.rs` | Overlay state shared by every OBS source: last frame, recent events, contracts, aUEC history. |
| `overlay/contracts.rs` | Contract and objective tracker. HUD notifications (`New Objective: …`) create objectives with their text; `<ObjectiveUpserted>` pushes complete, hide or show the objectives it already knows; internal `phase_` objectives are ignored. |
| `overlay/server.rs` | Read-only HTTP server: `/overlay/*` (the page), `/events` (SSE), `/api/state.json`, `…/assets/*`. Checks the Host header, sends CORS headers only for the app itself, and requires a token in LAN mode. |
| `overlay/store.rs` | Overlay settings and layouts in `%LOCALAPPDATA%\StatsCitizen\overlays\overlay.json`. |

## Frontend (`src`)

- `App.tsx` and `components/views/*`: the desktop app.
- `components/hud/*`: the adaptive Live HUD, a grid of modules.
- `themes/manufacturers.ts`: the Manufacturer OS registry. Ships are matched by manufacturer keyword, then by `class_name` prefix (`ANVL_`, `MRAI_`, …).
- `overlay/*`: the OBS overlay. The **same widget components** are used by `overlay.html` (OBS) and by the editor (`components/views/StreamOverlayView.tsx`).
  - `feed.ts`: SSE client, demo simulator and derived "moments".
  - `widgets.tsx`: every widget, laid out in `em`. `WidgetBox` sets the font size from the box, which is what makes widgets responsive.
  - `OverlayCanvas.tsx`: themes, the merged layout + widget appearance, and canvas scaling.
- `i18n/`: gettext-style translations. The English text is the key; `es.ts` holds Spanish.

## Overlay protocol (SSE `data:` JSON)

| `t` | Payload |
|---|---|
| `hello` | `frame`, `events`, `contracts`, `contractsCompleted`, `history`, `sessionStart`, `demo`, `layout` |
| `frame` | Live telemetry frame |
| `event` | One activity event |
| `contracts` | Full contract list + `completed` count |
| `history` | One `[ms, balance]` point |
| `layout` / `layoutDeleted` | The editor saved or deleted a layout (hot reload) |
| `demo` | Demo mode toggled |
| `test` | Test moment (`payout`, `death`, `boot`, …) |
| `reset` | New live session |
