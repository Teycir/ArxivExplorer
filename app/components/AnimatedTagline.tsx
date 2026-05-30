'use client';
// app/components/AnimatedTagline.tsx — ported from SeekYou
import { motion } from 'framer-motion';

export function AnimatedTagline({ text }: { text: string }) {
  const chars = text.split('');
  return (
    <motion.p
      className="text-sm text-neon-red/50 animate-subtle-shimmer cursor-default font-mono"
      initial="hidden"
      animate="visible"
      whileHover={{
        scale: 1.02,
        textShadow: '0 0 20px rgba(255, 26, 26, 0.8), 0 0 40px rgba(255, 26, 26, 0.4)',
        transition: { duration: 0.3 },
      }}
    >
      {chars.map((char, i) => (
        <motion.span
          key={i}
          className="inline-block"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.1, delay: (chars.length - 1 - i) * 0.04 }}
          whileHover={{
            y: -2,
            color: '#ff1a1a',
            textShadow: '0 0 10px rgba(255, 26, 26, 1)',
            transition: { duration: 0.2 },
          }}
        >
          {char === ' ' ? '\u00A0' : char}
        </motion.span>
      ))}
    </motion.p>
  );
}
