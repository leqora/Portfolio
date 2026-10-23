import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { RoundedBox, ContactShadows } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import * as THREE from 'three';
import { SNIPPETS, SCREEN_W, SCREEN_H, prepare, drawScreen } from './codeScreen';

/**
 * Hero scene: a monitor typing real-looking integration code.
 * - The screen is a live canvas texture (see codeScreen.ts)
 * - Red light spills from behind the monitor onto the floor
 * - The monitor turns toward the pointer; scrolling flies the camera into the screen
 */

const SIGNAL = '#ff2e3b';
const SCREEN_PLANE_W = 3.24;
const SCREEN_PLANE_H = SCREEN_PLANE_W * (SCREEN_H / SCREEN_W);
const FOV = 35;
const CAM_Z = 9;

const TYPE_SPEED = 46; // characters per second
const HOLD_SECONDS = 2.8;

function useCodeTexture(animate: boolean) {
  const prepared = useMemo(() => SNIPPETS.map(prepare), []);
  const { canvas, ctx, texture } = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = SCREEN_W;
    canvas.height = SCREEN_H;
    const ctx = canvas.getContext('2d')!;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    return { canvas, ctx, texture };
  }, []);

  const state = useRef({ index: 0, typed: 0, hold: 0, cursor: true, blink: 0, lastDrawn: -1 });

  // Redraw once the mono font is ready, otherwise the first frames use a fallback face
  useEffect(() => {
    const first = prepared[0];
    const draw = () => {
      drawScreen(ctx, first, animate ? 0 : first.length, true);
      texture.needsUpdate = true;
    };
    draw();
    document.fonts?.load('400 29px "JetBrains Mono Variable"').then(draw).catch(() => {});
  }, [ctx, texture, prepared, animate]);

  useFrame((_, dt) => {
    if (!animate) return;
    const s = state.current;
    const prep = prepared[s.index];
    const step = Math.min(dt, 0.1);

    s.blink += step;
    if (s.blink > 0.53) { s.blink = 0; s.cursor = !s.cursor; }

    if (s.typed < prep.length) {
      s.typed = Math.min(prep.length, s.typed + step * TYPE_SPEED * (0.7 + Math.random() * 0.6));
      // Indentation appears at once, like an editor auto-indenting
      const text = prep.snippet.code;
      let i = Math.floor(s.typed);
      while (i < text.length && text[i - 1] === '\n' && text[i] === ' ') {
        while (text[i] === ' ') i++;
      }
      s.typed = Math.max(s.typed, i);
    } else {
      s.hold += step;
      if (s.hold > HOLD_SECONDS) {
        s.hold = 0;
        s.typed = 0;
        s.index = (s.index + 1) % prepared.length;
      }
    }

    const key = Math.floor(s.typed) * 2 + (s.cursor ? 1 : 0) + s.index * 100000;
    if (key !== s.lastDrawn) {
      s.lastDrawn = key;
      drawScreen(ctx, prepared[s.index], Math.floor(s.typed), s.cursor);
      texture.needsUpdate = true;
    }
  });

  return { texture, canvas };
}

/** Radial red glow used as the light spill on the wall behind the monitor */
function useGlowTexture() {
  return useMemo(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    grad.addColorStop(0, 'rgba(255,46,59,0.85)');
    grad.addColorStop(0.35, 'rgba(255,46,59,0.28)');
    grad.addColorStop(1, 'rgba(255,46,59,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
}

const shell = new THREE.MeshStandardMaterial({ color: '#141417', metalness: 0.75, roughness: 0.32 });
const shellDark = new THREE.MeshStandardMaterial({ color: '#0d0d0f', metalness: 0.6, roughness: 0.45 });

function Monitor({ animate }: { animate: boolean }) {
  const { texture } = useCodeTexture(animate);
  const screenMat = useRef<THREE.MeshBasicMaterial>(null);
  const power = useRef(animate ? 0 : 1);

  // Power-on: a short flicker, then full brightness
  useFrame((_, dt) => {
    if (!screenMat.current || power.current >= 1) return;
    power.current = Math.min(1, power.current + dt * 1.4);
    const p = power.current;
    const flicker = p < 0.45 ? (Math.sin(p * 90) > 0 ? 0.65 : 0.1) * p * 2 : p;
    screenMat.current.color.setScalar(flicker);
  });

  return (
    <group>
      {/* Bezel */}
      <RoundedBox args={[3.42, 2.3, 0.12]} radius={0.05} smoothness={4} material={shell} />
      {/* Rear housing */}
      <RoundedBox args={[3.1, 1.95, 0.22]} radius={0.08} smoothness={4} position={[0, 0.02, -0.15]} material={shellDark} />
      {/* Screen */}
      <mesh position={[0, 0.04, 0.0615]}>
        <planeGeometry args={[SCREEN_PLANE_W, SCREEN_PLANE_H]} />
        <meshBasicMaterial ref={screenMat} map={texture} toneMapped={false} color={animate ? '#000' : '#fff'} />
      </mesh>
      {/* Power light */}
      <mesh position={[1.45, -1.09, 0.062]}>
        <circleGeometry args={[0.018, 16]} />
        <meshBasicMaterial color={SIGNAL} toneMapped={false} />
      </mesh>
      {/* Neck */}
      <RoundedBox args={[0.34, 1.0, 0.1]} radius={0.03} position={[0, -1.42, -0.3]} rotation={[-0.12, 0, 0]} material={shell} />
      {/* Base */}
      <RoundedBox args={[1.5, 0.06, 0.85]} radius={0.03} position={[0, -1.94, -0.18]} material={shell} />
    </group>
  );
}

function Rig({ animate }: { animate: boolean }) {
  const group = useRef<THREE.Group>(null);
  const glow = useGlowTexture();
  const { camera, size } = useThree();

  // Layout: monitor sits to the right on wide screens, above the copy on tall ones
  const portrait = size.width < 900;
  const visibleH = 2 * CAM_Z * Math.tan(THREE.MathUtils.degToRad(FOV / 2));
  const visibleW = visibleH * (size.width / size.height);
  const scale = portrait ? Math.min(1, (visibleW * 0.86) / 3.42) : Math.min(1.05, (visibleW * 0.4) / 3.42);
  const base = useMemo(
    () => (portrait ? new THREE.Vector3(0, visibleH * 0.2, 0) : new THREE.Vector3(visibleW * 0.25, 0.2, 0)),
    [portrait, visibleH, visibleW],
  );

  const tmp = useMemo(() => new THREE.Vector3(), []);
  const look = useMemo(() => new THREE.Vector3(), []);

  useFrame((state, dt) => {
    const g = group.current;
    if (!g) return;
    const t = state.clock.elapsedTime;

    // Scroll progress through the pinned hero, eased
    let raw = 0;
    const section = state.gl.domElement.closest('section');
    if (animate && section) {
      const r = section.getBoundingClientRect();
      const travel = r.height - window.innerHeight;
      raw = travel > 0 ? Math.min(1, Math.max(0, -r.top / travel)) : 0;
    }
    const p = raw * raw * (3 - 2 * raw);

    // Pointer follow fades out as the camera flies in
    const follow = animate ? 1 - p : 0;
    const ry = (portrait ? 0 : -0.32) * (1 - p) + state.pointer.x * 0.28 * follow;
    const rx = -state.pointer.y * 0.12 * follow;
    const k = 1 - Math.pow(0.001, dt);
    g.rotation.y += (ry - g.rotation.y) * k;
    g.rotation.x += (rx - g.rotation.x) * k;
    g.position.set(base.x, base.y + (animate ? Math.sin(t * 0.8) * 0.04 * (1 - p) : 0), base.z);

    // Camera: from the wide shot to filling the frame with the screen
    const screenY = base.y + 0.04 * scale;
    // Fill the frame with the screen: by height on wide viewports, by width on tall ones
    const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const aspect = size.width / size.height;
    const fitH = (SCREEN_PLANE_H * scale) / (2 * tan);
    const fitW = (SCREEN_PLANE_W * scale) / (2 * tan * aspect);
    const fillZ = portrait ? fitW * 1.02 : Math.min(fitH, fitW) * 1.02;
    tmp.set(base.x * p, screenY * p, CAM_Z + (fillZ - CAM_Z) * p);
    camera.position.lerp(tmp, k);
    look.set(base.x * p, screenY * p, 0);
    camera.lookAt(look);
  });

  return (
    <>
      <group ref={group} scale={scale}>
        <Monitor animate={animate} />
        {/* Red spill behind the monitor */}
        <mesh position={[0, 0.2, -0.6]} scale={[7, 5.5, 1]}>
          <planeGeometry />
          <meshBasicMaterial map={glow} transparent depthWrite={false} blending={THREE.AdditiveBlending} opacity={0.34} toneMapped={false} />
        </mesh>
        <ContactShadows position={[0, -1.98, 0]} opacity={0.8} scale={7} blur={2.6} far={2.5} color="#000" />
      </group>
      {/* Floor catches the red light */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, base.y - 1.98 * scale - 0.005, 0]}>
        <planeGeometry args={[60, 60]} />
        <meshStandardMaterial color="#09090b" roughness={0.8} metalness={0.25} />
      </mesh>
      <spotLight position={[base.x - 2.5, base.y + 4, -3]} angle={0.7} penumbra={1} intensity={55} color={SIGNAL} distance={14} />
      <pointLight position={[base.x, base.y, 2.4]} intensity={6} color="#ffd6d8" distance={7} />
    </>
  );
}

export default function MonitorScene() {
  const [ready, setReady] = useState(false);
  const [animate, setAnimate] = useState(true);
  const [mobile, setMobile] = useState(false);
  const [inView, setInView] = useState(true);
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setAnimate(!window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    setMobile(window.matchMedia('(max-width: 899px)').matches);
    setReady(true);
  }, []);

  // Stop rendering once the hero has scrolled away
  useEffect(() => {
    if (!host.current) return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { rootMargin: '100px' });
    io.observe(host.current);
    return () => io.disconnect();
  }, [ready]);

  if (!ready) return null;

  return (
    <div ref={host} className="absolute inset-0" aria-hidden="true">
      <Canvas
        frameloop={!inView ? 'never' : animate ? 'always' : 'demand'}
        camera={{ position: [0, 0, CAM_Z], fov: FOV }}
        dpr={mobile ? [1, 1.5] : [1, 2]}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        style={{ pointerEvents: 'none' }}
        // The canvas ignores clicks; pointer position is read from the whole page instead
        eventSource={document.documentElement}
        eventPrefix="client"
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
        }}
      >
        <fog attach="fog" args={['#09090b', 8, 18]} />
        <ambientLight intensity={0.12} />
        <Rig animate={animate} />
        {!mobile && (
          <EffectComposer>
            <Bloom intensity={0.55} luminanceThreshold={0.55} luminanceSmoothing={0.3} mipmapBlur />
          </EffectComposer>
        )}
      </Canvas>
    </div>
  );
}
