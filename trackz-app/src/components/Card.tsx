import type { ComponentChildren } from "preact";

interface CardProps {
  children: ComponentChildren;
  class?: string;
  onClick?: () => void;
}

/**
 * Flat card primitive — the base visual unit of the locked "Flat Minimal"
 * direction (Mockup B, Phase 3). No gradients, no shadows beyond the
 * container's own border. var(--surface-1) + 1px var(--border-subtle).
 */
export function Card({ children, class: className, onClick }: CardProps) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      class={`card ${className ?? ""}`}
      onClick={onClick}
      type={onClick ? "button" : undefined}
    >
      {children}
    </Tag>
  );
}
