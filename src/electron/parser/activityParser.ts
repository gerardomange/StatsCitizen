import { LiveTelemetryEvent } from '../../types/telemetry.js';
import { normalizeItemName } from './nameNormalizer.js';

const TIMESTAMP_RE = /<(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)>/;

function fieldValue(line: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = line.match(new RegExp(`\\b${escaped}:?\\s*\\[([^\\]]*)\\]`, 'i'));
  const value = match?.[1]?.trim().replace(/^<|>$/g, '');
  return value || undefined;
}

function notificationText(line: string): string | undefined {
  return line.match(/(?:Added\s+)?notification\s+["']([^"']+)["']/i)?.[1]?.trim();
}

function displayItem(raw?: string): string | undefined {
  if (!raw) return undefined;
  const leaf = raw.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') ?? raw;
  if (/^\d+$/.test(leaf) || leaf.length > 100) return undefined;
  return normalizeItemName(leaf).cleanName;
}

function createEvent(event: Omit<LiveTelemetryEvent, 'id'>): LiveTelemetryEvent {
  if (event.type === 'objective_update' && event.missionId && event.objectiveId) {
    return { ...event, id: [event.type, event.missionId, event.objectiveId, event.objectiveState ?? 'unknown'].join('|') };
  }
  const id = [event.timestamp, event.type, event.missionId ?? '', event.objectiveId ?? '', event.objectiveState ?? '', event.title, event.itemName ?? '', event.zone ?? '', event.operation ?? '', event.details].join('|');
  return { ...event, id };
}

/** Extracts low-volume player activity signals shared by historical scans and Live Copilot. */
export function parseActivityLine(line: string, fallbackTimestamp = new Date().toISOString()): LiveTelemetryEvent[] {
  const timestamp = line.match(TIMESTAMP_RE)?.[1] ?? fallbackTimestamp;
  const events: LiveTelemetryEvent[] = [];
  const notice = notificationText(line);
  const missionId = fieldValue(line, 'MissionId') ?? fieldValue(line, 'mission_id');
  const objectiveId = fieldValue(line, 'ObjectiveId') ?? fieldValue(line, 'objective_id');

  if (notice && /^Contract Accepted:/i.test(notice)) {
    const missionName = notice.replace(/^Contract Accepted:\s*/i, '').replace(/^['"]|['"]$/g, '').trim();
    if (missionId) events.push(createEvent({
      timestamp,
      type: 'mission_accepted',
      title: 'Contract Accepted',
      details: missionName || `Mission ${missionId}`,
      missionName: missionName || undefined,
      missionId,
      category: 'contract',
      confirmed: true,
      severity: 'info',
    }));
  }

  if (line.includes('<EndMission>') && missionId) {
    const completion = (fieldValue(line, 'CompletionType') ?? '').toLowerCase();
    const type = /abandon|cancel/.test(completion)
      ? 'mission_abandoned'
      : /complete|success/.test(completion)
        ? 'mission_completed'
        : undefined;
    if (type) events.push(createEvent({
      timestamp,
      type,
      title: type === 'mission_completed' ? 'Contract Completed' : 'Contract Abandoned',
      details: `Mission ${missionId}`,
      missionId,
      category: 'contract',
      confirmed: true,
      severity: type === 'mission_completed' ? 'success' : 'warning',
    }));
  }

  if (line.includes('<ObjectiveUpserted>')) {
    const mission = line.match(/mission_id\s+(.+?)\s+-\s+objective_id\s+(.+?)\s+-\s+state\s+([A-Z0-9_]+)/i);
    if (mission) {
      const state = mission[3].replace(/^MISSION_OBJECTIVE_STATE_/i, '').toLowerCase().replace(/_/g, ' ');
      const prettyState = state.replace(/\b\w/g, (letter) => letter.toUpperCase());
      events.push(createEvent({
        timestamp,
        type: 'objective_update',
        title: 'Objective Updated',
        details: `Objective state observed: ${prettyState}`,
        missionId: mission[1].trim(),
        objectiveId: mission[2].trim(),
        objectiveState: state,
        category: 'objective',
        confirmed: true,
        severity: /complete|success/.test(state) ? 'success' : 'info',
      }));
    }
  }

  if (notice) {
    const armistice = notice.match(/^(Entering|Leaving) Armistice Zone\s*-?\s*(.*)$/i);
    const jurisdiction = notice.match(/^Entered\s+(.+?)\s+Jurisdiction$/i);
    const monitored = /^Entered Monitored Space$/i.test(notice);
    if (armistice || jurisdiction || monitored) {
      const entering = armistice?.[1].toLowerCase() === 'entering';
      const zone = armistice
        ? `Armistice Zone${armistice[2] ? ` · ${armistice[2]}` : ''}`
        : jurisdiction?.[1] ?? 'Monitored Space';
      events.push(createEvent({
        timestamp,
        type: 'zone_transition',
        title: armistice ? (entering ? 'Entered Armistice Zone' : 'Left Armistice Zone') : 'Jurisdiction Changed',
        details: zone,
        zone,
        category: 'zone',
        confirmed: true,
        severity: 'info',
      }));
    }
  }

  if (line.includes('<Add Inventory Management Move>')) {
    const rawItem = fieldValue(line, 'ItemClass') ?? fieldValue(line, 'Class');
    const operation = fieldValue(line, 'Type') ?? 'move';
    const itemName = displayItem(rawItem);
    events.push(createEvent({
      timestamp,
      type: 'inventory_move',
      title: 'Inventory Move Requested',
      details: `${itemName ?? 'Item'} · ${operation} request observed; completion is not confirmed in this line.`,
      itemName,
      operation,
      category: 'inventory',
      confirmed: false,
      severity: 'info',
    }));
  } else if (line.includes('<EquipItem>')) {
    const itemName = displayItem(fieldValue(line, 'Class') ?? fieldValue(line, 'ItemClass'));
    const port = fieldValue(line, 'Port');
    events.push(createEvent({
      timestamp,
      type: 'inventory_equip',
      title: 'Equipment Request Observed',
      details: `${itemName ?? 'Item'}${port && !/^\d+$/.test(port) ? ` · slot ${port}` : ''}; completion is not confirmed in this line.`,
      itemName,
      operation: 'equip',
      category: 'inventory',
      confirmed: false,
      severity: 'info',
    }));
  } else if (line.includes('<OnInventoryStoreItem>')) {
    events.push(createEvent({
      timestamp,
      type: 'inventory_stored',
      title: 'Storage State Updated',
      details: 'The log recorded an item storage update; item name and quantity were not included.',
      operation: 'storage update',
      category: 'inventory',
      confirmed: true,
      severity: 'info',
    }));
  }

  if (line.includes('<Update Shard Id>')) {
    const shardId = line.match(/New Shard Id:\s*([^\s>.]+)/i)?.[1];
    if (shardId) events.push(createEvent({
      timestamp,
      type: 'shard',
      title: 'Shard Changed',
      details: `Connected to shard ${shardId}.`,
      category: 'system',
      confirmed: true,
      severity: 'info',
    }));
  }

  return events;
}
