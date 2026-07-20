import { OrionLogoMark } from '@/components/orion-logo-mark';

type OrionBrandProps = {
  context: 'ADMIN' | 'CLIENT';
  className?: string;
};

export default function OrionBrand({ context, className = '' }: OrionBrandProps) {
  return (
    <div className={`brand orion-brand ${className}`.trim()} data-brand-context={context.toLowerCase()}>
      <OrionLogoMark />
      <span className="brand-wordmark orion-brand-wordmark">
        <strong>ORION</strong>
        <small>SCALPER <b>V5</b></small>
      </span>
    </div>
  );
}
