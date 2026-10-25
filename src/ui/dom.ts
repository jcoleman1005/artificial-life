/**
 * Replaces a container's HTML while keeping the open/closed state of its
 * <details> sections. Views re-render many times per second while the
 * simulation runs; without this, a section the user opened snaps shut.
 * State is matched by position, so it is only restored when the structure
 * (number of <details>) is unchanged, and a section whose `data-key` changed
 * (e.g. on switching controller) takes its new default instead.
 */
export function setHTMLPreservingDetails(container: HTMLElement, html: string): void {
  const previous = Array.from(container.querySelectorAll('details'), (d) => ({
    open: d.open,
    key: d.dataset.key,
  }));
  container.innerHTML = html;
  const next = container.querySelectorAll('details');
  if (previous.length === next.length) {
    next.forEach((d, i) => {
      if (previous[i].key === d.dataset.key) d.open = previous[i].open;
    });
  }
}
