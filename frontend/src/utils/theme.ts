// 从 Toonflow-web 的 src/utils/theme.ts 移植——纯工具函数，无业务逻辑。
// 去掉了它依赖的 settingStore（持久化主题偏好），这里只保留"从一个 hex 生成品牌色阶 + 暗色模式切换"这部分。

const hexToHsl = (hex: string) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return { h: 0, s: 0, l: 0 };
  const r = parseInt(result[1], 16) / 255;
  const g = parseInt(result[2], 16) / 255;
  const b = parseInt(result[3], 16) / 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0,
    s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
};

const hslToHex = (h: number, s: number, l: number) => {
  s /= 100;
  l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0,
    g = 0,
    b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const toHex = (n: number) =>
    Math.round((n + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

const generateColorPalette = (hex: string) => {
  const { h, s, l } = hexToHsl(hex);
  const lightLevels = [97, 92, 85, 75, 62, l, Math.max(l - 12, 20), Math.max(l - 24, 15), Math.max(l - 36, 10), Math.max(l - 48, 5)];
  return lightLevels.map((level) => hslToHex(h, s, level));
};

export const applyThemeMode = (mode: "light" | "dark" | "auto") => {
  const targetMode = mode === "auto" ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : mode;
  if (targetMode === "dark") {
    document.documentElement.setAttribute("theme-mode", "dark");
    document.documentElement.classList.add("dark");
  } else {
    document.documentElement.removeAttribute("theme-mode");
    document.documentElement.classList.remove("dark");
  }
};

export const applyThemeColor = (color: string) => {
  const root = document.documentElement;
  const palette = generateColorPalette(color);
  const isDark = root.getAttribute("theme-mode") === "dark";
  const colors = isDark ? [...palette].reverse() : palette;
  colors.forEach((c, i) => root.style.setProperty(`--td-brand-color-${i + 1}`, c));
  ["", "-hover:5", "-focus:2", "-active:7", "-disabled:3", "-light:1", "-light-hover:2"].forEach((suffix) => {
    const [name, level] = suffix.split(":");
    root.style.setProperty(`--td-brand-color${name}`, level ? `var(--td-brand-color-${level})` : "var(--td-brand-color-6)");
  });
  root.style.setProperty("--td-text-color-brand", `var(--td-brand-color-${isDark ? 8 : 7})`);
  root.style.setProperty("--td-text-color-link", "var(--td-brand-color-8)");
};
