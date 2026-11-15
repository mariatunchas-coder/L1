import type { PerspectiveCamera } from '../core/Camera';
import { DEG2RAD, clamp } from '../math/MathUtils';
import { Vector3 } from '../math/Vector3';

/**
 * Orbit / pan / zoom controls with frame-rate independent damping.
 * Left drag = orbit · right drag / shift+drag = pan · wheel / pinch = zoom.
 */
export class OrbitControls {
  enabled = true;
  target = new Vector3();
  minDistance = 0.3;
  maxDistance = 600;
  minPolarAngle = 0.02;
  maxPolarAngle = Math.PI / 2 - 0.02;
  enableDamping = true;
  /** Higher = snappier (1/s). */
  damping = 12;
  rotateSpeed = 1;
  zoomSpeed = 1;
  panSpeed = 1;
  autoRotate = false;
  autoRotateSpeed = 0.15;
  /** The orbit target can't be panned below this world height (default: unrestricted). */
  minTargetY = -Infinity;

  private radius = 10;
  private theta = 0;
  private phi = Math.PI / 3;
  private gRadius = 10;
  private gTheta = 0;
  private gPhi = Math.PI / 3;
  private gTarget = new Vector3();
  private pointers = new Map<number, { x: number; y: number }>();
  private pinchDist = 0;
  private mode: 'none' | 'rotate' | 'pan' = 'none';
  private lastX = 0;
  private lastY = 0;
  private cleanups: (() => void)[] = [];
  /** Fires on user interaction (lets apps pause auto-rotate etc.). */
  onInteract: (() => void) | null = null;

  constructor(private camera: PerspectiveCamera, private dom: HTMLElement) {
    dom.style.touchAction = 'none';
    this.syncFromCamera();
    const on = <K extends keyof HTMLElementEventMap>(t: HTMLElement | Window, type: K | string, fn: (e: never) => void, opts?: AddEventListenerOptions) => {
      t.addEventListener(type, fn as EventListener, opts);
      this.cleanups.push(() => t.removeEventListener(type, fn as EventListener));
    };
    on(dom, 'pointerdown', this.pointerDown as never);
    on(window, 'pointermove', this.pointerMove as never);
    on(window, 'pointerup', this.pointerUp as never);
    on(window, 'pointercancel', this.pointerUp as never);
    on(dom, 'wheel', this.wheel as never, { passive: false });
    on(dom, 'contextmenu', ((e: Event) => e.preventDefault()) as never);
  }

  /** Re-reads the camera transform (call after moving the camera manually). */
  syncFromCamera(): void {
    const o = new Vector3().copy(this.camera.position).sub(this.target);
    this.radius = this.gRadius = Math.max(o.length(), 1e-3);
    this.theta = this.gTheta = Math.atan2(o.x, o.z);
    this.phi = this.gPhi = Math.acos(clamp(o.y / this.radius, -1, 1));
    this.gTarget.copy(this.target);
  }

  setView(target: Vector3, distance: number, azimuthDeg: number, elevationDeg: number): void {
    this.target.copy(target);
    this.gTarget.copy(target);
    this.radius = this.gRadius = distance;
    this.theta = this.gTheta = azimuthDeg * DEG2RAD;
    this.phi = this.gPhi = (90 - elevationDeg) * DEG2RAD;
    this.update(0);
  }

  focusOn(p: Vector3, distance?: number): void {
    this.gTarget.copy(p);
    if (distance) this.gRadius = clamp(distance, this.minDistance, this.maxDistance);
  }

  /** Frames a bounding sphere: moves the target to its centre and picks a distance that fits it in view. */
  frameBounds(center: Vector3, radius: number, azimuthDeg = this.theta / DEG2RAD, elevationDeg = 90 - this.phi / DEG2RAD): void {
    const dist = (radius / Math.sin((Math.min(this.camera.fov, this.camera.fov * this.camera.aspect) * DEG2RAD) / 2)) * 1.1;
    this.minDistance = Math.min(this.minDistance, dist * 0.05);
    this.maxDistance = Math.max(this.maxDistance, dist * 4);
    this.setView(center, dist, azimuthDeg, elevationDeg);
    this.camera.near = Math.max(0.01, dist / 1000);
    this.camera.far = Math.max(this.camera.far, dist * 20);
    this.camera.updateProjectionMatrix();
  }

  private pointerDown = (e: PointerEvent) => {
    if (!this.enabled) return;
    this.dom.setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    if (this.pointers.size === 1) this.mode = e.button === 2 || e.shiftKey || e.button === 1 ? 'pan' : 'rotate';
    else if (this.pointers.size === 2) {
      this.mode = 'pan';
      this.pinchDist = this.pointerDistance();
    }
    this.onInteract?.();
  };
  private pointerMove = (e: PointerEvent) => {
    const p = this.pointers.get(e.pointerId);
    if (!p || !this.enabled) return;
    const h = this.dom.clientHeight || 1;
    if (this.pointers.size === 1) {
      const dx = e.clientX - this.lastX,
        dy = e.clientY - this.lastY;
      if (this.mode === 'rotate') {
        this.gTheta -= ((2 * Math.PI * dx) / h) * this.rotateSpeed;
        this.gPhi = clamp(this.gPhi - ((2 * Math.PI * dy) / h) * this.rotateSpeed, this.minPolarAngle, this.maxPolarAngle);
      } else this.pan(dx, dy);
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    } else if (this.pointers.size === 2) {
      p.x = e.clientX;
      p.y = e.clientY;
      const d = this.pointerDistance();
      if (this.pinchDist > 0) this.gRadius = clamp(this.gRadius * (this.pinchDist / d), this.minDistance, this.maxDistance);
      this.pinchDist = d;
    }
    p.x = e.clientX;
    p.y = e.clientY;
  };
  private pointerUp = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size === 0) this.mode = 'none';
    else if (this.pointers.size === 1) {
      const rem = [...this.pointers.values()][0];
      this.lastX = rem.x;
      this.lastY = rem.y;
      this.mode = 'rotate';
    }
  };
  private wheel = (e: WheelEvent) => {
    if (!this.enabled) return;
    e.preventDefault();
    this.gRadius = clamp(this.gRadius * Math.exp(e.deltaY * 0.0011 * this.zoomSpeed), this.minDistance, this.maxDistance);
    this.onInteract?.();
  };
  private pointerDistance(): number {
    const [a, b] = [...this.pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
  private pan(dx: number, dy: number): void {
    const h = this.dom.clientHeight || 1;
    const k = ((2 * this.gRadius * Math.tan((this.camera.fov * DEG2RAD) / 2)) / h) * this.panSpeed;
    const e = this.camera.matrixWorld.elements;
    const rx = e[0],
      ry = e[1],
      rz = e[2];
    const ux = e[4],
      uy = e[5],
      uz = e[6];
    this.gTarget.x += (-dx * rx + dy * ux) * k;
    this.gTarget.y += (-dx * ry + dy * uy) * k;
    this.gTarget.z += (-dx * rz + dy * uz) * k;
    if (this.gTarget.y < this.minTargetY) this.gTarget.y = this.minTargetY;
  }

  update(dt: number): void {
    if (this.autoRotate && this.mode === 'none') this.gTheta += this.autoRotateSpeed * dt;
    const k = this.enableDamping && dt > 0 ? 1 - Math.exp(-dt * this.damping) : 1;
    this.radius += (this.gRadius - this.radius) * k;
    this.theta += (this.gTheta - this.theta) * k;
    this.phi += (this.gPhi - this.phi) * k;
    this.target.lerp(this.gTarget, k);
    const sp = Math.sin(this.phi) * this.radius;
    this.camera.position.set(this.target.x + sp * Math.sin(this.theta), this.target.y + Math.cos(this.phi) * this.radius, this.target.z + sp * Math.cos(this.theta));
    this.camera.lookAt(this.target);
  }

  dispose(): void {
    this.cleanups.forEach((c) => c());
    this.cleanups = [];
  }
}
