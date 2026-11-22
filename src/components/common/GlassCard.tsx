import React from 'react';
import { motion } from 'framer-motion';

interface GlassCardProps {
  children: React.ReactNode;
  className?: string;
  variant?: 'cyan' | 'amber' | 'crimson' | 'emerald' | 'default';
  bracket?: boolean;
}

export const GlassCard: React.FC<GlassCardProps> = ({
  children,
  className = '',
  variant = 'cyan',
  bracket = false,
}) => {
  const variantStyles = {
    cyan: 'border-cyan-500/15 hover:border-cyan-500/30 shadow-glow-cyan/5',
    amber: 'border-amber-500/20 hover:border-amber-500/35 shadow-glow-amber/5',
    crimson: 'border-rose-500/20 hover:border-rose-500/35 shadow-glow-crimson/5',
    emerald: 'border-emerald-500/20 hover:border-emerald-500/35 shadow-glow-emerald/5',
    default: 'border-slate-800 hover:border-slate-700',
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={`glass-panel hud-radius p-5 relative overflow-hidden transition-all duration-300 ${variantStyles[variant]} ${
        bracket ? 'sc-bracket' : ''
      } ${className}`}
    >
      {children}
    </motion.div>
  );
};
