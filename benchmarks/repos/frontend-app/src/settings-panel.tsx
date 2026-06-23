import { useState } from "react";
import { themes, type ThemeName } from "./theme";

export function SettingsPanel() {
  const [theme, setTheme] = useState<ThemeName>("system");

  return (
    <section aria-label="Settings">
      <label htmlFor="theme">Theme</label>
      <select id="theme" value={theme} onChange={(event) => setTheme(event.target.value as ThemeName)}>
        {themes.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </section>
  );
}
