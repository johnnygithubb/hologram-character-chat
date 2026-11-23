import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { AgentId, CameoAgentId, CastMode } from '../types/dialogue';
import { dialogueAudio } from '../utils/speech';

const SEEKER_IMAGE_URL = '/src/assets/images/alien_hologram_bust_1795419032468.jpg';
const SKEPTIC_IMAGE_URL =
  '/assets/aistudio/9E20F9BD-E0DF-4F98-B2CE-755E5F4345DF_2_c123370e.PNG';
const BIDEN_IMAGE_URL =
  '/assets/aistudio/D3B29687-E46F-46CD-87DD-5124369AAB5C_2a3049b3.JPG';
const TRUMP_IMAGE_URL =
  '/assets/aistudio/4E880D01-A6EF-4184-BC24-A3BF5F33FF37_be7599f9.JPG';
const TRUMP_ALT_IMAGE_URL =
  '/assets/aistudio/9E84B808-93C5-4B6F-96FE-02898622A602_29be6337.JPG';

interface HologramStageProps {
  castMode: CastMode;
  activeSpeaker: AgentId;
  activeCameo: CameoAgentId | null;
  isSpeaking: boolean;
  isRunning: boolean;
  seekerText: string;
  skepticText: string;
  cameoText: string;
  showDialogue: boolean;
  wakePromptText: string | null;
  isCapturingVoice: boolean;
}

function detectSoftwareWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

const PORTRAIT_VERTEX_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uSpeech;
  uniform float uSeed;

  varying vec2 vUv;
  varying float vDepth;

  void main() {
    vUv = uv;
    vec3 pos = position;

    // Gentle spherical relief so the hologram portrait carries subtle 3D curvature
    vec2 centered = (uv - 0.5) * 2.0;
    float radial = max(0.0, 1.0 - dot(centered, centered) * 0.72);
    pos.z += radial * 0.16;

    // Subtle organic breathing & speech vibration
    float breath = sin(uTime * 1.1 + uSeed) * 0.012;
    pos.z += breath + uSpeech * radial * 0.025 * sin(uTime * 15.0 + uSeed);
    vDepth = radial;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const PORTRAIT_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uTime;
  uniform float uActivity;
  uniform float uSpeech;
  uniform float uGlitch;
  uniform float uFlipX;
  uniform float uSeed;
  uniform float uReady;
  uniform float uMatrixGreen;
  uniform float uMonochrome;
  uniform float uEdgeBottom;
  uniform float uOpacity;

  varying vec2 vUv;
  varying float vDepth;

  float hash11(float p) {
    p = fract(p * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
  }

  void main() {
    if (uReady < 0.5 || uOpacity < 0.01) discard;

    vec2 uv = vUv;
    if (uFlipX > 0.5) {
      uv.x = 1.0 - uv.x;
    }

    // Subtle holographic slice glitch
    float sliceBand = floor(uv.y * 26.0 + uTime * 2.2);
    float sliceRand = hash11(sliceBand + floor(uTime * 16.0) * 11.3 + uSeed);
    float glitchShift = step(0.972 - uGlitch * 0.10, sliceRand) * (sliceRand - 0.5) * 0.04 * (0.3 + uGlitch);
    uv.x = clamp(uv.x + glitchShift, 0.0, 1.0);

    vec4 tex = texture2D(uMap, uv);
    float luma = dot(tex.rgb, vec3(0.299, 0.587, 0.114));
    float signal = max(tex.r, max(tex.g, tex.b));
    float keySignal = mix(signal, luma, uMonochrome);

    // Soft edge fade so the bust melts seamlessly into the pure #000000 void
    float edgeX = smoothstep(0.0, 0.14, vUv.x) * smoothstep(1.0, 0.86, vUv.x);
    float edgeY = smoothstep(0.0, max(0.08, uEdgeBottom), vUv.y) * smoothstep(1.0, 0.88, vUv.y);
    float edgeMask = edgeX * edgeY;

    // Animated scanlines + vertical sweep + speech resonance (high-brightness for black mesh projection)
    float boosted = pow(max(luma, 0.0), 0.72) * 1.48;
    float fineScan = 0.93 + 0.07 * sin(vUv.y * 220.0 - uTime * 3.0 + uSeed);
    float sweep = smoothstep(0.88, 1.0, sin(vUv.y * 5.0 - uTime * 0.95 + uSeed)) * 0.24;
    float speechPulse = 1.0 + uSpeech * (0.18 + 0.14 * sin(uTime * 14.0 + vUv.y * 8.0));
    float flicker = 0.97 + 0.03 * sin(uTime * 13.0 + uSeed);

    float brightness = boosted * fineScan * speechPulse * flicker + boosted * sweep;
    brightness *= mix(0.78, 1.38, uActivity);

    // Key out near-black background pixels cleanly while keeping busts bold and vivid
    float alpha = smoothstep(0.03, 0.15, keySignal) * edgeMask * mix(0.84, 1.0, uActivity) * uOpacity;

    vec3 monoColor = vec3(clamp(brightness, 0.0, 1.0));
    vec3 colorBoosted = pow(max(tex.rgb, vec3(0.0)), vec3(0.82)) * 1.32 * fineScan * speechPulse * flicker + tex.rgb * sweep;
    colorBoosted *= mix(0.76, 1.32, uActivity);
    vec3 baseColor = mix(clamp(colorBoosted, 0.0, 1.0), monoColor, uMonochrome);

    // Bright Matrix green + subtle digital code-rain shimmer when active speaker is talking
    float col = floor(vUv.x * 44.0);
    float colSpeed = 1.4 + hash11(col * 3.1 + uSeed) * 2.1;
    float rainWave = fract(vUv.y * 2.6 + uTime * colSpeed + hash11(col * 7.7 + uSeed));
    float matrixDrop = smoothstep(0.0, 0.28, rainWave) * smoothstep(0.96, 0.36, rainWave);
    float glyphTick = step(0.42, hash11(floor(vUv.y * 52.0 + floor(uTime * colSpeed * 6.0)) + col * 19.3));
    float rainGlow = matrixDrop * (0.35 + 0.65 * glyphTick) * 0.34 * smoothstep(0.06, 0.26, keySignal);

    float mLuma = clamp(brightness * 1.15 + rainGlow, 0.0, 1.25);
    vec3 matrixColor = vec3(mLuma * 0.10, clamp(mLuma * 1.08, 0.0, 1.0), mLuma * 0.20);
    matrixColor += vec3(0.35, 1.0, 0.45) * smoothstep(0.60, 1.15, mLuma) * 0.55;

    vec3 finalColor = mix(baseColor, clamp(matrixColor, 0.0, 1.0), uMatrixGreen);
    gl_FragColor = vec4(finalColor, clamp(alpha, 0.0, 1.0));
  }
`;

const CAMEO_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uTime;
  uniform float uOpacity;
  uniform float uSpeech;
  uniform float uReady;
  uniform float uMatrixGreen;

  varying vec2 vUv;
  varying float vDepth;

  float hash11(float p) {
    p = fract(p * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
  }

  void main() {
    if (uReady < 0.5 || uOpacity < 0.01) discard;

    vec2 uv = vUv;
    float sliceBand = floor(uv.y * 28.0 + uTime * 2.5);
    float sliceRand = hash11(sliceBand + floor(uTime * 15.0) * 9.7);
    float glitchShift = step(0.96, sliceRand) * (sliceRand - 0.5) * 0.03;
    uv.x = clamp(uv.x + glitchShift, 0.0, 1.0);

    vec4 tex = texture2D(uMap, uv);
    float signal = max(tex.r, max(tex.g, tex.b));

    // Soft side/top fade and deeper bottom torso melt for clean waist-up floating hologram
    float edgeX = smoothstep(0.0, 0.16, vUv.x) * smoothstep(1.0, 0.84, vUv.x);
    float edgeY = smoothstep(0.05, 0.34, vUv.y) * smoothstep(1.0, 0.90, vUv.y);
    float edgeMask = edgeX * edgeY;

    float fineScan = 0.92 + 0.08 * sin(vUv.y * 230.0 - uTime * 3.4);
    float sweep = smoothstep(0.88, 1.0, sin(vUv.y * 5.2 - uTime * 1.1)) * 0.18;
    float speechPulse = 1.0 + uSpeech * (0.18 + 0.12 * sin(uTime * 14.0 + vUv.y * 7.0));

    vec3 color = pow(max(tex.rgb, vec3(0.0)), vec3(0.82)) * 1.32 * fineScan * speechPulse;
    color += tex.rgb * sweep;

    float cameoLuma = dot(color, vec3(0.299, 0.587, 0.114));
    float col = floor(vUv.x * 42.0);
    float colSpeed = 1.5 + hash11(col * 4.3) * 2.1;
    float rainWave = fract(vUv.y * 2.5 + uTime * colSpeed + hash11(col * 8.1));
    float matrixDrop = smoothstep(0.0, 0.28, rainWave) * smoothstep(0.96, 0.36, rainWave);
    float glyphTick = step(0.42, hash11(floor(vUv.y * 50.0 + floor(uTime * colSpeed * 6.0)) + col * 17.7));
    float rainGlow = matrixDrop * (0.35 + 0.65 * glyphTick) * 0.30 * smoothstep(0.06, 0.26, signal);

    float mLuma = clamp(cameoLuma * 1.25 + rainGlow, 0.0, 1.25);
    vec3 matrixColor = vec3(mLuma * 0.10, clamp(mLuma * 1.10, 0.0, 1.0), mLuma * 0.20);
    matrixColor += vec3(0.35, 1.0, 0.45) * smoothstep(0.60, 1.15, mLuma) * 0.55;

    vec3 finalColor = mix(color, matrixColor, uMatrixGreen);
    float alpha = smoothstep(0.04, 0.16, signal) * edgeMask * uOpacity;
    gl_FragColor = vec4(clamp(finalColor, 0.0, 1.0), clamp(alpha, 0.0, 1.0));
  }
`;

export function HologramStage({
  castMode,
  activeSpeaker,
  activeCameo,
  isSpeaking,
  isRunning,
  seekerText,
  skepticText,
  cameoText,
  showDialogue,
  wakePromptText,
  isCapturingVoice,
}: HologramStageProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [webglFailed, setWebglFailed] = useState(false);

  const stateRef = useRef({
    castMode,
    activeSpeaker,
    activeCameo,
    isSpeaking,
    isRunning,
    hasSeekerText: Boolean(seekerText),
    hasSkepticText: Boolean(skepticText),
    hasCameoText: Boolean(cameoText),
  });

  useEffect(() => {
    stateRef.current = {
      castMode,
      activeSpeaker,
      activeCameo,
      isSpeaking,
      isRunning,
      hasSeekerText: Boolean(seekerText),
      hasSkepticText: Boolean(skepticText),
      hasCameoText: Boolean(cameoText),
    };
  }, [castMode, activeSpeaker, activeCameo, isSpeaking, isRunning, seekerText, skepticText, cameoText]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const isSoftwareGl = detectSoftwareWebGL();
    let renderer: THREE.WebGLRenderer;

    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        alpha: false,
        powerPreference: 'high-performance',
      });
    } catch {
      setWebglFailed(true);
      return;
    }

    const pixelRatio = isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(pixelRatio);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 1);

    const canvas = renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    container.appendChild(canvas);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    const camera = new THREE.PerspectiveCamera(34, width / Math.max(1, height), 0.1, 40);

    const updateLayout = (w: number, h: number) => {
      const aspect = w / Math.max(1, h);
      camera.aspect = aspect;
      const isNarrow = aspect < 1.1;
      camera.position.set(0, 0, isNarrow ? 9.0 : 6.6);
      camera.lookAt(0, -0.22, 0);
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    };

    const loader = new THREE.TextureLoader();

    let alienTex: THREE.Texture | null = null;
    let socratesTex: THREE.Texture | null = null;

    const makeBustPlane = (flipX: boolean, seed: number) => {
      const geo = new THREE.PlaneGeometry(2.55, 2.88, 48, 48);
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uMap: { value: null },
          uTime: { value: 0 },
          uActivity: { value: 0.6 },
          uSpeech: { value: 0 },
          uGlitch: { value: 0 },
          uFlipX: { value: flipX ? 1.0 : 0.0 },
          uSeed: { value: seed },
          uReady: { value: 0.0 },
          uMatrixGreen: { value: 0.0 },
          uMonochrome: { value: 1.0 },
          uEdgeBottom: { value: 0.14 },
          uOpacity: { value: 1.0 },
        },
        vertexShader: PORTRAIT_VERTEX_SHADER,
        fragmentShader: PORTRAIT_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });

      const mesh = new THREE.Mesh(geo, mat);
      return { mesh, geo, mat };
    };

    // Left bust is the grey alien (or Trump in Trump & Biden mode); right bust is Socrates (or Biden)
    const seekerObj = makeBustPlane(false, 1.7);
    const skepticObj = makeBustPlane(false, 7.3);

    loader.load(SEEKER_IMAGE_URL, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      alienTex = tex;
      if (stateRef.current.castMode === 'duo') {
        seekerObj.mat.uniforms.uMap.value = tex;
        seekerObj.mat.uniforms.uReady.value = 1.0;
      }
    });
    loader.load(SKEPTIC_IMAGE_URL, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      socratesTex = tex;
      if (stateRef.current.castMode === 'duo') {
        skepticObj.mat.uniforms.uMap.value = tex;
        skepticObj.mat.uniforms.uReady.value = 1.0;
      }
    });

    seekerObj.mesh.rotation.y = 0.16;
    skepticObj.mesh.rotation.y = -0.16;

    // Center cameo hologram plane for Trump / Biden 3-minute interruptions
    const cameoGeo = new THREE.PlaneGeometry(2.1, 3.05, 40, 48);
    const cameoMat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: null },
        uTime: { value: 0 },
        uOpacity: { value: 0.0 },
        uSpeech: { value: 0.0 },
        uReady: { value: 0.0 },
        uMatrixGreen: { value: 0.0 },
      },
      vertexShader: PORTRAIT_VERTEX_SHADER,
      fragmentShader: CAMEO_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const cameoMesh = new THREE.Mesh(cameoGeo, cameoMat);
    cameoMesh.position.set(0, 0.2, 0.55);

    let bidenTex: THREE.Texture | null = null;
    let trumpTex: THREE.Texture | null = null;
    let trumpTexAlt: THREE.Texture | null = null;

    loader.load(BIDEN_IMAGE_URL, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      bidenTex = tex;
    });
    loader.load(TRUMP_IMAGE_URL, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      trumpTex = tex;
    });
    loader.load(TRUMP_ALT_IMAGE_URL, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      trumpTexAlt = tex;
    });

    const bustBaseY = { value: 0.22 };
    const cameoBaseScale = { value: 0.74 };

    const positionBusts = (w: number, h: number) => {
      const aspect = w / Math.max(1, h);
      const spread = aspect < 0.8 ? 0.98 : aspect < 1.2 ? 1.34 : 1.62;
      const scale = aspect < 0.8 ? 0.7 : 0.82;
      bustBaseY.value = aspect < 0.8 ? 0.2 : 0.22;
      cameoBaseScale.value = aspect < 0.8 ? 0.6 : 0.74;
      seekerObj.mesh.position.x = -spread;
      skepticObj.mesh.position.x = spread;
      seekerObj.mesh.scale.setScalar(scale);
      skepticObj.mesh.scale.setScalar(scale);
      cameoMesh.scale.setScalar(cameoBaseScale.value);
    };

    scene.add(seekerObj.mesh);
    scene.add(skepticObj.mesh);
    scene.add(cameoMesh);

    // Subtle floating ambient dust motes
    const dustCount = 130;
    const dustPositions = new Float32Array(dustCount * 3);
    const dustPhases = new Float32Array(dustCount);
    for (let i = 0; i < dustCount; i++) {
      dustPositions[i * 3] = (Math.random() - 0.5) * 6.8;
      dustPositions[i * 3 + 1] = (Math.random() - 0.5) * 3.6;
      dustPositions[i * 3 + 2] = (Math.random() - 0.5) * 2.0 - 0.2;
      dustPhases[i] = Math.random();
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
    dustGeo.setAttribute('aPhase', new THREE.BufferAttribute(dustPhases, 1));
    const dustMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: pixelRatio },
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform float uPixelRatio;
        attribute float aPhase;
        varying float vAlpha;
        void main() {
          vec3 p = position;
          p.y += sin(uTime * 0.25 + aPhase * 6.2831) * 0.14;
          p.x += cos(uTime * 0.18 + aPhase * 6.2831) * 0.08;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          vAlpha = 0.08 + 0.14 * (0.5 + 0.5 * sin(uTime * 0.9 + aPhase * 20.0));
          gl_PointSize = 1.6 * uPixelRatio * (4.0 / max(1.0, -mv.z));
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - vec2(0.5));
          if (d > 0.5) discard;
          float soft = smoothstep(0.5, 0.0, d);
          gl_FragColor = vec4(vec3(0.85), vAlpha * soft);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const dustPoints = new THREE.Points(dustGeo, dustMat);
    scene.add(dustPoints);

    updateLayout(width, height);
    positionBusts(width, height);

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    const onContextLost = (e: Event) => {
      e.preventDefault();
      setWebglFailed(true);
    };
    const onContextRestored = () => {
      setWebglFailed(false);
    };
    canvas.addEventListener('webglcontextlost', onContextLost);
    canvas.addEventListener('webglcontextrestored', onContextRestored);

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const w = entry.contentRect.width;
      const h = entry.contentRect.height;
      if (w > 0 && h > 0) {
        updateLayout(w, h);
        positionBusts(w, h);
      }
    });
    resizeObserver.observe(container);

    const clock = new THREE.Clock();
    let seekerActivity = 0.6;
    let skepticActivity = 0.6;
    let sideOpacity = 1.0;
    let seekerSpeech = 0;
    let skepticSpeech = 0;
    let seekerGreen = 0;
    let skepticGreen = 0;
    let cameoOpacity = 0;
    let cameoSpeech = 0;
    let cameoGreen = 0;
    let glitchSeeker = 0;
    let glitchSkeptic = 0;
    let nextGlitchSeeker = 3.2;
    let nextGlitchSkeptic = 5.4;
    let frameId = 0;
    let disposed = false;

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (!gl || typeof gl.fenceSync !== 'function') {
        frameId = window.setTimeout(cb, 80);
        return;
      }
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) return;
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    const tick = () => {
      if (disposed) return;
      const delta = Math.min(clock.getDelta(), 0.1);
      const elapsed = prefersReducedMotion ? 0.0 : clock.getElapsedTime();
      const {
        castMode: mode,
        activeSpeaker: speaker,
        activeCameo: cameo,
        isSpeaking: speaking,
        isRunning: running,
        hasSeekerText,
        hasSkepticText,
        hasCameoText,
      } = stateRef.current;

      const isDuo = mode === 'duo';
      const isSoloTrump = mode === 'trump-only';
      const leftTex = isDuo ? alienTex : trumpTex;
      const rightTex = isDuo ? socratesTex : bidenTex;

      if (leftTex) {
        seekerObj.mat.uniforms.uMap.value = leftTex;
        seekerObj.mat.uniforms.uReady.value = 1.0;
        seekerObj.mat.uniforms.uMonochrome.value = isDuo ? 1.0 : 0.0;
        seekerObj.mat.uniforms.uEdgeBottom.value = isDuo ? 0.14 : 0.34;
      }
      if (rightTex) {
        skepticObj.mat.uniforms.uMap.value = rightTex;
        skepticObj.mat.uniforms.uReady.value = 1.0;
        skepticObj.mat.uniforms.uMonochrome.value = isDuo ? 1.0 : 0.0;
        skepticObj.mat.uniforms.uEdgeBottom.value = isDuo ? 0.14 : 0.34;
      }

      sideOpacity = THREE.MathUtils.damp(sideOpacity, isSoloTrump ? 0.0 : 1.0, 6.5, delta);
      seekerObj.mat.uniforms.uOpacity.value = sideOpacity;
      skepticObj.mat.uniforms.uOpacity.value = sideOpacity;
      seekerObj.mesh.visible = sideOpacity > 0.01;
      skepticObj.mesh.visible = sideOpacity > 0.01;

      const energy = dialogueAudio.getEnergy(speaking);
      const leftActive = !isSoloTrump && (isDuo ? speaker === 'seeker' : speaker === 'trump');
      const rightActive = !isSoloTrump && (isDuo ? speaker === 'skeptic' : speaker === 'biden');

      const seekerIsTalking = running && leftActive && (speaking || hasSeekerText);
      const skepticIsTalking = running && rightActive && (speaking || hasSkepticText);
      const cameoSpeakingActive = isSoloTrump
        ? speaker === 'trump'
        : isDuo && (speaker === 'trump' || speaker === 'biden');
      const cameoIsTalking = running && cameoSpeakingActive && (speaking || hasCameoText);

      const targetSeekerAct = !running
        ? 0.75
        : isDuo && cameo
          ? 0.36
          : leftActive
            ? 1.0
            : 0.48;
      const targetSkepticAct = !running
        ? 0.75
        : isDuo && cameo
          ? 0.36
          : rightActive
            ? 1.0
            : 0.48;

      seekerActivity = THREE.MathUtils.damp(seekerActivity, targetSeekerAct, 5.5, delta);
      skepticActivity = THREE.MathUtils.damp(skepticActivity, targetSkepticAct, 5.5, delta);
      seekerSpeech = THREE.MathUtils.damp(seekerSpeech, leftActive ? energy : 0, 11.0, delta);
      skepticSpeech = THREE.MathUtils.damp(skepticSpeech, rightActive ? energy : 0, 11.0, delta);
      seekerGreen = THREE.MathUtils.damp(seekerGreen, seekerIsTalking ? 1.0 : 0.0, 9.0, delta);
      skepticGreen = THREE.MathUtils.damp(skepticGreen, skepticIsTalking ? 1.0 : 0.0, 9.0, delta);

      const effectiveCameo = isSoloTrump ? 'trump' : isDuo ? cameo : null;
      const useAltTrump = trumpTexAlt && Math.floor(elapsed / 2.8) % 2 === 1;
      const activeTex =
        effectiveCameo === 'trump'
          ? useAltTrump && trumpTexAlt
            ? trumpTexAlt
            : trumpTex
          : effectiveCameo === 'biden'
            ? bidenTex
            : null;
      if (activeTex) {
        cameoMat.uniforms.uMap.value = activeTex;
        cameoMat.uniforms.uReady.value = 1.0;
      }
      const targetCameoOp = effectiveCameo && activeTex ? 1.0 : 0.0;
      cameoOpacity = THREE.MathUtils.damp(cameoOpacity, targetCameoOp, 5.5, delta);
      cameoMesh.scale.setScalar(cameoBaseScale.value * (isSoloTrump ? 1.22 : 1.0));
      cameoSpeech = THREE.MathUtils.damp(
        cameoSpeech,
        cameoSpeakingActive ? energy : 0,
        11.0,
        delta
      );
      cameoGreen = THREE.MathUtils.damp(cameoGreen, cameoIsTalking ? 1.0 : 0.0, 9.0, delta);

      if (elapsed > nextGlitchSeeker) {
        glitchSeeker = 0.45 + Math.random() * 0.55;
        nextGlitchSeeker = elapsed + 3.5 + Math.random() * 6.5;
      }
      if (elapsed > nextGlitchSkeptic) {
        glitchSkeptic = 0.45 + Math.random() * 0.55;
        nextGlitchSkeptic = elapsed + 4.0 + Math.random() * 6.5;
      }
      glitchSeeker = Math.max(0, glitchSeeker - delta * 2.8);
      glitchSkeptic = Math.max(0, glitchSkeptic - delta * 2.8);

      // Subtle idle floating & gentle yaw sway
      seekerObj.mesh.position.y = bustBaseY.value + Math.sin(elapsed * 0.8 + 1.2) * 0.032;
      skepticObj.mesh.position.y = bustBaseY.value + Math.sin(elapsed * 0.8 + 4.4) * 0.032;
      seekerObj.mesh.rotation.y = 0.16 + Math.sin(elapsed * 0.4) * 0.035;
      skepticObj.mesh.rotation.y = -0.16 - Math.sin(elapsed * 0.4 + 1.0) * 0.035;

      cameoMesh.position.y = (isSoloTrump ? 0.22 : 0.28) + Math.sin(elapsed * 0.9 + 2.5) * 0.025;
      cameoMat.uniforms.uTime.value = elapsed;
      cameoMat.uniforms.uOpacity.value = cameoOpacity;
      cameoMat.uniforms.uSpeech.value = cameoSpeech;
      cameoMat.uniforms.uMatrixGreen.value = cameoGreen;

      seekerObj.mat.uniforms.uTime.value = elapsed;
      seekerObj.mat.uniforms.uActivity.value = seekerActivity;
      seekerObj.mat.uniforms.uSpeech.value = seekerSpeech;
      seekerObj.mat.uniforms.uGlitch.value = glitchSeeker;
      seekerObj.mat.uniforms.uMatrixGreen.value = seekerGreen;

      skepticObj.mat.uniforms.uTime.value = elapsed;
      skepticObj.mat.uniforms.uActivity.value = skepticActivity;
      skepticObj.mat.uniforms.uSpeech.value = skepticSpeech;
      skepticObj.mat.uniforms.uGlitch.value = glitchSkeptic;
      skepticObj.mat.uniforms.uMatrixGreen.value = skepticGreen;

      dustMat.uniforms.uTime.value = elapsed;

      renderer.render(scene, camera);

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    };

    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      resizeObserver.disconnect();
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      seekerObj.geo.dispose();
      seekerObj.mat.dispose();
      skepticObj.geo.dispose();
      skepticObj.mat.dispose();
      cameoGeo.dispose();
      cameoMat.dispose();
      alienTex?.dispose();
      socratesTex?.dispose();
      bidenTex?.dispose();
      trumpTex?.dispose();
      dustGeo.dispose();
      dustMat.dispose();
      renderer.dispose();
      if (canvas.parentElement === container) {
        container.removeChild(canvas);
      }
    };
  }, []);

  const leftActive = castMode === 'trump-biden' ? activeSpeaker === 'trump' : activeSpeaker === 'seeker';
  const rightActive = castMode === 'trump-biden' ? activeSpeaker === 'biden' : activeSpeaker === 'skeptic';

  return (
    <div className="relative w-full h-full bg-black overflow-hidden">
      {/* Dedicated WebGL canvas mount */}
      <div ref={containerRef} className="absolute inset-0" aria-hidden="true" />

      {/* Graceful image fallback if WebGL context is unavailable */}
      {webglFailed && (
        <div className="absolute inset-0 flex items-center justify-center pt-20 gap-8 md:gap-24 pointer-events-none px-4">
          {castMode === 'trump-only' ? (
            <img
              src={TRUMP_IMAGE_URL}
              alt="Donald Trump Hologram"
              referrerPolicy="no-referrer"
              className={`w-56 md:w-88 object-contain brightness-125 contrast-125 transition-all duration-300 ${
                isRunning && activeSpeaker === 'trump' && (isSpeaking || cameoText)
                  ? 'opacity-100 sepia saturate-[6] hue-rotate-[75deg] drop-shadow-[0_0_24px_#00ff41]'
                  : 'opacity-85'
              }`}
            />
          ) : (
            <>
              <img
                src={castMode === 'trump-biden' ? TRUMP_IMAGE_URL : SEEKER_IMAGE_URL}
                alt={castMode === 'trump-biden' ? 'Donald Trump Hologram' : 'Seeker Alien Hologram'}
                referrerPolicy="no-referrer"
                className={`w-48 md:w-80 object-contain brightness-125 contrast-125 transition-all duration-300 ${
                  !isRunning
                    ? castMode === 'duo'
                      ? 'grayscale opacity-80'
                      : 'opacity-80'
                    : leftActive && (isSpeaking || seekerText)
                      ? 'opacity-100 sepia saturate-[6] hue-rotate-[75deg] drop-shadow-[0_0_22px_#00ff41]'
                      : castMode === 'duo'
                        ? 'grayscale opacity-45'
                        : 'opacity-45'
                }`}
              />
              {castMode === 'duo' && activeCameo && (
                <img
                  src={activeCameo === 'trump' ? TRUMP_IMAGE_URL : BIDEN_IMAGE_URL}
                  alt={activeCameo === 'trump' ? 'Trump Hologram' : 'Biden Hologram'}
                  referrerPolicy="no-referrer"
                  className={`w-40 md:w-64 object-contain brightness-125 contrast-125 transition-all duration-300 opacity-100 ${
                    (activeSpeaker === 'trump' || activeSpeaker === 'biden') && (isSpeaking || cameoText)
                      ? 'sepia saturate-[6] hue-rotate-[75deg] drop-shadow-[0_0_24px_#00ff41]'
                      : ''
                  }`}
                />
              )}
              <img
                src={castMode === 'trump-biden' ? BIDEN_IMAGE_URL : SKEPTIC_IMAGE_URL}
                alt={castMode === 'trump-biden' ? 'Joe Biden Hologram' : 'Skeptic Hologram'}
                referrerPolicy="no-referrer"
                className={`w-48 md:w-80 object-contain brightness-125 contrast-125 transition-all duration-300 ${
                  !isRunning
                    ? castMode === 'duo'
                      ? 'grayscale opacity-80'
                      : 'opacity-80'
                    : rightActive && (isSpeaking || skepticText)
                      ? 'opacity-100 sepia saturate-[6] hue-rotate-[75deg] drop-shadow-[0_0_22px_#00ff41]'
                      : castMode === 'duo'
                        ? 'grayscale opacity-45'
                        : 'opacity-45'
                }`}
              />
            </>
          )}
        </div>
      )}

      {/* Subtle live Speech-to-Text prompt when wake word "Socrates" is triggered */}
      {(isCapturingVoice || wakePromptText) && (
        <div className="pointer-events-none absolute top-14 inset-x-0 z-20 flex justify-center px-6">
          <p className="holo-letters font-bold text-base md:text-lg tracking-wider text-center max-w-xl">
            {isCapturingVoice
              ? wakePromptText
                ? `> "${wakePromptText}"`
                : '> LISTENING FOR QUESTION...'
              : `> "${wakePromptText}"`}
          </p>
        </div>
      )}

      {/* Floating bold bright 80s computer holographic letters — ALL anchored cleanly at the bottom below the holograms */}
      {showDialogue && (
        <div className="pointer-events-none select-text">
          {/* Left side (Zorblax) — bottom-left */}
          <div
            className={`absolute bottom-[3.5%] md:bottom-[5%] left-5 md:left-12 z-10 max-w-[88vw] md:max-w-[44vw] transition-opacity duration-500 ${
              !seekerText ? 'opacity-0' : 'opacity-100'
            }`}
          >
            {seekerText && (
              <p className="holo-letters font-bold text-lg sm:text-xl md:text-[23px] leading-[1.35] tracking-[0.03em] text-left">
                {seekerText}
              </p>
            )}
          </div>

          {/* Right side (Socrates) — bottom-right */}
          <div
            className={`absolute bottom-[3.5%] md:bottom-[5%] right-5 md:right-12 z-10 max-w-[88vw] md:max-w-[44vw] transition-opacity duration-500 ${
              !skepticText ? 'opacity-0' : 'opacity-100'
            }`}
          >
            {skepticText && (
              <p className="holo-letters font-bold text-lg sm:text-xl md:text-[23px] leading-[1.35] tracking-[0.03em] text-right">
                {skepticText}
              </p>
            )}
          </div>

          {/* Center cameo (Trump or Biden) — bottom-center */}
          <div
            className={`absolute bottom-[3.5%] md:bottom-[5%] inset-x-0 z-20 flex justify-center px-6 transition-opacity duration-500 ${
              !cameoText ? 'opacity-0' : 'opacity-100'
            }`}
          >
            {cameoText && (
              <p className="holo-letters font-bold text-lg sm:text-xl md:text-[23px] leading-[1.35] tracking-[0.03em] text-center max-w-[88vw] md:max-w-[58vw]">
                {cameoText}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
