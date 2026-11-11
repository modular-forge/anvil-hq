import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Api, WriteError, type FieldChanges, type StatusChange } from '../../core/api';
import type { ItemDetail, ItemSummary, NewItem, Space, WriteResult } from '../../core/models';
import { SpaceStore } from '../../core/space-store';
import { Dialogs, type DialogAnswer, type DialogRequest } from '../../shared/dialogs/dialogs';
import { Notices } from '../../shared/notices/notices';
import { detail, project, space, step, summary } from '../../testing';
import { Celebrations } from '../../shared/celebration/celebration';
import { NO_FILTERS, ProjectBoard, buildColumns, filterChoices, matchesFilters, sortCards } from './project-board';

describe('buildColumns', () => {
  it('puts live items in their column, high priority first, and cancelled only when asked', () => {
    const items = [
      summary('AB-3', { status: 'todo' }),
      summary('AB-1', { status: 'todo' }),
      summary('AB-9', { status: 'todo', priority: 'high' }),
      summary('AB-4', { status: 'cancelled', reason: 'x' }),
      { ...summary('AB-5', { status: 'done', evidence: 'x' }), archived: true },
    ];
    const columns = buildColumns(items, false);
    expect(columns.map((c) => c.status)).toEqual(['backlog', 'todo', 'doing', 'blocked', 'done', 'released']);
    expect(columns[1]?.items.map((i) => i.id)).toEqual(['AB-9', 'AB-1', 'AB-3']);
    expect(columns[4]?.items).toEqual([]);
    expect(buildColumns(items, true).at(-1)?.items.map((i) => i.id)).toEqual(['AB-4']);
  });

  it('sorts low priority after the rest', () => {
    expect(sortCards([summary('AB-1', { priority: 'low' }), summary('AB-2')]).map((i) => i.id)).toEqual(['AB-2', 'AB-1']);
  });
});

describe('filters', () => {
  const items = [
    summary('AB-1', { kind: 'bug', priority: 'high', labels: ['ui', 'forms'] }),
    summary('AB-2', { kind: 'task', labels: ['api'] }),
    { ...summary('AB-3', { kind: 'idea', labels: ['old'] }), archived: true },
  ];

  it('matches kind, label and priority, with "none" for items without a priority', () => {
    expect(items.filter((i) => matchesFilters(i, NO_FILTERS)).length).toBe(3);
    expect(items.filter((i) => matchesFilters(i, { ...NO_FILTERS, kind: 'bug' })).map((i) => i.id)).toEqual(['AB-1']);
    expect(items.filter((i) => matchesFilters(i, { ...NO_FILTERS, label: 'api' })).map((i) => i.id)).toEqual(['AB-2']);
    expect(items.filter((i) => matchesFilters(i, { ...NO_FILTERS, priority: 'none' })).map((i) => i.id)).toEqual(['AB-2', 'AB-3']);
    expect(items.filter((i) => matchesFilters(i, { kind: 'bug', label: 'api', priority: null }))).toEqual([]);
  });

  it('offers the kinds and labels of live items, sorted', () => {
    expect(filterChoices(items)).toEqual({ kinds: ['bug', 'task'], labels: ['api', 'forms', 'ui'] });
  });
});

describe('ProjectBoard', () => {
  let answers: (DialogAnswer | null)[];
  let opened: DialogRequest[];
  let writes: { id: string; change: StatusChange }[];
  let refuse: WriteError | null;
  let hint: string | null;
  let items: ItemSummary[];
  let details: Record<string, ItemDetail>;
  let patches: { id: string; changes: FieldChanges }[];
  let created: NewItem[];
  let returned: ItemDetail | null;
  const spaceSignal = signal<Space | null>(space());

  beforeEach(() => {
    answers = [];
    opened = [];
    writes = [];
    refuse = null;
    hint = null;
    items = [summary('AB-1', { kind: 'feature', status: 'doing' }), summary('AB-2', { parent: 'AB-1', status: 'doing' })];
    details = {};
    patches = [];
    created = [];
    returned = null;
    spaceSignal.set(space());
    TestBed.configureTestingModule({
      providers: [
        ProjectBoard,
        {
          provide: Api,
          useValue: {
            items: () => Promise.resolve(items),
            item: (id: string) => Promise.resolve(details[id] ?? detail(id)),
            history: () => Promise.resolve([]),
            setStatus: (item: { id: string }, change: StatusChange): Promise<WriteResult> => {
              if (refuse) return Promise.reject(refuse);
              writes.push({ id: item.id, change });
              return Promise.resolve({ message: 'ok', hint, commit: null, item: returned });
            },
            setFields: (item: { id: string }, changes: FieldChanges): Promise<WriteResult> => {
              patches.push({ id: item.id, changes });
              return Promise.resolve({ message: 'ok', commit: null, item: null });
            },
            createItem: (item: NewItem) => {
              created.push(item);
              return Promise.resolve({ id: 'AB-9', message: 'ok', commit: null, item: null });
            },
          },
        },
        { provide: SpaceStore, useValue: { space: spaceSignal, projects: signal([project({ id: 'alpha' })]), project: () => null } },
        {
          provide: Dialogs,
          useValue: {
            open: (request: DialogRequest) => {
              opened.push(request);
              return Promise.resolve(answers.shift() ?? null);
            },
            current: signal(null),
          },
        },
      ],
    });
  });

  async function board(): Promise<ProjectBoard> {
    const instance = TestBed.inject(ProjectBoard);
    instance.projectId.set('alpha');
    await instance.load();
    return instance;
  }

  it('moves straight to statuses that need nothing more', async () => {
    const b = await board();
    // AB-2 is in doing on the board: the board's own copy is what moves.
    expect(await b.move(summary('AB-2', { status: 'todo' }), 'todo')).toBe(true);
    expect(writes).toEqual([{ id: 'AB-2', change: { status: 'todo' } }]);
    expect(opened).toEqual([]);
  });

  it('queues quick changes and runs each on the item as it is by then', async () => {
    const b = await board();
    items = [summary('AB-2', { status: 'backlog' })];
    await b.load();
    // The second press comes before the first write is back; it must start from todo, not backlog.
    const first = b.stepBy(summary('AB-2', { status: 'backlog' }), 1);
    items = [{ ...summary('AB-2', { status: 'todo' }), etag: '"AB-2-2"' }];
    const second = b.stepBy(summary('AB-2', { status: 'backlog' }), 1);
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(writes.map((w) => w.change.status)).toEqual(['todo', 'doing']);
  });

  it('asks for a reason before blocking, and does nothing when dismissed', async () => {
    const b = await board();
    expect(await b.move(summary('AB-2'), 'blocked')).toBe(false);
    expect(writes).toEqual([]);
    answers.push({ value: 'Waiting' });
    expect(await b.move(summary('AB-2'), 'blocked')).toBe(true);
    expect(writes).toEqual([{ id: 'AB-2', change: { status: 'blocked', reason: 'Waiting' } }]);
  });

  it('refuses done with unchecked steps or open tasks, and opens the chosen task', async () => {
    const b = await board();
    const selected: (string | null)[] = [];
    b.onSelect = (id) => selected.push(id);
    details['AB-1'] = detail('AB-1', { kind: 'feature' }, [step(1, 'Check it')], [summary('AB-2', { status: 'doing' })]);
    answers.push({ value: 'AB-2' });
    expect(await b.move(items[0] as ItemSummary, 'done')).toBe(false);
    expect(opened[0]).toMatchObject({ kind: 'refused', steps: ['Check it'] });
    expect(selected).toEqual(['AB-2']);
    expect(writes).toEqual([]);
  });

  it('sends evidence for done only when given, and offers to close the parent after the last task', async () => {
    const b = await board();
    hint = 'every task of AB-1 is closed';
    answers.push({ value: '' }, { value: 'close' });
    expect(await b.move(items[1] as ItemSummary, 'done')).toBe(true);
    expect(opened.map((o) => o.kind)).toEqual(['done', 'close-parent']);
    expect(writes).toEqual([
      { id: 'AB-2', change: { status: 'done' } },
      { id: 'AB-1', change: { status: 'done' } },
    ]);
  });

  it('never moves to released, and nothing moves while read-only', async () => {
    const b = await board();
    const notices = TestBed.inject(Notices);
    expect(await b.move(summary('AB-2'), 'released')).toBe(false);
    expect(notices.error()).toContain('publishing a release');
    spaceSignal.set(space({ readOnly: true }));
    expect(await b.move(summary('AB-2'), 'doing')).toBe(false);
    expect(notices.error()).toContain('read-only');
    expect(writes).toEqual([]);
  });

  it('opens the changed-on-disk dialog with the differences on a conflict', async () => {
    const b = await board();
    b.selectedId.set('AB-2');
    await b.loadDetail('AB-2');
    refuse = new WriteError('changed', 409, detail('AB-2', { parent: 'AB-1', status: 'doing', title: 'New title' }));
    expect(await b.move(summary('AB-2'), 'backlog')).toBe(false);
    expect(opened[0]).toEqual({ kind: 'conflict', id: 'AB-2', lines: ['- title: Item AB-2', '+ title: New title', '- status: todo', '+ status: doing', '+ parent: AB-1'] });
  });

  it("shows the server's message when a rule refuses the move", async () => {
    const b = await board();
    refuse = new WriteError('AB-2 cannot be done: 1 unchecked step(s)', 422);
    expect(await b.move(summary('AB-2'), 'todo')).toBe(false);
    expect(TestBed.inject(Notices).error()).toBe('AB-2 cannot be done: 1 unchecked step(s)');
  });

  it('filters the columns, and lists what the filters can choose', async () => {
    const b = await board();
    items = [summary('AB-1', { kind: 'feature', status: 'doing' }), summary('AB-2', { status: 'doing', labels: ['ui'] })];
    await b.load();
    b.filters.set({ ...NO_FILTERS, label: 'ui' });
    expect(b.filtering()).toBe(true);
    expect(b.columns().find((c) => c.status === 'doing')?.items.map((i) => i.id)).toEqual(['AB-2']);
    expect(b.choices()).toEqual({ kinds: ['feature', 'task'], labels: ['ui'] });
  });

  it('saves fields and adds tasks, except while read-only', async () => {
    const b = await board();
    const item = detail('AB-1', { kind: 'feature' });
    expect(await b.setFields(item, { priority: 'high' }, 'Priority set')).toBe(true);
    expect(patches).toEqual([{ id: 'AB-1', changes: { priority: 'high' } }]);
    expect(await b.addTask(item, '  Write the docs ')).toBe(true);
    expect(created).toEqual([{ project: 'alpha', kind: 'task', title: 'Write the docs', parent: 'AB-1' }]);
    spaceSignal.set(space({ readOnly: true }));
    expect(await b.setFields(item, { priority: 'low' }, 'x')).toBe(false);
    expect(await b.addTask(item, 'More')).toBe(false);
    expect(patches.length).toBe(1);
    expect(created.length).toBe(1);
  });

  it('lands the moved card with its new status, and strikes the anvil when a feature is done', async () => {
    const b = await board();
    const played: unknown[] = [];
    vi.spyOn(TestBed.inject(Celebrations), 'play').mockImplementation((c) => void played.push(c));
    returned = detail('AB-2', { status: 'todo' });
    expect(await b.move(items[1] as ItemSummary, 'todo')).toBe(true);
    expect(b.landed()).toEqual({ id: 'AB-2', status: 'todo' });
    expect(played).toEqual([]);

    returned = detail('AB-1', { kind: 'feature', status: 'done' });
    details['AB-1'] = detail('AB-1', { kind: 'feature' });
    answers.push({ value: '' });
    expect(await b.move(items[0] as ItemSummary, 'done')).toBe(true);
    expect(played).toEqual([{ kind: 'forge', label: 'AB-1 forged' }]);
  });
});
