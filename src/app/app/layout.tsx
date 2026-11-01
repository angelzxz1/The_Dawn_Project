import type { Metadata } from "next";
import { THEME_BOOT_SCRIPT } from "@/studio/shell/themeBoot";

export const metadata: Metadata = {
  title: { absolute: "Dawn — Studio" },
};

export default function StudioLayout({ children }: LayoutProps<"/app">) {
  return (
    <>
      {/* The saved theme, before anything draws. */}
      <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      {children}
    </>
  );
}
