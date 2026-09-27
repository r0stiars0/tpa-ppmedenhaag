/**
 * The app's one switch style (TAD ADR-046(g)): a tinted track with the
 * selected segment raised in white. Used by the "Grup saya | Anak saya"
 * scope switch (ADR-025) and by Hadir's "Santri | Guru" view switch, so
 * the two look the same wherever they appear. Toggle buttons with
 * `aria-pressed`, each a 44px target, equal widths.
 */
export function SegmentedSwitch<T extends string>({
  options,
  value,
  onChange,
  label,
  className = '',
}: {
  options: readonly { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
  /** Accessible name only — no visible caption. */
  label: string
  className?: string
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={`grid gap-1 rounded-lg bg-ppme-primary/10 p-1 ${className}`}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={`min-h-11 whitespace-nowrap rounded-md px-3 text-sm transition-colors ${
              active
                ? 'bg-white font-bold text-ppme-primary shadow-sm'
                : 'font-semibold text-ppme-text/80 hover:bg-white/60'
            }`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
