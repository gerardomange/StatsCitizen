export interface NormalizedShip {
  name: string;
  manufacturer: string;
}

const MANUFACTURER_PREFIXES: Record<string, { name: string; mfg: string }> = {
  CRUS: { name: 'Crusader', mfg: 'Crusader Industries' },
  RSI: { name: 'RSI', mfg: 'Roberts Space Industries' },
  DRAK: { name: 'Drake', mfg: 'Drake Interplanetary' },
  ANVL: { name: 'Anvil', mfg: 'Anvil Aerospace' },
  AEGS: { name: 'Aegis', mfg: 'Aegis Dynamics' },
  MISC: { name: 'MISC', mfg: 'Musashi Industrial & Starflight Concern' },
  ORIG: { name: 'Origin', mfg: 'Origin Jumpworks' },
  ARGO: { name: 'ARGO', mfg: 'ARGO Astronautics' },
  ESPR: { name: 'Esperia', mfg: 'Esperia' },
  BANU: { name: 'Banu', mfg: 'Banu Protectorate' },
  XIAN: { name: 'Xi\'an', mfg: 'Gatac Railen / Aopoa' },
  AOPO: { name: 'Aopoa', mfg: 'Aopoa' },
  CNOU: { name: 'CNOU', mfg: 'Consolidated Outland' },
  TMBL: { name: 'Tumbril', mfg: 'Tumbril Land Systems' },
  MIRAI: { name: 'Mirai', mfg: 'Mirai' },
  GLSN: { name: 'Glaser', mfg: 'Glaser Navigation' },
};

export function normalizeShipName(rawName: string): NormalizedShip {
  if (!rawName) return { name: 'Unknown Vessel', manufacturer: 'Unknown' };

  // Strip trailing IDs like _768920956815 or -001
  let clean = rawName.replace(/_[0-9]{6,}$/, '').replace(/-[0-9]{3,}$/, '');

  const parts = clean.split('_');
  if (parts.length >= 2) {
    const prefix = parts[0].toUpperCase();
    if (MANUFACTURER_PREFIXES[prefix]) {
      const mfgInfo = MANUFACTURER_PREFIXES[prefix];
      const modelParts = parts.slice(1).map(p => {
        if (p.toLowerCase() === 'mk2') return 'Mk II';
        if (p.toLowerCase() === 'mk1') return 'Mk I';
        return p.charAt(0).toUpperCase() + p.slice(1);
      });
      return {
        name: `${mfgInfo.name} ${modelParts.join(' ')}`,
        manufacturer: mfgInfo.mfg,
      };
    }
  }

  // Fallback cleanup
  clean = clean.replace(/_/g, ' ');
  return {
    name: clean,
    manufacturer: 'Independent',
  };
}

export function normalizeShopName(rawName: string): string {
  if (!rawName) return 'Local Terminal';
  let clean = rawName;
  clean = clean.replace(/^SCShop_/i, '');
  clean = clean.replace(/_RestStop_/i, ' Rest Stop - ');
  clean = clean.replace(/_BlackMarket_/i, ' Black Market - ');
  clean = clean.replace(/_FPSItems/i, ' FPS Gear');
  clean = clean.replace(/_ShipWeapons/i, ' Ship Weapons');
  clean = clean.replace(/_ShipComponents/i, ' Components');
  clean = clean.replace(/_Clothing/i, ' Apparel');
  clean = clean.replace(/_/g, ' ');
  return clean.trim();
}

export function normalizeItemName(rawItem: string): { cleanName: string; category: 'weapons' | 'armor' | 'components' | 'ammo' | 'consumable' | 'ship' | 'other' } {
  if (!rawItem) return { cleanName: 'Standard Supply', category: 'other' };

  const lower = rawItem.toLowerCase();
  let category: 'weapons' | 'armor' | 'components' | 'ammo' | 'consumable' | 'ship' | 'other' = 'other';

  if (lower.includes('mag') || lower.includes('ammo') || lower.includes('battery')) {
    category = 'ammo';
  } else if (lower.includes('rifle') || lower.includes('hmg') || lower.includes('smg') || lower.includes('pistol') || lower.includes('shotgun') || lower.includes('sniper')) {
    category = 'weapons';
  } else if (lower.includes('helmet') || lower.includes('undersuit') || lower.includes('torso') || lower.includes('armor') || lower.includes('arms') || lower.includes('legs') || lower.includes('backpack')) {
    category = 'armor';
  } else if (lower.includes('shield') || lower.includes('cooler') || lower.includes('quantum') || lower.includes('powerplant')) {
    category = 'components';
  } else if (lower.includes('medpen') || lower.includes('oxypun') || lower.includes('drink') || lower.includes('food') || lower.includes('medical')) {
    category = 'consumable';
  }

  let clean = rawItem.replace(/_/g, ' ');
  clean = clean.replace(/\b([a-z])/g, (_, char) => char.toUpperCase());

  return { cleanName: clean, category };
}

export function normalizeDestination(rawDest: string): string {
  if (!rawDest) return 'Uncharted Space';
  if (rawDest.includes('stan-pyro_jp1')) return 'Stanton-Pyro Jump Point Station';
  if (rawDest.includes('pyro-stan_jp1')) return 'Pyro-Stanton Jump Point Station';
  if (rawDest.includes('pyro4') || rawDest.toLowerCase() === 'pyro4') return 'Pyro IV';
  if (rawDest.includes('pyro1') || rawDest.toLowerCase() === 'pyro1') return 'Pyro I';
  if (rawDest.includes('pyro2') || rawDest.toLowerCase() === 'pyro2') return 'Pyro II';
  if (rawDest.includes('pyro3') || rawDest.toLowerCase() === 'pyro3') return 'Pyro III';
  if (rawDest.includes('pyro5') || rawDest.toLowerCase() === 'pyro5') return 'Pyro V';
  if (rawDest.includes('pyro6') || rawDest.toLowerCase() === 'pyro6') return 'Pyro VI';
  if (rawDest.includes('microtech')) return 'microTech';
  if (rawDest.includes('hurston')) return 'Hurston';
  if (rawDest.includes('crusader')) return 'Crusader';
  if (rawDest.includes('arccorp')) return 'ArcCorp';
  
  let clean = rawDest.replace(/^LOC_rs_ext_/i, '').replace(/^LOC_/i, '');
  return clean.replace(/_/g, ' ').toUpperCase();
}
