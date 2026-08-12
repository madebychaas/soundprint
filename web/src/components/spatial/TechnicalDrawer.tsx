/**
 * Deeper measurements, collapsed by default.
 *
 * TechnicalPanel itself is untouched — it is the measurement layer and this
 * pass does not touch measurement. This only changes what contains it: a
 * plain <details> instead of always-visible panel, matching the hierarchy in
 * the brief (object → why this works → traits → context → measurements →
 * export). Native <details> keeps this keyboard- and screen-reader-usable
 * with zero client JS.
 */

export function TechnicalDrawer({ children }: { children: React.ReactNode }) {
  return (
    <details className="group rounded-2xl border border-line/70">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3.5 text-[13px] text-ink-2 transition-colors hover:text-ink [&::-webkit-details-marker]:hidden">
        <span className="text-ink-4 transition-transform group-open:rotate-90">›</span>
        Deeper measurements &amp; evidence
      </summary>
      <div className="border-t border-line/70 px-5 py-5">{children}</div>
    </details>
  );
}
