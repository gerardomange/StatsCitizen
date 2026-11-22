export interface ShipUsage {
  name: string;
  normalizedName: string;
  manufacturer: string;
  totalFlightTimeMs: number;
  totalFlightHours: number;
  sortiesCount: number;
  lastFlown?: string;
  shipId?: string;
}

export interface PurchaseRecord {
  id: string;
  timestamp: string;
  shopName: string;
  itemName: string;
  cleanItemName: string;
  category: 'weapons' | 'armor' | 'components' | 'ammo' | 'consumable' | 'ship' | 'other';
  price: number;
  quantity: number;
  totalCost: number;
}

export interface FatalCollisionRecord {
  timestamp: string;
  vehicleName: string;
  normalizedVehicleName: string;
  zone: string;
  part: string;
  wasPilot: boolean;
  impactVelocity?: {
    x: number;
    y: number;
    z: number;
    magnitude: number;
  };
}

export interface QuantumRouteRecord {
  timestamp: string;
  shipName: string;
  destination: string;
  cleanDestination: string;
}

export interface MedicalRecord {
  timestamp: string;
  type: string;
  description: string;
}

export interface SessionData {
  sessionId: string;
  filePath: string;
  startTime: string;
  endTime: string;
  durationMs: number;
  durationHours: number;
  versionLabel: string;
  buildNumber: string;
  channel: 'LIVE' | 'PTU' | 'EPTU' | 'TECH-PREVIEW';
  shardId?: string;
  cleanQuit: boolean;
  crashed: boolean;
  shipsFlown: string[];
  totalSpent: number;
  purchasesCount: number;
  collisionsCount: number;
}

export interface SystemSpecs {
  cpu?: string;
  gpu?: string;
  ramInstalled?: string;
  displays?: string;
  gpuDriver?: string;
}

export interface LoadoutWearTime {
  port: string;
  portLabel: string;
  item: string;
  cleanItem: string;
  durationMs: number;
  durationHours: number;
}

export interface TelemetrySummary {
  pilotCallsign: string;
  scInstallPath: string;
  totalPlaytimeMs: number;
  totalPlaytimeHours: number;
  totalSessions: number;
  longestSessionHours: number;
  averageSessionHours: number;
  firstSessionDate?: string;
  lastSessionDate?: string;
  currentPatch: string;
  totalAuecSpent: number;
  totalPurchasesCount: number;
  ships: ShipUsage[];
  purchases: PurchaseRecord[];
  collisions: FatalCollisionRecord[];
  quantumRoutes: QuantumRouteRecord[];
  medicalTreatments: MedicalRecord[];
  loadouts: LoadoutWearTime[];
  sessions: SessionData[];
  systemSpecs: SystemSpecs;
  shardsCount: number;
  scannedFilesCount: number;
  scanWarnings: string[];
  flightControlLines: number;
  activityEvents: LiveTelemetryEvent[];
  activityCoverage: ActivityCoverage;
}

export interface ActivityCoverage {
  contracts: number;
  objectives: number;
  zones: number;
  inventory: number;
  shards: number;
}

export interface LiveTelemetryEvent {
  id?: string;
  timestamp: string;
  type:
    | 'flight_start'
    | 'flight_end'
    | 'purchase'
    | 'collision'
    | 'quantum'
    | 'medical'
    | 'shard'
    | 'notice'
    | 'mission_accepted'
    | 'mission_completed'
    | 'mission_abandoned'
    | 'mission_failed'
    | 'objective_update'
    | 'zone_transition'
    | 'inventory_move'
    | 'inventory_equip'
    | 'inventory_stored'
    | 'reward';
  title: string;
  details: string;
  objectiveId?: string;
  objectiveState?: string;
  zone?: string;
  missionId?: string;
  missionName?: string;
  amountAuec?: number;
  itemName?: string;
  operation?: string;
  /** Player-facing objective text ("Go to Glaciem Ring"). */
  objectiveText?: string;
  confirmed?: boolean;
  category?:
    | 'contract'
    | 'objective'
    | 'zone'
    | 'inventory'
    | 'flight'
    | 'finance'
    | 'navigation'
    | 'system'
    | 'combat'
    | 'medical';
  severity?: 'info' | 'warning' | 'alert' | 'success';
}

export interface CleanShadersResult {
  success: boolean;
  freedBytes: number;
  freedFormatted: string;
  clearedFilesCount: number;
  error?: string;
}

export interface BackupResult {
  success: boolean;
  backupPath: string;
  filesBackedUp: string[];
  error?: string;
}

export interface PathValidation {
  isValid: boolean;
  hasGameLog: boolean;
  hasLogBackups: boolean;
  backupsCount: number;
}

export interface StarCitizenInstall {
  channel: string;
  path: string;
  exePath: string;
  userCfgPath: string;
  hasGameLog: boolean;
  backupsCount: number;
  isRunning: boolean;
  hasTelemetryProto: boolean;
  supportsActions: boolean;
  usesPortCvar: boolean;
  cfgReady: boolean;
  cfgMissing: string[];
  actionsCfgEnabled: boolean;
  port: number;
}

export interface TelemetrySetupStatus {
  installs: StarCitizenInstall[];
  activeChannel?: string | null;
  envEnabled: boolean;
  needsRestart: boolean;
  grpcConnected: boolean;
  grpcFps: number;
  grpcPort: number;
  grpcError?: string | null;
  logWatcherActive: boolean;
  supportsActions: boolean;
}

export interface EnableTelemetryResult {
  changedChannels: string[];
  elevatedChannels: string[];
  envUpdated: boolean;
  needsRestart: boolean;
  errors: string[];
}

export interface LiveSessionMetrics {
  uecStart?: number | null;
  uecCurrent?: number | null;
  uecDelta: number;
  maxSpeed: number;
  maxG: number;
  deaths: number;
  downedCount: number;
  activeShipName?: string | null;
  activeShipSince?: string | null;
  totalFrames: number;
}

export interface GaugeValue {
  current?: number;
  max?: number;
}

export interface LiveTelemetryFrame {
  connected: boolean;
  fps: number;
  channel: string;
  port: number;
  timestamp: string;
  error?: string | null;
  supportsActions: boolean;
  actor?: {
    vitals?: {
      health?: GaugeValue;
      oxygen?: GaugeValue;
      hunger?: GaugeValue;
      thirst?: GaugeValue;
      body_temperature?: GaugeValue;
      heart_rate?: number;
      gravity?: number;
      pressure?: number;
      intoxication_level?: number;
    };
    state?: {
      locomotion?: string;
      crew_role?: string;
      seat_name?: string;
      uec_balance?: number;
    };
    environment?: {
      external_temperature?: number;
      ambient_radiation_rate?: number;
      breathable_atmosphere?: boolean;
    };
  } | null;
  vehicle?: {
    state?: {
      name?: string;
      class_name?: string;
      manufacturer?: string;
      type?: string;
      lights_enabled?: boolean;
      health?: number;
      shields?: {
        level?: number;
        faces?: number[];
      };
      master_mode?: {
        mode?: string;
        spooled?: boolean;
      };
      doors?: {
        open_state?: string;
        lock_state?: string;
      };
      power?: Record<string, boolean>;
      annunciators?: Record<string, string>;
      flight?: {
        state?: {
          is_landed?: boolean;
          gear?: string;
          vtol?: string;
          transformation?: string;
        };
        settings?: Record<string, unknown>;
        instruments?: {
          speed?: number;
          hydrogen_fuel?: number;
          quantum_fuel?: number;
          g_meter?: GaugeValue;
          boost?: {
            engaged?: boolean;
            output?: number;
            reserves?: number;
            critical?: boolean;
          };
          altitude?: number;
          radar_altitude?: number;
          vertical_speed_indicator?: number;
          atmospheric_density?: number;
          heading?: number;
        };
      };
    };
  } | null;
  weapons?: {
    preset_index?: number;
    preset_name?: string;
    settings?: {
      gimbals_locked?: boolean;
    };
    weapons?: Array<{
      name?: string;
      is_powered?: boolean;
      ready_to_fire?: boolean;
      contained_in_preset?: boolean;
    }>;
    countermeasures?: Array<{
      type?: string;
      amount?: number;
    }>;
  } | null;
  turret?: {
    light_amplification?: boolean;
  } | null;
  forceFeedback?: Record<string, unknown> | null;
  sessionMetrics: LiveSessionMetrics;
}

export interface TriggerableActionInfo {
  actionName: string;
  category: string;
  holdable: boolean;
}

export interface TriggerActionResult {
  status: string;
  message: string;
}

export interface OverlaySettings {
  enabled: boolean;
  port: number;
  allowLan: boolean;
  token: string;
}

export interface OverlayServerStatus {
  running: boolean;
  port: number;
  lan: boolean;
  lanIps: string[];
}

export interface OverlayConfig {
  settings: OverlaySettings;
  /** Stored layouts (validated by the overlay module on the frontend). */
  layouts: unknown[];
  server: OverlayServerStatus;
}
