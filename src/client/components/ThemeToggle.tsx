/**
 * The Theme_Preference control (Requirements 18.1, 18.2, 18.3, 18.4, 18.5, 18.6,
 * 18.9, 11.5, 11.7, 11.9).
 *
 * Three native radios in a `fieldset`, which is exactly Requirement 18.2's three
 * mutually exclusive settings: the browser keeps one and only one selected, and
 * `checked` is what assistive technology reports as the current setting without
 * an ARIA attribute of ours. The `legend` names the group, each radio has its own
 * `label` associated by `for` (Requirement 11.7), and the target area comes from
 * those labels, which `controls.css` floors at 24px in both directions
 * (Requirement 11.9). The focus indicator is the one `controls.css` draws for
 * everything focusable (Requirement 11.5).
 *
 * The setting is component-local state rather than part of the Query_State: it
 * describes this browser, not the view being shared, so selecting one writes no
 * address and adds no history entry (Requirement 18.9). It is also not part of
 * `AppState`, because nothing else in the app reads it — the stylesheet resolves
 * the applied theme from `data-theme` on the document element, so the whole of
 * "apply the Resolved_Theme to every displayed surface without reloading"
 * (Requirement 18.3) is that one attribute. Which means nothing about the
 * Search_Query, the Filter values, the Sort_Option, the hide-conflicts setting,
 * the page, or the loaded Busy_Schedule is touched when the theme changes: none
 * of them is on the path.
 *
 * `data-theme='system'` is set rather than removed for the system setting, which
 * `tokens.css` treats as "follow `prefers-color-scheme`" exactly as it treats no
 * attribute at all. So a visitor moving from dark back to system follows the
 * operating system again immediately (Requirement 18.1).
 *
 * The first render reads the stored setting through `loadTheme`, which resolves
 * an unreadable or wrong-version value to `system` and removes the key with no
 * message shown (Requirements 18.4, 18.5). The inline script in `index.html` has
 * already set the same attribute from the same key before first paint
 * (Requirement 18.8); the effect below re-asserts the value this component holds
 * rather than re-deciding it, so the two paths cannot disagree.
 *
 * A write that throws is reported by `saveTheme` as `persisted: false` and
 * deliberately ignored here: the setting still applies for the visit and nothing
 * is displayed that would interrupt browsing (Requirement 18.6).
 */

import { useEffect, useState } from 'preact/hooks';
import {
  loadTheme,
  saveTheme,
  THEME_PREFERENCES,
  type ThemePreference,
} from '../themeStore';

/** The group's accessible name (Requirements 18.2, 11.7). */
export const THEME_GROUP_LABEL = 'Color theme';

/** The visitor-facing name of each setting. Exported so a test names them once. */
export const THEME_LABELS: Readonly<Record<ThemePreference, string>> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
};

/** The radios share one name, which is what makes them mutually exclusive. */
export const THEME_RADIO_NAME = 'theme-preference';

function optionId(preference: ThemePreference): string {
  return `theme-${preference}`;
}

export interface ThemeToggleProps {
  /**
   * Where the setting is read and written. Injected for tests the same way the
   * Busy_Schedule's storage is; the browser's `localStorage` otherwise.
   */
  readonly store?: Storage;
}

export function ThemeToggle({ store }: ThemeToggleProps = {}) {
  const [preference, setPreference] = useState<ThemePreference>(() =>
    loadTheme(store),
  );

  // Requirement 18.3: one attribute carries the Resolved_Theme to every surface,
  // with no reload and nothing else re-rendered on account of it.
  useEffect(() => {
    document.documentElement.dataset.theme = preference;
  }, [preference]);

  return (
    <fieldset class="theme-toggle" data-testid="theme-toggle">
      {/* Requirements 18.2, 11.7: the group is named for assistive technology. */}
      <legend class="theme-toggle__label">{THEME_GROUP_LABEL}</legend>

      {THEME_PREFERENCES.map(option => (
        <span class="theme-toggle__option" key={option}>
          <input
            id={optionId(option)}
            class="theme-toggle__radio"
            type="radio"
            name={THEME_RADIO_NAME}
            value={option}
            checked={preference === option}
            onChange={() => {
              setPreference(option);
              // Requirement 18.6: the return is not read on purpose. A failed
              // write costs later visits, not this one.
              saveTheme(option, store);
            }}
          />
          <label class="theme-toggle__option-label" for={optionId(option)}>
            {THEME_LABELS[option]}
          </label>
        </span>
      ))}
    </fieldset>
  );
}
