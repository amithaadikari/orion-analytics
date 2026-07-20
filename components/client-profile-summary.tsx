import Link from 'next/link';
import { AtSign, MapPin, PencilLine, Phone, ShieldCheck } from 'lucide-react';
import ClientAvatar from '@/components/client-avatar';
import { clientProfileDisplayName, type ClientProfile } from '@/lib/client-profile';

type ClientProfileSummaryProps = {
  fullName: string;
  country: string | null;
  profile: ClientProfile;
};

export default function ClientProfileSummary({ fullName, country, profile }: ClientProfileSummaryProps) {
  const displayName = clientProfileDisplayName(profile, fullName);
  const profileStarted = Boolean(profile.nickname || profile.bio || profile.brokers.length || profile.tradingPairs.length || profile.telegramUsername || profile.phoneNumber);

  return (
    <section className="client-profile-summary-card" aria-labelledby="profile-summary-title">
      <div className="client-profile-summary-identity">
        <ClientAvatar avatarKey={profile.avatarKey} size="medium" />
        <div>
          <p className="eyebrow">Profile snapshot</p>
          <h2 id="profile-summary-title">{displayName}</h2>
          <span>{fullName}{country ? ` · ${country}` : ''}</span>
        </div>
      </div>

      <div className="client-profile-summary-copy">
        <p>{profile.bio || (profileStarted ? 'Add a short bio so Orion support can understand your trading focus.' : 'Complete your private trading profile with your preferred markets, brokers, and contact details.')}</p>
        <div className="client-profile-summary-contact" aria-label="Saved contact details">
          <span><AtSign size={13} aria-hidden="true" />{profile.telegramUsername ? `@${profile.telegramUsername}` : 'Telegram not added'}</span>
          <span><Phone size={13} aria-hidden="true" />{profile.phoneNumber || 'Phone not added'}</span>
          <span><MapPin size={13} aria-hidden="true" />{country || 'Country not set'}</span>
        </div>
      </div>

      <div className="client-profile-summary-preferences">
        <PreferencePreview label="Brokers" values={profile.brokers} empty="No brokers selected" />
        <PreferencePreview label="Markets" values={profile.tradingPairs} empty="No markets selected" />
      </div>

      <div className="client-profile-summary-actions">
        <small><ShieldCheck size={13} aria-hidden="true" />Visible to you and authorized Orion administrators.</small>
        <Link href="#profile"><PencilLine size={14} aria-hidden="true" />Edit profile</Link>
      </div>
    </section>
  );
}

function PreferencePreview({ label, values, empty }: { label: string; values: string[]; empty: string }) {
  const visible = values.slice(0, 3);
  return (
    <div>
      <small>{label}</small>
      <span className={visible.length ? '' : 'is-empty'}>
        {visible.length ? visible.map((value) => <i key={value}>{value}</i>) : empty}
        {values.length > visible.length && <b>+{values.length - visible.length}</b>}
      </span>
    </div>
  );
}
