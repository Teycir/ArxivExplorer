'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';

export function ParticleBackground() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const width = window.innerWidth;
    const height = window.innerHeight;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);

    // Scene
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x000000, 800, 1600);

    // Camera
    const camera = new THREE.PerspectiveCamera(35, width / height, 1, 10000);
    camera.position.set(866, 500, 0);
    camera.lookAt(0, 0, 0);

    // Light
    const light = new THREE.HemisphereLight(0x77ffaa, 0x77ffaa, 1);
    light.position.set(866, 500, 0);
    scene.add(light);

    // Particles
    const moversNum = 20000;
    const movers: Array<{
      position: THREE.Vector3;
      velocity: THREE.Vector3;
      acceleration: THREE.Vector3;
      mass: number;
      isActive: boolean;
    }> = [];

    const pointsGeometry = new THREE.BufferGeometry();
    const pointsGeometry2 = new THREE.BufferGeometry();
    const positions = new Float32Array(moversNum * 3);
    const positions2 = new Float32Array(moversNum * 3);

    for (let i = 0; i < moversNum; i++) {
      const range = (1 - Math.log(Math.floor(Math.random() * 254) + 2) / Math.log(256)) * 500;
      const rad = (Math.random() * 360 * Math.PI) / 180;
      const x = Math.cos(rad) * range;
      const z = Math.sin(rad) * range;

      const mover = {
        position: new THREE.Vector3(x, 1000, z),
        velocity: new THREE.Vector3(x, 1000, z),
        acceleration: new THREE.Vector3(),
        mass: (Math.floor(Math.random() * 200) + 300) / 100,
        isActive: false,
      };
      movers.push(mover);

      const idx = i * 3;
      if (i % 2 === 0) {
        positions[idx] = x;
        positions[idx + 1] = 1000;
        positions[idx + 2] = z;
      } else {
        positions2[idx] = x;
        positions2[idx + 1] = 1000;
        positions2[idx + 2] = z;
      }
    }

    pointsGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    pointsGeometry2.setAttribute('position', new THREE.BufferAttribute(positions2, 3));

    const pointsMaterial = new THREE.PointsMaterial({
      color: 0x77ffaa,
      size: 4,
      transparent: true,
      opacity: 0.7,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    const pointsMaterial2 = new THREE.PointsMaterial({
      color: 0x77aaff,
      size: 4,
      transparent: true,
      opacity: 0.7,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });

    const points = new THREE.Points(pointsGeometry, pointsMaterial);
    const points2 = new THREE.Points(pointsGeometry2, pointsMaterial2);
    scene.add(points);
    scene.add(points2);

    // Animation
    const antigravity = new THREE.Vector3(0, 1.5, 0);
    let lastActivate = 0;
    let cameraRad = (30 * Math.PI) / 180;
    let lastTime = performance.now();

    const activateMovers = () => {
      let count = 0;
      for (const mover of movers) {
        if (mover.isActive) continue;
        mover.isActive = true;
        mover.velocity.y = -300;
        if (++count >= 40) break;
      }
    };

    const animate = (currentTime: number) => {
      requestAnimationFrame(animate);

      const delta = Math.min((currentTime - lastTime) / 1000, 0.1);
      lastTime = currentTime;

      if (currentTime - lastActivate > 50) {
        activateMovers();
        lastActivate = currentTime;
      }

      const positionAttr = pointsGeometry.attributes.position;
      const positionAttr2 = pointsGeometry2.attributes.position;
      if (!positionAttr || !positionAttr2) return;

      const posArray = positionAttr.array as Float32Array;
      const posArray2 = positionAttr2.array as Float32Array;

      for (let i = 0; i < movers.length; i++) {
        const mover = movers[i];
        if (!mover) continue;
        if (mover.isActive) {
          const force = antigravity.clone().multiplyScalar(delta * 60);
          mover.acceleration.add(force);
          mover.acceleration.divideScalar(mover.mass);
          mover.velocity.add(mover.acceleration.multiplyScalar(delta * 60));
          mover.position.add(mover.velocity.clone().multiplyScalar(delta * 60));
          mover.acceleration.set(0, 0, 0);

          if (mover.position.y > 500) {
            const range = (1 - Math.log(Math.floor(Math.random() * 254) + 2) / Math.log(256)) * 500;
            const rad = (Math.random() * 360 * Math.PI) / 180;
            const x = Math.cos(rad) * range;
            const z = Math.sin(rad) * range;
            mover.position.set(x, -300, z);
            mover.velocity.copy(mover.position);
            mover.mass = (Math.floor(Math.random() * 200) + 300) / 100;
          }
        }

        const idx = i * 3;
        if (i % 2 === 0) {
          posArray[idx] = mover.position.x;
          posArray[idx + 1] = mover.position.y;
          posArray[idx + 2] = mover.position.z;
        } else {
          posArray2[idx] = mover.position.x;
          posArray2[idx + 1] = mover.position.y;
          posArray2[idx + 2] = mover.position.z;
        }
      }

      positionAttr.needsUpdate = true;
      positionAttr2.needsUpdate = true;

      cameraRad += ((0.03 * Math.PI) / 180) * delta * 60;
      camera.position.x = Math.cos(Math.PI / 3) * Math.cos(cameraRad) * 1000;
      camera.position.z = Math.cos(Math.PI / 3) * Math.sin(cameraRad) * 1000;
      camera.position.y = Math.sin(Math.PI / 3) * 1000;
      camera.lookAt(0, 0, 0);

      renderer.render(scene, camera);
    };

    animate(performance.now());

    const handleResize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      scene.remove(points);
      scene.remove(points2);
      scene.remove(light);
      scene.clear();
      container.removeChild(renderer.domElement);
      renderer.dispose();
      pointsGeometry.dispose();
      pointsGeometry2.dispose();
      pointsMaterial.dispose();
      pointsMaterial2.dispose();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 pointer-events-none opacity-30 z-0"
      style={{ mixBlendMode: 'screen' }}
      aria-hidden="true"
    />
  );
}
