// 키보드·마우스·터치 입력. 게임 코드는 키 코드가 아니라 '행동(action)' 이름으로 묻는다.
//
//   input.down('sprint')      누르고 있는가
//   input.pressed('enter')    이번 틱에 눌렸는가 (틱마다 한 번만 true)
//   input.consume('enter')    pressed 를 먹어서 다른 시스템이 또 처리하지 않게 함
//   input.axis()              {x, y} 이동 입력 (-1..1, 대각선 정규화)
//   input.mouse               {sx, sy (화면 px), wx, wy (월드 m), down[0..2]}

export const ACTIONS = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  brake: ['Space'], // 말 급정지, 배 노 멈춤, 도보에선 구르기
  crouch: ['KeyC'], // Ctrl 은 쓰지 않는다 (Ctrl+W 로 탭이 닫히는 사고 방지)
  enter: ['KeyF'], // 탈것 타기/내리기/빼앗기
  interact: ['KeyE'], // 대화, 줍기, 가죽 벗기기, 약탈, 상점
  hoan: ['KeyQ'], // 호안(虎眼) 시간 감속 조준
  reload: ['KeyR'],
  weaponWheel: ['Tab'],
  weaponNext: ['Digit2'],
  weaponPrev: ['Digit1'],
  holster: ['KeyX'],
  whistle: ['KeyH'], // 말 부르기
  inventory: ['KeyI'],
  skills: ['KeyK'],
  map: ['KeyM'],
  journal: ['KeyJ'],
  pause: ['Escape', 'KeyP'],
  confirm: ['Enter', 'NumpadEnter'],
  zoomIn: ['Equal', 'NumpadAdd'],
  zoomOut: ['Minus', 'NumpadSubtract'],
  debug: ['Backquote'],
};

// 브라우저 기본 동작을 막을 키
const PREVENT = new Set(['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyF', 'Backquote', 'Enter', 'NumpadEnter']);
// 손가락 탭 뒤에 브라우저가 흉내 내는 마우스 이벤트를 무시할 시간(ms)
const TOUCH_MOUSE_GHOST_MS = 700;

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressedKeys = new Set();
    this.releasedKeys = new Set();
    this.consumed = new Set();
    this.virtual = new Map(); // 터치 버튼 action → bool
    this.virtualPressed = new Set();
    this.virtualAxis = null; // {x,y} 터치 조이스틱
    this.mouse = { sx: 0, sy: 0, wx: 0, wy: 0, down: [false, false, false], pressed: [false, false, false], released: [false, false, false], wheel: 0, inside: false };
    this.enabled = true; // UI 가 텍스트 입력 등을 받을 때 false
    this.lastDevice = 'keyboard';
    this._lastTouch = -1e9;
    this._bind();
  }

  _bind() {
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (PREVENT.has(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressedKeys.add(e.code);
      this.keys.add(e.code);
      this.lastDevice = 'keyboard';
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      this.releasedKeys.add(e.code);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouse.down = [false, false, false];
      this.virtual.clear();
      this.virtualAxis = null;
    });
    // 터치 직후의 흉내 마우스 이벤트 구분용
    window.addEventListener('touchstart', () => (this._lastTouch = performance.now()), { passive: true, capture: true });
    window.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') this._lastTouch = performance.now();
    }, { capture: true });
    const c = this.canvas;
    c.addEventListener('mousemove', (e) => {
      const r = c.getBoundingClientRect();
      this.mouse.sx = e.clientX - r.left;
      this.mouse.sy = e.clientY - r.top;
      this.mouse.inside = true;
    });
    c.addEventListener('mouseleave', () => (this.mouse.inside = false));
    c.addEventListener('mousedown', (e) => {
      if (performance.now() - this._lastTouch < TOUCH_MOUSE_GHOST_MS) return; // 탭이 만든 가짜 클릭
      this.mouse.down[e.button] = true;
      this.mouse.pressed[e.button] = true;
      this.lastDevice = 'keyboard';
      c.focus?.();
    });
    window.addEventListener('mouseup', (e) => {
      if (this.mouse.down[e.button]) this.mouse.released[e.button] = true;
      this.mouse.down[e.button] = false;
    });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.mouse.wheel += Math.sign(e.deltaY);
      },
      { passive: false }
    );
  }

  _codes(action) {
    return ACTIONS[action] || [action];
  }

  down(action) {
    if (!this.enabled) return false;
    if (this.virtual.get(action)) return true;
    for (const k of this._codes(action)) if (this.keys.has(k)) return true;
    return false;
  }

  pressed(action) {
    if (!this.enabled || this.consumed.has(action)) return false;
    if (this.virtualPressed.has(action)) return true;
    for (const k of this._codes(action)) if (this.pressedKeys.has(k)) return true;
    return false;
  }

  released(action) {
    if (!this.enabled) return false;
    for (const k of this._codes(action)) if (this.releasedKeys.has(k)) return true;
    return false;
  }

  /** 이 틱 동안 해당 action 의 pressed 를 다른 곳에서 못 보게 한다 */
  consume(action) {
    this.consumed.add(action);
  }

  axis() {
    if (!this.enabled) return { x: 0, y: 0 };
    if (this.virtualAxis && (this.virtualAxis.x || this.virtualAxis.y)) return { ...this.virtualAxis };
    let x = 0, y = 0;
    if (this.down('left')) x -= 1;
    if (this.down('right')) x += 1;
    if (this.down('up')) y -= 1;
    if (this.down('down')) y += 1;
    if (x && y) {
      x *= Math.SQRT1_2;
      y *= Math.SQRT1_2;
    }
    return { x, y };
  }

  /** 터치 UI 용 */
  setVirtual(action, isDown) {
    const was = !!this.virtual.get(action);
    this.virtual.set(action, isDown);
    if (isDown && !was) this.virtualPressed.add(action);
    this.lastDevice = 'touch';
  }
  setVirtualAxis(x, y) {
    this.virtualAxis = { x, y };
    this.lastDevice = 'touch';
  }

  /** 카메라로 마우스 월드 좌표 갱신 (매 프레임 게임이 호출) */
  updateMouseWorld(camera) {
    const w = camera.screenToWorld(this.mouse.sx, this.mouse.sy);
    this.mouse.wx = w.x;
    this.mouse.wy = w.y;
  }

  mousePressed(btn = 0) {
    if (!this.enabled) return false;
    if (btn === 0 && this.virtualPressed.has('fire')) return true;
    if (btn === 2 && this.virtualPressed.has('aim')) return true;
    return this.mouse.pressed[btn];
  }
  mouseDown(btn = 0) {
    return this.enabled && (this.mouse.down[btn] || (btn === 0 && this.virtual.get('fire')) || (btn === 2 && this.virtual.get('aim')));
  }

  /** 업데이트 틱 하나가 끝날 때 호출: '이번에 눌림' 상태를 비운다 */
  endTick() {
    this.pressedKeys.clear();
    this.releasedKeys.clear();
    this.virtualPressed.clear();
    this.consumed.clear();
    this.mouse.pressed = [false, false, false];
    this.mouse.released = [false, false, false];
  }
  /** 렌더 프레임이 끝날 때 */
  endFrame() {
    this.mouse.wheel = 0;
  }
}
