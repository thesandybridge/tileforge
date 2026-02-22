import { createCssVariablesTheme } from "shiki";
import { transformerMetaHighlight } from "@shikijs/transformers";
import type { RehypeShikiOptions } from "@shikijs/rehype";

const cssVarTheme = createCssVariablesTheme({
  name: "css-variables",
  variablePrefix: "--shiki-",
  variableDefaults: {},
  fontStyle: true,
});

export const shikiOptions: RehypeShikiOptions = {
  theme: cssVarTheme,
  transformers: [transformerMetaHighlight()],
};
