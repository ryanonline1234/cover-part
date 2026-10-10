import type { VerovioToolkit } from "verovio/esm";

let toolkit: Promise<VerovioToolkit> | null = null;

/** One shared Verovio toolkit; the ~7 MB WASM module loads on first use. */
export function getToolkit(): Promise<VerovioToolkit> {
  if (!toolkit) {
    toolkit = (async () => {
      const [{ default: createVerovioModule }, { VerovioToolkit, enableLog, LOG_ERROR }] = await Promise.all([
        import("verovio/wasm"),
        import("verovio/esm"),
      ]);
      const mod = await createVerovioModule();
      // Verovio logs layout warnings (e.g. tight justification) to the console; keep errors only.
      enableLog(LOG_ERROR, mod);
      return new VerovioToolkit(mod);
    })();
    toolkit.catch(() => {
      toolkit = null;
    });
  }
  return toolkit;
}

export interface Rendered {
  pages: string[];
  /** Verovio timemap: qstamp (quarter notes from start) -> note ids switched on. */
  timemap: Array<{ qstamp: number; on: string[] }>;
}

/**
 * Render MusicXML to SVG pages that fit `widthPx`. Synchronous once the toolkit is loaded,
 * so concurrent callers can't interleave loadData/render on the shared toolkit.
 */
export function renderScore(tk: VerovioToolkit, xml: string, widthPx: number): Rendered {
  const scale = widthPx >= 900 ? 46 : widthPx >= 640 ? 38 : 34;
  const pageWidth = Math.round((widthPx * 100) / scale);
  tk.setOptions({
    scale,
    pageWidth,
    pageHeight: Math.round(pageWidth * 1.15),
    adjustPageHeight: true,
    // Justify the last system too, so short excerpts fill the sheet instead of huddling left.
    minLastJustification: 0,
    breaks: "auto",
    header: "none",
    footer: "none",
    pageMarginTop: 60,
    pageMarginBottom: 60,
    pageMarginLeft: 40,
    pageMarginRight: 40,
    svgViewBox: false,
    svgRemoveXlink: true,
    // data-n on each measure group: lets checks (and future UI) map the cursor to a bar number.
    svgAdditionalAttribute: ["measure@n"],
  });
  if (!tk.loadData(xml)) throw new Error("Verovio couldn't read this MusicXML.");
  const n = tk.getPageCount();
  const pages: string[] = [];
  for (let i = 1; i <= n; i++) pages.push(tk.renderToSVG(i));
  let timemap: Rendered["timemap"] = [];
  try {
    timemap = tk
      .renderToTimemap({ includeMeasures: false, includeRests: false })
      .filter((e) => e.on && e.on.length)
      .map((e) => ({ qstamp: e.qstamp, on: e.on as string[] }));
  } catch {
    timemap = [];
  }
  return { pages, timemap };
}
