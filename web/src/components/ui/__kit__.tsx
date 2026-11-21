import type { ReactNode } from "react";
import { Disclosure, ListBox, Menu } from "react-aria-components";

import { Icon } from "@/components/icons";
import { Button, LinkButton } from "@/components/ui/button";
import { ButtonGroup, ButtonGroupSeparator, ButtonGroupText } from "@/components/ui/button-group";
import { Checkbox } from "@/components/ui/checkbox";
import { CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Combobox, ComboboxContent, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/ui/combobox";
import { Command, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from "@/components/ui/command";
import { ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuShortcut } from "@/components/ui/context-menu";
import { Dialog, DialogClose, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DirectionProvider } from "@/components/ui/direction";
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel, FieldLegend, FieldSet, FieldTitle } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Input } from "@/components/ui/input";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import { Popover, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";
import { overlayPanel } from "@/components/ui/styles";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipTrigger } from "@/components/ui/tooltip";

/*
 * A specimen sheet for the kit: every component in every state it can be put
 * in without a pointer. Hover and keyboard focus cannot be held by a static
 * page, so those columns force the same classes the state would add.
 * `?overlay=dialog` or `?overlay=sheet` opens the modal ones on top.
 */

const FORCED_FOCUS = "outline-2 outline-offset-2 outline-focus outline-solid";

const REGIONS = [
  { id: "gaza", name: "Gaza Strip" },
  { id: "khan-younis", name: "Khan Younis" },
  { id: "rafah", name: "Rafah" },
  { id: "deir", name: "Deir al-Balah" },
];

function Row({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-4 border-t border-rule py-3">
      <h3 className="w-32 shrink-0 pt-1 text-xs font-semibold text-ink-2">{name}</h3>
      <div className="flex min-w-0 flex-1 flex-wrap items-start gap-x-5 gap-y-3">{children}</div>
    </div>
  );
}

function State({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-2xs text-ink-3">{label}</span>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

function Buttons() {
  const variants = ["default", "outline", "secondary", "ghost", "destructive", "link"] as const;
  const hover: Record<(typeof variants)[number], string> = {
    default: "bg-survey-hover",
    outline: "border-ink-3 bg-well",
    secondary: "bg-rule",
    ghost: "bg-well text-ink",
    destructive: "bg-danger-wash",
    link: "decoration-2",
  };
  return (
    <>
      {variants.map((variant) => (
        <Row key={variant} name={`Button · ${variant}`}>
          <State label="default">
            <Button variant={variant}>Publish v15</Button>
          </State>
          <State label="hover">
            <Button variant={variant} className={hover[variant]}>
              Publish v15
            </Button>
          </State>
          <State label="focus">
            <Button variant={variant} className={FORCED_FOCUS}>
              Publish v15
            </Button>
          </State>
          <State label="disabled">
            <Button variant={variant} isDisabled>
              Publish v15
            </Button>
          </State>
          <State label="sizes">
            <Button variant={variant} size="xs">
              xs
            </Button>
            <Button variant={variant} size="sm">
              Small
            </Button>
            <Button variant={variant} size="lg">
              Large
            </Button>
            <Button variant={variant} size="icon" aria-label="Add">
              <Icon name="plus" size={14} />
            </Button>
          </State>
        </Row>
      ))}
      <Row name="LinkButton">
        <State label="default">
          <LinkButton variant="outline" href="#kit">
            Open versions
          </LinkButton>
        </State>
        <State label="link">
          <LinkButton variant="link" size="text" href="#kit">
            View the live map
          </LinkButton>
        </State>
      </Row>
    </>
  );
}

function Toggles() {
  return (
    <>
      <Row name="Toggle">
        <State label="off">
          <Toggle aria-label="Snap to roads">Snap</Toggle>
          <Toggle variant="outline">Snap</Toggle>
        </State>
        <State label="on">
          <Toggle defaultSelected>Snap</Toggle>
          <Toggle variant="outline" defaultSelected>
            Snap
          </Toggle>
        </State>
        <State label="focus">
          <Toggle variant="outline" className={FORCED_FOCUS}>
            Snap
          </Toggle>
        </State>
        <State label="disabled">
          <Toggle variant="outline" isDisabled>
            Snap
          </Toggle>
          <Toggle variant="outline" isDisabled defaultSelected>
            Snap
          </Toggle>
        </State>
      </Row>
      <Row name="ToggleGroup">
        <State label="joined (spacing 0)">
          <ToggleGroup spacing={0} selectionMode="single" defaultSelectedKeys={["solid"]} aria-label="Line style">
            <ToggleGroupItem id="solid">Solid</ToggleGroupItem>
            <ToggleGroupItem id="dashed">Dashed</ToggleGroupItem>
            <ToggleGroupItem id="dotted">Dotted</ToggleGroupItem>
            <ToggleGroupItem id="none" isDisabled>
              None
            </ToggleGroupItem>
          </ToggleGroup>
        </State>
        <State label="spaced">
          <ToggleGroup variant="outline" selectionMode="multiple" defaultSelectedKeys={["b"]} aria-label="Weight">
            <ToggleGroupItem id="a">Thin</ToggleGroupItem>
            <ToggleGroupItem id="b">Medium</ToggleGroupItem>
            <ToggleGroupItem id="c">Heavy</ToggleGroupItem>
          </ToggleGroup>
        </State>
      </Row>
      <Row name="ButtonGroup">
        <State label="horizontal">
          <ButtonGroup>
            <Button variant="outline">Zoom out</Button>
            <Button variant="outline">Fit</Button>
            <Button variant="outline">Zoom in</Button>
          </ButtonGroup>
        </State>
        <State label="with text + separator">
          <ButtonGroup>
            <ButtonGroupText>Zoom 7.4</ButtonGroupText>
            <Button variant="outline" aria-label="Zoom in">
              <Icon name="plus" size={14} />
            </Button>
            <ButtonGroupSeparator />
            <Button variant="outline" aria-label="Zoom out">
              <Icon name="minus" size={14} />
            </Button>
          </ButtonGroup>
        </State>
        <State label="vertical">
          <ButtonGroup orientation="vertical">
            <Button variant="outline" size="icon" aria-label="Zoom in">
              <Icon name="plus" size={14} />
            </Button>
            <Button variant="outline" size="icon" aria-label="Zoom out">
              <Icon name="minus" size={14} />
            </Button>
          </ButtonGroup>
        </State>
      </Row>
    </>
  );
}

function TextFields() {
  return (
    <>
      <Row name="Input">
        <State label="empty">
          <Input aria-label="Title" placeholder="Map title" className="w-48" />
        </State>
        <State label="filled">
          <Input aria-label="Title" defaultValue="Frontlines around Kharkiv" className="w-48" />
        </State>
        <State label="hover">
          <Input aria-label="Title" defaultValue="Frontlines" className="w-40 border-ink-3" />
        </State>
        <State label="focus">
          <Input aria-label="Title" defaultValue="Frontlines" className={`w-40 ${FORCED_FOCUS}`} />
        </State>
        <State label="invalid">
          <Input aria-label="Title" aria-invalid defaultValue="" placeholder="Required" className="w-40" />
        </State>
        <State label="disabled">
          <Input aria-label="Title" disabled defaultValue="Read only" className="w-40" />
        </State>
      </Row>
      <Row name="Textarea">
        <State label="default">
          <Textarea aria-label="Note" defaultValue="Shelling reported overnight near Izium; unconfirmed." className="w-64" />
        </State>
        <State label="invalid">
          <Textarea aria-label="Note" aria-invalid className="w-48" />
        </State>
        <State label="disabled">
          <Textarea aria-label="Note" disabled defaultValue="Locked by Rana" className="w-48" />
        </State>
      </Row>
      <Row name="InputGroup">
        <State label="search">
          <InputGroup className="w-56">
            <InputGroupInput aria-label="Search places" placeholder="Search places" />
            <InputGroupAddon>
              <Icon name="search" size={14} />
            </InputGroupAddon>
          </InputGroup>
        </State>
        <State label="unit + button">
          <InputGroup className="w-44">
            <InputGroupInput aria-label="Width" defaultValue="2.5" />
            <InputGroupAddon align="inline-end">
              <InputGroupText>px</InputGroupText>
              <InputGroupButton aria-label="Reset" size="icon-xs">
                <Icon name="close" size={12} />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </State>
        <State label="invalid">
          <InputGroup className="w-44">
            <InputGroupInput aria-label="Width" aria-invalid defaultValue="-4" />
            <InputGroupAddon align="inline-end">
              <InputGroupText>px</InputGroupText>
            </InputGroupAddon>
          </InputGroup>
        </State>
        <State label="disabled">
          <InputGroup className="w-44">
            <InputGroupInput aria-label="Width" disabled defaultValue="2.5" />
            <InputGroupAddon align="inline-end">
              <InputGroupText>px</InputGroupText>
            </InputGroupAddon>
          </InputGroup>
        </State>
      </Row>
    </>
  );
}

function Choices() {
  return (
    <>
      <Row name="Select">
        <State label="placeholder">
          <Select aria-label="Basemap" placeholder="Choose a basemap" className="w-48">
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
          </Select>
        </State>
        <State label="chosen">
          <Select aria-label="Basemap" defaultSelectedKey="positron" className="w-48">
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <ListBox className="hidden">
              <SelectItem id="positron">Positron</SelectItem>
            </ListBox>
          </Select>
        </State>
        <State label="focus">
          <Select aria-label="Basemap" placeholder="Basemap" className="w-36">
            <SelectTrigger className={FORCED_FOCUS}>
              <SelectValue />
            </SelectTrigger>
          </Select>
        </State>
        <State label="invalid">
          <Select aria-label="Basemap" placeholder="Required" isInvalid className="w-36">
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
          </Select>
        </State>
        <State label="disabled">
          <Select aria-label="Basemap" placeholder="Basemap" isDisabled className="w-36">
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
          </Select>
        </State>
        <State label="small">
          <Select aria-label="Basemap" placeholder="Basemap" className="w-32">
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
          </Select>
        </State>
      </Row>
      <Row name="Select · open list">
        <div className={`${overlayPanel} w-56`}>
          <ListBox aria-label="Basemap" selectionMode="single" defaultSelectedKeys={["positron"]} disabledKeys={["satellite"]} className="p-1 outline-none">
            <SelectItem id="positron">Positron</SelectItem>
            <SelectItem id="bright">Bright</SelectItem>
            <SelectItem id="dark">Dark matter</SelectItem>
            <SelectItem id="satellite">Satellite (not licensed)</SelectItem>
          </ListBox>
        </div>
        <div className="flex flex-col gap-1 text-2xs text-ink-3">
          <span>Labels and separators:</span>
          <div className={`${overlayPanel} w-48 p-1`}>
            <SelectLabel>Light</SelectLabel>
            <SelectSeparator />
            <SelectLabel>Dark</SelectLabel>
          </div>
        </div>
      </Row>
      <Row name="Combobox">
        <State label="closed">
          <Combobox aria-label="Region" defaultItems={REGIONS} className="w-56">
            <ComboboxInput placeholder="Region" showClear />
            <ComboboxContent>
              <ComboboxList>{(item: { id: string; name: string }) => <ComboboxItem id={item.id}>{item.name}</ComboboxItem>}</ComboboxList>
            </ComboboxContent>
          </Combobox>
        </State>
        <State label="disabled">
          <Combobox aria-label="Region" isDisabled defaultItems={REGIONS} className="w-48">
            <ComboboxInput placeholder="Region" disabled />
            <ComboboxContent>
              <ComboboxList>{(item: { id: string; name: string }) => <ComboboxItem id={item.id}>{item.name}</ComboboxItem>}</ComboboxList>
            </ComboboxContent>
          </Combobox>
        </State>
        <State label="open list">
          <div className={`${overlayPanel} w-56`}>
            <ListBox aria-label="Region" selectionMode="single" defaultSelectedKeys={["rafah"]} items={REGIONS} className="p-1 outline-none">
              {(item) => <ComboboxItem id={item.id}>{item.name}</ComboboxItem>}
            </ListBox>
          </div>
        </State>
      </Row>
      <Row name="Checkbox">
        <State label="off / on / mixed">
          <Checkbox aria-label="Off" />
          <Checkbox aria-label="On" defaultSelected />
          <Checkbox aria-label="Mixed" isIndeterminate />
        </State>
        <State label="focus">
          <Checkbox aria-label="Focus" className={FORCED_FOCUS} />
        </State>
        <State label="invalid">
          <Checkbox aria-label="Invalid" isInvalid />
          <Checkbox aria-label="Invalid on" isInvalid defaultSelected />
        </State>
        <State label="disabled">
          <Checkbox aria-label="Disabled" isDisabled />
          <Checkbox aria-label="Disabled on" isDisabled defaultSelected />
        </State>
        <State label="with label">
          <Checkbox defaultSelected className="peer" aria-label="Show casing" />
          <span className="text-sm">Show casing</span>
        </State>
      </Row>
      <Row name="RadioGroup">
        <State label="vertical">
          <RadioGroup aria-label="Units" defaultValue="km">
            {(["km", "mi", "nm"] as const).map((unit) => (
              <label key={unit} className="flex items-center gap-2 text-sm">
                <RadioGroupItem value={unit} aria-label={unit} />
                {unit === "km" ? "Kilometres" : unit === "mi" ? "Miles" : "Nautical miles"}
              </label>
            ))}
          </RadioGroup>
        </State>
        <State label="focus / invalid / disabled">
          <RadioGroup aria-label="States" orientation="horizontal" defaultValue="b" isInvalid>
            <RadioGroupItem value="a" aria-label="A" className={FORCED_FOCUS} />
            <RadioGroupItem value="b" aria-label="B" />
          </RadioGroup>
          <RadioGroup aria-label="Disabled" orientation="horizontal" defaultValue="b" isDisabled>
            <RadioGroupItem value="a" aria-label="A" />
            <RadioGroupItem value="b" aria-label="B" />
          </RadioGroup>
        </State>
      </Row>
      <Row name="Switch">
        <State label="off / on">
          <Switch aria-label="Off" />
          <Switch aria-label="On" defaultSelected />
        </State>
        <State label="small">
          <Switch size="sm" aria-label="Off" />
          <Switch size="sm" aria-label="On" defaultSelected />
        </State>
        <State label="focus">
          <Switch aria-label="Focus" className={FORCED_FOCUS} />
        </State>
        <State label="disabled">
          <Switch aria-label="Disabled" isDisabled />
          <Switch aria-label="Disabled on" isDisabled defaultSelected />
        </State>
      </Row>
      <Row name="Slider">
        <State label="value">
          <Slider aria-label="Opacity" defaultValue={60} className="w-40" />
        </State>
        <State label="range">
          <Slider aria-label="Window" defaultValue={[20, 70]} className="w-40" />
        </State>
        <State label="disabled">
          <Slider aria-label="Opacity" defaultValue={40} isDisabled className="w-40" />
        </State>
      </Row>
    </>
  );
}

function Structure() {
  return (
    <>
      <Row name="Tabs · default">
        <Tabs defaultSelectedKey="style">
          <TabsList aria-label="Inspector">
            <TabsTrigger id="style">Style</TabsTrigger>
            <TabsTrigger id="label">Label</TabsTrigger>
            <TabsTrigger id="time">Time</TabsTrigger>
            <TabsTrigger id="data" isDisabled>
              Data
            </TabsTrigger>
          </TabsList>
          <TabsContent id="style">Fill, outline and pattern.</TabsContent>
          <TabsContent id="label">Label</TabsContent>
          <TabsContent id="time">Time</TabsContent>
          <TabsContent id="data">Data</TabsContent>
        </Tabs>
      </Row>
      <Row name="Tabs · line">
        <Tabs defaultSelectedKey="all">
          <TabsList variant="line" aria-label="Maps">
            <TabsTrigger id="all">All maps</TabsTrigger>
            <TabsTrigger id="live">Live</TabsTrigger>
            <TabsTrigger id="archived">Archived</TabsTrigger>
          </TabsList>
          <TabsContent id="all">32 maps</TabsContent>
          <TabsContent id="live">Live</TabsContent>
          <TabsContent id="archived">Archived</TabsContent>
        </Tabs>
        <Tabs defaultSelectedKey="b" orientation="vertical">
          <TabsList variant="line" aria-label="Sections">
            <TabsTrigger id="a">General</TabsTrigger>
            <TabsTrigger id="b">Members</TabsTrigger>
          </TabsList>
          <TabsContent id="a">General</TabsContent>
          <TabsContent id="b">Members</TabsContent>
        </Tabs>
      </Row>
      <Row name="Progress">
        <Progress value={64} className="w-64">
          <ProgressLabel>Exporting 1920 × 1080</ProgressLabel>
          <ProgressValue />
        </Progress>
        <Progress isIndeterminate aria-label="Loading" className="w-40" />
      </Row>
      <Row name="Table">
        <Table aria-label="Maps" selectionMode="single" defaultSelectedKeys={["b"]} disabledKeys={["d"]} className="max-w-2xl">
          <TableHeader>
            <TableHead isRowHeader>Title</TableHead>
            <TableHead>State</TableHead>
            <TableHead>Updated</TableHead>
          </TableHeader>
          <TableBody>
            <TableRow id="a">
              <TableCell>Frontlines around Kharkiv</TableCell>
              <TableCell>Live</TableCell>
              <TableCell className="tabular-nums">21 Nov, 14:02</TableCell>
            </TableRow>
            <TableRow id="b">
              <TableCell>خريطة السيطرة في غزة</TableCell>
              <TableCell>Draft (selected)</TableCell>
              <TableCell className="tabular-nums">21 Nov, 13:40</TableCell>
            </TableRow>
            <TableRow id="c" className="bg-well">
              <TableCell>Sudan: El Fasher siege</TableCell>
              <TableCell>Live (hover)</TableCell>
              <TableCell className="tabular-nums">20 Nov, 22:15</TableCell>
            </TableRow>
            <TableRow id="d">
              <TableCell>Red Sea shipping attacks</TableCell>
              <TableCell>Archived (disabled)</TableCell>
              <TableCell className="tabular-nums">2 Oct, 09:30</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Row>
      <Row name="ScrollArea">
        <ScrollArea className="h-24 w-56 border border-rule" tabIndex={0}>
          <ul className="p-2 text-sm">
            {["Kharkiv", "Izium", "Kupiansk", "Lyman", "Bakhmut", "Avdiivka", "Pokrovsk", "Vuhledar", "Zaporizhzhia"].map((name) => (
              <li key={name} className="py-0.5">
                {name}
              </li>
            ))}
          </ul>
        </ScrollArea>
      </Row>
      <Row name="Separator">
        <div className="flex w-56 flex-col gap-2 text-sm">
          <span>Above</span>
          <Separator />
          <div className="flex h-5 items-center gap-2">
            <span>Start</span>
            <Separator orientation="vertical" />
            <span>End</span>
          </div>
        </div>
      </Row>
      <Row name="Field">
        <Field className="w-56">
          <FieldLabel htmlFor="kit-title">Title</FieldLabel>
          <Input id="kit-title" defaultValue="Frontlines around Kharkiv" />
          <FieldDescription>Shown above the map and in the embed.</FieldDescription>
        </Field>
        <Field className="w-56" data-invalid="true">
          <FieldLabel htmlFor="kit-slug">Slug</FieldLabel>
          <Input id="kit-slug" aria-invalid defaultValue="kharkiv front" />
          <FieldError>Use letters, digits and hyphens.</FieldError>
        </Field>
        <Field className="w-56" data-disabled="true">
          <FieldLabel htmlFor="kit-owner">Owner</FieldLabel>
          <Input id="kit-owner" disabled defaultValue="Rana Haddad" />
        </Field>
        <FieldSet className="w-64">
          <FieldLegend>Basemap</FieldLegend>
          <RadioGroup aria-label="Basemap" defaultValue="positron" className="gap-1.5">
            {(
              [
                ["positron", "Positron", "Pale, for colour-heavy maps"],
                ["dark", "Dark matter", "For night broadcasts"],
              ] as const
            ).map(([value, title, note]) => (
              <FieldLabel key={value}>
                <Field orientation="horizontal">
                  <RadioGroupItem value={value} aria-label={title} />
                  <FieldContent>
                    <FieldTitle>{title}</FieldTitle>
                    <FieldDescription>{note}</FieldDescription>
                  </FieldContent>
                </Field>
              </FieldLabel>
            ))}
          </RadioGroup>
        </FieldSet>
      </Row>
      <Row name="Label · Kbd">
        <Label>Stroke width</Label>
        <KbdGroup>
          <Kbd>⌘</Kbd>
          <Kbd>K</Kbd>
        </KbdGroup>
        <Kbd>V</Kbd>
        <Kbd>Esc</Kbd>
      </Row>
      <Row name="Collapsible">
        <Disclosure defaultExpanded className="w-64">
          <CollapsibleTrigger className="flex h-field w-full items-center gap-1.5 rounded-key px-1 text-sm font-medium text-ink hover:bg-well">
            <Icon name="chevronDown" size={14} className="text-ink-3" />
            Group: Frontlines (open)
          </CollapsibleTrigger>
          <CollapsibleContent className="ps-6 text-sm text-ink-2">3 features</CollapsibleContent>
        </Disclosure>
        <Disclosure className="w-64">
          <CollapsibleTrigger className="flex h-field w-full items-center gap-1.5 rounded-key px-1 text-sm font-medium text-ink hover:bg-well">
            <Icon name="chevron" size={14} className="text-ink-3 rtl:-scale-x-100" />
            Group: Shelling (closed)
          </CollapsibleTrigger>
          <CollapsibleContent className="ps-6 text-sm text-ink-2">12 features</CollapsibleContent>
        </Disclosure>
      </Row>
    </>
  );
}

function Floating() {
  return (
    <>
      <Row name="Tooltip · Popover">
        <div className="h-16 pt-8">
          <TooltipTrigger isOpen>
            <Button variant="outline" size="icon" aria-label="Lock">
              <Icon name="lock" size={14} />
            </Button>
            <Tooltip>
              Lock <span data-slot="kbd" className="rounded-key border px-1 text-2xs">L</span>
            </Tooltip>
          </TooltipTrigger>
        </div>
        <div className="h-40">
          <PopoverTrigger isOpen>
            <Button variant="outline">Embed options</Button>
            <Popover isNonModal placement="bottom start">
              <PopoverHeader>
                <PopoverTitle>Embed</PopoverTitle>
                <PopoverDescription>Polls every 30 s; pauses on hidden tabs.</PopoverDescription>
              </PopoverHeader>
              <Input aria-label="Embed code" readOnly defaultValue='<iframe src="https://maps.example/embed/kharkiv">' />
            </Popover>
          </PopoverTrigger>
        </div>
      </Row>
    </>
  );
}

function Overlays() {
  return (
    <>
      <Row name="Dropdown menu">
        <div className={`${overlayPanel} w-56 p-1`}>
          <Menu aria-label="Row" selectionMode="single" defaultSelectedKeys={["front"]} disabledKeys={["lock"]} className="outline-none">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Draw as</DropdownMenuLabel>
              <DropdownMenuItem id="area">Area</DropdownMenuItem>
              <DropdownMenuItem id="front">Front line</DropdownMenuItem>
            </DropdownMenuGroup>
          </Menu>
          <DropdownMenuSeparator />
          <Menu aria-label="Actions" disabledKeys={["lock"]} className="outline-none">
            <DropdownMenuItem id="dup">
              Duplicate <DropdownMenuShortcut>⌘D</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem id="lock">Lock (disabled)</DropdownMenuItem>
            <DropdownMenuSubTrigger id="move">Move to group</DropdownMenuSubTrigger>
            <DropdownMenuItem id="del" variant="destructive">
              Delete <DropdownMenuShortcut>⌫</DropdownMenuShortcut>
            </DropdownMenuItem>
          </Menu>
        </div>
      </Row>
      <Row name="Context menu">
        <div className={`${overlayPanel} w-56 p-1`}>
          <Menu aria-label="Map" selectionMode="multiple" defaultSelectedKeys={["labels"]} className="outline-none">
            <ContextMenuLabel>Show</ContextMenuLabel>
            <ContextMenuItem id="labels">Place labels</ContextMenuItem>
            <ContextMenuItem id="grid">Grid</ContextMenuItem>
          </Menu>
          <ContextMenuSeparator />
          <Menu aria-label="Actions" className="outline-none">
            <ContextMenuItem id="here">
              Add point here <ContextMenuShortcut>P</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem id="del" variant="destructive">
              Delete selection
            </ContextMenuItem>
          </Menu>
        </div>
      </Row>
      <Row name="Command">
        <div className={`${overlayPanel} h-60 w-80 overflow-hidden`}>
          <Command>
            <div className="border-b border-rule">
              <CommandInput placeholder="Type a command or a place" />
            </div>
            <CommandList aria-label="Commands" className="p-1">
              <CommandGroup heading="Draw" id="draw">
                <CommandItem id="area">
                  Area <CommandShortcut>A</CommandShortcut>
                </CommandItem>
                <CommandItem id="arrow">
                  Arrow <CommandShortcut>R</CommandShortcut>
                </CommandItem>
              </CommandGroup>
              <CommandGroup heading="Map" id="map">
                <CommandItem id="publish">Publish v15</CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </div>
      </Row>
    </>
  );
}

function Modal({ kind }: { kind: string }) {
  if (kind === "dialog") {
    return (
      <Dialog isOpen>
        <DialogHeader>
          <DialogTitle>Archive “Frontlines around Kharkiv”?</DialogTitle>
          <DialogDescription>The live embed keeps serving v14 until you unpublish it.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose>Cancel</DialogClose>
          <Button variant="destructive">Archive</Button>
        </DialogFooter>
      </Dialog>
    );
  }
  if (kind === "sheet") {
    return (
      <Sheet isOpen side="end">
        <SheetHeader>
          <SheetTitle>Versions</SheetTitle>
          <SheetDescription>14 published, the last 2 hours ago.</SheetDescription>
        </SheetHeader>
        <div className="px-4 text-sm">v14 · live</div>
        <SheetFooter>
          <Button>Restore v13</Button>
        </SheetFooter>
      </Sheet>
    );
  }
  return null;
}

export default function Kit() {
  const params = new URLSearchParams(window.location.search);
  const dir = params.get("dir") === "rtl" ? "rtl" : "ltr";
  return (
    <DirectionProvider direction={dir}>
      <div dir={dir} className="min-h-dvh bg-panel px-6 py-5 text-ink">
        <h1 className="font-title text-xl font-semibold">Kit · Atlas</h1>
        <p className="mt-1 text-xs text-ink-3">Every component in every state. Hover and focus columns force the classes the state would add.</p>
        <div className="mt-4 grid gap-x-10 xl:grid-cols-2">
          <div>
            <Buttons />
            <Toggles />
            <TextFields />
          </div>
          <div>
            <Floating />
            <Choices />
          </div>
          <div>
            <Structure />
          </div>
          <div>
            <Overlays />
          </div>
        </div>
        <Modal kind={params.get("overlay") ?? ""} />
      </div>
    </DirectionProvider>
  );
}
