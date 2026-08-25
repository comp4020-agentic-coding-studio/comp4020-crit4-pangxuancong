/**
 * The fluid field: a single fullscreen-quad fragment shader, one draw call,
 * no framebuffer feedback pass. Domain-warped noise for the idle drift; each
 * active point (pointer or ghost) displaces the field and contributes a hue
 * derived from its brightness (plan.md §3 — colour follows the filter axis,
 * not pitch), blended toward a violet flash at high energy.
 */
import { TUNE } from "./tune";
import type { RenderPoint } from "./pointer";

// A technical ceiling on the shader's uniform array, not a perceptual value —
// it stays here rather than in tune.ts.
const MAX_POINTS = 8;

const VERTEX_SRC = `
attribute vec2 aPosition;
varying vec2 vUv;
void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const FRAGMENT_SRC = `
precision highp float;

uniform vec2 uResolution;
uniform float uTime;
uniform float uMotionScale;
uniform float uIdleSpeed;
uniform float uAnalyserEnergy;
uniform float uWellRadius;
uniform float uHueLow;
uniform float uHueHigh;
uniform float uFastHueShift;
uniform int uPointCount;
uniform vec4 uPoints[${MAX_POINTS}]; // x, y (0..1, y-down), brightness (0..1), energy (0..1)

varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

float fbm(vec2 p) {
  float value = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 3; i++) {
    value += amp * valueNoise(p);
    p *= 2.02;
    amp *= 0.55;
  }
  return value;
}

// HSV-with-full-saturation-and-value hue lookup — cheap, and all this field
// needs, since brightness is already folded in separately via the glow term.
vec3 hueToRgb(float hueDegrees) {
  vec3 k = vec3(5.0, 3.0, 1.0);
  vec3 p = abs(mod(k + hueDegrees / 60.0, 6.0) - 3.0);
  return clamp(p - 1.0, 0.0, 1.0);
}

void main() {
  vec2 aspect = vec2(uResolution.x / uResolution.y, 1.0);
  vec2 p = (vUv - 0.5) * aspect;

  float t = uTime * uIdleSpeed * uMotionScale;
  float flowA = fbm(p * 1.6 + vec2(t, -t * 0.7));
  float flowB = fbm(p * 2.4 - vec2(t * 0.8, t));
  float field = flowA * 0.6 + flowB * 0.4;

  float glow = 0.0;
  float hueAcc = 0.0;
  float hueWeight = 0.0;
  float intensity = 0.7 + 0.3 * uMotionScale;

  for (int i = 0; i < ${MAX_POINTS}; i++) {
    if (i >= uPointCount) break;
    vec4 pt = uPoints[i];
    // pt.y is 0 at the top of the screen (CSS convention); flip for GL's y-up.
    vec2 pointPos = (vec2(pt.x, 1.0 - pt.y) - 0.5) * aspect;
    float dist = length(p - pointPos);
    float well = smoothstep(uWellRadius, 0.0, dist) * (0.35 + pt.w * 0.85) * intensity;
    field += well * 0.5;
    glow += well;

    float hue = mix(uHueLow, uHueHigh, pt.z);
    hue = mix(hue, uFastHueShift, clamp(pt.w * 0.5, 0.0, 1.0));
    hueAcc += hue * well;
    hueWeight += well;
  }

  float hue = hueWeight > 0.001 ? hueAcc / hueWeight : mix(uHueLow, uHueHigh, 0.35);
  vec3 tint = hueToRgb(hue);

  vec3 base = vec3(0.03, 0.035, 0.045);
  vec3 lit = mix(base, tint, clamp(glow + field * 0.12, 0.0, 1.0));

  float vignette = smoothstep(1.15, 0.15, length(p));
  vec3 color = lit * (0.4 + glow * 1.5 + uAnalyserEnergy * 0.3) * vignette;

  gl_FragColor = vec4(color, 1.0);
}
`;

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Could not create shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile error: ${info ?? "unknown"}`);
  }
  return shader;
}

interface Uniforms {
  resolution: WebGLUniformLocation | null;
  time: WebGLUniformLocation | null;
  motionScale: WebGLUniformLocation | null;
  idleSpeed: WebGLUniformLocation | null;
  analyserEnergy: WebGLUniformLocation | null;
  wellRadius: WebGLUniformLocation | null;
  hueLow: WebGLUniformLocation | null;
  hueHigh: WebGLUniformLocation | null;
  fastHueShift: WebGLUniformLocation | null;
  pointCount: WebGLUniformLocation | null;
  points: WebGLUniformLocation | null;
}

export class FluidRenderer {
  private readonly gl: WebGLRenderingContext;
  private readonly uniforms: Uniforms;
  private readonly pointsBuffer = new Float32Array(MAX_POINTS * 4);

  constructor(private readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl", { alpha: false, antialias: false });
    if (!gl) throw new Error("WebGL is not available");
    this.gl = gl;

    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SRC);
    const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SRC);
    const program = gl.createProgram();
    if (!program) throw new Error("Could not create program");
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Program link error: ${gl.getProgramInfoLog(program) ?? "unknown"}`);
    }
    gl.useProgram(program);

    // A single fullscreen triangle covers the viewport with no seam, cheaper
    // than a two-triangle quad.
    const quad = new Float32Array([-1, -1, 3, -1, -1, 3]);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    const positionLoc = gl.getAttribLocation(program, "aPosition");
    gl.enableVertexAttribArray(positionLoc);
    gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);

    this.uniforms = {
      resolution: gl.getUniformLocation(program, "uResolution"),
      time: gl.getUniformLocation(program, "uTime"),
      motionScale: gl.getUniformLocation(program, "uMotionScale"),
      idleSpeed: gl.getUniformLocation(program, "uIdleSpeed"),
      analyserEnergy: gl.getUniformLocation(program, "uAnalyserEnergy"),
      wellRadius: gl.getUniformLocation(program, "uWellRadius"),
      hueLow: gl.getUniformLocation(program, "uHueLow"),
      hueHigh: gl.getUniformLocation(program, "uHueHigh"),
      fastHueShift: gl.getUniformLocation(program, "uFastHueShift"),
      pointCount: gl.getUniformLocation(program, "uPointCount"),
      points: gl.getUniformLocation(program, "uPoints"),
    };

    gl.uniform1f(this.uniforms.wellRadius, TUNE.wellRadius);
    gl.uniform1f(this.uniforms.hueLow, TUNE.hueLow);
    gl.uniform1f(this.uniforms.hueHigh, TUNE.hueHigh);
    gl.uniform1f(this.uniforms.fastHueShift, TUNE.fastHueShift);
    gl.uniform1f(this.uniforms.idleSpeed, 1 / TUNE.idleCycleSec);
  }

  resize(cssWidth: number, cssHeight: number, dpr: number): void {
    const width = Math.max(1, Math.round(cssWidth * dpr));
    const height = Math.max(1, Math.round(cssHeight * dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.gl.viewport(0, 0, width, height);
    this.gl.uniform2f(this.uniforms.resolution, width, height);
  }

  draw(timeSec: number, points: RenderPoint[], analyserEnergy: number, reducedMotion: boolean): void {
    const gl = this.gl;
    const count = Math.min(points.length, MAX_POINTS);
    for (let i = 0; i < count; i += 1) {
      const point = points[i];
      if (!point) continue;
      this.pointsBuffer[i * 4 + 0] = point.x;
      this.pointsBuffer[i * 4 + 1] = point.y;
      this.pointsBuffer[i * 4 + 2] = point.brightness;
      this.pointsBuffer[i * 4 + 3] = point.energy;
    }

    gl.uniform1f(this.uniforms.time, timeSec);
    gl.uniform1f(this.uniforms.motionScale, reducedMotion ? TUNE.reducedMotionScale : 1);
    gl.uniform1f(this.uniforms.analyserEnergy, analyserEnergy);
    gl.uniform1i(this.uniforms.pointCount, count);
    gl.uniform4fv(this.uniforms.points, this.pointsBuffer);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
