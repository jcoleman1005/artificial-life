import type { AncestorNode } from '../sim/lineage';
import type { Organism } from '../sim/types';
import { familyName, givenName } from './names';

/** Formats a diet percentage into a human readable description. */
function dietText(carnivory: number): string {
  if (carnivory < 0.25) return 'Herbivore';
  if (carnivory < 0.5) return 'Mostly plants';
  if (carnivory < 0.75) return 'Mostly meat';
  return 'Carnivore';
}

/** Formats active movement abilities into a string list. */
function abilityText(abilities: { diagonal: boolean | number; squeeze: boolean | number; leap: boolean | number }): string {
  const list = [abilities.diagonal && 'Diagonal', abilities.squeeze && 'Squeeze', abilities.leap && 'Leap'].filter(Boolean);
  return list.length ? list.join(', ') : 'None';
}

/**
 * Renders the interactive Genome Lineage Map HTML for an inspected organism.
 * Shows direct descent from founding ancestors, mating crossovers, and mutation diffs.
 */
export function renderLineageMap(
  currentOrg: Readonly<Organism>,
  ancestry: readonly AncestorNode[],
  nameOf: (id: string) => string | null = () => null
): string {
  const family = familyName(currentOrg.lineage.id);
  const gen = currentOrg.lineage.generation;

  if (ancestry.length <= 1 && gen === 1) {
    return `
      <div class="lineage-empty">
        <div class="lineage-empty-icon">🌱</div>
        <h4>Founding Ancestor</h4>
        <p><strong>${givenName(currentOrg.id)}</strong> is a Gen 1 pioneer with no prior ancestors in this world. Subsequent generations will record mating crossovers and genome mutations here.</p>
      </div>
    `;
  }

  // Group nodes by generation
  const byGen = new Map<number, AncestorNode[]>();
  for (const node of ancestry) {
    const list = byGen.get(node.generation);
    if (list) list.push(node);
    else byGen.set(node.generation, [node]);
  }

  const sortedGens = Array.from(byGen.keys()).sort((a, b) => a - b);

  const levelsHtml = sortedGens
    .map((g) => {
      const nodes = byGen.get(g)!;
      const isCurrentGen = g === gen;

      const nodesHtml = nodes
        .map((n) => {
          const isSelected = n.id === currentOrg.id;
          const name = nameOf(n.id) ?? givenName(n.id);
          const pName = n.parentId ? (nameOf(n.parentId) ?? givenName(n.parentId)) : null;
          const mName = n.mateId ? (nameOf(n.mateId) ?? givenName(n.mateId)) : null;

          const parentText = pName && mName
            ? `Bred from <strong>${pName}</strong> & <strong>${mName}</strong>`
            : pName
            ? `Cloned from <strong>${pName}</strong>`
            : 'Founder ancestor';

          // Crossover details
          let crossoverHtml = '';
          if (n.crossover) {
            const mateGave = n.crossover.mateTraits.length
              ? ` · mate contributed: <em>${n.crossover.mateTraits.join(', ')}</em>`
              : '';
            crossoverHtml = `
              <div class="lineage-crossover-badge">
                <span class="crossover-icon">⚤</span>
                <span>Crossover: <strong>${Math.round(n.crossover.parentShare * 100)}%</strong> parent / <strong>${Math.round(n.crossover.mateShare * 100)}%</strong> mate${mateGave}</span>
              </div>
            `;
          }

          // Mutation badges
          const mutationsHtml = n.mutations
            .map((m) => `<span class="lineage-mutation-chip">${m}</span>`)
            .join('');

          return `
            <div class="lineage-node ${isSelected ? 'selected-node' : ''}" data-ancestor-id="${n.id}">
              <div class="lineage-node-header">
                <span class="lineage-node-orb" style="background: hsl(${n.tag}, 85%, 60%)" aria-hidden="true"></span>
                <div class="lineage-node-title">
                  <strong>${name}</strong>
                  <small>${n.id} · Gen ${n.generation} · t ${n.birthTick}</small>
                </div>
                ${isSelected ? '<span class="tag-chosen">CURRENT</span>' : ''}
              </div>

              <div class="lineage-node-parentage">${parentText}</div>

              ${crossoverHtml}

              ${mutationsHtml ? `<div class="lineage-mutations-row">${mutationsHtml}</div>` : ''}

              <div class="lineage-traits-summary">
                <span title="Body size">⚖️ ${n.traits.size.toFixed(2)}×</span>
                <span title="Diet">🥩 ${dietText(n.traits.carnivory)}</span>
                <span title="Dispersal distance">📍 ${n.traits.dispersal} step</span>
                <span title="Movement abilities">🏃 ${abilityText(n.traits.abilities)}</span>
              </div>
            </div>
          `;
        })
        .join('');

      return `
        <div class="lineage-generation-tier">
          <div class="lineage-tier-label">
            <span>Gen ${g}</span>
            <small>${nodes.length} ${nodes.length === 1 ? 'ancestor' : 'ancestors'}${isCurrentGen ? ' (Inspected)' : ''}</small>
          </div>
          <div class="lineage-tier-nodes">
            ${nodesHtml}
          </div>
        </div>
      `;
    })
    .join('<div class="lineage-tier-connector" aria-hidden="true">↓</div>');

  return `
    <div class="lineage-map-card">
      <div class="lineage-overview-header">
        <div>
          <h4>${family} Lineage</h4>
          <p class="muted">Descent tree of <strong>${givenName(currentOrg.id)}</strong> (${ancestry.length} ancestor nodes across ${sortedGens.length} generations)</p>
        </div>
      </div>
      <div class="lineage-tree-scroll">
        ${levelsHtml}
      </div>
    </div>
  `;
}
