/** Keys and inline boot script for display prefs (server + client safe; no "use client"). */

export const STORAGE_THEME = "aetheria-theme";
export const STORAGE_TEXT_SCALE = "aetheria-text-scale";
export const STORAGE_FONT = "aetheria-font";

export function displayPrefsInlineBootScript(): string {
  return `(function(){try{var h=document.documentElement;var theme=localStorage.getItem("${STORAGE_THEME}");if(!theme)theme="system";if(theme==="unicorn"){h.dataset.theme="unicorn";h.classList.remove("dark");}else{delete h.dataset.theme;if(theme==="dark")h.classList.add("dark");else if(theme==="light")h.classList.remove("dark");else{if(window.matchMedia("(prefers-color-scheme: dark)").matches)h.classList.add("dark");else h.classList.remove("dark");}}var scale=localStorage.getItem("${STORAGE_TEXT_SCALE}");if(scale==="sm"||scale==="lg")h.dataset.textScale=scale;else delete h.dataset.textScale;var font=localStorage.getItem("${STORAGE_FONT}");if(font==="readable"||font==="playful")h.dataset.font=font;else delete h.dataset.font;}catch(e){}})();`;
}
