// PagerViewNativeComponent.web.tsx
import * as React from 'react';
import type { ViewProps } from 'react-native';

export type OnPageScrollEventData = { position: number; offset: number };
export type OnPageSelectedEventData = { position: number };
export type OnPageScrollStateChangedEventData = {
  pageScrollState: 'idle' | 'dragging' | 'settling';
};

export interface NativeProps extends ViewProps {
  scrollEnabled?: boolean;
  layoutDirection?: 'ltr' | 'rtl';
  initialPage?: number;
  orientation?: 'horizontal' | 'vertical';
  offscreenPageLimit?: number;
  pageMargin?: number;
  overScrollMode?: 'auto' | 'always' | 'never';
  overdrag?: boolean;
  keyboardDismissMode?: 'none' | 'on-drag';
  onPageScroll?: (e: { nativeEvent: OnPageScrollEventData }) => void;
  onPageSelected?: (e: { nativeEvent: OnPageSelectedEventData }) => void;
  onPageScrollStateChanged?: (e: { nativeEvent: OnPageScrollStateChangedEventData }) => void;
  children?: React.ReactNode;
}

export interface PagerViewHandle {
  setPage: (index: number) => void;
  setPageWithoutAnimation: (index: number) => void;
  setScrollEnabled: (enabled: boolean) => void;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export const PagerView = React.forwardRef<PagerViewHandle, NativeProps>(function PagerViewNativeComponent(props, ref) {
  const {
    scrollEnabled = true,
    layoutDirection = 'ltr',
    initialPage = 0,
    orientation = 'horizontal',
    pageMargin = 0,
    onPageScroll,
    onPageSelected,
    onPageScrollStateChanged,
  } = props;

  const scrollerRef = React.useRef<HTMLDivElement>(null);
  const scrollEnabledRef = React.useRef<boolean>(scrollEnabled);
  const draggingRef = React.useRef<boolean>(false);
  const startRef = React.useRef<{ x: number; sl: number } | null>(null);
  const restoreRef = React.useRef<{ userSelect: string; cursor: string } | null>(null);
  const currentIndexRef = React.useRef<number>(initialPage);
  const settleTimer = React.useRef<number | null>(null);

  const childrenArray = React.Children.toArray(props.children);
  const pageCount = childrenArray.length;

  // Imperative API
  React.useImperativeHandle(ref, () => ({
    setPage(index: number) {
      scrollTo(index, true);
    },
    setPageWithoutAnimation(index: number) {
      scrollTo(index, false);
    },
    setScrollEnabled(enabled: boolean) {
      scrollEnabledRef.current = enabled;
    },
  }));

  // Initial page
  React.useEffect(() => {
    requestAnimationFrame(() => {
      scrollTo(initialPage, false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Helpers
  function getMetrics() {
    const el = scrollerRef.current!;
    const extent = el.clientWidth; // horizontal only
    const step = extent + (pageMargin || 0);
    const raw = Math.abs(el.scrollLeft);
    return { el, extent, step, raw };
  }

  function scrollTo(index: number, animated: boolean) {
    const el = scrollerRef.current;
    if (!el) return;

    const extent = el.clientWidth;
    const step = extent + (pageMargin || 0);
    const i = clamp(index, 0, Math.max(0, pageCount - 1));
    const pos = i * step;

    const left = layoutDirection === 'rtl' ? -pos : pos;
    el.scrollTo({ left, behavior: animated ? 'smooth' : 'auto' });

    if (currentIndexRef.current !== i) {
      currentIndexRef.current = i;
      onPageSelected?.({ nativeEvent: { position: i } });
    }
  }

  function emitState(s: 'idle' | 'dragging' | 'settling') {
    onPageScrollStateChanged?.({ nativeEvent: { pageScrollState: s } });
  }

  function clearSettleTimer() {
    if (settleTimer.current != null) {
      window.clearTimeout(settleTimer.current);
      settleTimer.current = null;
    }
  }
  function startSettleTimer() {
    clearSettleTimer();
    // after wheel/trackpad, snap when idle briefly
    settleTimer.current = window.setTimeout(() => {
      emitState('settling');
      snapToNearest(true);
      emitState('idle');
    }, 120);
  }

  function emitPageScroll() {
    if (!onPageScroll) return;
    const { step, raw } = getMetrics();
    if (!step) return;
    const f = raw / step;
    const position = Math.floor(f);
    const offset = clamp(f - position, 0, 1);
    onPageScroll({ nativeEvent: { position, offset } });
  }

  function snapToNearest(animated: boolean) {
    const { step, raw } = getMetrics();
    if (!step) return;
    const idx = clamp(Math.round(raw / step), 0, Math.max(0, pageCount - 1));
    scrollTo(idx, animated);
  }

  // Scroll from wheel/trackpad or programmatic
  const onScroll: React.UIEventHandler<HTMLDivElement> = () => {
    if (orientation !== 'horizontal') return; // only horizontal logic
    emitPageScroll();
    if (!draggingRef.current) startSettleTimer();
  };

  // --- Minimal horizontal drag-to-scroll with snap on release ---
  const onPointerDown: React.PointerEventHandler<HTMLDivElement> = (e) => {
    if (orientation !== 'horizontal') return;
    if (!scrollEnabledRef.current) return;

    const el = scrollerRef.current;
    if (!el) return;

    draggingRef.current = true;
    emitState('dragging');
    clearSettleTimer();

    restoreRef.current = { userSelect: document.body.style.userSelect, cursor: el.style.cursor };
    document.body.style.userSelect = 'none';
    el.style.cursor = 'grabbing';

    el.setPointerCapture(e.pointerId);
    startRef.current = { x: e.clientX, sl: el.scrollLeft };
  };

  const onPointerMove: React.PointerEventHandler<HTMLDivElement> = (e) => {
    if (orientation !== 'horizontal') return;
    if (!draggingRef.current) return;

    const el = scrollerRef.current;
    const start = startRef.current;
    if (!el || !start) return;

    const dx = e.clientX - start.x;
    const dir = layoutDirection === 'rtl' ? -1 : 1; // natural feel in RTL
    el.scrollLeft = start.sl - dx * dir;

    emitPageScroll();
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (orientation !== 'horizontal') return;
    if (!draggingRef.current) return;

    const el = scrollerRef.current;
    if (el && el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);

    draggingRef.current = false;
    emitState('settling');
    snapToNearest(true); // <-- snap here
    emitState('idle');

    if (restoreRef.current && el) {
      document.body.style.userSelect = restoreRef.current.userSelect;
      el.style.cursor = restoreRef.current.cursor;
      restoreRef.current = null;
    }
    startRef.current = null;
  };

  const onPointerUp: React.PointerEventHandler<HTMLDivElement> = (e) => endDrag(e);
  const onPointerCancel: React.PointerEventHandler<HTMLDivElement> = (e) => endDrag(e);

  // CSS mappings (simple)
  const overscrollBehavior = props.overScrollMode === 'never' ? 'contain' : 'auto';
  const touchAction =
    // Disable horizontal panning hints only when we manage it; otherwise let browser handle
    orientation === 'horizontal' && scrollEnabledRef.current ? 'pan-y' : 'auto';

  return (
    <div
      ref={scrollerRef}
      dir={layoutDirection}
      onScroll={onScroll}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      style={{
        display: 'flex',
        flexDirection: orientation === 'vertical' ? 'column' : 'row',
        overflowX: 'hidden',
        overflowY: 'hidden',
        width: '100%',
        height: '100%',
        overscrollBehavior,
        WebkitOverflowScrolling: 'touch',
        direction: layoutDirection,
        touchAction,
        cursor: orientation === 'horizontal' ? 'grab' : 'default',
        ...(props.style as React.CSSProperties),
      }}>
      {childrenArray.map((child, idx) => (
        <div
          key={(child as any)?.key ?? idx}
          style={{
            flex: '0 0 100%',
            width: '100%',
            height: '100%',
            display: 'flex',
            boxSizing: 'border-box',
            marginRight: orientation !== 'vertical' && props.pageMargin ? props.pageMargin : 0,
            marginBottom: orientation === 'vertical' && props.pageMargin ? props.pageMargin : 0,
          }}
          draggable={false}
          onDragStart={(e) => e.preventDefault()}>
          {child}
        </div>
      ))}
    </div>
  );
});

// Commands facade unchanged
export const Commands = {
  setPage(viewRef: React.RefObject<PagerViewHandle>, index: number) {
    viewRef.current?.setPage(index);
  },
  setPageWithoutAnimation(viewRef: React.RefObject<PagerViewHandle>, index: number) {
    viewRef.current?.setPageWithoutAnimation(index);
  },
  setScrollEnabledImperatively(viewRef: React.RefObject<PagerViewHandle>, enabled: boolean) {
    viewRef.current?.setScrollEnabled(enabled);
  },
};
