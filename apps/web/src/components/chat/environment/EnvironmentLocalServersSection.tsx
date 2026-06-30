// FILE: EnvironmentLocalServersSection.tsx
// Purpose: Environment panel row that opens the shared local-servers menu (see LocalServersMenu).
// Layer: Environment panel section
// Depends on: the shared LocalServersMenu and the Environment row skin.

import {
  LocalServersMenu,
  type LocalServersTriggerState,
  MenuTrigger,
} from "../../LocalServersMenu";
import { GlobeIcon, RefreshCwIcon } from "~/lib/icons";
import {
  ENVIRONMENT_ROW_CLASS_NAME,
  ENVIRONMENT_ROW_ICON_CLASS_NAME,
  EnvironmentRowBody,
  EnvironmentRowChevron,
} from "./EnvironmentRow";

export function EnvironmentLocalServersSection({ enabled }: { enabled: boolean }) {
  const renderTrigger = ({ serverCount, isBusy }: LocalServersTriggerState) => {
    const trailing = (
      <>
        {isBusy ? (
          <RefreshCwIcon className="size-3 animate-spin text-[var(--color-text-foreground-secondary)]" />
        ) : (
          <span className="flex items-center gap-1.5">
            {serverCount > 0 ? (
              <span className="size-1.5 rounded-full bg-success" aria-hidden />
            ) : null}
            <span className="text-[11px] tabular-nums text-[var(--color-text-foreground-secondary)]">
              {serverCount}
            </span>
          </span>
        )}
        <EnvironmentRowChevron />
      </>
    );

    return (
      <MenuTrigger render={<button type="button" className={ENVIRONMENT_ROW_CLASS_NAME} />}>
        <EnvironmentRowBody
          icon={<GlobeIcon className={ENVIRONMENT_ROW_ICON_CLASS_NAME} aria-hidden />}
          label="Local Servers"
          trailing={trailing}
        />
      </MenuTrigger>
    );
  };

  // Keep the scan live while the panel section is expanded so the row badge stays current.
  return (
    <LocalServersMenu enabled={enabled} align="start" side="bottom" renderTrigger={renderTrigger} />
  );
}
