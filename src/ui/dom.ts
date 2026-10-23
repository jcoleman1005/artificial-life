/**
 * Replaces a container's HTML while keeping the open/closed state of its
 * <details> sections. Views re-render many times per second while the
 * simulation runs; without this, a section the user opened snaps shut.
 * State is matched by position, so it is only restored when the structure
 * (number of <details>) is unchanged.
 */
export function setHTMLPreservingDetails(container: HTMLElement, html: string): void {
  const previous = Array.from(container.querySelectorAll('details'), (d) => d.open);
  container.innerHTML = html;
  const next = container.querySelectorAll('details');
  if (previous.length === next.length) {
    next.forEach((d, i) => {
      d.open = previous[i];
    });
  }
}
