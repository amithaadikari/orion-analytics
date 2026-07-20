'use client';

import React, {
  FormEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Archive,
  ArrowRight,
  Check,
  CheckCircle2,
  CloudUpload,
  Download,
  FileArchive,
  FileCheck2,
  FileCog,
  FileUp,
  LoaderCircle,
  LockKeyhole,
  MonitorCheck,
  PackageCheck,
  Pencil,
  RefreshCw,
  RotateCcw,
  ServerCog,
  ShieldCheck,
  Trash2,
  UploadCloud,
  UsersRound,
  X,
} from 'lucide-react';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import styles from './release-manager.module.css';

type ReleasePlatform = 'MT4' | 'MT5' | 'Both';
type ReleaseSource = 'private' | 'external' | 'none';

type Release = {
  id: string;
  version: string;
  title: string;
  release_notes: string | null;
  platform: ReleasePlatform;
  published: boolean;
  released_at: string;
  published_at: string | null;
  promoted_at: string | null;
  archived_at: string | null;
  asset_status: string;
  source: ReleaseSource;
  file_name: string | null;
  file_size: number | null;
  file_type: string | null;
  checksum_sha256: string | null;
  file_verified_at: string | null;
  current_platforms: string[];
  download_count: number;
  unique_clients: number;
  last_downloaded_at: string | null;
};

type ReleaseData = {
  releases: Release[];
  channels: unknown;
  summary: Record<string, unknown>;
  storageReady: boolean;
  metricsAvailable: boolean;
};

type ConfirmAction = 'publish' | 'restore' | 'archive' | 'delete';
type UploadStage = 'idle' | 'saving' | 'preparing' | 'uploading' | 'verifying' | 'complete';

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const ALLOWED_EXTENSIONS = ['.ex4', '.ex5', '.zip'];
const EMPTY_RELEASES: Release[] = [];

export default function ReleaseManager({ canWrite }: { canWrite: boolean }) {
  const [data, setData] = useState<ReleaseData | null>(null);
  const dataRef = useRef<ReleaseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [staleError, setStaleError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [platformFilter, setPlatformFilter] = useState('All');
  const [editor, setEditor] = useState<Release | null | undefined>(undefined);
  const [confirmation, setConfirmation] = useState<{ action: ConfirmAction; release: Release } | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (quiet && dataRef.current) setRefreshing(true);
    else setLoading(true);
    setError('');
    if (!quiet) setStaleError('');
    try {
      const body = await requestJson('/api/releases', { cache: 'no-store', credentials: 'same-origin' });
      const next = parseReleaseData(body);
      dataRef.current = next;
      setData(next);
      setStaleError('');
    } catch (reason) {
      const message = errorMessage(reason, 'Secure release records could not be loaded.');
      if (dataRef.current) setStaleError(message);
      else setError(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const releases = data?.releases || EMPTY_RELEASES;
  const currentTargets = useMemo(() => resolveCurrentTargets(data), [data]);
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return releases.filter((release) => {
      const status = releaseStatus(release);
      const statusMatches = statusFilter === 'All' || statusFilter === status;
      const platformMatches = platformFilter === 'All' || release.platform === platformFilter || release.platform === 'Both';
      const searchMatches = !query || `${release.version} ${release.title} ${release.platform} ${release.release_notes || ''} ${release.file_name || ''}`.toLowerCase().includes(query);
      return statusMatches && platformMatches && searchMatches;
    });
  }, [platformFilter, releases, search, statusFilter]);

  const metrics = useMemo(() => releaseMetrics(data, currentTargets), [currentTargets, data]);

  function changed(message?: string) {
    if (message) {
      setNotice(message);
      window.setTimeout(() => setNotice((current) => current === message ? '' : current), 6000);
    }
    void load(true);
  }

  if (loading && !data) return <ReleaseLoading />;

  if (error && !data) {
    return (
      <section className={styles.initialError} role="alert" aria-labelledby="release-error-title">
        <span aria-hidden="true"><ServerCog size={24} /></span>
        <div><small>Protected delivery unavailable</small><h2 id="release-error-title">Release Center could not connect</h2><p>{error}</p></div>
        <button type="button" onClick={() => void load()}><RefreshCw size={15} aria-hidden="true" />Try again</button>
      </section>
    );
  }

  return (
    <section className={styles.root} aria-labelledby="release-center-title" aria-busy={refreshing}>
      <h2 className={styles.visuallyHidden} id="release-center-title">Secure Release Center</h2>

      {(notice || staleError) && (
        <div className={notice ? styles.notice : styles.staleNotice} role={staleError ? 'alert' : 'status'}>
          <span aria-hidden="true">{notice ? <CheckCircle2 size={16} /> : <RefreshCw size={16} />}</span>
          <p>{notice || `Refresh failed. Showing the last available release records. ${staleError}`}</p>
          {staleError && <button type="button" onClick={() => void load(true)}>Retry</button>}
        </div>
      )}

      <header className={styles.commandBar}>
        <div>
          <span className={styles.secureLabel}><LockKeyhole size={13} aria-hidden="true" />Protected product delivery</span>
          <p>Stage, verify, and release Orion builds without exposing source files to client portals.</p>
        </div>
        <div className={styles.commandActions}>
          <button type="button" className={styles.refreshButton} onClick={() => void load(true)} disabled={refreshing} aria-label="Refresh release records">
            <RefreshCw size={15} aria-hidden="true" />
          </button>
          {canWrite && <button type="button" className={styles.primaryButton} onClick={() => setEditor(null)} disabled={!data?.storageReady} title={!data?.storageReady ? 'Apply the Secure EA Release Center migration first.' : undefined}><UploadCloud size={16} aria-hidden="true" />Upload new build</button>}
        </div>
      </header>

      <div className={styles.metricGrid}>
        {metrics.map((metric) => <ReleaseMetric key={metric.label} {...metric} />)}
      </div>

      <section className={styles.deliveryHero} aria-labelledby="live-delivery-title">
        <div className={styles.heroIntro}>
          <span className={styles.heroIcon} aria-hidden="true"><ShieldCheck size={23} /></span>
          <div><small>Current delivery</small><h3 id="live-delivery-title">Protected client channel</h3><p>Only eligible clients with an active matching-platform license can request these builds.</p></div>
          <span className={styles.gatewayState} data-ready={data?.storageReady ? 'true' : 'false'}><i aria-hidden="true" />{data?.storageReady ? 'Private uploads enabled' : 'Release setup required'}</span>
        </div>

        {currentTargets.length ? (
          <div className={styles.liveGrid}>
            {currentTargets.map(({ platform, release }) => <CurrentReleaseCard key={platform} platform={platform} release={release} metricsAvailable={Boolean(data?.metricsAvailable)} />)}
          </div>
        ) : (
          <div className={styles.noCurrent}>
            <span aria-hidden="true"><PackageCheck size={24} /></span>
            <div><strong>No live release channel yet</strong><p>Create a private draft, attach a verified file, then publish it when it is ready for clients.</p></div>
            {canWrite && data?.storageReady && <button type="button" onClick={() => setEditor(null)}>Create first draft <ArrowRight size={14} aria-hidden="true" /></button>}
          </div>
        )}
      </section>

      <section className={styles.history} aria-labelledby="release-history-title">
        <header className={styles.historyHeader}>
          <div><small>Version control</small><h3 id="release-history-title">Release history</h3><p>Private drafts, previous builds, and live delivery records.</p></div>
          <span aria-live="polite">{visible.length} of {releases.length}</span>
        </header>

        <div className={styles.filters} role="group" aria-label="Filter release history">
          <label className={styles.searchField}><span className={styles.visuallyHidden}>Search releases</span><FileCog size={15} aria-hidden="true" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search version, title, or file…" /></label>
          <label><span>Status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>{['All', 'Live', 'Published', 'Draft', 'Archived'].map((value) => <option key={value}>{value}</option>)}</select></label>
          <label><span>Platform</span><select value={platformFilter} onChange={(event) => setPlatformFilter(event.target.value)}>{['All', 'MT4', 'MT5'].map((value) => <option key={value}>{value}</option>)}</select></label>
        </div>

        {visible.length ? (
          <ol className={styles.releaseList}>
            {visible.map((release) => (
              <ReleaseRow
                key={release.id}
                release={release}
                canWrite={canWrite && Boolean(data?.storageReady)}
                metricsAvailable={Boolean(data?.metricsAvailable)}
                onEdit={() => setEditor(release)}
                onConfirm={(action) => setConfirmation({ action, release })}
              />
            ))}
          </ol>
        ) : (
          <div className={styles.emptyHistory}>
            <FileArchive size={25} aria-hidden="true" />
            <strong>{releases.length ? 'No releases match these filters' : 'No releases have been created'}</strong>
            <p>{releases.length ? 'Try another version, status, or platform.' : 'Your first upload will begin as a private draft.'}</p>
            {canWrite && data?.storageReady && !releases.length && <button type="button" onClick={() => setEditor(null)}>Upload first build</button>}
          </div>
        )}
      </section>

      {editor !== undefined && (
        <ReleaseEditor
          value={editor || undefined}
          storageReady={Boolean(data?.storageReady)}
          onClose={() => setEditor(undefined)}
          onChanged={() => changed()}
          onComplete={(message) => changed(message)}
        />
      )}

      {confirmation && (
        <ReleaseActionDialog
          action={confirmation.action}
          release={confirmation.release}
          onClose={() => setConfirmation(null)}
          onComplete={(message) => { setConfirmation(null); changed(message); }}
        />
      )}
    </section>
  );
}

function ReleaseMetric({ label, value, detail, tone, Icon }: { label: string; value: string; detail: string; tone: string; Icon: React.ComponentType<{ size?: number; 'aria-hidden'?: boolean }> }) {
  return <article className={styles.metric} data-tone={tone}><span aria-hidden="true"><Icon size={17} /></span><div><small>{label}</small><strong>{value}</strong><p>{detail}</p></div></article>;
}

function CurrentReleaseCard({ platform, release, metricsAvailable }: { platform: 'MT4' | 'MT5'; release: Release; metricsAvailable: boolean }) {
  return (
    <article className={styles.liveCard}>
      <header><span className={styles.platformMark}>{platform}</span><div><small>Live now</small><strong>{formatVersion(release.version)}</strong></div><span className={styles.livePill}><i aria-hidden="true" />Current</span></header>
      <h4>{release.title}</h4>
      <div className={styles.deliveryFlow} aria-label="Verified build delivered through the protected Orion gateway to licensed clients">
        <span><FileCheck2 size={16} aria-hidden="true" /><small>Build</small><strong>{integrityLabel(release)}</strong></span><i aria-hidden="true" /><span><ShieldCheck size={16} aria-hidden="true" /><small>Gateway</small><strong>Protected</strong></span><i aria-hidden="true" /><span><UsersRound size={16} aria-hidden="true" /><small>Access</small><strong>Licensed</strong></span>
      </div>
      <dl><div><dt>Published</dt><dd>{formatDate(release.promoted_at || release.published_at || release.released_at)}</dd></div><div><dt>Delivery requests</dt><dd>{metricsAvailable ? release.download_count.toLocaleString() : 'Unavailable'}</dd></div><div><dt>Source</dt><dd>{sourceLabel(release)}</dd></div></dl>
    </article>
  );
}

function ReleaseRow({ release, canWrite, metricsAvailable, onEdit, onConfirm }: { release: Release; canWrite: boolean; metricsAvailable: boolean; onEdit: () => void; onConfirm: (action: ConfirmAction) => void }) {
  const status = releaseStatus(release);
  const ready = releaseReady(release);
  const isCurrent = status === 'Live';
  const wasPublished = Boolean(release.published_at || release.promoted_at || release.archived_at);
  const canDelete = metricsAvailable && !wasPublished && !release.published && release.download_count === 0 && !release.archived_at && !isCurrent;
  const canReplace = status === 'Draft';

  return (
    <li className={styles.releaseRow} data-status={status.toLowerCase()}>
      <div className={styles.releaseIdentity}>
        <span className={styles.versionBlock}><small>Version</small><strong>{formatVersion(release.version)}</strong></span>
        <div><span className={styles.statusPill} data-status={status.toLowerCase()}><i aria-hidden="true" />{status}</span><h4>{release.title}</h4><p>{release.release_notes || 'No release notes added.'}</p></div>
      </div>
      <div className={styles.releaseFacts}>
        <span><small>Platform</small><strong>{release.platform}</strong></span>
        <span><small>Source</small><strong>{sourceLabel(release)}</strong></span>
        <span><small>Integrity</small><strong data-ready={ready ? 'true' : 'false'}>{integrityLabel(release)}</strong></span>
        <span><small>File</small><strong title={release.file_name || undefined}>{release.file_name || 'Not attached'}</strong><em>{release.file_size ? formatBytes(release.file_size) : '—'}</em></span>
        <span><small>Requests</small><strong>{metricsAvailable ? release.download_count.toLocaleString() : '—'}</strong><em>{metricsAvailable ? `${release.unique_clients.toLocaleString()} clients` : 'Metrics unavailable'}</em></span>
        <span><small>Last activity</small><strong>{release.last_downloaded_at ? formatDate(release.last_downloaded_at) : 'No requests'}</strong><em>{formatChecksum(release.checksum_sha256)}</em></span>
      </div>
      {canWrite && (
        <div className={styles.rowActions}>
          {!release.archived_at && <button type="button" onClick={onEdit}><Pencil size={13} aria-hidden="true" />{canReplace ? 'Edit / replace file' : 'Edit details'}</button>}
          {!isCurrent && (
            <button type="button" className={styles.publishAction} disabled={!ready} title={!ready ? 'Attach and verify a release file before publishing.' : undefined} onClick={() => onConfirm(wasPublished ? 'restore' : 'publish')}>
              {wasPublished ? <RotateCcw size={13} aria-hidden="true" /> : <UploadCloud size={13} aria-hidden="true" />}{wasPublished ? 'Restore' : 'Publish'}
            </button>
          )}
          {!isCurrent && !release.archived_at && wasPublished && <button type="button" onClick={() => onConfirm('archive')}><Archive size={13} aria-hidden="true" />Archive</button>}
          {canDelete && <button type="button" className={styles.dangerAction} onClick={() => onConfirm('delete')}><Trash2 size={13} aria-hidden="true" />Delete draft</button>}
        </div>
      )}
    </li>
  );
}

function ReleaseEditor({ value, storageReady, onClose, onChanged, onComplete }: { value?: Release; storageReady: boolean; onClose: () => void; onChanged: () => void; onComplete: (message: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [stage, setStage] = useState<UploadStage>('idle');
  const [error, setError] = useState('');
  const [savedRelease, setSavedRelease] = useState<Release | null>(value || null);
  const createKeyRef = useRef(idempotencyKey());
  const uploadKeyRef = useRef(idempotencyKey());
  const dialogRef = useRef<HTMLFormElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const busy = ['saving', 'preparing', 'uploading', 'verifying'].includes(stage);
  const canReplaceFile = !value || releaseStatus(value) === 'Draft';
  const identityLocked = !canReplaceFile || Boolean(value?.file_name);

  useDialogFocus(dialogRef, closeRef);

  function requestClose() { if (!busy) onClose(); }

  function chooseFile(candidate?: File) {
    setError('');
    if (!candidate) { setFile(null); return; }
    const issue = validateSelectedFile(candidate);
    if (issue) { setFile(null); setError(issue); return; }
    uploadKeyRef.current = idempotencyKey();
    setFile(candidate);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || stage === 'complete') return;
    setError('');
    const values = new FormData(event.currentTarget);
    const metadata = {
      version: String(values.get('version') || '').trim(),
      title: String(values.get('title') || '').trim(),
      release_notes: String(values.get('release_notes') || '').trim(),
      platform: String(values.get('platform') || '') as ReleasePlatform,
    };
    if (file) {
      const compatibilityIssue = validateFilePlatform(file, metadata.platform);
      if (compatibilityIssue) { setError(compatibilityIssue); return; }
    }
    let persisted = savedRelease;
    try {
      setStage('saving');
      const body = value
        ? await requestJson('/api/releases', jsonRequest('PATCH', { id: value.id, data: metadata }))
        : await requestJson('/api/releases', jsonRequest('POST', metadata, createKeyRef.current));
      persisted = releaseFromResponse(body);
      if (!persisted) throw new Error('The draft was saved but its release record could not be confirmed.');
      setSavedRelease(persisted);
      onChanged();

      if (!file) {
        setStage('complete');
        onComplete(`${formatVersion(persisted.version)} was saved as a private draft.`);
        return;
      }

      setStage('preparing');
      const intentBody = await requestJson(`/api/releases/${persisted.id}/upload-intents`, jsonRequest('POST', {
        file_name: file.name,
        file_size: file.size,
        file_type: contentTypeForFile(file.name),
      }, uploadKeyRef.current));
      const intent = parseUploadIntent(intentBody);
      validateServerConstraints(file, intent.constraints);

      setStage('uploading');
      const { error: uploadError } = await createSupabaseBrowserClient().storage
        .from(intent.bucket)
        .uploadToSignedUrl(intent.path, intent.token, file, {
          contentType: contentTypeForFile(file.name),
          upsert: false,
        });
      if (uploadError) throw new Error(uploadError.message || 'The private file upload did not complete.');

      setStage('verifying');
      const completeBody = await requestJson(
        `/api/releases/${persisted.id}/upload-intents/${intent.id}/complete`,
        jsonRequest('POST', {}, idempotencyKey()),
      );
      const completed = releaseFromResponse(completeBody) || persisted;
      setSavedRelease(completed);
      setStage('complete');
      onComplete(`${formatVersion(completed.version)} is verified and saved as a private draft.`);
    } catch (reason) {
      setStage('idle');
      const suffix = persisted && !value ? ' The private draft was saved, so you can reopen it and retry the file.' : '';
      setError(`${errorMessage(reason, 'The release could not be saved.')}${suffix}`);
      if (persisted) onChanged();
    }
  }

  const stageIndex = stage === 'saving' ? 1 : stage === 'preparing' || stage === 'uploading' ? 2 : stage === 'verifying' || stage === 'complete' ? 3 : 0;

  return (
    <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose(); }}>
      <form ref={dialogRef} className={styles.editor} role="dialog" aria-modal="true" aria-labelledby="release-editor-title" aria-busy={busy} onSubmit={submit} onKeyDown={(event) => handleDialogKeyDown(event, requestClose, busy)}>
        <header className={styles.dialogHeader}>
          <span aria-hidden="true"><CloudUpload size={20} /></span>
          <div><small>{value ? 'Release workspace' : 'Secure upload'}</small><h2 id="release-editor-title">{value ? `Edit ${formatVersion(value.version)}` : 'Create a private release draft'}</h2><p>{value ? (canReplaceFile ? 'Update the release details or attach a replacement build.' : 'Update client-facing release details. Live and previous build files remain locked.') : 'The release record is saved first. Its file remains private until you explicitly publish.'}</p></div>
          <button ref={closeRef} type="button" className={styles.closeButton} onClick={requestClose} disabled={busy} aria-label="Close release workspace"><X size={18} aria-hidden="true" /></button>
        </header>

        <ol className={styles.stageRail} aria-label="Release preparation stages">
          <Stage number="01" label="Draft details" state={stageIndex > 1 || stage === 'complete' ? 'done' : stageIndex === 1 ? 'active' : 'idle'} />
          <Stage number="02" label="Private upload" state={stageIndex > 2 || stage === 'complete' ? 'done' : stageIndex === 2 ? 'active' : 'idle'} />
          <Stage number="03" label="Integrity check" state={stage === 'complete' ? 'done' : stageIndex === 3 ? 'active' : 'idle'} />
        </ol>

        {stage === 'complete' ? (
          <div className={styles.successState} role="status">
            <span aria-hidden="true"><CheckCircle2 size={30} /></span>
            <small>Private draft ready</small>
            <h3>{formatVersion(savedRelease?.version || value?.version || 'Release')} is prepared</h3>
            <p>{file ? 'The file was uploaded and its secure release record was verified. Clients cannot access it until you publish.' : 'The release details were saved. Attach a file before publishing to client portals.'}</p>
            <button type="button" className={styles.primaryButton} onClick={onClose}>Return to Release Center <ArrowRight size={15} aria-hidden="true" /></button>
          </div>
        ) : (
          <>
            <div className={styles.editorBody}>
              <fieldset className={styles.detailsFields} disabled={busy}>
                <legend>Release details</legend>
                <div className={styles.twoFields}>
                  <label><span>Version</span><input name="version" required maxLength={40} defaultValue={value?.version} placeholder="2.4.0" autoComplete="off" readOnly={identityLocked} /></label>
                  <label><span>Platform</span><select name={identityLocked ? undefined : 'platform'} defaultValue={value?.platform || 'MT5'} disabled={identityLocked}><option>MT5</option><option>MT4</option><option>Both</option></select>{identityLocked && <input type="hidden" name="platform" value={value?.platform || 'MT5'} />}</label>
                </div>
                <label><span>Release title</span><input name="title" required maxLength={140} defaultValue={value?.title} placeholder="Orion Scalper 2.4" /></label>
                <label><span>Release notes <em>Shown in the client Software Center</em></span><textarea name="release_notes" rows={5} maxLength={4000} defaultValue={value?.release_notes || ''} placeholder="Summarize improvements, fixes, and setup notes…" /></label>
              </fieldset>

              <section className={styles.uploadPanel} aria-labelledby="release-file-title">
                <header><div><small>Protected source</small><h3 id="release-file-title">{value?.file_name ? 'Release file' : 'Attach a build'}</h3></div><ShieldCheck size={18} aria-hidden="true" /></header>
                {!storageReady ? (
                  <div className={styles.storageWarning}><ServerCog size={18} aria-hidden="true" /><div><strong>Secure Release Center setup required</strong><p>Apply the release database migration before creating drafts or uploading private builds.</p></div></div>
                ) : canReplaceFile ? (
                  <div
                    className={styles.dropzone}
                    data-dragging={dragging || undefined}
                    data-selected={file ? 'true' : undefined}
                    onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
                    onDragOver={(event) => event.preventDefault()}
                    onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }}
                    onDrop={(event) => { event.preventDefault(); setDragging(false); chooseFile(event.dataTransfer.files[0]); }}
                  >
                    <input ref={fileInputRef} className={styles.fileInput} type="file" accept=".ex4,.ex5,.zip,application/zip,application/octet-stream" onChange={(event) => chooseFile(event.target.files?.[0])} tabIndex={-1} aria-hidden="true" />
                    <span aria-hidden="true">{file ? <FileCheck2 size={25} /> : <FileUp size={25} />}</span>
                    {file ? <div><strong>{file.name}</strong><p>{formatBytes(file.size)} · {file.type || contentTypeForFile(file.name)}</p></div> : <div><strong>Drop an Orion build here</strong><p>.ex4, .ex5, or .zip · up to 50 MB</p></div>}
                    <button type="button" onClick={() => fileInputRef.current?.click()} disabled={busy}>{file ? 'Choose another file' : 'Choose file'}</button>
                  </div>
                ) : (
                  <div className={styles.lockedFile}><LockKeyhole size={18} aria-hidden="true" /><div><strong>{value?.file_name || sourceLabel(value!)}</strong><p>Published build files are immutable. Create a new version to replace the live binary.</p></div></div>
                )}
                <p className={styles.protectionNote}><LockKeyhole size={13} aria-hidden="true" />Files remain private and are served only after Orion verifies the client account, plan, and platform license.</p>
              </section>
            </div>

            {busy && <UploadProgress stage={stage} />}
            {error && <p className={styles.formError} role="alert">{error}</p>}

            <footer className={styles.dialogFooter}>
              <button type="button" className={styles.secondaryButton} onClick={requestClose} disabled={busy}>Cancel</button>
              <button type="submit" className={styles.primaryButton} disabled={busy || !storageReady}>{busy ? <LoaderCircle className={styles.spin} size={16} aria-hidden="true" /> : <CloudUpload size={16} aria-hidden="true" />}{submitLabel({ value, file, storageReady, stage })}</button>
            </footer>
          </>
        )}
      </form>
    </div>
  );
}

function Stage({ number, label, state }: { number: string; label: string; state: 'idle' | 'active' | 'done' }) {
  return <li data-state={state}><span aria-hidden="true">{state === 'done' ? <Check size={13} /> : number}</span><strong>{label}</strong></li>;
}

function UploadProgress({ stage }: { stage: UploadStage }) {
  const copy = stage === 'saving'
    ? ['Saving private draft', 'Creating the protected release record first.']
    : stage === 'preparing'
      ? ['Preparing secure upload', 'Requesting a short-lived private storage destination.']
      : stage === 'uploading'
        ? ['Uploading securely', 'Transfer time depends on the file size and connection. No percentage is estimated.']
        : ['Checking file integrity', 'Confirming the uploaded object before the draft can be published.'];
  return <div className={styles.uploadProgress} role="status"><span aria-hidden="true"><LoaderCircle className={styles.spin} size={18} /></span><div><strong>{copy[0]}</strong><p>{copy[1]}</p></div><i aria-hidden="true" /></div>;
}

function ReleaseActionDialog({ action, release, onClose, onComplete }: { action: ConfirmAction; release: Release; onClose: () => void; onComplete: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useDialogFocus(dialogRef, closeRef);

  const config = action === 'publish'
    ? { eyebrow: 'Client release', title: `Publish ${formatVersion(release.version)}?`, body: `Eligible ${release.platform} clients will see this build immediately. Any current matching channel will remain in history for rollback.`, confirm: 'Publish to clients', Icon: UploadCloud }
    : action === 'restore'
      ? { eyebrow: 'Version rollback', title: `Restore ${formatVersion(release.version)}?`, body: `New secure ${release.platform} download requests will use this version. The current build will remain in release history.`, confirm: 'Restore this version', Icon: RotateCcw }
      : action === 'archive'
        ? { eyebrow: 'Release history', title: `Archive ${formatVersion(release.version)}?`, body: 'This build will stay in the audit history but will no longer be available as a release candidate.', confirm: 'Archive release', Icon: Archive }
        : { eyebrow: 'Unused private draft', title: `Delete ${formatVersion(release.version)}?`, body: 'This draft has never been published or requested. Its release record and private file cannot be recovered after deletion.', confirm: 'Delete private draft', Icon: Trash2 };

  function requestClose() { if (!busy) onClose(); }

  async function confirm() {
    setBusy(true);
    setError('');
    try {
      if (action === 'publish' || action === 'restore') {
        await requestJson(`/api/releases/${release.id}/publish`, jsonRequest('POST', { notify_clients: true }, idempotencyKey()));
      } else if (action === 'archive') {
        await requestJson(`/api/releases/${release.id}/archive`, jsonRequest('POST', {}, idempotencyKey()));
      } else {
        await requestJson('/api/releases', jsonRequest('DELETE', { id: release.id }, idempotencyKey()));
      }
      const message = action === 'publish'
        ? `${formatVersion(release.version)} is now live for eligible clients.`
        : action === 'restore'
          ? `${formatVersion(release.version)} was restored to the protected client channel.`
          : action === 'archive'
            ? `${formatVersion(release.version)} was archived.`
            : `${formatVersion(release.version)} private draft was deleted.`;
      onComplete(message);
    } catch (reason) {
      const fallback = action === 'publish' ? 'The release could not be published.' : action === 'restore' ? 'The release could not be restored.' : action === 'archive' ? 'The release could not be archived.' : 'The private draft could not be deleted.';
      setError(errorMessage(reason, fallback));
      setBusy(false);
    }
  }

  return (
    <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose(); }}>
      <div ref={dialogRef} className={styles.confirmDialog} role="dialog" aria-modal="true" aria-labelledby="release-confirm-title" aria-describedby="release-confirm-copy" aria-busy={busy} onKeyDown={(event) => handleDialogKeyDown(event, requestClose, busy)}>
        <button ref={closeRef} type="button" className={styles.closeButton} onClick={requestClose} disabled={busy} aria-label="Close confirmation"><X size={18} aria-hidden="true" /></button>
        <span className={styles.confirmIcon} data-danger={action === 'delete' || undefined} aria-hidden="true"><config.Icon size={22} /></span>
        <small>{config.eyebrow}</small><h2 id="release-confirm-title">{config.title}</h2><p id="release-confirm-copy">{config.body}</p>
        {(action === 'publish' || action === 'restore') && <div className={styles.confirmFacts}><span><small>Platform</small><strong>{release.platform}</strong></span><span><small>File integrity</small><strong>{integrityLabel(release)}</strong></span><span><small>Client notice</small><strong>Enabled</strong></span></div>}
        {error && <p className={styles.formError} role="alert">{error}</p>}
        <div className={styles.confirmActions}><button type="button" className={styles.secondaryButton} onClick={requestClose} disabled={busy}>Keep current state</button><button type="button" className={action === 'delete' ? styles.dangerButton : styles.primaryButton} onClick={() => void confirm()} disabled={busy}>{busy ? <LoaderCircle className={styles.spin} size={15} aria-hidden="true" /> : <config.Icon size={15} aria-hidden="true" />}{busy ? 'Confirming…' : config.confirm}</button></div>
      </div>
    </div>
  );
}

function ReleaseLoading() {
  return <section className={styles.loading} role="status" aria-label="Loading secure release center"><div><span /><span /><span /></div><p>Connecting to protected release delivery…</p></section>;
}

function releaseMetrics(data: ReleaseData | null, currentTargets: Array<{ platform: 'MT4' | 'MT5'; release: Release }>) {
  const rows = data?.releases || [];
  const drafts = numberFrom(data?.summary, ['drafts', 'private_drafts']) ?? rows.filter((row) => releaseStatus(row) === 'Draft').length;
  const requests = numberFrom(data?.summary, ['deliveryRequests30d', 'delivery_requests_30d', 'downloads30d']) ?? rows.reduce((total, row) => total + row.download_count, 0);
  const livePlatforms = new Set(currentTargets.map((target) => target.platform)).size;
  return [
    { label: 'Live targets', value: `${livePlatforms}/2`, detail: livePlatforms === 2 ? 'MT4 and MT5 protected' : livePlatforms ? 'One protected channel live' : 'No channel published', tone: 'green', Icon: MonitorCheck },
    { label: 'Private drafts', value: drafts.toLocaleString(), detail: drafts === 1 ? 'One build awaiting release' : 'Builds not visible to clients', tone: 'gold', Icon: FileCog },
    { label: 'Delivery requests', value: data?.metricsAvailable ? requests.toLocaleString() : '—', detail: data?.metricsAvailable ? 'Secure gateway activity' : 'Metrics temporarily unavailable', tone: 'violet', Icon: Download },
    { label: 'Protected storage', value: data?.storageReady ? 'Enabled' : 'Setup', detail: data?.storageReady ? 'Secured on the first upload' : 'Apply the release migration', tone: 'cyan', Icon: data?.storageReady ? ShieldCheck : ServerCog },
  ];
}

function resolveCurrentTargets(data: ReleaseData | null) {
  if (!data) return [];
  const targets = new Map<'MT4' | 'MT5', Release>();
  for (const release of data.releases) {
    for (const platform of release.current_platforms) if (platform === 'MT4' || platform === 'MT5') targets.set(platform, release);
  }
  if (targets.size < 2) collectChannels(data.channels, data.releases, targets);
  return (['MT4', 'MT5'] as const).flatMap((platform) => {
    const release = targets.get(platform);
    return release ? [{ platform, release }] : [];
  });
}

function collectChannels(value: unknown, releases: Release[], targets: Map<'MT4' | 'MT5', Release>) {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (!isObject(item)) continue;
      const platform = item.platform;
      if (platform !== 'MT4' && platform !== 'MT5') continue;
      const release = releaseFromChannel(item, releases);
      if (release) targets.set(platform, release);
    }
    return;
  }
  if (!isObject(value)) return;
  for (const platform of ['MT4', 'MT5'] as const) {
    const release = releaseFromChannel(value[platform], releases);
    if (release) targets.set(platform, release);
  }
}

function releaseFromChannel(value: unknown, releases: Release[]) {
  if (typeof value === 'string') return releases.find((release) => release.id === value);
  if (!isObject(value)) return undefined;
  const embedded = normalizeRelease(value.release);
  if (embedded) return embedded;
  const id = typeof value.release_id === 'string' ? value.release_id : typeof value.current_release_id === 'string' ? value.current_release_id : typeof value.id === 'string' ? value.id : '';
  return releases.find((release) => release.id === id);
}

function parseReleaseData(value: unknown): ReleaseData {
  if (!isObject(value) || !Array.isArray(value.releases)) throw new Error('The secure release response was incomplete.');
  const releases = value.releases.map(normalizeRelease).filter((release): release is Release => Boolean(release));
  if (releases.length !== value.releases.length) throw new Error('One or more release records were incomplete.');
  return {
    releases,
    channels: value.channels,
    summary: isObject(value.summary) ? value.summary : {},
    storageReady: value.storageReady === true,
    metricsAvailable: value.metricsAvailable !== false,
  };
}

function normalizeRelease(value: unknown): Release | null {
  if (!isObject(value) || typeof value.id !== 'string' || typeof value.version !== 'string' || typeof value.title !== 'string') return null;
  const platform = value.platform === 'MT4' || value.platform === 'MT5' || value.platform === 'Both' ? value.platform : null;
  if (!platform) return null;
  const source: ReleaseSource = value.source === 'private' || value.source === 'external' || value.source === 'none' ? value.source : 'none';
  return {
    id: value.id,
    version: value.version,
    title: value.title,
    release_notes: nullableString(value.release_notes),
    platform,
    published: value.published === true,
    released_at: typeof value.released_at === 'string' ? value.released_at : '',
    published_at: nullableString(value.published_at),
    promoted_at: nullableString(value.promoted_at),
    archived_at: nullableString(value.archived_at),
    asset_status: typeof value.asset_status === 'string' ? value.asset_status : 'missing',
    source,
    file_name: nullableString(value.file_name),
    file_size: finiteNumber(value.file_size),
    file_type: nullableString(value.file_type),
    checksum_sha256: nullableString(value.checksum_sha256),
    file_verified_at: nullableString(value.file_verified_at),
    current_platforms: Array.isArray(value.current_platforms) ? value.current_platforms.filter((item): item is string => typeof item === 'string') : [],
    download_count: finiteNumber(value.download_count) || 0,
    unique_clients: finiteNumber(value.unique_clients) || 0,
    last_downloaded_at: nullableString(value.last_downloaded_at),
  };
}

function releaseFromResponse(value: unknown) {
  const direct = normalizeRelease(value);
  if (direct) return direct;
  return isObject(value) ? normalizeRelease(value.release) : null;
}

function parseUploadIntent(value: unknown) {
  if (!isObject(value) || !isObject(value.upload)) throw new Error('The private upload destination was incomplete.');
  const { upload } = value;
  if (typeof upload.id !== 'string' || typeof upload.path !== 'string' || typeof upload.token !== 'string' || typeof upload.bucket !== 'string') throw new Error('The private upload destination was incomplete.');
  return { id: upload.id, path: upload.path, token: upload.token, bucket: upload.bucket, constraints: isObject(value.constraints) ? value.constraints : {} };
}

function validateServerConstraints(file: File, constraints: Record<string, unknown>) {
  const max = finiteNumber(constraints.maxBytes) || finiteNumber(constraints.max_bytes) || MAX_UPLOAD_BYTES;
  if (file.size > max) throw new Error(`This file is larger than the ${formatBytes(max)} upload limit.`);
  const allowed = Array.isArray(constraints.extensions)
    ? constraints.extensions
    : Array.isArray(constraints.allowed_extensions)
      ? constraints.allowed_extensions
      : Array.isArray(constraints.accepted_extensions)
        ? constraints.accepted_extensions
        : null;
  if (allowed && !allowed.some((item) => typeof item === 'string' && file.name.toLowerCase().endsWith(item.toLowerCase().startsWith('.') ? item.toLowerCase() : `.${item.toLowerCase()}`))) throw new Error('This file type is not accepted by protected storage.');
}

function releaseStatus(release: Release) {
  if (release.current_platforms.length) return 'Live';
  if (release.archived_at) return 'Archived';
  if (release.published || release.published_at || release.promoted_at) return 'Published';
  return 'Draft';
}

function releaseReady(release: Release) {
  if (release.source === 'external') return true;
  if (release.source === 'none') return false;
  const status = release.asset_status.toLowerCase();
  return Boolean(release.file_verified_at) || ['verified', 'ready', 'available', 'complete'].includes(status);
}

function integrityLabel(release: Release) {
  if (release.source === 'external') return 'Protected link';
  if (releaseReady(release)) return 'Verified';
  const status = release.asset_status.toLowerCase();
  if (status === 'verifying') return 'Verifying';
  if (status === 'failed') return 'Check failed';
  if (release.source === 'private') return 'Pending check';
  return 'File needed';
}

function sourceLabel(release: Release) {
  if (release.source === 'private') return 'Private storage';
  if (release.source === 'external') return 'Protected external';
  return 'No file';
}

function validateSelectedFile(file: File) {
  const lower = file.name.toLowerCase();
  if (!ALLOWED_EXTENSIONS.some((extension) => lower.endsWith(extension))) return 'Choose an Orion .ex4, .ex5, or .zip release file.';
  if (file.size <= 0) return 'The selected file is empty.';
  if (file.size > MAX_UPLOAD_BYTES) return `This file is larger than the ${formatBytes(MAX_UPLOAD_BYTES)} upload limit.`;
  return '';
}

function validateFilePlatform(file: File, platform: ReleasePlatform) {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.ex4') && platform !== 'MT4') return 'An .ex4 build must use the MT4 platform. Use a .zip package for Both.';
  if (lower.endsWith('.ex5') && platform !== 'MT5') return 'An .ex5 build must use the MT5 platform. Use a .zip package for Both.';
  return '';
}

function contentTypeForFile(name: string) { return name.toLowerCase().endsWith('.zip') ? 'application/zip' : 'application/octet-stream'; }

function submitLabel({ value, file, storageReady, stage }: { value?: Release; file: File | null; storageReady: boolean; stage: UploadStage }) {
  if (stage === 'saving') return value ? 'Saving details…' : 'Creating private draft…';
  if (stage === 'preparing') return 'Preparing upload…';
  if (stage === 'uploading') return 'Uploading securely…';
  if (stage === 'verifying') return 'Verifying file…';
  if (file) return value ? 'Save & replace file' : 'Create draft & upload';
  if (!storageReady && !value) return 'Save private draft';
  return 'Save release details';
}

function useDialogFocus(dialogRef: React.RefObject<HTMLElement | null>, initialRef: React.RefObject<HTMLButtonElement | null>) {
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    initialRef.current?.focus();
    return () => opener?.focus();
  }, [dialogRef, initialRef]);
}

function handleDialogKeyDown(event: KeyboardEvent<HTMLElement>, close: () => void, busy = false) {
  if (event.key === 'Escape') { event.preventDefault(); if (!busy) close(); return; }
  if (event.key !== 'Tab') return;
  const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]):not([tabindex="-1"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'));
  if (!focusable.length) return;
  const first = focusable[0], last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

function jsonRequest(method: string, body: unknown, key?: string): RequestInit {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (key) headers['Idempotency-Key'] = key;
  return { method, credentials: 'same-origin', headers, body: JSON.stringify(body) };
}

async function requestJson(url: string, init?: RequestInit) {
  let response: Response;
  try { response = await fetch(url, init); }
  catch { throw new Error('The secure release service could not be reached.'); }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(isObject(body) && typeof body.error === 'string' ? body.error : 'The secure release request was not completed.');
  return body;
}

function idempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `release-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function numberFrom(value: Record<string, unknown> | undefined, keys: string[]) {
  if (!value) return null;
  for (const key of keys) { const number = finiteNumber(value[key]); if (number !== null) return number; }
  return null;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value)) && Number(value) >= 0) return Number(value);
  return null;
}

function nullableString(value: unknown) { return typeof value === 'string' && value ? value : null; }
function isObject(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null; }
function errorMessage(reason: unknown, fallback: string) { return reason instanceof Error && reason.message ? reason.message : fallback; }

function formatVersion(value: string) { return /^v/i.test(value) ? value : `v${value}`; }

function formatDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Date unavailable';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(parsed);
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB'];
  let size = value / 1024, index = 0;
  while (size >= 1024 && index < units.length - 1) { size /= 1024; index += 1; }
  return `${size >= 10 ? size.toFixed(0) : size.toFixed(1)} ${units[index]}`;
}

function formatChecksum(value: string | null) { return value ? `SHA-256 ${value.slice(0, 10)}…` : 'No checksum'; }
