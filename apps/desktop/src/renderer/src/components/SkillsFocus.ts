export type InstalledLifecycleKind = "disable" | "enable" | "export" | "uninstall" | "update";

export interface PendingInstalledFocus {
  readonly skillId: string | null;
  readonly action?: InstalledLifecycleKind;
}

export function queueInstalledFocus(
  pendingFocusRef: { current: PendingInstalledFocus | undefined },
  skillId?: string,
  action?: InstalledLifecycleKind
): void {
  pendingFocusRef.current = {
    skillId: skillId ?? null,
    ...(action ? { action } : {})
  };
}
