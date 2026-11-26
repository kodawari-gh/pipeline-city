import * as shopData from './shopdata';

/**
 * The Gallery's spine (SPEC 5.8): one row per category, its opcode tag, its name and its count. The row chosen shows its parts on the shelf beside
 * the card. Keys: Up and Down move between the categories (`Gallery.tsx`). Styles: ui.css (`.gal-spine`, `.gal-row`).
 */
export function GallerySpine({
  groups,
  kind,
  setKind,
}: {
  groups: readonly shopData.GalleryGroup[];
  kind: string;
  setKind: (k: string) => void;
}) {
  return (
    <nav class="gal-spine" aria-label="Part kinds">
      {groups.map((g) => (
        <button
          key={g.key}
          class={`gal-row ${g.kind === kind ? 'on' : ''}`}
          aria-current={g.kind === kind ? 'true' : undefined}
          title={`${shopData.kindLabel(g.kind)} (${g.items.length})`}
          onClick={() => setKind(g.kind)}
        >
          <span class="gal-tag" aria-hidden="true">
            {shopData.railTag(g.kind)}
          </span>
          <span class="gal-name">{shopData.kindLabel(g.kind)}</span>
          <span class="gal-count">{g.items.length}</span>
        </button>
      ))}
    </nav>
  );
}
