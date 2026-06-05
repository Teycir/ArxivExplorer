'use client';
import { useState, type ReactNode } from 'react';

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
  delay?: number;
  maxWidth?: string;
}

export function Tooltip({ 
  content, 
  children, 
  position = 'bottom', 
  className = '',
  delay = 0,
  maxWidth = 'max-w-xs',
}: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [timer, setTimer] = useState<NodeJS.Timeout | null>(null);

  const positionClasses = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  };

  const handleMouseEnter = () => {
    if (delay > 0) {
      const t = setTimeout(() => setVisible(true), delay);
      setTimer(t);
    } else {
      setVisible(true);
    }
  };

  const handleMouseLeave = () => {
    if (timer) clearTimeout(timer);
    setVisible(false);
  };

  return (
    <span
      className="relative inline-flex items-center"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {children}
      {visible && (
        <span
          className={`absolute z-50 animate-in fade-in duration-200 ${positionClasses[position]} ${className}`}
        >
          <span className={`block px-3 py-2 text-xs font-mono leading-relaxed ${maxWidth}
            bg-gradient-to-br from-neutral-950 to-neutral-900
            border border-neon-red/40 rounded-lg shadow-2xl
            shadow-neon-red/20`}>
            {content}
          </span>
        </span>
      )}
    </span>
  );
}
