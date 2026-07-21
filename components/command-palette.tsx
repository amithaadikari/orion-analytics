'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './command-palette.module.css';

type SearchResult = { id:string; kind:'client'|'license'|'payment'; title:string; subtitle:string; section:string; search:string };
type PaletteCommand = { id:string; title:string; subtitle:string; icon:string; type:'action'|'navigation'; section?:string; filter?:string };
type CommandPaletteProps = {
  canWrite: boolean;
  onNavigate: (section:string, filter?:string, search?:string) => void;
  onAction: (action:'add-client'|'create-license'|'record-payment') => void;
};

const quickActions: PaletteCommand[] = [
  { id:'add-client', title:'Add a client', subtitle:'Create a new Orion client record', icon:'＋', type:'action' as const },
  { id:'create-license', title:'Create a license', subtitle:'Generate a new MT4 or MT5 license', icon:'◇', type:'action' as const },
  { id:'record-payment', title:'Record a payment', subtitle:'Add or verify a client transaction', icon:'$', type:'action' as const },
  { id:'pending-payments', title:'Verify pending payments', subtitle:'Open the payment verification queue', icon:'◈', type:'navigation' as const, section:'payments', filter:'Pending' },
  { id:'support', title:'Open support tickets', subtitle:'View the official client support queue', icon:'◎', type:'navigation' as const, section:'support' },
];
const pageCommands: PaletteCommand[] = [
  { id:'page-overview', title:'Analytics overview', subtitle:'Live acquisition and advanced analytics', icon:'✦', type:'navigation', section:'overview' },
  { id:'page-visitors', title:'Visitors', subtitle:'Anonymous audience and journey records', icon:'◉', type:'navigation', section:'visitors' },
  { id:'page-campaigns', title:'Campaigns', subtitle:'UTM and conversion comparison', icon:'↗', type:'navigation', section:'campaigns' },
  { id:'page-sales', title:'Revenue Intelligence', subtitle:'MRR, goals, renewals, and payment exceptions', icon:'◇', type:'navigation', section:'sales' },
  { id:'page-registrations', title:'Registration queue', subtitle:'Pending and unreviewed client accounts', icon:'＋', type:'navigation', section:'registrations' },
  { id:'page-clients', title:'Client management', subtitle:'Client cards and Client 360 profiles', icon:'◎', type:'navigation', section:'clients' },
  { id:'page-licenses', title:'License manager', subtitle:'Generate, renew, and monitor licenses', icon:'⌘', type:'navigation', section:'licenses' },
  { id:'page-payments', title:'Payment records', subtitle:'Transactions, receipts, and verification', icon:'$', type:'navigation', section:'payments' },
  { id:'page-fleet', title:'EA fleet monitor', subtitle:'Connection health and trading synchronization', icon:'◉', type:'navigation', section:'fleet' },
  { id:'page-releases', title:'Product releases', subtitle:'Secure downloads and version history', icon:'↓', type:'navigation', section:'releases' },
  { id:'page-activity', title:'Audit trail', subtitle:'Chronological operational activity', icon:'≋', type:'navigation', section:'activity' },
  { id:'page-support', title:'Support desk', subtitle:'Official client support tickets', icon:'?', type:'navigation', section:'support' },
  { id:'page-settings', title:'System settings', subtitle:'Tracking and connection configuration', icon:'⚙', type:'navigation', section:'settings' },
];

export default function CommandPalette({canWrite,onNavigate,onAction}:CommandPaletteProps){
  const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[results,setResults]=useState<SearchResult[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState(''),[active,setActive]=useState(0);
  const inputRef=useRef<HTMLInputElement>(null),paletteRef=useRef<HTMLElement>(null),openerRef=useRef<HTMLElement|null>(null);
  const availableQuickActions=useMemo(()=>quickActions.filter((item)=>canWrite||item.type==='navigation'),[canWrite]);
  const pageMatches=useMemo(()=>{const term=query.trim().toLocaleLowerCase();return term.length<2?[]:pageCommands.filter((item)=>`${item.title} ${item.subtitle}`.toLocaleLowerCase().includes(term)).slice(0,6)},[query]);
  const visible=useMemo(()=>(query.trim().length>=2?[...pageMatches,...results]:availableQuickActions),[availableQuickActions,pageMatches,query,results]);
  const activeOptionId=visible[active]?`command-search-option-${active}`:undefined;
  const close=useCallback(()=>{setOpen(false);setQuery('');setResults([]);setError('');openerRef.current?.focus()},[]);
  const launch=useCallback((item:PaletteCommand|SearchResult)=>{
    if('type'in item){
      if(item.type==='action')onAction(item.id as 'add-client'|'create-license'|'record-payment');
      else if(item.section)onNavigate(item.section,item.filter);
    }else onNavigate(item.section,undefined,item.search);
    close();
  },[close,onAction,onNavigate]);

  useEffect(()=>{const key=(event:globalThis.KeyboardEvent)=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){event.preventDefault();if(open)close();else{openerRef.current=document.activeElement instanceof HTMLElement?document.activeElement:null;setOpen(true)}}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)},[close,open]);
  useEffect(()=>{if(!open)return;queueMicrotask(()=>inputRef.current?.focus())},[open]);
  useEffect(()=>{if(!open)return;const previous=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{document.body.style.overflow=previous}},[open]);
  useEffect(()=>{setActive(0);const normalized=query.trim();if(normalized.length<2){setResults([]);setLoading(false);setError('');return}const controller=new AbortController(),timer=window.setTimeout(async()=>{setLoading(true);setError('');try{const response=await fetch(`/api/command-search?q=${encodeURIComponent(normalized)}`,{cache:'no-store',signal:controller.signal});const payload=await response.json().catch(()=>null);if(!response.ok)throw new Error(payload?.error||'Search is unavailable.');setResults(Array.isArray(payload?.results)?payload.results:[])}catch(reason){if(reason instanceof DOMException&&reason.name==='AbortError')return;setError(reason instanceof Error?reason.message:'Search is unavailable.')}finally{if(!controller.signal.aborted)setLoading(false)}},220);return()=>{window.clearTimeout(timer);controller.abort()}},[query]);
  useEffect(()=>{if(active>=visible.length)setActive(Math.max(0,visible.length-1))},[active,visible.length]);
  function keyboard(event:React.KeyboardEvent<HTMLElement>){
    if(event.key==='Escape'){event.preventDefault();close()}
    else if(event.key==='Tab'){
      const focusable=Array.from(paletteRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')||[]);
      if(!focusable.length)return;
      const first=focusable[0],last=focusable[focusable.length-1];
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
    }
    else if(event.key==='ArrowDown'){event.preventDefault();setActive(index=>Math.min(index+1,visible.length-1))}
    else if(event.key==='ArrowUp'){event.preventDefault();setActive(index=>Math.max(index-1,0))}
    else if(event.key==='Enter'&&event.target===inputRef.current&&visible[active]){event.preventDefault();launch(visible[active] as PaletteCommand|SearchResult)}
  }
  return <>
    <button className={styles.trigger} type="button" onClick={(event)=>{openerRef.current=event.currentTarget;setOpen(true)}} aria-haspopup="dialog" aria-expanded={open}><span aria-hidden="true">⌕</span><span>Command search</span><kbd>⌘K</kbd></button>
    {open&&createPortal(<div className={styles.backdrop} onMouseDown={close}><section ref={paletteRef} className={styles.palette} role="dialog" aria-modal="true" aria-label="Orion command search" onKeyDown={keyboard} onMouseDown={event=>event.stopPropagation()}>
      <div className={styles.search}><span aria-hidden="true">⌕</span><input ref={inputRef} role="combobox" aria-autocomplete="list" aria-expanded="true" aria-activedescendant={activeOptionId} value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search clients, licenses, payments, pages or actions…" aria-label="Search Orion command center" aria-controls="command-search-results"/><button type="button" aria-label="Close command search" onClick={close}>×</button></div>
      <div className={styles.body} id="command-search-results">
        <section className={styles.group}><h3>{query.trim().length>=2?'Search results':'Quick actions'}</h3>
          {loading&&!pageMatches.length?<p className={styles.state} role="status">Searching Orion records…</p>:error&&!pageMatches.length?<p className={styles.state} role="alert">{error}</p>:visible.length?<ul className={styles.list} role="listbox" aria-label="Command search results">{visible.map((item,index)=>{const isResult=!('type'in item);const icon=isResult?item.kind==='client'?'◎':item.kind==='license'?'◇':'◈':item.icon;const label=isResult?item.kind:item.id.startsWith('page-')?'Page':'Quick action';return <li role="presentation" key={item.id}><button id={`command-search-option-${index}`} role="option" aria-selected={active===index} className={styles.item} data-active={active===index} type="button" onMouseEnter={()=>setActive(index)} onClick={()=>launch(item as PaletteCommand|SearchResult)}><span className={styles.icon} aria-hidden="true">{icon}</span><span className={styles.copy}><strong>{item.title}</strong><small>{item.subtitle}</small></span><small>{label}</small></button></li>})}</ul>:<p className={styles.state}>No matching Orion records or pages.</p>}
        </section>
      </div><footer className={styles.footer}><span><b>↑↓</b> Navigate <b>↵</b> Open</span><span>Esc Close</span></footer>
    </section></div>,document.body)}
  </>
}
