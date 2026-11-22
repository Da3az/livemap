// Place search sits behind the API so a geocoder's key and cost stay on the
// server. Which geocoder is a decision still open (licence, attribution,
// Arabic coverage, cost); until it is made, the built-in gazetteer answers.

import { searchGazetteer, type PlaceResult } from "@livemap/core";

export interface PlaceSearch {
  search(query: string, language: "ar" | "en"): Promise<PlaceResult[]>;
}

/** The built-in list from @livemap/core: forgiving Arabic matching, at most eight results. */
export class GazetteerPlaces implements PlaceSearch {
  async search(query: string, language: "ar" | "en"): Promise<PlaceResult[]> {
    return searchGazetteer(query, language);
  }
}
