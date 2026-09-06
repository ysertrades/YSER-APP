import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/* ---------------------------------------------------------------------------
 * TWO HOSTS, TWO BASES, AND THE DIFFERENCE IS NOT COSMETIC.
 *
 * GitHub Pages serves this from a sub-path of the user site
 * (/YSER-FLOW/), so it needs RELATIVE asset URLs — "./assets/x.js" resolves
 * against the document wherever that document happens to live.
 *
 * Vercel serves it at the domain root, but Whop then frames it at a path of
 * Whop's choosing — /experiences/<id> and the like. Relative URLs are wrong
 * there in a way that looks like nothing at all: the document loads from
 * /experiences/abc, so "./assets/x.js" resolves to /experiences/assets/x.js,
 * which does not exist, which the rewrite in vercel.json turns back into
 * index.html, which the browser then tries to execute as JavaScript. A blank
 * screen and a syntax error, from a path that was never meant to be a path.
 *
 * So the base is absolute on Vercel and relative everywhere else. VERCEL is set
 * by their build environment automatically — nothing to remember in a
 * dashboard, and nothing to forget.
 * ------------------------------------------------------------------------- */
const BASE = process.env.VERCEL ? "/" : "./";

export default defineConfig({
  base: BASE,
  plugins: [
    react(),
    /* The @font-face in index.html lives in an inline <style>, which Vite
       reports on and then leaves alone — "didn't resolve at build time, it will
       remain unchanged". Unchanged means relative, which is the exact trap
       described above, and the casualty is the wordmark on the launch intro.
       Substituted here rather than moving the face into the bundled CSS, which
       would delay it past the intro it exists for.
     *
     * TWO DETAILS, BOTH LEARNED THE HARD WAY.
     *
     * `order: "pre"` — Vite runs the inline <style> through PostCSS, so by the
     * time an ordinary transformIndexHtml sees the HTML the URL has already
     * been through the CSS pipeline. This has to happen first.
     *
     * `__ASSET_BASE__` and not `%ASSET_BASE%` — Vite's CSS url() rewriter calls
     * decodeURI on what it finds, and `%AS` is not a valid escape sequence, so
     * a percent-wrapped token fails the whole build with "URI malformed". */
    {
      name: "yser-asset-base",
      transformIndexHtml: {
        order: "pre",
        handler(html) { return html.split("__ASSET_BASE__").join(BASE); },
      },
    },
  ],
});
