import { Link } from "react-router";
import { StateBadge } from "@/components/state-badge";
import { useEditorStrings } from "@/i18n/editor";
import { useEditorAccess } from "../shared/access";

/** Says once, plainly, why nothing here can be changed. */
export function ReadOnlyBar() {
  const t = useEditorStrings();
  const access = useEditorAccess();
  if (access.why === null) return null;
  const state = access.why === "archived" ? "archived" : "readonly";
  return (
    <div role="status" className="flex min-h-9 shrink-0 flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-rule bg-well px-4 py-1.5 text-sm text-ink">
      <StateBadge state={state} className="text-sm font-semibold">
        {access.why === "archived" ? t.readOnly.archivedWord : t.readOnly.word}
      </StateBadge>
      <span className="text-ink-2">
        {access.why === "viewer" ? t.readOnly.viewer : access.why === "archived" ? t.readOnly.archived : t.readOnly.notOwner(access.createdByName)}
      </span>
      {access.why === "archived" ? (
        <Link to="/maps?view=archived" className="rounded-key font-medium text-bathy underline decoration-1 underline-offset-2 hover:decoration-2">
          {t.readOnly.openArchive}
        </Link>
      ) : null}
    </div>
  );
}
