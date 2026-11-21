/**
 * Every seeded map of the member workspace, in no particular order; the
 * workspace list sorts by last edit. `buildSeedMaps` is deterministic for a
 * given `now`, which is what lets a reload rebuild whatever was not edited.
 */
import { aftershocks } from "./aftershocks";
import { alamein } from "./alamein";
import { beirut, stadiums } from "./archived";
import { derna } from "./derna";
import { earthquake } from "./earthquake";
import { election } from "./election";
import { haouz } from "./haouz";
import { nile } from "./nile";
import { makeClock, type SeedMap } from "./people";
import { shaheen } from "./shaheen";
import { suez } from "./suez";
import { wildfire } from "./wildfire";

export function buildSeedMaps(now: number): SeedMap[] {
  const clock = makeClock(now);
  return [
    shaheen(clock),
    aftershocks(clock),
    wildfire(clock),
    election(clock),
    earthquake(clock),
    derna(clock),
    suez(clock),
    haouz(clock),
    nile(clock),
    alamein(clock),
    beirut(clock),
    stadiums(clock),
  ];
}

export { MEMBER_TENANT, PEOPLE, type Person, type PersonId, type SeedMap } from "./people";
