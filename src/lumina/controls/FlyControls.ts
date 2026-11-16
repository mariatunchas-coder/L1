import type { PerspectiveCamera } from '../core/Camera';
import { clamp } from '../math/MathUtils';

/**
 * Lumina X – free-fly / walk-through camera for large worlds.
 *
 * W A S D move · Q / E (or Space / C) down / up · Shift sprint · Ctrl slow · drag (or pointer lock after a click)
 * to look · wheel changes the speed. Motion is frame-rate independent with exponential damping, and the camera can't
 * sink below `minHeight`.
 */
export class FlyControls {
  enabled = true;
  /** Cruise speed in m/s. */
  speed = 18;
  sprintMultiplier = 4;
  slowMultiplier = 0.2;
  /** Radians per pixel. */
  lookSpeed = 0.0022;
  /** 1/s – higher = snappier. */
  damping = 9;
  minHeight = 1.2;
  maxHeight = Infinity;
  /** Capture the mouse with the Pointer Lock API on click (drag-look is always available). */
  usePointerLock = false;
  /** Fires on any user input (apps stop cinematic paths here). */
  onInteract: (() => void) | null = null;

  private yaw = 0;
  private pitch = 0;
  private vx = 0;
  private vy = 0;
  private vz = 0;
  private keys = new Set<string>();
  private dragging = false;
  private cleanups: (() => void)[] = [];

  constructor(private camera: PerspectiveCamera, private dom: HTMLElement) {
    dom.style.touchAction = 'none';
    this.syncFromCamera();
    const on = (t: EventTarget, type: string, fn: (e: never) => void, opts?: AddEventListenerOptions) => {
      t.addEventListener(type, fn as EventListener, opts);
      this.cleanups.push(() => t.removeEventListener(type, fn as EventListener));
    };
    on(window, 'keydown', this.keyDown as never);
    on(window, 'keyup', this.keyUp as never);
    on(window, 'blur', (() => this.keys.clear()) as never);
    on(dom, 'pointerdown', this.pointerDown as never);
    on(window, 'pointerup', this.pointerUp as never);
    on(window, 'pointercancel', this.pointerUp as never);
    on(window, 'pointermove', this.pointerMove as never);
    on(dom, 'wheel', this.wheel as never, { passive: false });
    on(dom, 'contextmenu', ((e: Event) => e.preventDefault()) as never);
  }

  /** Re-reads yaw / pitch from the camera (call after placing the camera manually). */
  syncFromCamera(): void {
    const e = this.camera.matrixWorld.elements;
    this.camera.updateMatrixWorld(true);
    // forward = −Z column of the world matrix
    const fx = -e[8],
      fy = -e[9],
      fz = -e[10];
    this.yaw = Math.atan2(-fx, -fz);
    this.pitch = Math.asin(clamp(fy, -1, 1));
    this.vx = this.vy = this.vz = 0;
  }

  /** Looks at a world point. */
  lookAtPoint(x: number, y: number, z: number): void {
    const p = this.camera.position;
    const dx = x - p.x,
      dy = y - p.y,
      dz = z - p.z;
    this.yaw = Math.atan2(-dx, -dz);
    this.pitch = Math.asin(clamp(dy / Math.max(Math.hypot(dx, dy, dz), 1e-6), -1, 1));
    this.apply();
  }

  private isTyping(e: KeyboardEvent): boolean {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  }

  private keyDown = (e: KeyboardEvent) => {
    if (!this.enabled || this.isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.code;
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyC', 'Space', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) {
      this.keys.add(k);
      this.onInteract?.();
      if (k === 'Space' || k.startsWith('Arrow')) e.preventDefault();
    }
  };
  private keyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };
  private pointerDown = (e: PointerEvent) => {
    if (!this.enabled) return;
    this.dragging = true;
    this.onInteract?.();
    if (this.usePointerLock && e.pointerType === 'mouse') this.dom.requestPointerLock?.();
  };
  private pointerUp = () => {
    this.dragging = false;
  };
  private pointerMove = (e: PointerEvent) => {
    if (!this.enabled) return;
    const locked = document.pointerLockElement === this.dom;
    if (!this.dragging && !locked) return;
    this.yaw -= e.movementX * this.lookSpeed;
    this.pitch = clamp(this.pitch - e.movementY * this.lookSpeed, -1.5, 1.5);
  };
  private wheel = (e: WheelEvent) => {
    if (!this.enabled) return;
    e.preventDefault();
    this.speed = clamp(this.speed * Math.exp(-e.deltaY * 0.0012), 1, 400);
    this.onInteract?.();
  };

  private apply(): void {
    const cp = Math.cos(this.pitch);
    const p = this.camera.position;
    this.camera.lookAt(p.x - Math.sin(this.yaw) * cp, p.y + Math.sin(this.pitch), p.z - Math.cos(this.yaw) * cp);
  }

  update(dt: number): void {
    if (!this.enabled) return;
    dt = Math.min(dt, 0.1);
    const k = this.keys;
    const fwd = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const side = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const up = (k.has('KeyE') || k.has('Space') ? 1 : 0) - (k.has('KeyQ') || k.has('KeyC') ? 1 : 0);
    const mul = (k.has('ShiftLeft') || k.has('ShiftRight') ? this.sprintMultiplier : 1) * (k.has('ControlLeft') ? this.slowMultiplier : 1);
    const cp = Math.cos(this.pitch);
    // camera-relative axes: forward follows the pitch (true fly), strafe stays horizontal
    const fx = -Math.sin(this.yaw) * cp,
      fy = Math.sin(this.pitch),
      fz = -Math.cos(this.yaw) * cp;
    const rx = Math.cos(this.yaw),
      rz = -Math.sin(this.yaw);
    const s = this.speed * mul;
    const tx = (fx * fwd + rx * side) * s;
    const ty = (fy * fwd + up) * s;
    const tz = (fz * fwd + rz * side) * s;
    const a = 1 - Math.exp(-this.damping * dt);
    this.vx += (tx - this.vx) * a;
    this.vy += (ty - this.vy) * a;
    this.vz += (tz - this.vz) * a;
    const p = this.camera.position;
    p.x += this.vx * dt;
    p.y = clamp(p.y + this.vy * dt, this.minHeight, this.maxHeight);
    p.z += this.vz * dt;
    this.apply();
  }

  dispose(): void {
    this.cleanups.forEach((c) => c());
    this.cleanups = [];
    if (document.pointerLockElement === this.dom) document.exitPointerLock?.();
  }
}
