// FILE: CTCodeLogo.tsx
// Purpose: Render the CTCode mark as an inline SVG that follows theme foreground color.
// Layer: Shared app branding primitive

import type { SVGProps } from "react";
import { CTCODE_LOGO_PATHS } from "~/assets/ctcodeLogoPath";
import { cn } from "~/lib/utils";

export function CTCodeLogo({ className, ...props }: SVGProps<SVGSVGElement>) {
  const ariaLabel = props["aria-label"];

  return (
    <svg
      viewBox="0 0 577 580"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden={ariaLabel ? undefined : true}
      {...props}
      className={cn("shrink-0 text-foreground", className)}
    >
      {CTCODE_LOGO_PATHS.map((path) => (
        <path key={path} d={path} fill="currentColor" />
      ))}
    </svg>
  );
}
