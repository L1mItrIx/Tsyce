import { z } from 'zod';

const point = { x: z.number().int().nonnegative(), y: z.number().int().nonnegative() };
const mouseEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('click'), ...point }),
  z.object({ type: z.literal('scroll'), ...point, direction: z.union([z.literal(-1), z.literal(1)]) }),
]);
export type MouseEvent = z.infer<typeof mouseEventSchema>;

/** SGR terminal mouse events. Coordinates are converted from 1-based cells to layout coordinates. */
export function createMouseParser(): (chunk: string) => MouseEvent[] {
  let pending = '';
  let pasting = false;
  return (chunk) => {
    pending += chunk;
    const events: MouseEvent[] = [];
    while (pending !== '') {
      const start = pending.indexOf('\u001b[');
      if (start < 0) { pending = pending.endsWith('\u001b') ? '\u001b' : ''; break; }
      pending = pending.slice(start);
      if (pending.startsWith('\u001b[200~') || pending.startsWith('\u001b[201~')) {
        pasting = pending.startsWith('\u001b[200~');
        pending = pending.slice(6);
        continue;
      }
      const match = /^\u001b\[<(\d{1,6});(\d{1,6});(\d{1,6})([Mm])/.exec(pending);
      if (match) {
        const button = Number(match[1]); const x = Number(match[2]) - 1; const y = Number(match[3]) - 1;
        if (!pasting && match[4] === 'M' && x >= 0 && y >= 0) {
          if (button === 0) events.push({ type: 'click', x, y });
          if (button === 64 || button === 65) events.push({ type: 'scroll', x, y, direction: button === 64 ? -1 : 1 });
        }
        pending = pending.slice(match[0].length);
      } else if (pending.length <= 64 && /^\u001b\[(?:<[\d;]*|2(?:0[01]?)?)?$/.test(pending)) break;
      else pending = pending.slice(2);
    }
    return events;
  };
}
