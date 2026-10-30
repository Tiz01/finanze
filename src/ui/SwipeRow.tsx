import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';

const ACTION_WIDTH = 76;
const AXIS_THRESHOLD = 8;

const TONES = {
  accent: 'bg-accent text-on-accent',
  neutral: 'bg-muted text-surface',
  danger: 'bg-danger text-on-danger',
} as const;

export interface SwipeAction {
  label: string;
  tone: keyof typeof TONES;
  onPress: () => void;
}

interface Gesture {
  x: number;
  y: number;
  startOffset: number;
  axis: 'x' | 'y' | null;
}

// Una sola riga aperta alla volta.
let closeOpenRow: (() => void) | null = null;

export function SwipeRow({
  actions,
  onTap,
  children,
}: {
  actions: SwipeAction[];
  onTap?: () => void;
  children: ReactNode;
}) {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const gesture = useRef<Gesture | null>(null);
  const close = useRef(() => setOffset(0));
  const openWidth = actions.length * ACTION_WIDTH;

  useEffect(() => {
    const current = close.current;
    return () => {
      if (closeOpenRow === current) closeOpenRow = null;
    };
  }, []);

  function onPointerDown(event: PointerEvent) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    gesture.current = { x: event.clientX, y: event.clientY, startOffset: offset, axis: null };
  }

  function onPointerMove(event: PointerEvent) {
    const current = gesture.current;
    if (!current) return;
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    if (current.axis === null) {
      if (Math.abs(dx) < AXIS_THRESHOLD && Math.abs(dy) < AXIS_THRESHOLD) return;
      current.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (current.axis === 'x') {
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
        if (closeOpenRow !== close.current) closeOpenRow?.();
        closeOpenRow = close.current;
      }
    }
    if (current.axis === 'x') {
      setOffset(Math.min(0, Math.max(-openWidth, current.startOffset + dx)));
    }
  }

  function finishDrag() {
    setDragging(false);
    setOffset((value) => (value < -openWidth / 2 ? -openWidth : 0));
  }

  function onPointerUp() {
    const current = gesture.current;
    gesture.current = null;
    if (!current) return;
    if (current.axis === 'x') {
      finishDrag();
    } else if (current.axis === null) {
      if (offset !== 0) setOffset(0);
      else onTap?.();
    }
  }

  function onPointerCancel() {
    const current = gesture.current;
    gesture.current = null;
    if (current?.axis === 'x') finishDrag();
  }

  return (
    <div className="relative overflow-hidden">
      <div
        className={`absolute inset-y-0 right-0 flex ${offset === 0 && !dragging ? 'invisible' : ''}`}
        aria-hidden={offset === 0}
      >
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            tabIndex={offset === 0 ? -1 : 0}
            onClick={() => {
              setOffset(0);
              action.onPress();
            }}
            style={{ width: ACTION_WIDTH }}
            className={`text-sm font-semibold ${TONES[action.tone]}`}
          >
            {action.label}
          </button>
        ))}
      </div>
      <div
        role={onTap ? 'button' : undefined}
        tabIndex={onTap ? 0 : undefined}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onTap?.();
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        style={{ transform: `translateX(${offset}px)` }}
        className={`relative touch-pan-y bg-surface select-none ${dragging ? '' : 'transition-transform duration-150'}`}
      >
        {children}
      </div>
    </div>
  );
}
