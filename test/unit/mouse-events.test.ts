import { expect, test } from 'vitest';
import { createMouseParser } from '../../src/tui/mouse-events.js';

test('reads left clicks and wheel events with zero-based terminal coordinates', () => {
  const parse = createMouseParser();
  expect(parse('\u001b[<0;12;5M')).toEqual([{ type: 'click', x: 11, y: 4 }]);
  expect(parse('\u001b[<64;4;3M\u001b[<65;4;3M')).toEqual([
    { type: 'scroll', x: 3, y: 2, direction: -1 }, { type: 'scroll', x: 3, y: 2, direction: 1 },
  ]);
});

test('buffers fragmented sequences and ignores release, right-click, motion and invalid coordinates', () => {
  const parse = createMouseParser();
  expect(parse('typing\u001b[<0;')).toEqual([]);
  expect(parse('7;2M')).toEqual([{ type: 'click', x: 6, y: 1 }]);
  expect(parse('\u001b[<0;7;2m\u001b[<2;7;2M\u001b[<32;7;2M\u001b[<0;0;1M')).toEqual([]);
  expect(parse('garbage\u001b[<0;3;1M')).toEqual([{ type: 'click', x: 2, y: 0 }]);
});

test('pasted escape sequences cannot activate buttons; buffering is bounded and recovers', () => {
  const parse = createMouseParser();
  expect(parse('\u001b[200~\u001b[<0;1;1M')).toEqual([]);
  expect(parse('\u001b[201~\u001b[<0;2;2M')).toEqual([{ type: 'click', x: 1, y: 1 }]);
  expect(parse('\u001b[<' + '9'.repeat(10000))).toEqual([]);
  expect(parse('\u001b[<0;4;4M')).toEqual([{ type: 'click', x: 3, y: 3 }]);
});
