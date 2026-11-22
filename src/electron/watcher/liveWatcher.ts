import fs from 'fs';
import path from 'path';
import { StringDecoder } from 'string_decoder';
import { BrowserWindow } from 'electron';
import { LiveTelemetryEvent } from '../../types/telemetry.js';
import { normalizeShipName, normalizeDestination } from '../parser/nameNormalizer.js';
import { parseActivityLine } from '../parser/activityParser.js';

const LIVE_BUY_REQUEST_RE = /SendShopBuyRequest.*shopId\[(\d+)\].*shopName\[(.*?)\].*kioskId\[(\d+)\].*client_price\[(\d+(?:\.\d+)?)\].*itemName\[(.*?)\].*quantity\[(\d+)\]/i;
const LIVE_BUY_RESPONSE_RE = /RmShopFlowResponse.*shopId\[(\d+)\].*kioskId\[(\d+)\].*result\[([^\]]+)\]/i;
const MISSION_REWARD_RE = /Awarded\s+([\d,]+)\s+aUEC/i;

interface PendingLivePurchase {
  timestamp: string;
  shopName: string;
  itemName: string;
  unitPrice: number;
  quantity: number;
}

export class LiveGameLogWatcher {
  private scPath: string;
  private currentOffset: number = 0;
  private watchTimer: NodeJS.Timeout | null = null;
  private isWatching: boolean = false;
  private mainWindow: BrowserWindow | null = null;
  private pendingText = '';
  private fileIdentity = '';
  private decoder = new StringDecoder('utf8');
  private pendingPurchases = new Map<string, PendingLivePurchase[]>();

  constructor(scPath: string, mainWindow: BrowserWindow) {
    this.scPath = scPath;
    this.mainWindow = mainWindow;
  }

  public start(): boolean {
    if (this.isWatching) return true;
    const gameLogPath = path.join(this.scPath, 'Game.log');
    if (!fs.existsSync(gameLogPath)) return false;

    try {
      const stats = fs.statSync(gameLogPath);
      // Start at EOF: historical lines should not be replayed as live events.
      this.currentOffset = stats.size;
      this.fileIdentity = `${stats.dev}:${stats.ino}`;
    } catch {
      this.currentOffset = 0;
    }

    this.isWatching = true;
    this.watchTimer = setInterval(() => {
      this.pollFile();
    }, 1000);
    return true;
  }

  public stop() {
    if (this.watchTimer) {
      clearInterval(this.watchTimer);
      this.watchTimer = null;
    }
    this.isWatching = false;
    this.pendingText = '';
    this.decoder = new StringDecoder('utf8');
    this.pendingPurchases.clear();
  }

  private pollFile() {
    const gameLogPath = path.join(this.scPath, 'Game.log');
    if (!fs.existsSync(gameLogPath)) return;

    try {
      const stats = fs.statSync(gameLogPath);
      const identity = `${stats.dev}:${stats.ino}`;
      if (stats.size < this.currentOffset || identity !== this.fileIdentity) {
        // A new game can truncate or replace Game.log while the watcher is running.
        this.currentOffset = 0;
        this.fileIdentity = identity;
        this.pendingText = '';
        this.decoder = new StringDecoder('utf8');
      }

      if (stats.size > this.currentOffset) {
        const readLen = stats.size - this.currentOffset;
        const buffer = Buffer.alloc(readLen);
        const fd = fs.openSync(gameLogPath, 'r');
        fs.readSync(fd, buffer, 0, readLen, this.currentOffset);
        fs.closeSync(fd);

        this.currentOffset = stats.size;
        const text = this.decoder.write(buffer);
        this.parseNewLines(text);
      }
    } catch {
      // Ignore read errors
    }
  }

  private parseNewLines(chunk: string) {
    const parts = (this.pendingText + chunk).split('\n');
    this.pendingText = parts.pop() ?? '';
    const lines = parts;
    for (const line of lines) {
      if (!line.trim()) continue;

      const tsMatch = line.match(/<(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)>/);
      const ts = tsMatch ? tsMatch[1] : new Date().toISOString();

      for (const event of parseActivityLine(line, ts)) this.emitEvent(event);

      const reward = line.match(MISSION_REWARD_RE);
      if (reward) {
        const amountAuec = Number(reward[1].replace(/,/g, ''));
        if (Number.isFinite(amountAuec)) {
          this.emitEvent({ timestamp: ts, type: 'reward', title: 'aUEC Awarded', details: `${amountAuec.toLocaleString()} aUEC`, amountAuec, severity: 'success' });
        }
      }

      // 1. Ship Takeoff / Pilot Seat
      if (line.includes('granted control token for')) {
        const grantMatch = line.match(/granted control token for '([^']+)'/i);
        if (grantMatch) {
          const ship = normalizeShipName(grantMatch[1]);
          this.emitEvent({
            timestamp: ts,
            type: 'flight_start',
            title: 'Flight Systems Engaged',
            details: `Piloting ${ship.name} (${ship.manufacturer})`,
            severity: 'info',
          });
        }
      }

      // 2. Ship Release
      if (line.includes('releasing control token for')) {
        const relMatch = line.match(/releasing control token for '([^']+)'/i);
        if (relMatch) {
          const ship = normalizeShipName(relMatch[1]);
          this.emitEvent({
            timestamp: ts,
            type: 'flight_end',
            title: 'Pilot Stand Down',
            details: `Released controls of ${ship.name}`,
            severity: 'info',
          });
        }
      }

      // 3. Quantum Route
      if (line.includes('Player has requested fuel calculation to destination')) {
        const qMatch = line.match(/Player has requested fuel calculation to destination\s+([^\s]+)/i);
        if (qMatch) {
          const dest = normalizeDestination(qMatch[1]);
          this.emitEvent({
            timestamp: ts,
            type: 'quantum',
            title: 'Quantum Route Computed',
            details: `Destination: ${dest}`,
            severity: 'info',
          });
        }
      }

      // 4. Fatal Collision
      if (line.includes('<FatalCollision>')) {
        const colMatch = line.match(/Fatal Collision occured for vehicle\s+([^\s\[]+).*Zone:\s*([^,]+)/i);
        if (colMatch) {
          const ship = normalizeShipName(colMatch[1]);
          const zone = normalizeDestination(colMatch[2]);
          this.emitEvent({
            timestamp: ts,
            type: 'collision',
            title: 'CRITICAL IMPACT // HULL LOSS',
            details: `${ship.name} suffered fatal impact in sector ${zone}`,
            severity: 'alert',
          });
        }
      }

      // 5. Purchases
      const buyRequest = line.match(LIVE_BUY_REQUEST_RE);
      if (buyRequest) {
        const [, shopId, shopName, kioskId, price, itemName, quantity] = buyRequest;
        const key = `${shopId}_${kioskId}`;
        const pending = this.pendingPurchases.get(key) ?? [];
        pending.push({ timestamp: ts, shopName, itemName, unitPrice: Number(price), quantity: Number(quantity) });
        this.pendingPurchases.set(key, pending);
      }
      const buyResponse = line.match(LIVE_BUY_RESPONSE_RE);
      if (buyResponse) {
        const key = `${buyResponse[1]}_${buyResponse[2]}`;
        const pending = this.pendingPurchases.get(key) ?? [];
        const purchase = pending.shift();
        if (pending.length) this.pendingPurchases.set(key, pending);
        else this.pendingPurchases.delete(key);
        if (buyResponse[3].toLowerCase().includes('success')) {
          const amountAuec = purchase ? purchase.unitPrice * purchase.quantity : undefined;
          this.emitEvent({
            timestamp: ts,
            type: 'purchase',
            title: 'Transaction Confirmed',
            details: purchase
              ? `${purchase.itemName} ×${purchase.quantity} · ${amountAuec!.toLocaleString()} aUEC · ${purchase.shopName}`
              : 'Successful terminal response; purchase details were not present in the log.',
            amountAuec,
            itemName: purchase?.itemName,
            severity: 'success',
          });
        }
      }

      // 6. Medical Bed
      if (line.includes('Medical Bed: The bed has restored your health')) {
        this.emitEvent({
          timestamp: ts,
          type: 'medical',
          title: 'Medical Treatment Applied',
          details: 'Health restored and vitals stabilized.',
          severity: 'success',
        });
      }

    }
  }

  private emitEvent(event: LiveTelemetryEvent) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('live-telemetry-event', event);
    }
  }
}
