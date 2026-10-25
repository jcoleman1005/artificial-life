export type SheetTab = 'stats' | 'trends' | 'organism';

/**
 * The bottom sheet on a portrait phone: it peeks with the always-visible
 * numbers and drags or taps up to show its tabs. Only the sheet's header
 * takes drags (the body scrolls on its own), so it never fights the world's
 * pan or the page. On wide screens CSS turns it into an always-open side
 * panel and dragging is switched off.
 */
export class BottomSheet {
  private readonly sheet: HTMLElement;
  private readonly header: HTMLElement;
  private readonly peek: HTMLElement;
  private readonly onChange: () => void;
  private open = false;
  private tab: SheetTab = 'stats';
  private drag: { startY: number; startOffset: number; lastY: number; lastT: number; velocity: number; moved: boolean } | null = null;

  constructor(sheet: HTMLElement, onChange: () => void) {
    this.sheet = sheet;
    this.header = sheet.querySelector('.sheet-header')!;
    this.peek = sheet.querySelector('.sheet-peek')!;
    this.onChange = onChange;

    sheet.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => this.show(btn.dataset.tab as SheetTab));
    });

    this.header.addEventListener('pointerdown', (e) => {
      if (this.isSidePanel() || (e.target as Element).closest('button')) return;
      this.drag = { startY: e.clientY, startOffset: this.offset(), lastY: e.clientY, lastT: e.timeStamp, velocity: 0, moved: false };
      this.header.setPointerCapture(e.pointerId);
    });
    this.header.addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (!d) return;
      const dy = e.clientY - d.startY;
      if (!d.moved && Math.abs(dy) < 6) return;
      if (!d.moved) this.sheet.classList.add('dragging');
      d.moved = true;
      const dt = Math.max(1, e.timeStamp - d.lastT);
      d.velocity = 0.7 * d.velocity + 0.3 * ((e.clientY - d.lastY) / dt);
      d.lastY = e.clientY;
      d.lastT = e.timeStamp;
      const offset = Math.max(0, Math.min(this.closedOffset(), d.startOffset + dy));
      this.sheet.style.transform = `translateY(${offset}px)`;
    });
    const end = (e: PointerEvent) => {
      const d = this.drag;
      if (!d) return;
      this.drag = null;
      this.sheet.classList.remove('dragging');
      this.sheet.style.transform = '';
      if (!d.moved) {
        if (e.type === 'pointerup') this.setOpen(!this.open);
        return;
      }
      const offset = d.startOffset + (e.clientY - d.startY);
      // A flick decides; otherwise whichever position is nearer.
      const open = Math.abs(d.velocity) > 0.4 ? d.velocity < 0 : offset < this.closedOffset() / 2;
      this.setOpen(open);
    };
    this.header.addEventListener('pointerup', end);
    this.header.addEventListener('pointercancel', end);
    this.header.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target === this.peek) {
        e.preventDefault();
        this.setOpen(!this.open);
      }
    });
  }

  /** On wide screens the sheet is a side panel that is always open. */
  public isSidePanel(): boolean {
    return getComputedStyle(this.sheet).position !== 'fixed';
  }

  /** Whether the tab content can be seen (open, or a side panel). */
  public isContentVisible(): boolean {
    return this.open || this.isSidePanel();
  }

  public getTab(): SheetTab {
    return this.tab;
  }

  /** Height of the part that shows while peeking (handle and numbers). */
  public peekHeight(): number {
    return this.peek.offsetTop + this.peek.offsetHeight;
  }

  private offset(): number {
    return this.open ? 0 : this.closedOffset();
  }

  private closedOffset(): number {
    return this.sheet.offsetHeight - this.peekHeight() - this.safeBottom();
  }

  private safeBottom(): number {
    return parseFloat(getComputedStyle(this.sheet).getPropertyValue('padding-bottom')) || 0;
  }

  public setOpen(open: boolean): void {
    this.open = open;
    this.sheet.classList.toggle('open', open);
    this.peek.setAttribute('aria-expanded', String(open));
    this.onChange();
  }

  /** Opens the sheet on a tab. */
  public show(tab: SheetTab): void {
    this.tab = tab;
    this.sheet.dataset.tab = tab;
    this.sheet.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => {
      b.classList.toggle('active', b.dataset.tab === tab);
      b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    });
    if (!this.open) this.setOpen(true);
    else this.onChange();
  }
}
