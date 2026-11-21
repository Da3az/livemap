import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import type { Key } from "react-aria-components";
import { useSignOut } from "@/api/hooks";
import { type ThemeChoice, useTheme } from "@/app/providers";
import { StateBadge } from "@/components/state-badge";
import { formatLeft, useNow } from "@/components/time";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useShellStrings } from "@/i18n/shell";
import type { Session } from "@/model/types";

const THEMES: ThemeChoice[] = ["light", "dark", "system"];

function isTheme(key: Key | undefined): key is ThemeChoice {
  return THEMES.some((theme) => theme === key);
}

/** What the session may do, as a state: guest and read-only have their own shape; other roles are a word. */
function SessionState({ session }: { session: Session }) {
  const t = useShellStrings();
  const now = useNow();
  if (session.guest) {
    return (
      <StateBadge state="guest">
        <span className="tabular-nums">
          {t.header.guest}
          {session.expiresAt ? ` · ${formatLeft(session.expiresAt, now, t.time)}` : ""}
        </span>
      </StateBadge>
    );
  }
  if (!session.capabilities.includes("map:edit")) return <StateBadge state="readonly">{t.header.readOnly}</StateBadge>;
  return <span className="text-xs font-medium text-ink-2">{t.header.role(session.role)}</span>;
}

/**
 * The bar across the top of every shell screen: the wordmark, the workspace,
 * who is signed in and with what access, the theme, and the way out.
 *
 * `session` is left out on sign-in, where only the wordmark and the theme
 * apply. `children` sit after the workspace name, for a screen that needs to
 * say where inside the workspace it is (the versions screen names its map).
 */
export function AppHeader({ session, children }: { session?: Session | null; children?: ReactNode }) {
  const t = useShellStrings();
  const { choice, setChoice } = useTheme();
  const navigate = useNavigate();
  const signOut = useSignOut();

  const leave = (): void => {
    signOut.mutate(undefined, { onSuccess: () => void navigate("/") });
  };
  const themeNames: Record<ThemeChoice, string> = { light: t.header.light, dark: t.header.dark, system: t.header.system };

  return (
    <header className="flex h-topbar shrink-0 items-center gap-3 border-b border-rule bg-panel px-4 md:gap-4 md:px-5">
      <Link
        to={session ? "/maps" : "/"}
        aria-label={t.header.home}
        className="rounded-key font-title text-xl font-semibold tracking-tight text-survey"
      >
        livemap
      </Link>

      {session ? (
        <>
          <span aria-hidden="true" className="h-5 w-px shrink-0 bg-rule-strong" />
          <span dir="auto" className="min-w-0 truncate font-title text-lg text-ink" title={session.tenant.name}>
            {session.tenant.name}
          </span>
        </>
      ) : null}
      {children}

      <div className="ms-auto flex shrink-0 items-center gap-4">
        {signOut.isError ? (
          <span role="alert" className="text-xs font-medium text-danger">
            {t.header.signOutFailed}
          </span>
        ) : null}

        {session ? (
          <div className="hidden items-center gap-3 md:flex">
            <SessionState session={session} />
            {session.guest ? null : (
              <span dir="auto" className="max-w-40 truncate text-xs text-ink-2" title={t.header.signedInAs(session.name)}>
                {session.name}
              </span>
            )}
          </div>
        ) : null}

        <ToggleGroup
          aria-label={t.header.theme}
          size="sm"
          spacing={0}
          selectionMode="single"
          disallowEmptySelection
          selectedKeys={[choice]}
          onSelectionChange={(keys) => {
            const next = [...keys][0];
            if (isTheme(next)) setChoice(next);
          }}
          className={session ? "hidden md:flex" : undefined}
        >
          {THEMES.map((theme) => (
            <ToggleGroupItem key={theme} id={theme}>
              {themeNames[theme]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        {session ? (
          <>
            <Button variant="ghost" className="hidden md:inline-flex" isDisabled={signOut.isPending} onPress={leave}>
              {signOut.isPending ? t.header.signingOut : t.header.signOut}
            </Button>

            <div className="md:hidden">
              <DropdownMenuTrigger>
                <Button variant="outline" size="lg">
                  {t.header.menu}
                </Button>
                <DropdownMenu placement="bottom end" className="min-w-56">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>
                      <span dir="auto">{session.name}</span>
                    </DropdownMenuLabel>
                    <DropdownMenuItem isDisabled textValue={t.header.role(session.role)} className="data-disabled:opacity-100">
                      <SessionState session={session} />
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup
                    selectionMode="single"
                    disallowEmptySelection
                    selectedKeys={[choice]}
                    onSelectionChange={(keys) => {
                      if (keys === "all") return;
                      const next = [...keys][0];
                      if (isTheme(next)) setChoice(next);
                    }}
                  >
                    <DropdownMenuLabel>{t.header.theme}</DropdownMenuLabel>
                    {THEMES.map((theme) => (
                      <DropdownMenuItem key={theme} id={theme}>
                        {themeNames[theme]}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onAction={leave}>{t.header.signOut}</DropdownMenuItem>
                </DropdownMenu>
              </DropdownMenuTrigger>
            </div>
          </>
        ) : null}
      </div>
    </header>
  );
}
