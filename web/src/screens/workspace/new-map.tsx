import { type FormEvent, type KeyboardEvent, type ReactNode, type RefObject, useEffect, useId, useState } from "react";
import { Radio, RadioGroup } from "react-aria-components";
import { useNavigate } from "react-router";
import type { ApiError } from "@/api/client";
import { useCreateMap, useTemplates } from "@/api/hooks";
import { Notice } from "@/components/notice";
import { formatClock, useCountdown } from "@/components/time";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useShellStrings } from "@/i18n/shell";
import type { TemplateSummary } from "@/model/types";
import { type Dir, firstStrongDir } from "./model";

type DirChoice = "auto" | Dir;
const DIR_CHOICES: DirChoice[] = ["auto", "ltr", "rtl"];

function isDirChoice(value: unknown): value is DirChoice {
  return DIR_CHOICES.some((choice) => choice === value);
}

const TOUCH_BUTTON = "max-md:h-10 max-md:px-4 max-md:text-base";

function CreateRefusal({ error, waiting }: { error: ApiError; waiting: number }) {
  const t = useShellStrings();
  switch (error.code) {
    case "quota_exceeded":
      return (
        <Notice tone="danger" title={t.ws.createQuotaTitle}>
          {error.reason}
        </Notice>
      );
    case "rate_limited":
      return (
        <Notice tone="warning" title={t.ws.createRateTitle}>
          <span className="tabular-nums">{waiting > 0 ? t.ws.createRateBody(formatClock(waiting)) : t.ws.createRateReady}</span>
        </Notice>
      );
    case "forbidden":
      return (
        <Notice tone="danger" title={t.ws.createForbiddenTitle}>
          {error.reason}
        </Notice>
      );
    case "network":
      return (
        <Notice tone="danger" title={t.ws.createNetworkTitle}>
          {t.ws.createNetworkBody}
        </Notice>
      );
    default:
      return (
        <Notice tone="danger" title={t.ws.createOtherTitle}>
          {error.reason}
        </Notice>
      );
  }
}

function TemplateRows({ templates, value, onChange }: { templates: TemplateSummary[]; value: TemplateSummary["id"]; onChange: (id: string) => void }) {
  const t = useShellStrings();
  return (
    <RadioGroup aria-label={t.ws.newStart} value={value} onChange={onChange} className="flex flex-col border-t border-rule">
      {templates.map((template) => (
        <Radio
          key={template.id}
          value={template.id}
          className="group flex cursor-default items-start gap-3 border-b border-rule px-2 py-2 -outline-offset-2 transition-colors duration-100 data-focus-visible:outline-2 data-focus-visible:outline-focus data-hovered:bg-panel data-selected:bg-panel"
        >
          <span
            aria-hidden="true"
            className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-pill border border-rule-strong bg-panel group-data-selected:border-survey"
          >
            <span className="size-2 rounded-pill group-data-selected:bg-survey" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-semibold text-ink">{template.title}</span>
              {template.id !== "blank" ? (
                <span className="shrink-0 text-2xs text-ink-3">{t.ws.presets(template.uiDir === "rtl" ? t.ws.rtl : t.ws.ltr)}</span>
              ) : null}
            </span>
            <span className="mt-0.5 block text-xs text-ink-2">{template.description}</span>
          </span>
        </Radio>
      ))}
    </RadioGroup>
  );
}

/**
 * Starting a map, in place: above the table when asked for, or where the
 * rows would be when the workspace is empty. Whatever the server refuses is
 * shown here, beside the form, with what was typed kept.
 */
export function NewMapPanel({
  embedded,
  lead,
  titleRef,
  onCancel,
}: {
  /** Inside the empty table: no heading, no cancel, nothing to close. */
  embedded: boolean;
  lead?: ReactNode;
  titleRef: RefObject<HTMLInputElement | null>;
  onCancel?: () => void;
}) {
  const t = useShellStrings();
  const navigate = useNavigate();
  const templates = useTemplates();
  const create = useCreateMap();
  const [templateId, setTemplateId] = useState<TemplateSummary["id"]>("blank");
  const [title, setTitle] = useState("");
  const [dirChoice, setDirChoice] = useState<DirChoice>("auto");
  const [waitUntil, setWaitUntil] = useState<number | null>(null);
  const waiting = useCountdown(waitUntil);
  const titleId = useId();
  const hintId = useId();
  const headingId = useId();

  useEffect(() => {
    if (!embedded) titleRef.current?.focus();
  }, [embedded, titleRef]);

  const template = templates.data?.find((candidate) => candidate.id === templateId);
  const fromTitle = firstStrongDir(title);
  const dir: Dir = dirChoice !== "auto" ? dirChoice : (fromTitle ?? template?.uiDir ?? "ltr");
  const dirName = dir === "rtl" ? t.ws.rtlFull : t.ws.ltrFull;
  const dirWhy = dirChoice !== "auto" ? t.ws.dirManual(dirName) : fromTitle ? t.ws.dirFromTitle(dirName) : t.ws.dirFromTemplate(dirName);

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (create.isPending || waiting > 0) return;
    setWaitUntil(null);
    create.mutate(
      { title: { value: title.trim(), dir }, uiDir: dir, template: templateId },
      {
        onSuccess: (map) => void navigate(`/maps/${map.id}`),
        onError: (error) => {
          if (error.retryAfter !== null) setWaitUntil(Date.now() + error.retryAfter * 1000);
        },
      },
    );
  };

  const onKeyDown = (event: KeyboardEvent<HTMLFormElement>): void => {
    if (event.key === "Escape" && onCancel) {
      event.stopPropagation();
      onCancel();
    }
  };

  return (
    <form
      onSubmit={submit}
      onKeyDown={onKeyDown}
      noValidate
      aria-labelledby={headingId}
      className={embedded ? "px-4 py-5 md:px-5" : "border-b border-rule-strong bg-well px-4 py-4 md:px-5"}
    >
      <div className="flex items-baseline justify-between gap-4">
        <h2 id={headingId} className={embedded ? "text-base text-ink-2" : "font-title text-lg font-medium text-ink"}>
          {embedded ? lead : t.ws.newHeading}
        </h2>
      </div>

      <div className="mt-3 grid max-w-6xl gap-x-10 gap-y-5 @4xl:grid-cols-12">
        <div className="@4xl:col-span-7">
          <p className="mb-1.5 text-xs font-semibold text-plum">{t.ws.newStart}</p>
          {templates.isPending ? (
            <div aria-busy="true" className="flex flex-col border-t border-rule">
              <span className="sr-only" role="status">
                {t.ws.templatesLoading}
              </span>
              {["w-24", "w-36", "w-28", "w-40"].map((width) => (
                <div key={width} aria-hidden="true" className="flex flex-col gap-2 border-b border-rule px-2 py-2.5">
                  <span className={`h-3 rounded-key bg-rule ${width}`} />
                  <span className="h-2.5 w-4/5 rounded-key bg-rule" />
                </div>
              ))}
            </div>
          ) : templates.isError ? (
            <Notice
              tone={templates.error.code === "rate_limited" ? "warning" : "danger"}
              title={t.ws.templatesFailed}
              action={
                <Button variant="outline" className={TOUCH_BUTTON} isDisabled={templates.isFetching} onPress={() => void templates.refetch()}>
                  {t.ws.retry}
                </Button>
              }
            >
              {templates.error.reason}
            </Notice>
          ) : (
            <TemplateRows
              templates={templates.data}
              value={templateId}
              onChange={(id) => {
                const picked = templates.data.find((candidate) => candidate.id === id);
                if (picked) setTemplateId(picked.id);
              }}
            />
          )}
        </div>

        <div className="flex flex-col gap-4 @4xl:col-span-5">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={titleId} className="text-xs font-semibold text-plum">
              {t.ws.newTitle}
            </label>
            <Input
              ref={titleRef}
              id={titleId}
              name="map-title"
              dir={dir}
              value={title}
              autoComplete="off"
              placeholder={dir === "rtl" ? t.ws.untitledRtl : t.ws.untitledLtr}
              aria-describedby={hintId}
              onChange={(event) => setTitle(event.target.value)}
              className="h-row font-title text-base max-md:h-10 max-md:text-lg"
            />
            <p id={hintId} className="text-xs text-ink-3">
              {t.ws.newTitleHint}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-plum">{t.ws.newDir}</span>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <ToggleGroup
                aria-label={t.ws.newDir}
                spacing={0}
                selectionMode="single"
                disallowEmptySelection
                selectedKeys={[dirChoice]}
                onSelectionChange={(keys) => {
                  const next = [...keys][0];
                  if (isDirChoice(next)) setDirChoice(next);
                }}
              >
                <ToggleGroupItem id="auto" className="max-md:h-10 max-md:px-3.5">
                  {t.ws.dirAuto}
                </ToggleGroupItem>
                <ToggleGroupItem id="ltr" className="max-md:h-10 max-md:px-3.5">
                  {t.ws.ltr}
                </ToggleGroupItem>
                <ToggleGroupItem id="rtl" className="max-md:h-10 max-md:px-3.5">
                  {t.ws.rtl}
                </ToggleGroupItem>
              </ToggleGroup>
              <span aria-live="polite" className="text-xs text-ink-2">
                {dirWhy}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button type="submit" size="lg" className={TOUCH_BUTTON} isDisabled={create.isPending || waiting > 0 || !templates.isSuccess}>
              {create.isPending ? t.ws.creating : t.ws.create}
            </Button>
            {onCancel ? (
              <Button variant="ghost" size="lg" className={TOUCH_BUTTON} onPress={onCancel}>
                {t.ws.cancel}
              </Button>
            ) : null}
          </div>

          {create.error && !create.isPending ? <CreateRefusal error={create.error} waiting={waiting} /> : null}
        </div>
      </div>
    </form>
  );
}
