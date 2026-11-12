import { createContext, useCallback, useContext, useEffect, useEffectEvent, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Box, measureElement, useBoxMetrics, useStdin, useStdout, useWindowSize, type DOMElement } from 'ink';
import { createMouseParser, type MouseEvent } from './mouse-events.js';

type Target = { ref: RefObject<DOMElement | null>; click?: () => void; scroll?: (direction: -1 | 1) => void };
type Register = (target: Target) => () => void;
const MouseContext = createContext<Register | null>(null);
export const MOUSE_ON = '\u001b[?1000h\u001b[?1006h';
export const MOUSE_OFF = '\u001b[?1006l\u001b[?1000l';
const isTTY = (stream: NodeJS.ReadableStream | NodeJS.WritableStream) => 'isTTY' in stream && stream.isTTY === true;

/** Must live in an alternate screen, with no Static content above the live region. */
export function MouseProvider({ children }: { children: ReactNode }) {
  const { stdin } = useStdin(); const { stdout } = useStdout();
  const { rows } = useWindowSize();
  const content = useRef<DOMElement>(null);
  const { height } = useBoxMetrics(content);
  const [offset, setOffset] = useState(0);
  const viewportHeight = isTTY(stdout) ? Math.max(1, rows) : undefined;
  const maxOffset = viewportHeight === undefined ? 0 : Math.max(0, height - viewportHeight);
  useEffect(() => { setOffset((previous) => Math.min(previous, maxOffset)); }, [maxOffset]);
  const targets = useRef(new Set<Target>());
  const register = useCallback<Register>((target) => {
    targets.current.add(target);
    return () => { targets.current.delete(target); };
  }, []);
  const route = useEffectEvent((event: MouseEvent) => {
    if (viewportHeight !== undefined && event.y >= viewportHeight) return;
    for (const target of [...targets.current].reverse()) {
      if (!target.ref.current || (event.type === 'click' ? !target.click : !target.scroll)) continue;
      // Measure at event time: wrapping, terminal resize and nested boxes change the coordinates.
      const bounds = measureElement(target.ref.current);
      const top = bounds.y - offset;
      if (event.x < bounds.x || event.y < top || event.x >= bounds.x + bounds.width || event.y >= top + bounds.height) continue;
      if (event.type === 'click') target.click?.(); else target.scroll?.(event.direction);
      return;
    }
    if (event.type === 'scroll') setOffset((previous) => Math.max(0, Math.min(maxOffset, previous + event.direction * 3)));
  });
  useEffect(() => {
    const parse = createMouseParser();
    const canReport = isTTY(stdin) && isTTY(stdout);
    const disable = () => { if (canReport) stdout.write(MOUSE_OFF); };
    if (canReport) stdout.write(MOUSE_ON);
    const onData = (chunk: string | Buffer) => {
      for (const event of parse(String(chunk))) route(event);
    };
    stdin.on('data', onData);
    process.once('exit', disable);
    return () => { stdin.removeListener('data', onData); process.removeListener('exit', disable); disable(); };
  }, [stdin, stdout]);
  return <MouseContext.Provider value={register}>
    <Box flexDirection="column" {...(viewportHeight === undefined ? {} : { height: viewportHeight })} overflow="hidden">
      <Box ref={content} flexDirection="column" flexShrink={0} contentOffsetY={-offset}>{children}</Box>
    </Box>
  </MouseContext.Provider>;
}

export function MouseTarget({ children, onClick, onScroll, disabled = false }: {
  children: ReactNode; onClick?: () => void; onScroll?: (direction: -1 | 1) => void; disabled?: boolean;
}) {
  const ref = useRef<DOMElement>(null);
  const register = useContext(MouseContext);
  const click = useEffectEvent(() => { onClick?.(); });
  const scroll = useEffectEvent((direction: -1 | 1) => { onScroll?.(direction); });
  const clickable = onClick !== undefined; const scrollable = onScroll !== undefined;
  useEffect(() => {
    if (!register || disabled) return;
    return register({ ref, ...(clickable ? { click } : {}), ...(scrollable ? { scroll } : {}) });
  }, [register, disabled, clickable, scrollable]);
  return <Box ref={ref} flexDirection="column" flexShrink={0}
    {...(clickable ? { 'aria-role': 'button' as const, 'aria-state': { disabled } } : {})}>{children}</Box>;
}
