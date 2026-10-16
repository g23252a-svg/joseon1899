// 탑다운 카메라. 월드 단위는 미터, zoom 은 '미터당 CSS 픽셀'.
// GTA 처럼 속도가 빠를수록 멀리 본다(speedZoom).

import { clamp, damp, lerp } from './util.js';

export class Camera {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.zoom = 14; // 실제 적용 줌
    this.baseZoom = 14; // 걸을 때 기준
    this.userZoom = 1; // 마우스 휠
    this.minZoom = 2.5;
    this.maxZoom = 30;
    this.viewW = 800; // CSS px
    this.viewH = 600;
    this.dpr = 1;
    this.shakeT = 0;
    this.shakeMag = 0;
    this.ox = 0; // 흔들림 오프셋
    this.oy = 0;
    this.lookAhead = 0.6; // 이동 방향으로 앞을 더 보여주는 초
    this.override = null; // {x,y,zoom} 컷신 등에서 강제 지정
  }

  resize(w, h, dpr) {
    this.viewW = w;
    this.viewH = h;
    this.dpr = dpr;
    // 작은 화면에서는 조금 더 멀리 본다
    const short = Math.min(w, h);
    this.baseZoom = clamp(short / 30, 12, 28);
  }

  /**
   * target: {x, y, vx, vy} 를 따라간다. speed 는 m/s.
   * zoomScale: 탈것이 원하는 추가 배율 (기차 0.5 등). 기본 1.
   */
  follow(target, dt, zoomScale = 1) {
    const speed = Math.hypot(target.vx || 0, target.vy || 0);
    let tx = target.x + (target.vx || 0) * this.lookAhead;
    let ty = target.y + (target.vy || 0) * this.lookAhead;
    // 속도가 빠를수록 줌 아웃: 5m/s → 0.85, 15m/s → 0.6
    const speedFactor = clamp(1 - speed * 0.026, 0.45, 1);
    let tz = this.baseZoom * speedFactor * this.userZoom * zoomScale;
    if (this.override) {
      tx = this.override.x ?? tx;
      ty = this.override.y ?? ty;
      tz = this.override.zoom ?? tz;
    }
    tz = clamp(tz, this.minZoom, this.maxZoom);
    const k = damp(6, dt);
    this.x = lerp(this.x, tx, k);
    this.y = lerp(this.y, ty, k);
    this.zoom = lerp(this.zoom, tz, damp(2.2, dt));

    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const m = this.shakeMag * clamp(this.shakeT * 3, 0, 1);
      this.ox = (Math.random() * 2 - 1) * m;
      this.oy = (Math.random() * 2 - 1) * m;
    } else {
      this.ox = this.oy = 0;
    }
  }

  snap(x, y) {
    this.x = x;
    this.y = y;
  }

  shake(mag = 0.3, time = 0.3) {
    this.shakeMag = Math.max(this.shakeMag * (this.shakeT > 0 ? 1 : 0), mag);
    this.shakeT = Math.max(this.shakeT, time);
  }

  wheel(delta) {
    if (!delta) return;
    this.userZoom = clamp(this.userZoom * (delta > 0 ? 0.88 : 1.136), 0.35, 2.2);
  }

  /** 월드 좌표로 그리도록 ctx 변환 설정 */
  apply(ctx) {
    const s = this.zoom * this.dpr;
    ctx.setTransform(s, 0, 0, s, this.dpr * (this.viewW / 2) - (this.x + this.ox) * s, this.dpr * (this.viewH / 2) - (this.y + this.oy) * s);
  }
  /** 화면(CSS px) 좌표로 그리도록 ctx 변환 설정 */
  applyScreen(ctx) {
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  worldToScreen(wx, wy) {
    return {
      x: (wx - this.x - this.ox) * this.zoom + this.viewW / 2,
      y: (wy - this.y - this.oy) * this.zoom + this.viewH / 2,
    };
  }
  screenToWorld(sx, sy) {
    return {
      x: (sx - this.viewW / 2) / this.zoom + this.x + this.ox,
      y: (sy - this.viewH / 2) / this.zoom + this.y + this.oy,
    };
  }

  /** 화면에 보이는 월드 사각형(+여유) */
  bounds(margin = 4) {
    const hw = this.viewW / 2 / this.zoom + margin;
    const hh = this.viewH / 2 / this.zoom + margin;
    return { x0: this.x - hw, y0: this.y - hh, x1: this.x + hw, y1: this.y + hh };
  }

  visible(x, y, r = 2) {
    const b = this.bounds(r);
    return x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1;
  }
}
