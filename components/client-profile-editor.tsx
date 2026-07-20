'use client';

import React, { FormEvent, KeyboardEvent, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AtSign,
  Check,
  CircleUserRound,
  MessageSquareText,
  Phone,
  Plus,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import ClientAvatar from '@/components/client-avatar';
import {
  brokerSuggestions,
  clientAvatarPresets,
  clientProfileDisplayName,
  clientProfileLimits,
  tradingPairSuggestions,
  type ClientProfile,
} from '@/lib/client-profile';

type ClientProfileEditorProps = {
  fullName: string;
  email: string | null;
  country: string | null;
  plan: string;
  status: string;
  initialProfile: ClientProfile;
};

type ListKey = 'brokers' | 'tradingPairs';

export default function ClientProfileEditor({ fullName, email, country, plan, status, initialProfile }: ClientProfileEditorProps) {
  const router = useRouter();
  const [profile, setProfile] = useState(initialProfile);
  const [savedProfile, setSavedProfile] = useState(initialProfile);
  const [customBroker, setCustomBroker] = useState('');
  const [customPair, setCustomPair] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const dirty = JSON.stringify(profile) !== JSON.stringify(savedProfile);
  const displayName = clientProfileDisplayName(profile, fullName);
  const brokerChoices = useMemo(() => Array.from(new Set([...brokerSuggestions, ...profile.brokers])), [profile.brokers]);
  const pairChoices = useMemo(() => Array.from(new Set([...tradingPairSuggestions, ...profile.tradingPairs])), [profile.tradingPairs]);

  function change<K extends keyof ClientProfile>(key: K, value: ClientProfile[K]) {
    setProfile((current) => ({ ...current, [key]: value }));
    setMessage(null);
  }

  function toggleList(key: ListKey, value: string) {
    const limit = key === 'brokers' ? clientProfileLimits.brokers : clientProfileLimits.tradingPairs;
    const normalized = key === 'tradingPairs' ? value.trim().toUpperCase() : value.trim();
    if (!normalized) return;
    setProfile((current) => {
      const selected = current[key];
      const exists = selected.some((item) => item.toLowerCase() === normalized.toLowerCase());
      if (!exists && selected.length >= limit) {
        setMessage({ tone: 'error', text: `You can select up to ${limit} ${key === 'brokers' ? 'brokers' : 'markets'}.` });
        return current;
      }
      return { ...current, [key]: exists ? selected.filter((item) => item.toLowerCase() !== normalized.toLowerCase()) : [...selected, normalized] };
    });
  }

  function addCustom(key: ListKey) {
    const value = (key === 'brokers' ? customBroker : customPair).trim();
    if (value.length < 2) {
      setMessage({ tone: 'error', text: `Enter a valid ${key === 'brokers' ? 'broker name' : 'market symbol'}.` });
      return;
    }
    if (key === 'tradingPairs' && (value.length > 20 || !/^[A-Za-z0-9./_-]+$/.test(value))) {
      setMessage({ tone: 'error', text: 'Use a market symbol such as XAUUSD, EUR/USD, or BTCUSD.' });
      return;
    }
    toggleList(key, value);
    if (key === 'brokers') setCustomBroker('');
    else setCustomPair('');
  }

  function addWithEnter(event: KeyboardEvent<HTMLInputElement>, key: ListKey) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    addCustom(key);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch('/api/client-profile', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(profile),
      });
      const result = await response.json().catch(() => ({})) as { profile?: ClientProfile; error?: string };
      if (!response.ok || !result.profile) throw new Error(result.error || 'Unable to save your profile');
      setProfile(result.profile);
      setSavedProfile(result.profile);
      setMessage({ tone: 'success', text: 'Your Orion profile has been updated.' });
      router.refresh();
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Unable to save your profile' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="client-profile-editor" id="profile" aria-labelledby="client-profile-heading">
      <header className="client-profile-heading">
        <div>
          <p className="eyebrow">Personal account</p>
          <h2 id="client-profile-heading">Your trading profile</h2>
          <span>Personalize how your Orion workspace looks and keep your trading preferences together.</span>
        </div>
        <strong aria-hidden="true">ID</strong>
      </header>

      <div className="client-profile-layout">
        <aside className="client-profile-preview" aria-label="Profile preview">
          <div className="client-profile-preview-glow" aria-hidden="true" />
          <ClientAvatar avatarKey={profile.avatarKey} size="large" />
          <p className="eyebrow">Orion trader identity</p>
          <h3>{displayName}</h3>
          <span className="client-profile-real-name">{fullName}</span>
          <p>{profile.bio || 'Add a short trading bio to complete your private Orion profile.'}</p>
          <dl>
            <div><dt>Plan</dt><dd>{plan}</dd></div>
            <div><dt>Status</dt><dd data-status={status.toLowerCase()}>{status}</dd></div>
            <div><dt>Country</dt><dd>{country || 'Not set'}</dd></div>
          </dl>
          <div className="client-profile-contact-preview">
            <span><AtSign size={13} aria-hidden="true" />{profile.telegramUsername ? `@${profile.telegramUsername}` : 'Telegram not added'}</span>
            <span><Phone size={13} aria-hidden="true" />{profile.phoneNumber || 'Phone not added'}</span>
          </div>
          <small><ShieldCheck size={13} aria-hidden="true" />Visible only inside your secure Orion account.</small>
        </aside>

        <form className="client-profile-form" onSubmit={save} aria-busy={loading}>
          <fieldset className="client-profile-avatar-fieldset" disabled={loading}>
            <legend><span><CircleUserRound size={15} aria-hidden="true" /></span><b>Choose your avatar</b><small>Forex, crypto, and animated robot identities</small></legend>
            <div className="client-avatar-picker" role="group" aria-label="Trading avatar">
              {clientAvatarPresets.map((preset) => {
                const selected = profile.avatarKey === preset.key;
                return (
                  <button key={preset.key} type="button" aria-pressed={selected} className={selected ? 'is-selected' : ''} onClick={() => change('avatarKey', preset.key)}>
                    <ClientAvatar avatarKey={preset.key} size="medium" />
                    <span><strong>{preset.label}</strong><small>{preset.category}</small></span>
                    <i aria-hidden="true">{selected ? <Check size={12} /> : null}</i>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <fieldset className="client-profile-details" disabled={loading}>
            <legend><span><MessageSquareText size={15} aria-hidden="true" /></span><b>Profile details</b><small>Your private Orion identity</small></legend>
            <div className="client-profile-field-grid">
              <label>
                <span>Nickname</span>
                <input value={profile.nickname} maxLength={clientProfileLimits.nickname} autoComplete="nickname" placeholder="How Orion should greet you" onChange={(event) => change('nickname', event.target.value)} />
                <small>{profile.nickname.length}/{clientProfileLimits.nickname}</small>
              </label>
              <label>
                <span>Email</span>
                <input value={email || ''} type="email" disabled aria-label="Account email cannot be changed here" />
                <small>Managed by your secure account</small>
              </label>
              <label>
                <span>Telegram username</span>
                <span className="client-profile-input-prefix"><AtSign size={14} aria-hidden="true" /><input value={profile.telegramUsername} maxLength={80} autoComplete="off" placeholder="username" onChange={(event) => change('telegramUsername', event.target.value.replace(/^@/, ''))} /></span>
                <small>Without the @ symbol</small>
              </label>
              <label>
                <span>Phone number</span>
                <span className="client-profile-input-prefix"><Phone size={14} aria-hidden="true" /><input value={profile.phoneNumber} type="tel" maxLength={40} autoComplete="tel" placeholder="+94 77 123 4567" onChange={(event) => change('phoneNumber', event.target.value)} /></span>
                <small>Include your international code</small>
              </label>
              <label className="wide">
                <span>Trading bio</span>
                <textarea value={profile.bio} maxLength={clientProfileLimits.bio} rows={4} placeholder="For example: Gold and major-pair trader focused on disciplined risk." onChange={(event) => change('bio', event.target.value)} />
                <small>{profile.bio.length}/{clientProfileLimits.bio}</small>
              </label>
            </div>
          </fieldset>

          <ProfilePreferenceGroup
            title="Brokers you use"
            description="Profile preference only — this does not imply official compatibility."
            values={profile.brokers}
            choices={brokerChoices}
            inputValue={customBroker}
            placeholder="Add another broker"
            limit={clientProfileLimits.brokers}
            inputMaxLength={40}
            onInput={setCustomBroker}
            onToggle={(value) => toggleList('brokers', value)}
            onAdd={() => addCustom('brokers')}
            onKeyDown={(event) => addWithEnter(event, 'brokers')}
            disabled={loading}
          />

          <ProfilePreferenceGroup
            title="Most-traded markets"
            description="Select the symbols you trade most often; these are preferences, not live positions."
            values={profile.tradingPairs}
            choices={pairChoices}
            inputValue={customPair}
            placeholder="Add symbol, e.g. AUDUSD"
            limit={clientProfileLimits.tradingPairs}
            inputMaxLength={20}
            onInput={setCustomPair}
            onToggle={(value) => toggleList('tradingPairs', value)}
            onAdd={() => addCustom('tradingPairs')}
            onKeyDown={(event) => addWithEnter(event, 'tradingPairs')}
            disabled={loading}
          />

          <div className="client-profile-savebar">
            <div aria-live="polite">
              {message ? <p data-tone={message.tone}>{message.tone === 'success' ? <Check size={14} aria-hidden="true" /> : <X size={14} aria-hidden="true" />}{message.text}</p> : <span><SlidersHorizontal size={14} aria-hidden="true" />{dirty ? 'You have unsaved profile changes.' : 'Your profile is up to date.'}</span>}
            </div>
            <button type="submit" disabled={loading || !dirty}><Save size={15} aria-hidden="true" />{loading ? 'Saving profile…' : 'Save profile'}</button>
          </div>
        </form>
      </div>
    </section>
  );
}

type ProfilePreferenceGroupProps = {
  title: string;
  description: string;
  values: string[];
  choices: string[];
  inputValue: string;
  placeholder: string;
  limit: number;
  inputMaxLength: number;
  onInput: (value: string) => void;
  onToggle: (value: string) => void;
  onAdd: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  disabled: boolean;
};

function ProfilePreferenceGroup({ title, description, values, choices, inputValue, placeholder, limit, inputMaxLength, onInput, onToggle, onAdd, onKeyDown, disabled }: ProfilePreferenceGroupProps) {
  return (
    <fieldset className="client-profile-preferences" disabled={disabled}>
      <legend><span><SlidersHorizontal size={15} aria-hidden="true" /></span><b>{title}</b><small>{description}</small></legend>
      <div className="client-profile-chips" aria-label={`${title}: ${values.length} selected`}>
        {choices.map((choice) => {
          const selected = values.some((value) => value.toLowerCase() === choice.toLowerCase());
          return <button type="button" key={choice} aria-pressed={selected} onClick={() => onToggle(choice)}><i aria-hidden="true">{selected ? <Check size={11} /> : <Plus size={11} />}</i>{choice}</button>;
        })}
      </div>
      <div className="client-profile-custom-entry">
        <input value={inputValue} maxLength={inputMaxLength} placeholder={placeholder} onChange={(event) => onInput(event.target.value)} onKeyDown={onKeyDown} aria-label={placeholder} />
        <button type="button" onClick={onAdd}><Plus size={14} aria-hidden="true" />Add</button>
        <span>{values.length}/{limit} selected</span>
      </div>
    </fieldset>
  );
}
