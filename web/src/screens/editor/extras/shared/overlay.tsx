import { cn } from "cn";
import type { ReactNode } from "react";
import { Header, Menu, MenuItem, MenuSection, MenuTrigger, Popover, Separator, type PopoverProps } from "react-aria-components";
import { Icon } from "@/components/icons";
import { useEditorRuntime } from "../../runtime";

/** Where the editor's overlays mount, so they inherit its direction and language. */
export function usePortalContainer(): HTMLElement | undefined {
  return useEditorRuntime().portalContainer ?? undefined;
}

/** A panel floating over the editor, anchored to its trigger and mounted inside the editor root. */
export function FloatingPanel({ className, offset = 6, ...props }: Omit<PopoverProps, "className"> & { className?: string }) {
  const container = usePortalContainer();
  return (
    <Popover
      offset={offset}
      UNSTABLE_portalContainer={container}
      className={cn(
        "z-50 rounded-block border border-rule-strong bg-panel text-sm text-ink shadow-overlay outline-none",
        className,
      )}
      {...props}
    />
  );
}

export interface MenuChoice<T extends string> {
  value: T;
  label: string;
  /** Why it cannot be chosen; shown beside the label. */
  disabledReason?: string;
}

export interface MenuChoiceGroup<T extends string> {
  /** Stable id; also what `onChoose` reports. */
  id: string;
  heading: string;
  /** The checked choice; null for a group of actions. */
  value: T | null;
  choices: readonly MenuChoice<T>[];
}

/** A menu of grouped choices and actions under one trigger. Pass a button as `children`. */
export function ChoiceMenu<T extends string>({
  label,
  groups,
  onChoose,
  placement = "bottom end",
  children,
}: {
  label: string;
  groups: readonly MenuChoiceGroup<T>[];
  onChoose: (groupId: string, value: T) => void;
  placement?: PopoverProps["placement"];
  children: ReactNode;
}) {
  return (
    <MenuTrigger>
      {children}
      <FloatingPanel placement={placement} className="min-w-44 overflow-y-auto p-1">
        <Menu aria-label={label} className="outline-none">
          {groups.map((group, index) => (
            <MenuSection key={group.id} className="flex flex-col">
              {index > 0 ? <Separator className="-mx-1 my-1 h-px border-0 bg-rule" /> : null}
              <Header className="px-2 pt-1.5 pb-1 text-2xs font-semibold text-plum">{group.heading}</Header>
              {group.choices.map((choice) => (
                <MenuItem
                  key={`${group.id}:${choice.value}`}
                  id={`${group.id}:${choice.value}`}
                  textValue={choice.label}
                  isDisabled={choice.disabledReason !== undefined}
                  onAction={() => onChoose(group.id, choice.value)}
                  className="flex min-h-field cursor-default items-center gap-2 rounded-key px-2 py-1 text-sm text-ink outline-hidden select-none data-disabled:text-ink-3 data-focused:bg-well"
                >
                  <span className="flex size-3.5 shrink-0 items-center justify-center text-survey">
                    {group.value === choice.value ? <Icon name="check" size={13} /> : null}
                  </span>
                  <span className="grow tabular-nums">{choice.label}</span>
                  {choice.disabledReason !== undefined ? <span className="text-2xs text-ink-3">{choice.disabledReason}</span> : null}
                </MenuItem>
              ))}
            </MenuSection>
          ))}
        </Menu>
      </FloatingPanel>
    </MenuTrigger>
  );
}
