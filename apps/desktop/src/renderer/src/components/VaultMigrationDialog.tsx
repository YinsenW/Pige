import { useEffect, useRef } from "react";
import type { VaultMigrationPreview } from "@pige/contracts";

export interface VaultMigrationDialogProps {
  readonly preview: VaultMigrationPreview;
  readonly applying: boolean;
  readonly failed: boolean;
  readonly onApply: () => void;
  readonly onCancel: () => void;
  readonly t: (key: string) => string;
}

export function VaultMigrationDialog(props: VaultMigrationDialogProps): React.JSX.Element {
  const dialogRef = useRef<HTMLElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <div className="confirmation-backdrop">
      <section
        ref={dialogRef}
        className="confirmation-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="vault-migration-title"
        aria-describedby="vault-migration-description"
        aria-busy={props.applying}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !props.applying) {
            event.preventDefault();
            props.onCancel();
            return;
          }
          if (event.key !== "Tab") return;
          const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
          if (controls.length === 0) return event.preventDefault();
          const first = controls[0]!;
          const last = controls.at(-1)!;
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <div className="confirmation-icon" aria-hidden="true">!</div>
        <div className="confirmation-copy">
          <h2 id="vault-migration-title">{props.t("vaultMigration.title")}</h2>
          <p id="vault-migration-description">{props.t("vaultMigration.description")}</p>
        </div>
        <dl className="confirmation-summary">
          <div><dt>{props.t("vaultMigration.version")}</dt><dd>v{props.preview.fromVersion} → v{props.preview.toVersion}</dd></div>
          {props.preview.affectedDomains.map((entry) => (
            <div key={entry.domain}>
              <dt>{props.t(`vaultMigration.domain.${entry.domain}`)}</dt>
              <dd>{entry.count}</dd>
            </div>
          ))}
        </dl>
        <p>{props.t("vaultMigration.backupNotice")}</p>
        {props.failed ? <p className="error" role="alert">{props.t("vaultMigration.failed")}</p> : null}
        <div className="confirmation-actions">
          <button ref={cancelRef} type="button" className="secondary" disabled={props.applying} onClick={props.onCancel}>
            {props.t("vaultMigration.cancel")}
          </button>
          <button type="button" className="primary" disabled={props.applying} onClick={props.onApply}>
            {props.t(props.applying ? "vaultMigration.applying" : "vaultMigration.apply")}
          </button>
        </div>
      </section>
    </div>
  );
}
