/**
 * How one secondary panel asks another to open: the command palette's
 * "Export image…" opens the Import / Export control on that view, and the
 * timeline's reader indicator opens Map settings at the reader timeline.
 */
export type TransferView = "import" | "geojson" | "image";

/** The parts of Map settings that can be asked for by name. */
export type SettingsSection = "document" | "legend" | "presets" | "basemap" | "view" | "embed" | "timeline";

function channel<T>() {
  const listeners = new Set<(value: T) => void>();
  return {
    emit(value: T): void {
      for (const listener of listeners) listener(value);
    },
    listen(listener: (value: T) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const transfer = channel<TransferView>();
const settings = channel<SettingsSection>();

export const requestTransfer = transfer.emit;
export const onTransferRequest = transfer.listen;

let pendingSection: SettingsSection | null = null;

/**
 * Ask Map settings to unfold a section and bring it into view. Kept until a
 * pane takes it, since the request usually comes before the pane is open.
 */
export function requestSettingsSection(section: SettingsSection): void {
  pendingSection = section;
  settings.emit(section);
}

/** True when a request for this section came before the pane opened; answering it clears it. */
export function takePendingSettingsSection(section: SettingsSection): boolean {
  if (pendingSection !== section) return false;
  pendingSection = null;
  return true;
}

export function onSettingsSectionRequest(listener: (section: SettingsSection) => void): () => void {
  return settings.listen((section) => {
    pendingSection = null;
    listener(section);
  });
}
