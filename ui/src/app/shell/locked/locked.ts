import { ChangeDetectionStrategy, Component } from '@angular/core';
import { readToken, sessionStore } from '../../core/token';
import { Logo } from '../../shared/logo/logo';

/**
 * Shown without a valid token: the board only opens from the URL that `anvil serve` prints. A
 * tab that has a token the server refuses was opened before the server restarted.
 */
@Component({
  selector: 'anv-locked',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Logo],
  template: `
    <main class="locked">
      <anv-logo />
      @if (expired) {
        <h1 class="display">This tab's key is no longer valid</h1>
        <p>
          The board was restarted and made a new key. Open the link <span class="mono">anvil serve</span> printed in your
          terminal, or run it again.
        </p>
      } @else {
        <h1 class="display">Open the board from its link</h1>
        <p>
          This page needs the private link that <span class="mono">anvil serve</span> printed in your terminal, the one
          that ends in <span class="mono">#token=…</span>. Each start makes a new one.
        </p>
        <p class="hint">Restarted the server? Copy the new link from the terminal.</p>
      }
    </main>
  `,
  styles: `
    .locked {
      max-width: 34rem;
      min-height: 100vh;
      margin: 0 auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 12px;
      color: var(--tx2);
    }

    h1 {
      margin: 0;
      font-size: 24px;
      color: var(--tx);
    }

    p {
      margin: 0;
    }

    .hint {
      color: var(--tx3);
      font-size: 13px;
    }
  `,
})
export class Locked {
  protected readonly expired = readToken(sessionStore()) !== null;
}
