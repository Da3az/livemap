import { Link } from "react-router";
import { Icon } from "@/components/icons";
import { useEditorStore } from "@/editor/store";
import { useEditorStrings } from "@/i18n/editor";
import { TransferMenu } from "@/screens/editor/extras";
import { useEditorLayout } from "../shared/layout";
import { HistoryButtons } from "./history-buttons";
import { PublishControl } from "./publish-control";
import { ModeSwitch, SaveControl } from "./save-control";
import { TitleField } from "./title-field";

function Rule() {
  return <span aria-hidden="true" className="h-6 w-px shrink-0 bg-rule" />;
}

/**
 * The bar across the top: the way back, the title and its revision, history,
 * saving, preview and transfer — and, set apart at the end, publishing. The
 * map's direction is set in Map settings and from the command palette.
 * On a tablet the commands move to a second row so the title keeps its room.
 */
export function TopBar() {
  const t = useEditorStrings();
  const { mode } = useEditorLayout();
  const rev = useEditorStore((state) => state.meta.rev);
  const tablet = mode === "tablet";

  const back = (
    <Link to="/maps" className="flex h-10 shrink-0 items-center gap-1 rounded-field px-2 text-sm font-medium text-ink-2 hover:bg-well hover:text-ink">
      <Icon name="chevron" className="rotate-180 rtl:rotate-0" />
      {t.top.back}
    </Link>
  );
  const title = (
    <div className="flex min-w-32 flex-1 flex-col justify-center">
      <TitleField className="h-7 text-xl" />
      <p className="px-1.5 font-title text-xs whitespace-nowrap text-ink-3 tabular-nums italic" title={t.top.revisionHint}>
        {t.top.revision(rev)}
      </p>
    </div>
  );
  const commands = (
    <div className="flex shrink-0 items-center gap-2">
      <SaveControl />
      <ModeSwitch />
      <TransferMenu />
    </div>
  );

  if (tablet) {
    return (
      <header className="shrink-0 border-b border-rule bg-panel">
        <div className="flex h-topbar items-center gap-2 ps-1 pe-3">
          {back}
          <Rule />
          {title}
          <PublishControl compact />
        </div>
        <div className="flex h-12 items-center gap-3 border-t border-rule ps-2 pe-3">
          <HistoryButtons roomy />
          <span className="ms-auto" />
          {commands}
        </div>
      </header>
    );
  }

  return (
    <header className="flex h-topbar shrink-0 items-center gap-2.5 border-b border-rule bg-panel ps-2 pe-3">
      {back}
      <Rule />
      {title}
      <HistoryButtons />
      <Rule />
      {commands}
      <span aria-hidden="true" className="h-8 w-px shrink-0 bg-rule-strong" />
      <PublishControl />
    </header>
  );
}
