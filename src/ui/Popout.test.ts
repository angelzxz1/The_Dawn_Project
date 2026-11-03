import { describe, expect, it } from "vitest";
import { absoluteUrls, popoutFeatures } from "./Popout";

describe("popoutFeatures", () => {
  it("opens a new window at its usual size, wherever the system puts it", () => {
    expect(popoutFeatures({ width: 1100, height: 640 }, null)).toBe("popup=yes,width=1100,height=640");
  });

  it("opens where it was last left, at that size, and never tiny", () => {
    expect(popoutFeatures({ width: 1100, height: 640 }, { left: 1920.4, top: -20, width: 900, height: 700 })).toBe(
      "popup=yes,width=900,height=700,left=1920,top=-20"
    );
    expect(popoutFeatures({ width: 1100, height: 640 }, { left: 0, top: 0, width: 10, height: 10 })).toBe("popup=yes,width=320,height=240,left=0,top=0");
  });
});

describe("absoluteUrls", () => {
  const base = "http://localhost:3000/_next/static/chunks/app.css";

  it("makes a stylesheet's fonts absolute, from the sheet's own address", () => {
    expect(absoluteUrls('src: url("../media/geist.woff2") format("woff2")', base)).toBe(
      'src: url("http://localhost:3000/_next/static/media/geist.woff2") format("woff2")'
    );
    expect(absoluteUrls("background: url(/img/a.png)", base)).toBe("background: url(http://localhost:3000/img/a.png)");
  });

  it("leaves addresses that are already whole as they are", () => {
    const css = 'a { background: url("data:image/png;base64,AAA"); mask: url(#m); src: url(https://example.com/f.woff2) }';
    expect(absoluteUrls(css, base)).toBe(css);
  });
});
