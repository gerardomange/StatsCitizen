import React from 'react';
import { Compass } from 'lucide-react';
import type { ManufacturerTheme } from '../../themes/manufacturers.js';

interface ManufacturerLogoProps {
  theme: ManufacturerTheme;
  className?: string;
  /** 'tint' renders the logo as a silhouette in the current text color; 'original' keeps the SVG colors. */
  variant?: 'tint' | 'original';
  title?: string;
}

/**
 * Renders the official manufacturer logo SVG. The default `tint` mode uses a CSS mask so
 * every logo (some ship black-on-transparent, some multi-color) reads well on the dark HUD
 * and follows the brand accent color.
 */
export const ManufacturerLogo: React.FC<ManufacturerLogoProps> = ({
  theme,
  className = 'w-6 h-6',
  variant = 'tint',
  title,
}) => {
  const label = title ?? theme.name;
  if (!theme.logo) {
    return <Compass className={className} aria-label={label} />;
  }
  if (variant === 'original') {
    return <img src={theme.logo} alt={label} className={`${className} object-contain`} draggable={false} />;
  }
  const mask = `url("${theme.logo}")`;
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`mfg-logo ${className}`}
      style={{ WebkitMaskImage: mask, maskImage: mask }}
    />
  );
};
