'use client';

/**
 * HeroStars — lightweight R3F Stars canvas for the home page hero background.
 * Replaces the SVG BackgroundBeams with a real Three.js starfield.
 * Pointer-events disabled so it never blocks clicks on hero content.
 */

import { Canvas } from '@react-three/fiber';
import { Stars } from '@react-three/drei';

export function HeroStars() {
  return (
    <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
      <Canvas
        camera={{ position: [0, 0, 1], fov: 75 }}
        gl={{ antialias: false, alpha: true }}
        style={{ background: 'transparent' }}
        dpr={[1, 1]}
      >
        <Stars
          radius={80}
          depth={50}
          count={2500}
          factor={4}
          saturation={0}
          fade
          speed={0.6}
        />
      </Canvas>
      {/* Subtle radial vignette to blend into page */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 80% 60% at 50% 50%, transparent 40%, #0a0a0a 100%)',
        }}
      />
      {/* Hard bottom fade so stars never bleed into content below the hero */}
      <div
        className="absolute inset-x-0 bottom-0"
        style={{
          height: '35%',
          background: 'linear-gradient(to bottom, transparent 0%, #0a0a0a 100%)',
        }}
      />
    </div>
  );
}
