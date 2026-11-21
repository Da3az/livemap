import { useVersion } from "@/api/hooks";
import { useTheme } from "@/app/providers";
import { Notice } from "@/components/notice";
import { Button } from "@/components/ui/button";
import { useVersionsStrings } from "@/i18n/versions";
import type { VersionRecord } from "@/model/types";
import { MapViewer } from "@/screens/embed/viewer";
import { When } from "./pointer";

/** One version exactly as a reader got it, beside the table it was picked from. */
export function ViewPane({ mapId, record, live, onClose }: { mapId: string; record: VersionRecord; live: boolean; onClose: () => void }) {
  const t = useVersionsStrings();
  const version = useVersion(mapId, record.version);
  /* A map set to follow the reader's system follows this app's theme here, where there is no reader. */
  const { mode } = useTheme();
  const setting = version.data?.settings.embed.theme ?? "auto";

  return (
    <aside aria-label={t.viewTitle(record.version)} className="flex h-120 shrink-0 flex-col border-b max-md:h-dvh border-rule-strong bg-panel xl:h-auto xl:w-1/3 xl:min-w-96 xl:border-s xl:border-b-0">
      <div className="flex min-h-12 shrink-0 items-center gap-3 border-b border-rule px-4 py-2">
        <div className="min-w-0 flex-1">
          <h2 className="font-title md:truncate text-lg leading-tight font-medium text-ink">{live ? t.viewLive(record.version) : t.viewTitle(record.version)}</h2>
          <p className="text-xs text-ink-3 md:truncate">
            <When iso={record.publishedAt} /> · <span dir="auto">{record.publishedBy.name}</span>
          </p>
        </div>
        <Button variant="outline" className="max-md:h-10 max-md:px-4" onPress={onClose}>
          {t.closeView}
        </Button>
      </div>
      {version.isSuccess ? (
        <MapViewer version={version.data} theme={setting === "auto" ? mode : setting} className="min-h-0 flex-1" />
      ) : version.isError ? (
        <div className="p-4">
          <Notice
            tone="danger"
            title={t.versionFailed}
            action={
              <Button variant="outline" isDisabled={version.isFetching} onPress={() => void version.refetch()}>
                {t.retry}
              </Button>
            }
          >
            {version.error.reason}
          </Notice>
        </div>
      ) : (
        <div aria-busy="true" className="min-h-0 flex-1 bg-well" />
      )}
    </aside>
  );
}
