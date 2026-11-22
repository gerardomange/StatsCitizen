# StatsCitizen — Plan del proyecto (v2.0 Rust + Tauri 2)

## Objetivo

Companion local de alto rendimiento en **Rust + Tauri 2** para Star Citizen que combina **telemetría en vivo vía gRPC** (`sc.game.telemetry.v1.GameTelemetryService`, ~17 Hz) con enriquecimiento de `Game.log` y escaneo histórico honesto de logs locales.

## Estado actual (v2.0)

- **Migración a Rust + Tauri 2 completada**:
  - Backend completo en `src-tauri/src/` (`models`, `sc_detector`, `normalizer`, `activity_parser`, `log_indexer`, `live_watcher`, `tools_manager`, `telemetry/{proto_extractor,game_cfg,grpc_client}`).
  - Frontend React/Vite/Tailwind conectado vía puente Tauri 2 (`src/services/desktopApi.ts`) con selector de canales (`PTU` / `LIVE` / `EPTU` / `TECH-PREVIEW`).
- **Telemetría gRPC en vivo implementada**:
  - Extracción dinámica de `sc/game/telemetry/v1/{api,types}.proto` desde `StarCitizen.exe` con caché por tamaño + `mtime` (`prost-reflect` + `tonic`), compatible con **LIVE 4.10** (solo lectura) y **PTU 5.0** (escudos, hull health, master mode y acciones).
  - Activador seguro en 1 clic de `user.cfg` (preservando configuración existente + backup `.bak` + elevación UAC cuando aplica) y variable de usuario `GRPC_CLIENT_SERVER_ENABLED=true`.
  - Live Telemetry HUD con vitales del piloto, entorno, balance real de aUEC + delta de sesión, instrumentos de vuelo, matriz de energía, 10 annunciators, armas/contramedidas y feed híbrido gRPC + `Game.log`.

## Reglas de producto y datos

1. **Local primero**: Cero autenticación externa, cero subida de datos; gRPC solo en `127.0.0.1`. No leer memoria del proceso ni modificar binarios del juego.
2. **Transparencia de fuentes**: Distinguir métricas medidas en vivo (gRPC) de inferencias/eventos de `Game.log`.
3. **Respeto a la configuración del usuario**: Nunca sobrescribir ajustes personalizados de `user.cfg`; respaldar antes de modificar.
4. **Acciones locales seguras**: `TriggerGameAction` solo bajo activación explícita del usuario y nunca expuesto a red externa.

## Siguientes fases

### Fase A — Verificación en vivo en PTU 5.0 y LIVE 4.10
- Activar telemetría en PTU 5.0, probar el stream gRPC en vuelo real y validar todos los campos del HUD (vitales, aUEC, escudos, hull, annunciators, armas y acciones).
- Verificar reconexión limpia al salir al menú / cambiar de shard / cambiar de canal.

### Fase A.5 — v2.1 HUD Adaptativo + Manufacturer OS (aprobado, pendiente de implementar)
Mockups de referencia: `ui-mockup.html` y `full-app-mockup.html` (scratch de la sesión anterior).

Decisiones confirmadas por el usuario:
- **Branding global mientras está sentado**: `TitleBar`, `Sidebar`, acentos, bordes, emblema y HUD toman la identidad del fabricante de la nave; al levantarse (`ON_FOOT` / `EVA`) vuelve al tema default de StatsCitizen.
- **Boot splash** de ~1.2–1.5 s (logo + checklist `IFCS / SHIELDS / WEAPONS / LIFE SUPPORT`) al pasar a `SEATED` o cambiar `vehicle.state.name`; toggle para desactivarlo.
- **Audio sutil sintético (Web Audio, sin archivos)**: chime de encendido por fabricante, tono de desconexión al bajar, alerta breve para `MISL` / descompresión; botón de mute en `TitleBar`.

Modos automáticos por gRPC: `ON_FOOT` → FPS (mobiGlas), `EVA` → traje (O₂/presión), `SEATED`+`PILOT` → cabina de marca, `SEATED`+`GUNNER` → torreta, vehículo `GROUND/GRAVLEV` → terrestre.

Telemetría nueva a visualizar: `shields.faces[]`, `health`, `doors.*`, `flight.state.is_landed/transformation`, `heading`, `vertical_speed_indicator`, `atmospheric_density`, `boost.critical`, `force_feedback.gunfire/stick_shaker`, `weapons.preset_*` y settings de puntería, `pressure` (descompresión), `intoxication_level`, `ambient_radiation_rate`, `external_temperature`.

Fabricante: `vehicle.state.manufacturer`, con respaldo en prefijo de `class_name` (`RSI_`, `AEGS_`, `DRAK_`, `ANVL_`, `CRUS_`, `ORIG_`, `MISC_`, `MIRA_`, `ARGO_`, `BANU_`, `CNOU_`, `ESPR_`, `TMBL_`, `AOPO_`); fallback “UEE Standard MFD”.

Implementación:
1. ✅ (2026-11-21) `src/themes/manufacturers.ts` (17 marcas + UEE fallback, logos SVG oficiales en `src/assets/manufacturers/`), `ShipThemeContext.tsx`, `ManufacturerLogo.tsx`, `CockpitBootOverlay.tsx`, `services/cockpitAudio.ts`; Tailwind `cyan-*`/`quantum-cyan` ahora salen de variables CSS `--accent*`. Pendiente: probar en el juego.
   Antes: `src/themes/manufacturers.ts` (CSS vars globales + logo SVG + estilo de esquinas), `ManufacturerLogo.tsx`, `CockpitBootOverlay.tsx`, servicio de audio Web Audio.
2. ✅ (2026-11-21) HUD adaptativo en `src/components/hud/`: `detectHudMode` (AUTO + selector manual), `FpsHudView`, `EvaHudView`, `ShipCockpitHudView` (holograma de escudos por cara, cinta de rumbo, VSI, densidad atm., boost crítico, stick shaker, puertas/tren/alas), `TurretHudView`, `GroundVehicleHudView`, franja de piloto, banner MISL/HIT y alertas de supervivencia. `LiveCopilotView.tsx` bajó de ~1090 a ~660 líneas. Arnés de preview con datos simulados en `.hud-preview/`. Pendiente verificar en juego: orden de `shields.faces[]`, unidades de presión/radiación/densidad, nombres de acciones a pie.
   Antes: Dividir `LiveCopilotView.tsx` (~1080 líneas) en `FpsHudView`, `EvaHudView`, `ShipCockpitHudView`, `TurretHudView`, `GroundVehicleHudView`.
3. ✅ (2026-11-21) `AlertFrame` (borde pulsante en toda la ventana: misil, impacto, escudos críticos, peligros críticos; desactivable en el menú de paleta) y modo compacto (`CompactHudView`, ventana 760×560 con botón de fijar encima; recuerda el estado entre sesiones). Permisos de ventana agregados en `src-tauri/capabilities/default.json`.
   Antes: Alertas (descompresión, `MISL`/`HIT` con borde pulsante), selector manual “Preview de marca”, modo compacto para segundo monitor.

### Fase A.6 — Pulido UX (2026-11-21) ✅
- HUD en vivo como cuadrícula de módulos movibles/redimensionables/ocultables (`react-grid-layout@1.5.4`, acomodo guardado por modo en localStorage, botón Personalizar/Restablecer). Las vistas fijas se reemplazaron por `src/components/hud/modules.tsx` + `HudGrid.tsx`.
- Se quitó la info técnica del HUD (encabezado gRPC, puerto, frames, badge de Hz en TitleBar).
- Barra lateral plegable a íconos.
- Idioma: inglés por defecto + español opcional (`src/i18n/`, estilo gettext: la frase en inglés es la llave; `es.ts` tiene ~330 traducciones). Pendiente: los títulos de eventos que genera el backend en Rust siguen en inglés.
- Escaneo de logs: caché en disco por archivo (`%LOCALAPPDATA%\StatsCitizen\log-cache\`) + parseo en paralelo; dependencias optimizadas en perfil dev. Medido con 167 logs/~1 GB del PTU: debug 38 s → 1.0 s con caché; release ~0.5 s. El aviso de escaneo ya no bloquea la ventana.

### Fase A.7 — Stream Overlay para OBS (2026-11-21) ✅ primera pasada
Plan y estado detallado en `plan_overlay.md`. Servidor local (`127.0.0.1:47800`, SSE) dentro de la app + página `overlay.html` para Browser Source de OBS, 12 widgets responsivos, 5 plantillas, editor en la vista "Stream Overlay" (resolución del canvas configurable, layout completo o una fuente por widget). Pendiente: probar en OBS con el juego y validar formatos reales de contratos.

### Fase B — Grabador local de sesiones en vivo (Session Recorder)
- Persistir sesiones grabadas desde gRPC en `%LOCALAPPDATA%\StatsCitizen\sessions\` (tiempo exacto por nave, curva de aUEC, picos de velocidad/G, derribos/muertes) para alimentar las vistas históricas con precisión real.
- Correlacionar deltas de `uec_balance` con eventos de `Game.log` (±3 s) para etiquetar automáticamente cada gasto o pago.

### Fase C — Herramientas y mejoras comunitarias
- Restauración de backups con confirmación y vista previa.
- Opcional: servidor web local en LAN (`axum`) para abrir el HUD de cabina en celular/tablet o segundo monitor sin salir de tu red doméstica.
- Retirar definitivamente los restos de Electron (`src/electron/`, `electron-builder.json`, dependencias `electron*`) una vez validado el build de Tauri en uso diario.
