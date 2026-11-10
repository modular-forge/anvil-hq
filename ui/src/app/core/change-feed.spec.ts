import { parseEvents } from './change-feed';

describe('parseEvents', () => {
  it('reads hello, change and mode events', () => {
    const { events, rest } = parseEvents(
      'event: hello\ndata: {"watching":true}\n\nevent: change\ndata: {"paths":["projects/alpha/items/AL-1.md"]}\n\nevent: mode\ndata: {"watching":false}\n\n',
    );
    expect(events).toEqual([
      { type: 'hello', watching: true },
      { type: 'change', paths: ['projects/alpha/items/AL-1.md'] },
      { type: 'mode', watching: false },
    ]);
    expect(rest).toBe('');
  });

  it('keeps an unfinished event for the next chunk', () => {
    const first = parseEvents('event: change\ndata: {"pa');
    expect(first.events).toEqual([]);
    const second = parseEvents(`${first.rest}ths":[]}\n\n`);
    expect(second.events).toEqual([{ type: 'change', paths: [] }]);
  });

  it('accepts CRLF line endings', () => {
    expect(parseEvents('event: hello\r\ndata: {"watching":false}\r\n\r\n').events).toEqual([{ type: 'hello', watching: false }]);
  });

  it('skips comments, unknown events and malformed data', () => {
    const { events } = parseEvents(
      ': ping\n\nevent: other\ndata: {}\n\nevent: change\ndata: not json\n\nevent: hello\ndata: {"watching":"yes"}\n\nevent: change\ndata: {"paths":["a",3]}\n\n',
    );
    expect(events).toEqual([{ type: 'change', paths: ['a'] }]);
  });
});
