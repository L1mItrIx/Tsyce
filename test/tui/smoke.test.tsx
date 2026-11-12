import { useState } from 'react';
import { Text, useInput } from 'ink';
import { render } from 'ink-testing-library';
import { expect, test } from 'vitest';

const tick = () => new Promise((resolve) => setTimeout(resolve, 50));

function Counter() {
  const [count, setCount] = useState(0);
  useInput((_input, key) => {
    if (key.downArrow) setCount((n) => n + 1);
    if (key.return) setCount(100);
  });
  return <Text>count: {count}</Text>;
}

test('Ink renders and lastFrame() reads the output', () => {
  const { lastFrame, unmount } = render(<Text>hello httpi</Text>);
  expect(lastFrame()).toBe('hello httpi');
  unmount();
});

test('stdin.write() drives useInput (arrow down and Enter)', async () => {
  const { lastFrame, stdin, unmount } = render(<Counter />);
  expect(lastFrame()).toBe('count: 0');

  await tick();
  stdin.write('\u001B[B');
  await tick();
  expect(lastFrame()).toBe('count: 1');

  stdin.write('\r');
  await tick();
  expect(lastFrame()).toBe('count: 100');
  unmount();
});
