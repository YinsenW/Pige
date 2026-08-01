import type { KnowledgeTreeSearchMatch } from "./knowledge-tree-search-model";
import { PigeIcon } from "./PigeIcon";

export function KnowledgeTreeSearchControl(props: {
  readonly query: string;
  readonly matches: readonly KnowledgeTreeSearchMatch[];
  readonly selectedIndex: number;
  readonly onQueryChange: (query: string) => void;
  readonly onSelectedIndexChange: (index: number) => void;
  readonly onActivate: (match: KnowledgeTreeSearchMatch) => void;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const active = props.matches[props.selectedIndex];
  return (
    <div className="knowledge-toolbar-search-shell">
      <label className="knowledge-toolbar-search">
        <PigeIcon name="search" size={14} />
        <input
          type="search"
          value={props.query}
          placeholder={props.t("knowledgeTree.search")}
          aria-label={props.t("knowledgeTree.search")}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={Boolean(props.query)}
          aria-controls={props.query ? "knowledge-tree-search-results" : undefined}
          aria-activedescendant={active ? `knowledge-tree-search-result-${props.selectedIndex}` : undefined}
          onInput={(event) => props.onQueryChange(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") { event.preventDefault(); props.onQueryChange(""); return; }
            if (!props.query || props.matches.length === 0) return;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const direction = event.key === "ArrowDown" ? 1 : -1;
              props.onSelectedIndexChange((props.selectedIndex + direction + props.matches.length) % props.matches.length);
            } else if (event.key === "Enter") {
              event.preventDefault();
              props.onActivate(active ?? props.matches[0]!);
            }
          }}
        />
      </label>
      {props.query ? props.matches.length === 0 ? (
        <p className="knowledge-tree-search-empty" role="status">{props.t("knowledgeTree.searchNoResults")}</p>
      ) : (
        <div id="knowledge-tree-search-results" className="knowledge-tree-search-results" role="listbox"
          aria-label={props.t("knowledgeTree.searchResults")}>
          {props.matches.map((match, index) => (
            <button id={`knowledge-tree-search-result-${index}`} key={match.id} type="button" role="option"
              aria-selected={index === props.selectedIndex} tabIndex={-1}
              onMouseDown={(event) => event.preventDefault()} onClick={() => props.onActivate(match)}>
              <span className="knowledge-tree-search-title">{match.title}</span>
              <span className="knowledge-tree-search-meta">
                {match.kindLabel}{match.breadcrumb.length > 0 ? ` · ${match.breadcrumb.join(" › ")}` : ""}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
