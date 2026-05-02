"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import {
  STORAGE_FONT,
  STORAGE_TEXT_SCALE,
  STORAGE_THEME,
} from "@/lib/display-prefs-boot";

export type DisplayTheme = "system" | "light" | "dark" | "unicorn";
export type DisplayTextScale = "sm" | "md" | "lg";
export type DisplayFont = "default" | "readable" | "playful";

function readStoredTheme(): DisplayTheme {
  if (typeof window === "undefined") return "system";
  const v = localStorage.getItem(STORAGE_THEME);
  if (v === "light" || v === "dark" || v === "unicorn" || v === "system") return v;
  return "system";
}

function readStoredTextScale(): DisplayTextScale {
  if (typeof window === "undefined") return "md";
  const v = localStorage.getItem(STORAGE_TEXT_SCALE);
  if (v === "sm" || v === "md" || v === "lg") return v;
  return "md";
}

function readStoredFont(): DisplayFont {
  if (typeof window === "undefined") return "default";
  const v = localStorage.getItem(STORAGE_FONT);
  if (v === "readable" || v === "playful") return v;
  return "default";
}

function applyThemeToDocument(theme: DisplayTheme) {
  const root = document.documentElement;
  if (theme === "unicorn") {
    root.dataset.theme = "unicorn";
    root.classList.remove("dark");
    return;
  }
  delete root.dataset.theme;
  if (theme === "dark") {
    root.classList.add("dark");
  } else if (theme === "light") {
    root.classList.remove("dark");
  } else {
    const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    root.classList.toggle("dark", dark);
  }
}

function applyTextScaleToDocument(scale: DisplayTextScale) {
  const root = document.documentElement;
  if (scale === "md") {
    delete root.dataset.textScale;
  } else {
    root.dataset.textScale = scale;
  }
}

function applyFontToDocument(font: DisplayFont) {
  const root = document.documentElement;
  if (font === "default") {
    delete root.dataset.font;
  } else {
    root.dataset.font = font;
  }
}

export function DisplayPreferences() {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<DisplayTheme>("system");
  const [textScale, setTextScale] = useState<DisplayTextScale>("md");
  const [font, setFont] = useState<DisplayFont>("default");
  const wrapRef = useRef<HTMLDivElement>(null);

  const applyAll = useCallback(
    (t: DisplayTheme, s: DisplayTextScale, f: DisplayFont) => {
      applyThemeToDocument(t);
      applyTextScaleToDocument(s);
      applyFontToDocument(f);
    },
    [],
  );

  useLayoutEffect(() => {
    /* Sync React state from localStorage after SSR; FOUC script already set <html>. */
    /* eslint-disable react-hooks/set-state-in-effect -- one-shot hydration from persisted prefs */
    setTheme(readStoredTheme());
    setTextScale(readStoredTextScale());
    setFont(readStoredFont());
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  useEffect(() => {
    applyAll(theme, textScale, font);
  }, [theme, textScale, font, applyAll]);

  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (readStoredTheme() !== "system") return;
      applyThemeToDocument("system");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      const el = wrapRef.current;
      if (!el?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  const persistTheme = (t: DisplayTheme) => {
    localStorage.setItem(STORAGE_THEME, t);
    setTheme(t);
  };

  const persistScale = (s: DisplayTextScale) => {
    localStorage.setItem(STORAGE_TEXT_SCALE, s);
    setTextScale(s);
  };

  const persistFont = (f: DisplayFont) => {
    localStorage.setItem(STORAGE_FONT, f);
    setFont(f);
  };

  return (
    <div ref={wrapRef} className="fixed bottom-4 right-4 z-[100]">
      <button
        type="button"
        className="flex size-10 items-center justify-center rounded-full border border-zinc-300 bg-white text-sm font-semibold text-zinc-800 shadow-md hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
        aria-label="Display settings"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        Aa
      </button>
      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-modal="true"
          aria-labelledby={`${panelId}-title`}
          className="absolute bottom-12 right-0 w-[min(100vw-2rem,18rem)] rounded-xl border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        >
          <h2
            id={`${panelId}-title`}
            className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
          >
            Display
          </h2>
          <div className="space-y-3 text-sm text-zinc-800 dark:text-zinc-200">
            <fieldset className="space-y-1">
              <legend className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Theme
              </legend>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="aetheria-theme"
                  checked={theme === "system"}
                  onChange={() => persistTheme("system")}
                  className="accent-blue-600"
                />
                System
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="aetheria-theme"
                  checked={theme === "light"}
                  onChange={() => persistTheme("light")}
                  className="accent-blue-600"
                />
                Light
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="aetheria-theme"
                  checked={theme === "dark"}
                  onChange={() => persistTheme("dark")}
                  className="accent-blue-600"
                />
                Dark
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="aetheria-theme"
                  checked={theme === "unicorn"}
                  onChange={() => persistTheme("unicorn")}
                  className="accent-blue-600"
                />
                Unicorn
              </label>
            </fieldset>
            <fieldset className="space-y-1">
              <legend className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Text size
              </legend>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="aetheria-text-scale"
                  checked={textScale === "sm"}
                  onChange={() => persistScale("sm")}
                  className="accent-blue-600"
                />
                Smaller
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="aetheria-text-scale"
                  checked={textScale === "md"}
                  onChange={() => persistScale("md")}
                  className="accent-blue-600"
                />
                Default
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="aetheria-text-scale"
                  checked={textScale === "lg"}
                  onChange={() => persistScale("lg")}
                  className="accent-blue-600"
                />
                Larger
              </label>
            </fieldset>
            <fieldset className="space-y-1">
              <legend className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Font
              </legend>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="aetheria-font"
                  checked={font === "default"}
                  onChange={() => persistFont("default")}
                  className="accent-blue-600"
                />
                Default
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="aetheria-font"
                  checked={font === "readable"}
                  onChange={() => persistFont("readable")}
                  className="accent-blue-600"
                />
                System / readable
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="aetheria-font"
                  checked={font === "playful"}
                  onChange={() => persistFont("playful")}
                  className="accent-blue-600"
                />
                Playful
              </label>
            </fieldset>
          </div>
        </div>
      ) : null}
    </div>
  );
}
