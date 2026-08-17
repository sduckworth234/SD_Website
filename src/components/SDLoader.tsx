export function SDLoader({ label = "Loading" }: { label?: string }) {
  return (
    <div className="sd-loader" role="status" aria-live="polite" aria-label={label}>
      <svg aria-hidden="true" viewBox="0 0 120 64">
        <path
          className="sd-loader-stroke sd-loader-s"
          d="M54 12C42 4 21 7 17 20c-4 14 31 8 30 23-1 13-23 17-36 8"
          pathLength="100"
        />
        <path
          className="sd-loader-stroke sd-loader-d"
          d="M61 11v42m0-35c14-11 42-8 45 13 3 22-24 27-45 20"
          pathLength="100"
        />
      </svg>
      <span>{label}</span>
    </div>
  );
}
