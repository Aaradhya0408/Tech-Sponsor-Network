const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
const excludedRegionCodes = new Set([
  "AC",
  "AN",
  "CP",
  "CQ",
  "CS",
  "DD",
  "DG",
  "EA",
  "EU",
  "EZ",
  "FX",
  "IC",
  "NT",
  "QO",
  "SU",
  "TA",
  "TP",
  "UK",
  "UN",
  "YU",
  "ZR",
  "ZZ",
]);
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export const COUNTRY_OPTIONS = alphabet
  .split("")
  .flatMap((first) =>
    alphabet.split("").flatMap((second) => {
      const code = `${first}${second}`;
      if (
        excludedRegionCodes.has(code) ||
        (code.startsWith("X") && code !== "XK")
      ) {
        return [];
      }

      const name = regionNames.of(code);
      if (!name || name === code || name === "Unknown Region") return [];
      return [{ code, name }];
    }),
  )
  .sort((left, right) => left.name.localeCompare(right.name));
