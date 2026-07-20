import Link from 'next/link';
import { AtSign, PencilLine, Phone, ShieldCheck } from 'lucide-react';
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
  const hasContactDetails = Boolean(profile.telegramUsername || profile.phoneNumber);

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
          {profile.telegramUsername && <span><AtSign size={14} aria-hidden="true" />@{profile.telegramUsername}</span>}
          {profile.phoneNumber && <span><Phone size={14} aria-hidden="true" />{profile.phoneNumber}</span>}
          {!hasContactDetails && <span className="is-empty">Add Telegram or phone details</span>}
        </div>
      </div>

      <div className="client-profile-summary-preferences">
        <PreferencePreview label="Brokers" values={profile.brokers} empty="No brokers selected" />
        <PreferencePreview label="Markets" values={profile.tradingPairs} empty="No markets selected" />
      </div>

      <div className="client-profile-summary-actions">
        <small><ShieldCheck size={13} aria-hidden="true" />Visible to you and authorized Orion administrators.</small>
        <Link href="/portal/profile"><PencilLine size={14} aria-hidden="true" />Edit profile</Link>
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
        {visible.length ? visible.map((value) => <span className="client-profile-summary-chip" key={value}>{value}</span>) : empty}
        {values.length > visible.length && <span className="client-profile-summary-more">+{values.length - visible.length}</span>}
      </span>
    </div>
  );
}
