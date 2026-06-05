'use client';
import { useState, useRef, useEffect, type ReactNode } from 'react';

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
  maxWidth = 'max-w-[220px]',
}: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [offset, setOffset]   = useState(0);
  const tipRef  = useRef<HTMLSpanElement>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const timer   = useRef<ReturnType<typeof setTimeout> | null>(null);

  // After the tooltip appears, clamp it inside the viewport
  useEffect(() => {
    if (!visible || !tipRef.current) return;
    const rect = tipRef.current.getBoundingClientRect();
    const pad  = 8;
    if (rect.right > window.innerWidth - pad) {
      setOffset(-(rect.right - (window.innerWidth - pad)));
    } else if (rect.left < pad) {
      setOffset(pad - rect.left);
    } else {
      setOffset(0);
    }
  }, [visible]);

  const base: Record<string, string> = {
    top:    'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left:   'right-full top-1/2 -translate-y-1/2 mr-2',
    right:  'left-full top-1/2 -translate-y-1/2 ml-2',
  };

  const show = () => {
    if (delay > 0) { timer.current = setTimeout(() => setVisible(true), delay); }
    else setVisible(true);
  };
  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    setVisible(false);
    setOffset(0);
  };

  return (
    <span
      ref={wrapRef}
      className="relative inline-flex items-center"
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      {children}
      {visible && (
        <span
          ref={tipRef}
          className={`absolute z-50 ${base[position]} ${className}`}
          style={offset ? { transform: `translateX(calc(-50% + ${offset}px))` } : undefined}
        >
          <span className={`block px-2.5 py-1.5 text-[11px] font-mono leading-snug
            w-max ${maxWidth} text-center whitespace-normal
            bg-neutral-950 border border-neon-red/30 rounded-lg
            shadow-lg shadow-black/60 text-white/70`}>
            {content}
          </span>
        </span>
      )}
    </span>
  );
}
