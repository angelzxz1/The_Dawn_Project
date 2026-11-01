// The theme, set before the studio's page draws. It imports nothing, so
// the page's layout (a server component, rendered at build time) can use
// it.

/** Where the studio's preferences are kept (studioPrefs.ts). */
export const STUDIO_PREFS_KEY = "dawn.studioPrefs.v1";

export const LIGHT_QUERY = "(prefers-color-scheme: light)";

/** Run as the studio's page loads, before it draws (app/app/layout.tsx):
 * the saved theme, so a light studio doesn't flash dark first. */
export const THEME_BOOT_SCRIPT = `try{var p=JSON.parse(localStorage.getItem(${JSON.stringify(STUDIO_PREFS_KEY)})||"null")||{};var t=p.theme;if(t==="system")t=matchMedia(${JSON.stringify(LIGHT_QUERY)}).matches?"light":"dark";if(t==="light")document.documentElement.dataset.theme="light"}catch(e){}`;
