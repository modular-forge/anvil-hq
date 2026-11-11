import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { Block, Inline } from '../../core/item-text';

/**
 * Renders an item body parsed by bodyBlocks: built from data by the template, never from HTML.
 * Headings start at h4, under the page's own headings. Mentions of items are buttons; what they
 * open is up to the parent (`mention`). Links open in a new tab, and only http(s) ones exist.
 */
@Component({
  selector: 'anv-markdown',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet],
  templateUrl: './markdown.html',
  styleUrl: './markdown.scss',
})
export class Markdown {
  readonly blocks = input.required<Block[]>();
  /** False: mentions show as plain ids (where there is nothing to open them in). */
  readonly linkMentions = input(true);
  readonly mention = output<string>();

  /** One inline piece as the template needs it: its kind, its text and, for a link, where to. */
  protected view(part: Inline): { kind: 'text' | 'id' | 'code' | 'strong' | 'em' | 'link'; text: string; href: string } {
    if ('id' in part) return { kind: 'id', text: part.id, href: '' };
    if ('code' in part) return { kind: 'code', text: part.code, href: '' };
    if ('strong' in part) return { kind: 'strong', text: part.strong, href: '' };
    if ('em' in part) return { kind: 'em', text: part.em, href: '' };
    if ('link' in part) return { kind: 'link', text: part.link, href: part.href };
    return { kind: 'text', text: part.text, href: '' };
  }
}
