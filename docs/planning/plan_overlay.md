# StatsCitizen — Plan: Stream Overlay para OBS (v2.2)

> Overlay customizable para streamers, consumible en OBS como **Browser Source**, alimentado por la telemetría gRPC en vivo (~17 Hz) + eventos de `Game.log` que StatsCitizen ya procesa.
>
> Mockup visual: [`plan_overlay_mockup.html`](plan_overlay_mockup.html) (ábrelo en el navegador).

---

## 1. Decisión: ¿dentro de la app o app aparte?

**Recomendación: dentro de StatsCitizen** (mismo proceso Tauri), con el overlay servido por un **servidor HTTP/WebSocket local embebido** y construido como una **segunda entrada de Vite** (`overlay.html`). No es una app aparte para el usuario, pero sí un bundle web separado y ligero.

| Criterio | Dentro de la app (recomendado) | App aparte |
|---|---|---|
| Fuente de datos | Reusa el stream gRPC y el watcher de `Game.log` que ya existen (`grpc_client.rs`, `live_watcher.rs`) | Tendría que abrir **otra** conexión gRPC al juego y volver a parsear el log (duplica trabajo, CPU y posibles conflictos) |
| Contratos activos | El tracker vive junto al parser de actividad, con el mismo estado | Habría que extraer el parser a un crate compartido |
| Instalación | Nada extra: un toggle "Stream Overlay" y copiar URL | Otro instalador, otra actualización, otro proceso corriendo |
| Edición en vivo | El editor manda cambios por WebSocket y OBS se actualiza sin refrescar | Requiere IPC entre apps |
| Peso en OBS | El overlay es solo HTML/CSS/JS mínimo (sin Tauri ni React-grid) | Igual |
| Riesgo | Si StatsCitizen se cierra, el overlay muestra estado "offline" elegante | Igual, pero con dos puntos de falla |

**Por qué no un overlay sobre el juego (ventana transparente encima):** OBS captura mejor una Browser Source, no interfiere con el juego ni con EAC, y el streamer decide qué ven los viewers sin ensuciar su propia pantalla.

**Cuándo sí conviene separar (futuro):** si quisieras un overlay **para viewers remotos** (extensión de Twitch, página pública), eso sería un servicio aparte. Queda fuera de este plan por la regla "Local primero".

---

## 2. Arquitectura

```
 StarCitizen.exe ──gRPC 127.0.0.1──►  grpc_client.rs ─┐
 Game.log ──────────tail──────────►  live_watcher.rs ─┤
                                                      ▼
                                         overlay_hub.rs  (nuevo)
                                         · estado agregado (OverlayState)
                                         · ContractTracker
                                         · detector de "momentos"
                                         · throttle 17 Hz → 10 Hz, diffs
                                                      │ broadcast (tokio)
                       ┌──────────────────────────────┼─────────────────────────┐
                       ▼                              ▼                         ▼
              app.emit (UI actual)       overlay_server.rs (axum)        editor (UI app)
                                         127.0.0.1:47800                  guarda layouts
                                         · GET /overlay/:layout           en disco y avisa
                                         · GET /assets/*                  por SSE
                                         · SSE /events?layout=…
                                                      │
                                                      ▼
                                      OBS Browser Source (CEF, fondo transparente)
```

### Piezas nuevas

**Backend (Rust)**
- `src-tauri/src/overlay/mod.rs`
- `overlay/hub.rs` — `OverlayHub`: recibe frames y eventos (los mismos que hoy se emiten como `live-telemetry-frame` / `live-telemetry-event`), mantiene un `OverlayState` reducido y publica por `tokio::sync::broadcast`.
- `overlay/contracts.rs` — `ContractTracker`: hoy los eventos `mission_accepted` / `objective_update` / `mission_completed` / `mission_abandoned` son sueltos. Este módulo los convierte en **estado**: lista de contratos activos con nombre, hora de aceptación, objetivos (con estado) y recompensa estimada (correlacionando el `reward`/delta de aUEC ±5 s tras `mission_completed`).
- `overlay/moments.rs` — detecta "momentos" para animaciones: pago grande, muerte, derribado, misil, escudos rotos, salto cuántico, nave nueva, récord de velocidad/G, meta alcanzada.
- `overlay/server.rs` — `axum` + `tower-http` (`ServeDir` con los assets embebidos vía `include_dir!` o `rust-embed`) + WebSocket. **Bind solo a `127.0.0.1`** por defecto.
- `overlay/layouts.rs` — CRUD de layouts en `%LOCALAPPDATA%\StatsCitizen\overlays\*.json`.
- Comandos Tauri: `overlay_start`, `overlay_stop`, `overlay_status`, `overlay_list_layouts`, `overlay_save_layout`, `overlay_delete_layout`, `overlay_test_moment` (dispara un evento de prueba para ajustar en OBS sin jugar).

**Frontend**
- `overlay.html` + `src/overlay/main.ts` — **segunda entrada de Vite** (`build.rollupOptions.input`). Bundle aparte, sin Tauri API, sin react-grid-layout. Preact o React ligero + CSS puro; objetivo < 150 KB gz.
- `src/overlay/widgets/*` — un componente por widget (ver §3).
- `src/overlay/themes/*` — temas visuales; reusa `src/themes/manufacturers.ts` para el tema "Fabricante".
- `src/components/views/StreamOverlayView.tsx` — **nueva vista en la app** (editor, ver §5).
- i18n: los textos del overlay usan el mismo sistema `src/i18n/` (inglés por defecto, español opcional, por layout: el streamer elige el idioma de **sus viewers**).

### Protocolo (SSE)

```jsonc
// servidor → overlay
{ "t": "hello",   "layout": { ... }, "state": { ... }, "version": 1 }
{ "t": "state",   "patch": { "vitals.health": 0.62, "session.uecDelta": 184500 } }   // diffs a ≤10 Hz
{ "t": "moment",  "kind": "payout", "amount": 45000, "label": "Bounty: Vlk Hunt" }
{ "t": "layout",  "layout": { ... } }   // el streamer editó → hot reload sin refrescar OBS
{ "t": "offline", "reason": "game_closed" }
```

- Throttle: vitales/ship a 10 Hz, el resto solo al cambiar. Interpolación en el cliente (`requestAnimationFrame`) para que los números se vean fluidos.
- Reconexión automática con backoff; si no hay datos, el overlay se desvanece a un estado "Standby" (logo + "Pilot offline") en vez de mostrar ceros.

---

## 3. Widgets (catálogo)

Cada widget es configurable: posición, tamaño, escala, opacidad, tema, idioma, campos visibles y "solo mostrar cuando…" (p. ej. *solo sentado*, *solo en combate*, *solo si hay contrato*).

| # | Widget | Datos | Lo que lo hace "padre" en stream |
|---|---|---|---|
| 1 | **Contratos activos** | `ContractTracker` (Game.log) | Tarjeta con nombre, cronómetro desde que se aceptó, checklist de objetivos que se van tachando con animación, recompensa. Al completar: sello "CONTRACT COMPLETE" + monto volando hacia el widget de profit. |
| 2 | **Profit de sesión** | `uecDelta`, `uecStart`, historial de balance | Número grande que **cuenta** (odómetro), sparkline de la curva de aUEC, **aUEC/hora**, color verde/rojo. Opción "ocultar balance total, mostrar solo delta". |
| 3 | **Meta del stream** | delta vs meta configurada | Barra de progreso "Meta: 1,000,000 aUEC" con hitos; confeti al llegar. Ideal para "no termino stream hasta…". |
| 4 | **Vitales** | health, O₂, temp, BPM, hambre/sed | Barras finas estilo mobiGlas; **BPM con latido animado** al ritmo real (en combate sube y los viewers lo notan). Parpadeo rojo con vida baja. |
| 5 | **Nave** | nombre, fabricante, hull, shields.faces[], combustibles, master mode | Logo del fabricante + holograma de escudos por cara que se "rompe" al recibir daño; hull %, H₂/QT. Tema automático por fabricante. |
| 6 | **Vuelo** | speed, altitude, G, heading | Velocímetro compacto; "récord de sesión" cuando superas tu max speed/G. |
| 7 | **Alertas / Momentos** (toasts) | `moments.rs` | Banners centrales grandes: `MISSILE LOCK`, `SHIELDS DOWN`, `K.I.A. #3`, `+45,000 aUEC`, `QUANTUM JUMP → Hurston`. Con sonido opcional (Web Audio sintético, ya existe `cockpitAudio.ts`). |
| 8 | **Contador de muertes** | deaths, downed | "Deaths: 3 · Downed: 5". Clásico de stream; humor garantizado. |
| 9 | **Barra inferior / ticker** | sesión, nave, zona, eventos | Lower-third con tiempo de sesión, nave actual, zona (Armistice / Monitored), y un crawler de los últimos eventos. |
| 10 | **Feed de eventos** | eventos híbridos | Lista vertical de los últimos 5 eventos con íconos (compra, pago, QT, muerte). |
| 11 | **Ubicación** | zona/jurisdicción, destino QT | Con **retraso configurable** (0–10 min) o desactivado, para evitar *stream sniping*. |
| 12 | **Debrief de fin de sesión** | resumen de la sesión | Escena completa para el final: profit total, contratos completados, muertes, tiempo por nave, top momento. Se usa como escena de OBS "Ending". |
| 13 | **Combat mode** (modificador global) | annunciators MISL/HIT, shields | Todo el overlay vira a rojo con borde pulsante mientras dura el combate, y regresa solo. |

---

## 4. Plantillas incluidas (presets)

1. **Cockpit Classic** — contratos (arriba izq.), profit + meta (arriba der.), nave + vitales (abajo izq.), toasts al centro, ticker abajo.
2. **Minimal** — solo profit pill + contrato activo + toasts. Para no tapar el juego.
3. **Bounty Hunter** — contador de muertes/derribos, escudos grandes, combat mode agresivo, feed de combate.
4. **Trader / Hauler** — profit/hora, sparkline grande, meta, contratos de carga con cronómetro.
5. **Ending Screen** — debrief a pantalla completa (escena aparte).

Cada plantilla es un JSON; el streamer puede duplicarla y editarla.

---

## 5. Editor en la app — vista "Stream Overlay"

- Lienzo 16:9 (1920×1080 escalado) con **screenshot de fondo opcional** del juego para acomodar sobre algo real.
- Arrastrar/redimensionar widgets (reusar `react-grid-layout` en modo libre o un `react-rnd`), con *snapping* a márgenes seguros de stream.
- Panel derecho: propiedades del widget seleccionado (campos, tema, escala, condiciones de visibilidad).
- **Datos de prueba**: botón "Simular sesión" (reusar el arnés de `.hud-preview/` con datos simulados) y botones para disparar cada momento → el streamer ve en OBS cómo se ve sin estar jugando.
- **Copiar URL para OBS**: `http://127.0.0.1:47800/overlay/cockpit-classic` + instrucciones (ancho 1920, alto 1080, "Shutdown source when not visible" desactivado).
- Varios layouts simultáneos: cada widget puede ser **su propia URL** (`/overlay/cockpit-classic?widget=contracts`) para quien prefiera acomodarlos como fuentes separadas en OBS.
- Exportar/importar layout (`.json`) para compartir con la comunidad.

---

## 5.1 Resolución del canvas y modos de uso en OBS

Hay **dos formas** de usar el overlay y el editor soporta ambas:

**A) Layout completo (una sola Browser Source).**
- Cada layout tiene una **resolución de canvas** configurable con presets: `1920×1080` (default), `2560×1440`, `3840×2160`, `1280×720`, **vertical `1080×1920`** (TikTok/Shorts) y **personalizada** (W×H libre).
- El streamer pone la Browser Source de OBS con **ese mismo ancho y alto** (el editor lo muestra junto a la URL: *"Set the Browser Source to 2560 × 1440"*).
- Las posiciones de los widgets se guardan como **fracciones del canvas** (0–1), no en píxeles. Si cambias de 1080p a 1440p todo queda en su lugar sin reacomodar. Si cambias de proporción (16:9 → vertical) el editor avisa que conviene reacomodar.
- Si la fuente de OBS no coincide exactamente con el canvas, la página **escala el canvas completo para que quepa** (letterbox transparente) en vez de cortarse.

**B) Un widget por Browser Source (responsivo).**
- Cada widget tiene su propia URL: `/overlay/<layout>/<widgetId>`. La página llena el 100 % de la fuente.
- Los widgets son **responsivos a su caja**: miden su tamaño real (`ResizeObserver`) y
  - escalan la tipografía/espaciado proporcionalmente (todo en `em` sobre un tamaño base calculado),
  - cambian de **variante según la proporción**: *strip* (barra horizontal, p. ej. 900×80), *card* (tarjeta) o *tall* (columna vertical).
- Así el streamer redimensiona la fuente en OBS como quiera y el widget se reacomoda solo.
- El mismo componente se usa en el modo A (la caja del widget dentro del canvas) y en el editor, así que lo que ves en el editor es lo que sale en OBS.

## 5.2 Decisiones técnicas tomadas al implementar

- **SSE (Server-Sent Events) en lugar de WebSocket**: el tráfico es solo servidor → overlay (las ediciones viajan por comandos de Tauri). `EventSource` se reconecta solo, funciona en el CEF de OBS y no requiere dependencias extra (`axum` ya está en el árbol por `tonic`).
- **Frames completos en vez de diffs**: el backend ya emite frames a ~8 Hz; en `127.0.0.1` el costo es despreciable y el cliente reutiliza los mismos tipos (`LiveTelemetryFrame`) y helpers del HUD.
- **Assets del overlay**: en release se sirven desde los assets que Tauri ya embebe en el binario (`asset_resolver`); en `npm run dev` el servidor redirige al servidor de Vite para tener hot reload. Fuentes empaquetadas localmente (`@fontsource`), sin Google Fonts.
- **Seguridad del servidor local**: validación del header `Host` (anti DNS-rebinding), CORS solo para la propia app, y token obligatorio si se habilita LAN.

---

## 6. Privacidad y seguridad (alineado con las reglas del producto)

- **Solo `127.0.0.1`** por defecto. Opción explícita "Permitir LAN" (para setups de 2 PCs: juego en una, OBS en otra) que exige **token** en la URL (`?k=…`) y muestra advertencia.
- **Nunca** se exponen por el servidor: `TriggerGameAction`, rutas del sistema, `user.cfg`, logs crudos. El servidor es **solo lectura** y solo del `OverlayState` reducido.
- Balance total de aUEC **oculto por defecto** (solo delta). Ubicación con retraso / off por defecto.
- Sin dependencias externas en el overlay (sin CDNs, sin fuentes remotas): todo embebido en el binario.
- El servidor se apaga si el usuario desactiva el overlay; se puede marcar "iniciar con la app".

---

## 7. Fases de implementación

### Estado (2026-11-21)

Implementado en una primera pasada: fases O.1–O.5 y el endpoint de O.6. **Falta probarlo en OBS con el juego real.**

Archivos: `src-tauri/src/overlay/{mod,hub,contracts,server,store}.rs`, `src/overlay/*` (bundle de OBS + widgets compartidos), `src/components/views/StreamOverlayView.tsx` (editor), `overlay.html`, arnés visual en `.overlay-preview/`.

### Fase O.1 — Fundaciones (backend) ✅
- [x] `overlay/hub.rs`: `publish_frame` / `publish_event` reemplazan los `app.emit(...)` de `grpc_client.rs` y `live_watcher.rs`; la UI actual no cambia.
- [x] Estado en memoria (último frame, 30 eventos, contratos, curva de aUEC, inicio de sesión). Sin diffs: se reenvían los frames que el backend ya limita a ~8 Hz.
- [x] `overlay/server.rs` con `axum` 0.7 (ya estaba en el árbol por `tonic`) + SSE; bind `127.0.0.1`, puerto 47800 con fallback a los 10 siguientes; validación de `Host`, CORS solo para la app y token en modo LAN.
- [x] Comandos Tauri: `overlay_get_config`, `overlay_set_settings` (enciende/apaga), `overlay_regenerate_token`, `overlay_save_layout`, `overlay_delete_layout`, `overlay_set_demo`, `overlay_test_moment`. Arranque automático si quedó encendido.
- [x] Prueba de integración HTTP real (debug y release): SSE, `/api/state.json`, rechazo de Host ajeno, CORS, assets y 404.

### Fase O.2 — ContractTracker + momentos ✅ (falta validar en juego)
- [x] `overlay/contracts.rs`: aceptado → objetivos → completado/abandonado; conserva los últimos 5 terminados + contador total; recompensa por correlación (pago dentro de 20 s del completado). Pruebas unitarias.
- [x] Al iniciar la sesión en vivo se re-lee el `Game.log` actual para restaurar contratos.
- [x] Momentos derivados en el cliente (`src/overlay/feed.ts`): pago, contrato, K.I.A., derribado, misil, escudos, salto cuántico, nave nueva (solo si es distinta a la última), récord de velocidad (cooldown 90 s), meta alcanzada. Dedup del pago doble (`Game.log` + delta gRPC).
- [x] (2026-11-22) Formatos reales validados con logs de LIVE: los objetivos visibles vienen como notificaciones `New Objective` / `Objective Complete` / `Objective Failed` / `Objective Withdrawn` (con texto y `ObjectiveId`), a veces partidas en dos líneas (`LineJoiner`); los `ObjectiveUpserted` son fases internas y se ignoran. Contratos fallidos (`Contract Failed`, `CompletionType[Fail]`) y nombres sin etiquetas `<EM4>…</EM4>`. La caché del indexador subió a v2.
- [ ] Recompensa: el log no trae el monto; depende del delta de aUEC por gRPC (validar en juego).
- [x] (2026-11-22) Apariencia por widget y por layout: estilo (panel / minimalista / solo texto), fuente (7 incluidas + fuentes de Windows + personalizada), tamaño de texto, grosor, color de acento y de texto.

### Fase O.3 — Bundle del overlay + widgets ✅
- [x] Segunda entrada Vite (`overlay.html`, ~84 KB gzip), cliente SSE con reconexión; transparente si la app está cerrada.
- [x] 12 widgets responsivos (contratos, profit, meta, vitales, nave, vuelo, momentos, muertes, ticker, feed, ubicación, debrief) con variantes card / strip / tall.
- [x] 5 plantillas: Cockpit Classic, Minimal, Bounty Hunter, Trader / Hauler, Ending Screen.
- [ ] Prueba en OBS (CEF): fondo transparente, CPU < 2 %, sin fugas tras 4 h.

### Fase O.4 — Editor en la app ✅
- [x] Vista "Stream Overlay": lienzo con arrastrar/redimensionar (esquinas, snap 0.25 %, flechas, Supr), propiedades por widget generadas de su definición, "Visible cuando…", resolución del canvas (presets + personalizada), idioma de viewers, tema, opacidad, modo combate.
- [x] Guardado automático (300 ms) → OBS se actualiza en vivo por SSE sin refrescar.
- [x] URL de layout completo + URL por widget; datos demo en la vista previa y opción "Datos demo en OBS"; botones para probar momentos.
- [x] Exportar (copia JSON) / importar (pegar JSON).

### Fase O.5 — Extras "wow" ✅
- [x] Meta del stream, debrief, modo combate, contador de muertes, sparkline y aUEC/h.
- [x] Temas: StatsCitizen, Fabricante (auto), mobiGlas, Minimal, Retro MFD.
- [x] Sonidos opcionales por momento (Web Audio sintético; en OBS activar "Control audio via OBS").

### Fase O.6 — Integraciones opcionales (opt-in, todo local)
- [ ] **obs-websocket** (local, `ws://127.0.0.1:4455`): cambiar de escena automáticamente (p. ej. "K.I.A." → escena de muerte 5 s; fin de sesión → escena Ending). Requiere contraseña que el usuario pega; nunca se guarda en texto plano.
- [x] Endpoint `GET /api/state.json` (solo lectura) para Streamer.bot / bots de chat (`!profit`, `!contrato`, `!muertes`).
- [ ] Twitch/YouTube directo queda **fuera** (rompería "local primero"); los bots externos lo cubren consumiendo el endpoint local.

---

## 8. Riesgos y pendientes por validar

- **Formato de contratos en `Game.log`** cambia entre parches; el tracker debe tolerar contratos sin nombre (mostrar "Contract" + id corto) y objetivos sin texto legible.
- **Delta de aUEC ≠ recompensa** cuando hay compras/pagos simultáneos → marcar la recompensa como "estimada" si la correlación es ambigua.
- **LIVE 4.10 vs PTU 5.0**: escudos/hull solo en PTU 5.0 → widgets de nave deben degradar con gracia (ocultar campos que no llegan).
- **OBS CEF** usa Chromium viejo en algunas versiones: evitar CSS muy nuevo (`@container`, `:has()` en partes críticas) o probar con OBS 30+.
- **Puerto ocupado**: fallback automático y mostrar la URL correcta en el editor.
- **Antichat/sniping**: defaults conservadores (ubicación off, balance oculto).

---

## 9. Criterios de "listo"

- El streamer activa el overlay, copia la URL, la pega en OBS y ve datos reales en < 1 minuto.
- Editar un widget en la app se refleja en OBS en < 500 ms sin refrescar la fuente.
- Con el juego cerrado, el overlay muestra "Standby" y se recupera solo al volver.
- CPU del overlay en OBS < 2 %, RAM estable en sesiones de 6 h.
