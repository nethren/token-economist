/**
 * Plain-language sizes.
 *
 * Two of the four scale inputs are denominated in tokens, which is a unit
 * nobody can estimate by eye. A PM knows "the reply is a short paragraph"; they
 * do not know "the reply is 130 tokens". These tables let the interface ask the
 * question in the unit people actually think in, and convert.
 *
 * The numbers are deliberately round. They are a starting point to be replaced
 * by measuring a real example, not a claim of precision — which is why the
 * interface always shows the token figure a choice resolves to.
 */

export interface SizeOption {
  id: string;
  /** What the user is being asked to judge. */
  label: string;
  tokens: number;
}

/** What the user (or the retrieved context) sends in, per turn. */
export const INPUT_SIZES: SizeOption[] = [
  { id: "few-words", label: "a few words", tokens: 15 },
  { id: "sentence", label: "a sentence", tokens: 30 },
  { id: "short-message", label: "a short message", tokens: 80 },
  { id: "paragraph", label: "a paragraph", tokens: 150 },
  { id: "long-message", label: "a long message or form", tokens: 400 },
  { id: "page", label: "a page of text", tokens: 900 },
  { id: "document", label: "a whole document", tokens: 6_000 },
];

/** What the model sends back, per turn. */
export const OUTPUT_SIZES: SizeOption[] = [
  { id: "label", label: "a label or short JSON", tokens: 30 },
  { id: "sentence", label: "a sentence or two", tokens: 60 },
  { id: "short-paragraph", label: "a short paragraph", tokens: 130 },
  { id: "few-paragraphs", label: "a few paragraphs", tokens: 300 },
  { id: "page", label: "a page", tokens: 700 },
];

/**
 * The option a token count corresponds to, matched exactly.
 *
 * Deliberately not nearest-neighbour: a hand-entered 145 is not "a paragraph",
 * and relabelling it as one would quietly overwrite a number the user chose on
 * purpose. An unmatched value keeps the custom input visible instead.
 */
export function matchSize(tokens: number | null, options: SizeOption[]): SizeOption | null {
  if (tokens == null) return null;
  return options.find((o) => o.tokens === tokens) ?? null;
}
