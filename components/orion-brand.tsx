type OrionBrandProps = {
  context: 'ADMIN' | 'CLIENT';
  className?: string;
};

export default function OrionBrand({ context, className = '' }: OrionBrandProps) {
  return (
    <div className={`brand orion-brand ${className}`.trim()} aria-label={`Orion ${context.toLowerCase()}`}>
      <span className="brand-mark orion-brand-mark" aria-hidden="true">
        <span className="orion-brand-core" />
        <span className="orion-brand-orbit orion-brand-orbit--horizontal" />
        <span className="orion-brand-orbit orion-brand-orbit--angled" />
        <span className="orion-brand-planet" />
      </span>
      <span className="orion-brand-wordmark">
        <strong>ORION</strong>
        <em>{context}</em>
      </span>
    </div>
  );
}
