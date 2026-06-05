'use client';
// app/components/Card.tsx — ported from SeekYou
import { motion, useMotionTemplate, useMotionValue } from "framer-motion";
import React, { type MouseEvent } from "react";

interface CardProps {
  children: React.ReactNode;
  className?: string;
  title?: string;
}

export function Card({ children, className = "", title }: Readonly<CardProps>) {
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const rectRef = React.useRef<DOMRect | null>(null);

  function handleMouseEnter({ currentTarget }: MouseEvent) {
    rectRef.current = currentTarget.getBoundingClientRect();
  }

  function handleMouseMove({ currentTarget, clientX, clientY }: MouseEvent) {
    const rect = rectRef.current || currentTarget.getBoundingClientRect();
    mouseX.set(clientX - rect.left);
    mouseY.set(clientY - rect.top);
  }

  return (
    <motion.div
      initial={{ opacity: 1, y: 0 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -3, transition: { duration: 0.18, ease: [0.22, 1, 0.36, 1] } }}
      transition={{ duration: 0.3 }}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      className={`card-scanlines border border-neon-red/20 hover:border-neon-red/50 transition-all duration-300 rounded-xl p-6 leading-normal group relative
        bg-[rgba(10,10,10,0.6)] backdrop-blur-[12px]
        shadow-[0_4px_24px_0_rgba(0,0,0,0.4),inset_0_1px_0_0_rgba(255,255,255,0.04)]
        hover:shadow-[0_8px_40px_0_rgba(0,255,65,0.08),inset_0_1px_0_0_rgba(0,255,65,0.06)] ${className}`}
    >
      {/* Mouse-tracking radial glow */}
      <motion.div
        className="pointer-events-none absolute -inset-px rounded-xl opacity-0 transition duration-500 group-hover:opacity-100"
        style={{
          background: useMotionTemplate`radial-gradient(520px circle at ${mouseX}px ${mouseY}px, rgba(0, 255, 65, 0.10), transparent 70%)`,
        }}
      />
      {/* Corner accent — top-left */}
      <span className="absolute top-0 left-0 w-4 h-4 border-t border-l border-neon-red/20 rounded-tl-xl
        group-hover:border-neon-red/50 group-hover:w-6 group-hover:h-6 transition-all duration-300 pointer-events-none" />
      {/* Corner accent — bottom-right */}
      <span className="absolute bottom-0 right-0 w-4 h-4 border-b border-r border-neon-red/20 rounded-br-xl
        group-hover:border-neon-red/50 group-hover:w-6 group-hover:h-6 transition-all duration-300 pointer-events-none" />
      <div className="relative h-full">
        {title && (
          <div className="mb-4 border-b border-neon-red/20 pb-2">
            <h3 className="text-neon-red font-mono font-bold uppercase tracking-wider">{title}</h3>
          </div>
        )}
        {children}
      </div>
    </motion.div>
  );
}
