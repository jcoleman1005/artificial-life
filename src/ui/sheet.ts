export type SheetTab = 'stats' | 'trends' | 'organism';

/**
 * The details sheet: on portrait mobile it peeks and drags/taps up;
 * on desktop computer screens it sits below the world canvas as a collapsable
 * landscape dashboard; on landscape mobile phones it acts as an open side panel.
 */
export class BottomSheet {
  private readonly sheet: HTMLElement;
  private readonly header: HTMLElement;
  private readonly peek: HTMLElement;
  private readonly collapseBtn: HTMLElement | null;
  private readonly onChange: () => void;
  private open = false;
  private tab: SheetTab = 'stats';
  private drag: { startY: number; startOffset: number; lastY: number; lastT: number; velocity: number; moved: boolean } | null = null;

  constructor(sheet: HTMLElement, onChange: () => void) {
    this.sheet = sheet;
    this.header = sheet.querySelector('.sheet-header')!;
    this.peek = sheet.querySelector('.sheet-peek')!;
    this.collapseBtn = sheet.querySelector('.btn-collapse-sheet');
    this.onChange = onChange;

    // Check desktop mode: default open on desktop unless user collapsed it
    const isDesktop = !this.isSidePanel() && !this.isFixedSheet();
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('alife-sheet-open') : null;
    if (saved !== null) {
      this.open = saved === '1';
    } else if (isDesktop) {
      this.open = true;
    }

    if (this.open) {
      this.sheet.classList.add('open');
      this.peek.setAttribute('aria-expanded', 'true');
      if (this.collapseBtn) {
        this.collapseBtn.setAttribute('aria-expanded', 'true');
        this.collapseBtn.setAttribute('title', 'Collapse details panel');
      }
    }

    sheet.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.show(btn.dataset.tab as SheetTab);
      });
    });

    if (this.collapseBtn) {
      this.collapseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setOpen(!this.open);
      });
    }

    this.peek.addEventListener('click', (e) => {
      if ((e.target as Element).closest('button')) return;
      this.setOpen(!this.open);
    });

    this.header.addEventListener('pointerdown', (e) => {
      if (this.isSidePanel() || (e.target as Element).closest('button') || !this.isFixedSheet()) return;
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

  /** On landscape phones the sheet is an always-open side panel. */
  public isSidePanel(): boolean {
    return getComputedStyle(document.documentElement).getPropertyValue('--is-side').trim() === '1';
  }

  /** Whether the sheet floats as a fixed overlay (mobile portrait) vs in-flow (desktop). */
  private isFixedSheet(): boolean {
    return getComputedStyle(this.sheet).position === 'fixed';
  }

  /** Whether the tab content can be seen (open, or an always-open side panel). */
  public isContentVisible(): boolean {
    return this.open || this.isSidePanel();
  }

  public isOpen(): boolean {
    return this.open;
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
    if (this.collapseBtn) {
      this.collapseBtn.setAttribute('aria-expanded', String(open));
      this.collapseBtn.setAttribute('title', open ? 'Collapse details panel' : 'Expand details panel');
    }
    try {
      localStorage.setItem('alife-sheet-open', open ? '1' : '0');
    } catch {}
    this.onChange();
  }

  /** Opens the sheet on a tab, or collapses if clicking the already open active tab. */
  public show(tab: SheetTab): void {
    if (this.tab === tab && this.open && !this.isSidePanel()) {
      this.setOpen(false);
      return;
    }
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
