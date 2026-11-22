import React, { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ManufacturerLogo } from './ManufacturerLogo.js';
import { useShipTheme } from '../../themes/ShipThemeContext.js';
import { useT } from '../../i18n/index.js';

const BOOT_MS = 1400;

/** Full-window manufacturer boot splash, shown for ~1.4 s when the player sits down in a ship. */
export const CockpitBootOverlay: React.FC = () => {
  const { boot, dismissBoot } = useShipTheme();
  const t = useT();

  useEffect(() => {
    if (!boot) return;
    const timer = window.setTimeout(dismissBoot, BOOT_MS);
    return () => window.clearTimeout(timer);
  }, [boot, dismissBoot]);

  const checks = boot?.theme.bootChecks ?? [];
  const step = (BOOT_MS / 1000 - 0.45) / Math.max(checks.length, 1);

  return (
    <AnimatePresence>
      {boot && (
        <motion.div
          key={boot.key}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-space-950/95 backdrop-blur-sm cursor-pointer"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.35 } }}
          transition={{ duration: 0.15 }}
          onClick={dismissBoot}
          title={t('Click to skip')}
        >
          <div className="absolute inset-0 bg-sc-grid opacity-60 pointer-events-none" />
          <div className="absolute inset-0 bg-hud-radial pointer-events-none" />

          <div className="relative flex flex-col items-center gap-5 w-[min(420px,80vw)]">
            <motion.div
              initial={{ scale: 0.7, opacity: 0, filter: 'blur(8px)' }}
              animate={{ scale: 1, opacity: 1, filter: 'blur(0px)' }}
              transition={{ duration: 0.45, ease: 'easeOut' }}
              className="text-quantum-cyan drop-shadow-[0_0_24px_rgb(var(--accent)/0.55)]"
            >
              <ManufacturerLogo theme={boot.theme} className="w-32 h-32" />
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.3 }}
              className="text-center"
            >
              <div className="font-orbitron font-bold tracking-[0.3em] text-lg text-white">{boot.theme.osName}</div>
              <div className="font-mono text-[11px] tracking-[0.25em] text-cyan-300/80 mt-1">{boot.theme.tagline}</div>
              <div className="font-mono text-xs text-slate-400 mt-3 uppercase tracking-widest">{boot.shipName}</div>
            </motion.div>

            <div className="w-full h-1 bg-space-800 overflow-hidden hud-radius">
              <motion.div
                className="h-full bg-quantum-cyan shadow-glow-cyan"
                initial={{ width: '0%' }}
                animate={{ width: '100%' }}
                transition={{ duration: BOOT_MS / 1000 - 0.25, ease: 'easeInOut' }}
              />
            </div>

            <div className="w-full grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-[11px]">
              {checks.map((c, i) => (
                <motion.div
                  key={c}
                  className="flex items-center justify-between"
                  initial={{ opacity: 0.25 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.3 + i * step, duration: 0.15 }}
                >
                  <span className="text-slate-400">{c}</span>
                  <motion.span
                    className="text-cyan-300"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.3 + i * step + 0.1 }}
                  >
                    ONLINE
                  </motion.span>
                </motion.div>
              ))}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
