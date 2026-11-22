import fs from 'fs';
import path from 'path';
import readline from 'readline';
import {
  ActivityCoverage,
  LiveTelemetryEvent,
  TelemetrySummary,
  ShipUsage,
  PurchaseRecord,
  FatalCollisionRecord,
  QuantumRouteRecord,
  MedicalRecord,
  SessionData,
  SystemSpecs,
} from '../../types/telemetry.js';
import { parseActivityLine } from './activityParser.js';
import {
  normalizeShipName,
  normalizeShopName,
  normalizeItemName,
  normalizeDestination,
} from './nameNormalizer.js';

// Regexes
const TS_RE = /<(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)>/;
const ENV_SESSION_RE = /@env_session:\s*'([^']+)'/;
const SHIP_GRANT_RE = /<(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)>.*granted control token for '([^']+)'\s*\[(\d+)\]/i;
const SHIP_RELEASE_RE = /<(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)>.*releasing control token for '([^']+)'\s*\[(\d+)\]/i;
const QUANTUM_DEST_RE = /<(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)>.*Player has requested fuel calculation to destination\s+([^\s]+)/i;
const SHOP_BUY_REQ_RE = /<(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)>.*SendShopBuyRequest.*shopId\[(\d+)\].*shopName\[(.*?)\].*kioskId\[(\d+)\].*client_price\[(\d+(?:\.\d+)?)\].*itemName\[(.*?)\].*quantity\[(\d+)\]/i;
const SHOP_FLOW_RESP_RE = /<(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)>.*RmShopFlowResponse.*shopId\[(\d+)\].*kioskId\[(\d+)\].*result\[([^\]]+)\]/i;
const FATAL_COLLISION_RE = /<(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)>.*<FatalCollision>\s+Fatal Collision occured for vehicle\s+([^\s\[]+)\s+\[Part:\s*([^,]+).*Zone:\s*([^,]+).*PlayerPilot:\s*(\d+)\]/i;
const COLLISION_VEL_RE = /Relative Vel:\s*x:\s*([-\d.]+),\s*y:\s*([-\d.]+),\s*z:\s*([-\d.]+)/i;
const MEDICAL_BED_RE = /<(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)>.*Medical Bed:\s*([^\."]+)/i;
const SHARD_RE = /<Update Shard Id>\s+New Shard Id:\s+([^\s>.]+)/i;
const CPU_RE = /Host CPU:\s*([^\n\r]+)/i;
const GPU_RE = /Suitable rendering device:\s*([^\n\r]+)/i;
const RAM_RE = /memory installed:\s*([^\n\r]+)/i;
const DISPLAYS_RE = /Displays connected:\s*(\d+)/i;

function parseDate(tsStr: string): Date | null {
  try {
    const d = new Date(tsStr);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

function formatVersion(envSession: string | null): { label: string; build: string; channel: 'LIVE' | 'PTU' | 'EPTU' | 'TECH-PREVIEW' } {
  if (!envSession) return { label: 'Star Citizen Alpha', build: 'Unknown', channel: 'LIVE' };
  const parts = envSession.split('-');
  const channel: 'LIVE' | 'PTU' | 'EPTU' | 'TECH-PREVIEW' =
    parts[0]?.toLowerCase() === 'pub' ? 'LIVE' : 'PTU';
  
  const versionDigits = parts[3] || '';
  const build = parts[4] || '';

  let major = '3';
  let minor = '0';
  let patch = '0';

  if (versionDigits.length >= 2) {
    major = versionDigits[0];
    minor = versionDigits[1];
    patch = versionDigits.slice(2) || '0';
  }

  return {
    label: `Alpha ${major}.${minor}.${patch} ${channel}`,
    build,
    channel,
  };
}

export async function parseSingleLogFile(
  filePath: string
): Promise<{
  session: SessionData | null;
  shipIntervals: Array<{ ship: string; durationMs: number; lastFlown: string; sortieCompleted: boolean }>;
  purchases: PurchaseRecord[];
  collisions: FatalCollisionRecord[];
  quantumRoutes: QuantumRouteRecord[];
  medicalTreatments: MedicalRecord[];
  shardId?: string;
  specs: SystemSpecs;
  flightControlLines: number;
  activityEvents: LiveTelemetryEvent[];
}> {
  const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  let firstTs: Date | null = null;
  let lastTs: Date | null = null;
  let envSession: string | null = null;
  let shardId: string | undefined;
  let cleanQuit = false;
  let flightControlLines = 0;

  const specs: SystemSpecs = {};
  const activeShips: Map<string, Date> = new Map();
  const shipIntervals: Array<{ ship: string; durationMs: number; lastFlown: string; sortieCompleted: boolean }> = [];

  interface PendingPurchase {
    id: string;
    ts: string;
    shopName: string;
    price: number;
    itemName: string;
    quantity: number;
  }
  const pendingPurchases: Map<string, PendingPurchase[]> = new Map();
  const purchaseOccurrences = new Map<string, number>();
  const purchases: PurchaseRecord[] = [];
  const collisions: FatalCollisionRecord[] = [];
  const quantumRoutes: QuantumRouteRecord[] = [];
  const medicalTreatments: MedicalRecord[] = [];
  const activityEvents: LiveTelemetryEvent[] = [];

  for await (const line of rl) {
    // 1. Timestamps
    const tsMatch = line.match(TS_RE);
    let currentTs: Date | null = null;
    if (tsMatch) {
      currentTs = parseDate(tsMatch[1]);
      if (currentTs) {
        if (!firstTs) firstTs = currentTs;
        lastTs = currentTs;
      }
    }

    if (currentTs) activityEvents.push(...parseActivityLine(line, currentTs.toISOString()));

    // 2. Env session
    if (!envSession) {
      const envMatch = line.match(ENV_SESSION_RE);
      if (envMatch) {
        envSession = envMatch[1];
      }
    }

    // 3. Shard ID
    if (!shardId && line.includes('<Update Shard Id>')) {
      const shardMatch = line.match(SHARD_RE);
      if (shardMatch) {
        shardId = shardMatch[1];
      }
    }

    // 4. Clean quit detection
    if (line.includes('Requesting QuitLobby') || line.includes('Engine exit requested')) {
      cleanQuit = true;
    }

    // 5. System Specs
    if (!specs.cpu && line.includes('Host CPU:')) {
      const m = line.match(CPU_RE);
      if (m) specs.cpu = m[1].trim();
    }
    if (!specs.gpu && line.includes('Suitable rendering device:')) {
      const m = line.match(GPU_RE);
      if (m) specs.gpu = m[1].trim();
    }
    if (!specs.ramInstalled && line.includes('memory installed:')) {
      const m = line.match(RAM_RE);
      if (m) specs.ramInstalled = m[1].trim();
    }
    if (!specs.displays && line.includes('Displays connected:')) {
      const m = line.match(DISPLAYS_RE);
      if (m) specs.displays = m[1].trim();
    }

    // 6. Ship Control Tokens & Navigation Activity
    if (line.toLowerCase().includes('control token')) flightControlLines++;
    if (line.includes('CSCItemNavigation') || line.includes('control token for')) {
      const grantMatch = line.match(SHIP_GRANT_RE);
      if (grantMatch) {
        const ts = parseDate(grantMatch[1]);
        const ship = grantMatch[2];
        const shipId = grantMatch[3];
        if (ts) {
          activeShips.set(`${ship}_${shipId}`, ts);
        }
      }

      const releaseMatch = line.match(SHIP_RELEASE_RE);
      if (releaseMatch) {
        const ts = parseDate(releaseMatch[1]);
        const ship = releaseMatch[2];
        const shipId = releaseMatch[3];
        const key = `${ship}_${shipId}`;
        const started = activeShips.get(key) || activeShips.get(ship);
        if (ts) {
          // A release without a matching grant is not enough evidence to invent a flight duration.
          if (!started || ts <= started) continue;
          const durationMs = ts.getTime() - started.getTime();
          shipIntervals.push({
            ship,
            durationMs,
            lastFlown: ts.toISOString(),
            sortieCompleted: true,
          });
          activeShips.delete(key);
          activeShips.delete(ship);
        }
      }
    }

    // 7. Quantum Route & Starmap
    if (line.includes('Player has requested fuel calculation to destination')) {
      const qMatch = line.match(QUANTUM_DEST_RE);
      if (qMatch) {
        const ts = qMatch[1];
        const rawDest = qMatch[2];
        quantumRoutes.push({
          timestamp: ts,
          shipName: 'Active Vessel',
          destination: rawDest,
          cleanDestination: normalizeDestination(rawDest),
        });
      }
    }

    // 8. Purchases
    if (line.includes('SendShopBuyRequest')) {
      const reqMatch = line.match(SHOP_BUY_REQ_RE);
      if (reqMatch) {
        const [, ts, shopId, shopName, kioskId, price, itemName, qty] = reqMatch;
        const key = `${shopId}_${kioskId}`;
        const occurrenceKey = `${ts}|${shopName}|${itemName}`;
        const occurrence = (purchaseOccurrences.get(occurrenceKey) ?? 0) + 1;
        purchaseOccurrences.set(occurrenceKey, occurrence);
        if (!pendingPurchases.has(key)) {
          pendingPurchases.set(key, []);
        }
        pendingPurchases.get(key)!.push({
          id: `${ts}_${shopName}_${itemName}_${occurrence}`,
          ts,
          shopName,
          price: parseFloat(price),
          itemName,
          quantity: parseInt(qty, 10),
        });
      }
    } else if (line.includes('RmShopFlowResponse')) {
      const respMatch = line.match(SHOP_FLOW_RESP_RE);
      if (respMatch) {
        const [, , shopId, kioskId, result] = respMatch;
        const key = `${shopId}_${kioskId}`;
        const pending = pendingPurchases.get(key);
        if (pending && pending.length > 0) {
          const p = pending.shift()!;
          if (pending.length === 0) pendingPurchases.delete(key);
          if (result.toLowerCase().includes('success')) {
            const { cleanName, category } = normalizeItemName(p.itemName);
            purchases.push({
              id: p.id,
              timestamp: p.ts,
              shopName: normalizeShopName(p.shopName),
              itemName: p.itemName,
              cleanItemName: cleanName,
              category,
              price: p.price,
              quantity: p.quantity,
              totalCost: p.price * p.quantity,
            });
          }
        }
      }
    }

    // 9. Black Box / Fatal Collisions
    if (line.includes('<FatalCollision>')) {
      const colMatch = line.match(FATAL_COLLISION_RE);
      if (colMatch) {
        const [, ts, rawVehicle, part, zone, wasPilot] = colMatch;
        const velMatch = line.match(COLLISION_VEL_RE);
        let impactVelocity;
        if (velMatch) {
          const vx = parseFloat(velMatch[1]);
          const vy = parseFloat(velMatch[2]);
          const vz = parseFloat(velMatch[3]);
          impactVelocity = {
            x: vx,
            y: vy,
            z: vz,
            magnitude: Math.sqrt(vx * vx + vy * vy + vz * vz),
          };
        }
        const norm = normalizeShipName(rawVehicle);
        collisions.push({
          timestamp: ts,
          vehicleName: rawVehicle,
          normalizedVehicleName: norm.name,
          zone: normalizeDestination(zone),
          part: part.trim(),
          wasPilot: wasPilot === '1',
          impactVelocity,
        });
      }
    }

    // 10. Medical
    if (line.includes('Medical Bed: The bed has restored your health')) {
      const medMatch = line.match(MEDICAL_BED_RE);
      if (medMatch) {
        medicalTreatments.push({
          timestamp: medMatch[1],
          type: 'Bed Restoration',
          description: medMatch[2].trim(),
        });
      }
    }
  }

  // Finalize active ships if unreleased
  if (lastTs) {
    for (const [key, started] of activeShips.entries()) {
      if (lastTs > started) {
        const durationMs = lastTs.getTime() - started.getTime();
        // Keep the original ship name (which may contain underscores) from its map key.
        const ship = key.replace(/_\d+$/, '');
        shipIntervals.push({ ship, durationMs, lastFlown: lastTs.toISOString(), sortieCompleted: false });
      }
    }
  }

  // Finalize session
  let session: SessionData | null = null;
  if (firstTs && lastTs && lastTs >= firstTs) {
    const durationMs = lastTs.getTime() - firstTs.getTime();
    const versionInfo = formatVersion(envSession);
    const totalSpent = purchases.reduce((acc, p) => acc + p.totalCost, 0);

    session = {
      sessionId: path.basename(filePath),
      filePath,
      startTime: firstTs.toISOString(),
      endTime: lastTs.toISOString(),
      durationMs,
      durationHours: parseFloat((durationMs / 3600000).toFixed(2)),
      versionLabel: versionInfo.label,
      buildNumber: versionInfo.build,
      channel: versionInfo.channel,
      shardId,
      cleanQuit,
      crashed: collisions.length > 0 || !cleanQuit,
      shipsFlown: Array.from(new Set(shipIntervals.map(s => normalizeShipName(s.ship).name))),
      totalSpent,
      purchasesCount: purchases.length,
      collisionsCount: collisions.length,
    };
  }

  return {
    session,
    shipIntervals,
    purchases,
    collisions,
    quantumRoutes,
    medicalTreatments,
    shardId,
    specs,
    flightControlLines,
    activityEvents,
  };
}

export async function indexAllStarCitizenLogs(
  scPath: string,
  onProgress?: (progress: { current: number; total: number; filename: string }) => void
): Promise<TelemetrySummary> {
  const filesToScan: string[] = [];

  const gameLogPath = path.join(scPath, 'Game.log');
  if (fs.existsSync(gameLogPath)) {
    filesToScan.push(gameLogPath);
  }

  const backupsDir = path.join(scPath, 'logbackups');
  if (fs.existsSync(backupsDir)) {
    try {
      const backupFiles = fs.readdirSync(backupsDir)
        .filter(f => f.endsWith('.log'))
        .map(f => path.join(backupsDir, f));
      filesToScan.push(...backupFiles);
    } catch {
      // Ignore directory read error
    }
  }

  const sessions: SessionData[] = [];
  const scanWarnings: string[] = [];
  const sessionKeys = new Set<string>();
  const eventKeys = new Set<string>();
  const shipIntervalKeys = new Set<string>();
  const allPurchases: PurchaseRecord[] = [];
  const allCollisions: FatalCollisionRecord[] = [];
  const allQuantumRoutes: QuantumRouteRecord[] = [];
  const allMedicalTreatments: MedicalRecord[] = [];
  const activityEventMap = new Map<string, LiveTelemetryEvent>();
  const shipMap: Map<string, { durationMs: number; sorties: number; lastFlown: string; manufacturer: string; rawName: string }> = new Map();
  let specs: SystemSpecs = {};
  let flightControlLines = 0;
  const shardIds = new Set<string>();

  for (let i = 0; i < filesToScan.length; i++) {
    const file = filesToScan[i];
    if (onProgress) {
      onProgress({
        current: i + 1,
        total: filesToScan.length,
        filename: path.basename(file),
      });
    }

    try {
      const result = await parseSingleLogFile(file);
      flightControlLines += result.flightControlLines;
      if (result.session) {
        // Some launcher backups can contain the same complete session as Game.log.
        const sessionKey = `${result.session.startTime}|${result.session.endTime}|${result.session.buildNumber}`;
        if (!sessionKeys.has(sessionKey)) {
          sessions.push(result.session);
          sessionKeys.add(sessionKey);
        }
      }
      for (const item of result.purchases) {
        if (!eventKeys.has(`purchase|${item.id}`)) { allPurchases.push(item); eventKeys.add(`purchase|${item.id}`); }
      }
      for (const item of result.collisions) {
        const key = `collision|${item.timestamp}|${item.vehicleName}|${item.zone}|${item.part}`;
        if (!eventKeys.has(key)) { allCollisions.push(item); eventKeys.add(key); }
      }
      for (const item of result.quantumRoutes) {
        const key = `route|${item.timestamp}|${item.destination}`;
        if (!eventKeys.has(key)) { allQuantumRoutes.push(item); eventKeys.add(key); }
      }
      for (const item of result.medicalTreatments) {
        const key = `medical|${item.timestamp}|${item.description}`;
        if (!eventKeys.has(key)) { allMedicalTreatments.push(item); eventKeys.add(key); }
      }
      for (const event of result.activityEvents) {
        if (event.id && !activityEventMap.has(event.id)) activityEventMap.set(event.id, event);
      }

      if (result.shardId) {
        shardIds.add(result.shardId);
      }

      if (!specs.cpu && result.specs.cpu) specs.cpu = result.specs.cpu;
      if (!specs.gpu && result.specs.gpu) specs.gpu = result.specs.gpu;
      if (!specs.ramInstalled && result.specs.ramInstalled) specs.ramInstalled = result.specs.ramInstalled;
      if (!specs.displays && result.specs.displays) specs.displays = result.specs.displays;

      for (const item of result.shipIntervals) {
        const intervalKey = `${normalizeShipName(item.ship).name}|${item.lastFlown}|${item.durationMs}`;
        if (shipIntervalKeys.has(intervalKey)) continue;
        shipIntervalKeys.add(intervalKey);
        const norm = normalizeShipName(item.ship);
        const existing = shipMap.get(norm.name) || {
          durationMs: 0,
          sorties: 0,
          lastFlown: item.lastFlown,
          manufacturer: norm.manufacturer,
          rawName: item.ship,
        };
        existing.durationMs += item.durationMs;
        if (item.sortieCompleted) existing.sorties += 1;
        if (new Date(item.lastFlown) > new Date(existing.lastFlown)) {
          existing.lastFlown = item.lastFlown;
        }
        shipMap.set(norm.name, existing);
      }
    } catch (error) {
      scanWarnings.push(`${path.basename(file)}: ${error instanceof Error ? error.message : 'could not be read'}`);
    }
  }

  // Sort sessions chronologically
  sessions.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
  allPurchases.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  allCollisions.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  allQuantumRoutes.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  // Aggregate Ship Usage
  const ships: ShipUsage[] = Array.from(shipMap.entries()).map(([normName, data]: [string, any]) => {
    return {
      name: data.rawName,
      normalizedName: normName,
      manufacturer: data.manufacturer,
      totalFlightTimeMs: data.durationMs,
      totalFlightHours: parseFloat((data.durationMs / 3600000).toFixed(2)),
      sortiesCount: data.sorties,
      lastFlown: data.lastFlown,
    };
  }).sort((a, b) => b.totalFlightTimeMs - a.totalFlightTimeMs);

  // Union overlapping log spans so duplicate/overlapping backups do not inflate coverage.
  const ranges = sessions.map((s) => [new Date(s.startTime).getTime(), new Date(s.endTime).getTime()] as const)
    .sort((a, b) => a[0] - b[0]);
  let totalPlaytimeMs = 0;
  let rangeStart: number | null = null;
  let rangeEnd: number | null = null;
  for (const [start, end] of ranges) {
    if (rangeStart === null) { rangeStart = start; rangeEnd = end; continue; }
    if (start <= rangeEnd!) rangeEnd = Math.max(rangeEnd!, end);
    else { totalPlaytimeMs += rangeEnd! - rangeStart; rangeStart = start; rangeEnd = end; }
  }
  if (rangeStart !== null && rangeEnd !== null) totalPlaytimeMs += rangeEnd - rangeStart;
  const totalPlaytimeHours = parseFloat((totalPlaytimeMs / 3600000).toFixed(1));
  const totalAuecSpent = allPurchases.reduce((acc, p) => acc + p.totalCost, 0);
  const activityEvents = Array.from(activityEventMap.values())
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  const activityCoverage: ActivityCoverage = {
    contracts: new Set(activityEvents.filter((event) => event.category === 'contract' && event.missionId).map((event) => event.missionId)).size,
    objectives: activityEvents.filter((event) => event.category === 'objective').length,
    zones: activityEvents.filter((event) => event.category === 'zone').length,
    inventory: activityEvents.filter((event) => event.category === 'inventory').length,
    shards: activityEvents.filter((event) => event.type === 'shard').length,
  };

  const longestSessionHours = sessions.length > 0
    ? Math.max(...sessions.map(s => s.durationHours))
    : 0;

  const averageSessionHours = sessions.length > 0
    ? parseFloat((totalPlaytimeMs / 3600000 / sessions.length).toFixed(2))
    : 0;

  // Callsign customization is not implemented; avoid reading launcher credentials for decoration.
  const detectedCallsign = 'Citizen';
  const currentPatch = sessions[0]?.versionLabel || 'Star Citizen Alpha';

  return {
    pilotCallsign: detectedCallsign,
    scInstallPath: scPath,
    totalPlaytimeMs,
    totalPlaytimeHours,
    totalSessions: sessions.length,
    longestSessionHours,
    averageSessionHours,
    firstSessionDate: sessions[sessions.length - 1]?.startTime,
    lastSessionDate: sessions[0]?.startTime,
    currentPatch,
    totalAuecSpent,
    totalPurchasesCount: allPurchases.length,
    ships,
    purchases: allPurchases,
    collisions: allCollisions,
    quantumRoutes: allQuantumRoutes,
    medicalTreatments: allMedicalTreatments,
    loadouts: [],
    sessions,
    systemSpecs: specs,
    shardsCount: shardIds.size,
    scannedFilesCount: filesToScan.length,
    scanWarnings,
    flightControlLines,
    activityEvents,
    activityCoverage,
  };
}
