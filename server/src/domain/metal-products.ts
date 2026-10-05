// Common bullion products with gross weight per piece (grams) and fineness, used to pre-fill forms.
export interface MetalProduct {
  metal: "gold" | "silver" | "platinum" | "palladium";
  name: string;
  grossWeightG: string;
  purity: string;
}

const bars = (metal: MetalProduct["metal"], purity: string, sizes: [string, string][]): MetalProduct[] =>
  sizes.map(([label, g]) => ({ metal, name: `${label} bar`, grossWeightG: g, purity }));

export const METAL_PRODUCTS: MetalProduct[] = [
  { metal: "gold", name: "Krugerrand 1 oz", grossWeightG: "33.93", purity: "0.9167" },
  { metal: "gold", name: "Maple Leaf 1 oz", grossWeightG: "31.104", purity: "0.9999" },
  { metal: "gold", name: "Philharmonic 1 oz", grossWeightG: "31.103", purity: "0.9999" },
  { metal: "gold", name: "Britannia 1 oz", grossWeightG: "31.21", purity: "0.9999" },
  { metal: "gold", name: "American Eagle 1 oz", grossWeightG: "33.93", purity: "0.9167" },
  { metal: "gold", name: "Kangaroo 1 oz", grossWeightG: "31.103", purity: "0.9999" },
  { metal: "gold", name: "Buffalo 1 oz", grossWeightG: "31.108", purity: "0.9999" },
  { metal: "gold", name: "Gouden Tientje (10 gulden)", grossWeightG: "6.729", purity: "0.900" },
  { metal: "gold", name: "Gouden Dukaat", grossWeightG: "3.494", purity: "0.983" },
  { metal: "gold", name: "Sovereign", grossWeightG: "7.988", purity: "0.9167" },
  { metal: "gold", name: "20 Franc Napoleon", grossWeightG: "6.452", purity: "0.900" },
  ...bars("gold", "0.9999", [
    ["1 g", "1"],
    ["2.5 g", "2.5"],
    ["5 g", "5"],
    ["10 g", "10"],
    ["20 g", "20"],
    ["1 oz", "31.1035"],
    ["50 g", "50"],
    ["100 g", "100"],
    ["250 g", "250"],
    ["500 g", "500"],
    ["1 kg", "1000"],
  ]),
  { metal: "silver", name: "Maple Leaf 1 oz", grossWeightG: "31.11", purity: "0.9999" },
  { metal: "silver", name: "Philharmonic 1 oz", grossWeightG: "31.103", purity: "0.999" },
  { metal: "silver", name: "Britannia 1 oz", grossWeightG: "31.21", purity: "0.999" },
  { metal: "silver", name: "Krugerrand 1 oz", grossWeightG: "31.1", purity: "0.999" },
  { metal: "silver", name: "American Eagle 1 oz", grossWeightG: "31.103", purity: "0.999" },
  { metal: "silver", name: "Kookaburra 1 oz", grossWeightG: "31.103", purity: "0.9999" },
  { metal: "silver", name: "Kangaroo 1 oz", grossWeightG: "31.103", purity: "0.9999" },
  { metal: "silver", name: "Zilveren rijksdaalder (pre-1967)", grossWeightG: "15", purity: "0.720" },
  { metal: "silver", name: "Zilveren gulden (pre-1967)", grossWeightG: "10", purity: "0.720" },
  ...bars("silver", "0.999", [
    ["1 oz", "31.1035"],
    ["100 g", "100"],
    ["250 g", "250"],
    ["500 g", "500"],
    ["1 kg", "1000"],
    ["5 kg", "5000"],
  ]),
  { metal: "platinum", name: "Platinum Maple Leaf 1 oz", grossWeightG: "31.11", purity: "0.9995" },
  ...bars("platinum", "0.9995", [["1 oz", "31.1035"]]),
  { metal: "palladium", name: "Palladium Maple Leaf 1 oz", grossWeightG: "31.11", purity: "0.9995" },
  ...bars("palladium", "0.9995", [["1 oz", "31.1035"]]),
];
