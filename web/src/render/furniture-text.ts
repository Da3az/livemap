import type { MapFeature, MapSettings, RichText } from "@/model/types";
import { BASEMAP_ATTRIBUTION } from "./basemap";
import { formatAsOf, langForDir, legendEntries } from "./furniture";
import { fontFamilies, fontSpec, wrapText } from "./text";

/** Text runs for the canvas furniture: a few styled paragraphs, wrapped once and drawn line by line. */

export interface TextRun {
  text: RichText;
  font: string;
  color: string;
  lineHeight: number;
}

export interface LaidRun extends TextRun {
  lines: string[];
  dir: "ltr" | "rtl";
  width: number;
}


export function layRuns(runs: TextRun[], maxWidth: number): LaidRun[] {
  return runs.filter((run) => run.text.value.trim() !== "").map((run) => ({ ...run, ...wrapText(run.text, run.font, maxWidth) }));
}

export function runsSize(runs: LaidRun[]): { width: number; height: number } {
  return {
    width: Math.max(0, ...runs.map((run) => run.width)),
    height: runs.reduce((total, run) => total + run.lines.length * run.lineHeight, 0),
  };
}

/** Loads every typeface the furniture will use, so the first paint is already in the right faces. */
export async function loadFurnitureFonts(input: { title: RichText; settings: MapSettings; features: readonly MapFeature[]; dir: "ltr" | "rtl" }): Promise<void> {
  const { ui, title: serif } = fontFamilies();
  const { settings } = input;
  const block = settings.titleBlock;
  const uiText = [block.subtitle?.value, block.source?.value, block.credit?.value, block.note?.value, BASEMAP_ATTRIBUTION]
    .concat(legendEntries(settings, input.features).map((entry) => entry.label.value))
    .concat(block.asOf ? formatAsOf(block.asOf, langForDir(input.dir)) : [])
    .filter((value) => value !== undefined && value !== null)
    .join(" ");
  const serifText = `${input.title.value} ${settings.legend.title.value}`;
  await Promise.allSettled([
    document.fonts.load(fontSpec(serif, 23, 600), serifText),
    document.fonts.load(fontSpec(ui, 13, 400), uiText),
    document.fonts.load(fontSpec(ui, 12, 500), uiText),
  ]);
}
