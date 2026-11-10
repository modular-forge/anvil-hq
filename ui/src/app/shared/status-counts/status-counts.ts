import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

const ORDER = ['doing', 'blocked', 'todo', 'backlog', 'done', 'released', 'cancelled'];

/** Items per status as small labelled chips, in board order; statuses with no items left out. */
@Component({
  selector: 'anv-status-counts',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ul>
      @for (entry of entries(); track entry.status) {
        <li [style.--dot]="'var(--st-' + entry.status + ')'">
          <span class="dot" aria-hidden="true"></span>{{ entry.status }} <b class="mono">{{ entry.count }}</b>
        </li>
      } @empty {
        <li class="none">No items yet</li>
      }
    </ul>
  `,
  styles: `
    ul {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    li {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 10px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: var(--s2);
      color: var(--tx2);
      font-size: 12px;
    }

    b {
      color: var(--tx);
      font-weight: 500;
    }

    .dot {
      width: 8px;
      height: 8px;
      border-radius: 4px;
      background: var(--dot);
    }

    .none {
      border-style: dashed;
      color: var(--tx3);
    }
  `,
})
export class StatusCounts {
  readonly counts = input.required<Partial<Record<string, number>>>();
  protected readonly entries = computed(() =>
    ORDER.map((status) => ({ status, count: this.counts()[status] ?? 0 })).filter((entry) => entry.count > 0),
  );
}
