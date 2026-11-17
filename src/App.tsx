import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, ChevronRight, Compass, Crown, ExternalLink, Globe2, Layers3, Maximize2, Plus, RefreshCw, Search,  Wallet, X } from 'lucide-react';
import { usePlatform } from './lib/usePlatform';
import { layoutTerritories } from './lib/territories';
import type { Token, PlatformConfig } from './types';
import { formatUnits } from './lib/math';

const compact = (n: number) => new Intl.NumberFormat('fr-FR', { notation: n >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 2 }).format(n);
const percent = (n: number) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(n) + ' %';
const shortAddress = (a: string) => a.length > 15 ? `${a.slice(0, 5)}…${a.slice(-5)}` : a;

export default function App() {
  const platform = usePlatform();
  const { config, snapshot, loading, error, wallet, busy, notice } = platform;
  const [page, setPage] = useState<'map' | 'ranking' | 'rules'>('map');
  const [selectedMint, setSelectedMint] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const mapRef = useRef<HTMLDivElement>(null);
  const [mapSize, setMapSize] = useState({ width: 960, height: 570 });
  const demo = config.mode === 'demo';
  const currency = snapshot.currency ?? (demo ? config.quoteSymbol : 'USD');
  const creationFee = formatUnits(config.creationFeeAtomic ?? '0', config.quoteDecimals);
  const explorerSuffix = config.mode === 'devnet' ? '?cluster=devnet' : '';
  const awaitingCount = snapshot.tokens.filter(t => t.marketCap <= 0).length;
  const tokens = [...snapshot.tokens].sort((a, b) => b.marketCap - a.marketCap || a.mint.localeCompare(b.mint));
  const total = tokens.reduce((sum, token) => sum + token.marketCap, 0);
  const selected = tokens.find(t => t.mint === selectedMint) ?? tokens[0];
  const filtered = tokens.filter(t => `${t.name} ${t.symbol} ${t.mint}`.toLowerCase().includes(query.toLowerCase()));
  const territories = layoutTerritories(tokens, mapSize.width, mapSize.height);
  const activeCount = tokens.filter(t => t.marketCap > 0).length;

  useEffect(() => {
    const element = mapRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setMapSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element);
    return () => observer.disconnect();
  }, [page, expanded, loading]);

  useEffect(() => {
    if (!expanded) return;
    const listener = (event: KeyboardEvent) => { if (event.key === 'Escape') setExpanded(false); };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [expanded]);

  async function action(fn: () => Promise<void>) {
    setLocalError(null);
    try { await fn(); } catch (err) { setLocalError(err instanceof Error ? err.message : 'Action impossible. Réessayez.'); }
  }

  function select(token: Token) { setSelectedMint(token.mint); }

  const selectedShare = selected && total > 0 ? selected.marketCap / total * 100 : 0;

  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="#" onClick={e => { e.preventDefault(); setPage('map'); }} aria-label="Dominion, carte des territoires"><span className="brand-mark"><Layers3 size={24} strokeWidth={2.3} /></span><span>dominion<span className="brand-dot">.</span></span></a>
      <nav className="main-nav" aria-label="Navigation principale">{([{id:"map",label:"Le territoire"},{id:"ranking",label:"Classement"},{id:"rules",label:"Les règles"}] as const).map(item=><button key={item.id} className={page===item.id?"active":""} onClick={()=>setPage(item.id)}>{item.label}</button>)}</nav><div className="topbar-middle"><span className="network-dot" />Solana<span className="network-name">{demo ? 'Démo' : config.mode === 'devnet' ? 'Devnet' : 'Mainnet'}</span>{!demo && config.quoteMint && <a className="payment-token-link" href={`https://explorer.solana.com/address/${config.quoteMint}${explorerSuffix}`} target="_blank" rel="noreferrer" title={`Token de paiement : ${config.quoteMint}`}>{config.quoteSymbol}<ExternalLink size={11} /></a>}</div>
      <div className="header-actions"><button className="button button-quiet header-create" onClick={() => setCreateOpen(true)}><Plus size={16} />Créer un token</button><button className="button wallet-button" disabled={busy} onClick={() => void action(wallet ? platform.disconnect : platform.connect)}><Wallet size={17} /><span>{wallet ? shortAddress(wallet) : 'Connecter Phantom'}</span>{wallet && <span className="connected-dot" />}</button></div>
    </header>

    <div className="workspace">
      <main className="main-content">
        {demo && <div className="demo-banner"><span><span className="demo-tag">Démo</span>Explorez le jeu avec des tokens fictifs. Aucun fonds réel n’est utilisé.</span><button onClick={() => { platform.resetDemo(); setSelectedMint(null); }}>Réinitialiser</button></div>}
        {!demo && <div className="launch-banner"><span><span className="launch-dot" />Création de token : <strong>{creationFee} {config.quoteSymbol}</strong><span className="launch-extra">+ frais Solana</span></span>{config.quoteMint && <a href={`https://explorer.solana.com/address/${config.quoteMint}${explorerSuffix}`} target="_blank" rel="noreferrer" title={config.quoteMint}>Token de paiement : {shortAddress(config.quoteMint)}<ExternalLink size={12} /></a>}</div>}
        {(error || localError) && <div className="message message-error" role="alert"><span>{localError || error}</span>{localError && <button aria-label="Fermer le message" onClick={() => setLocalError(null)}><X size={16} /></button>}</div>}
        {notice && <div className="message message-success" role="status"><Check size={17} /><span>{notice}</span></div>}

        {page === 'map' ? <section className="dominion-hero" aria-label="Bienvenue sur Dominion"><div className="hero-art" aria-hidden="true"><img src="/dominion-city.svg" alt="" /></div><div className="hero-content"><div className="hero-network"><span className="solana-bars"><i /><i /><i /></span>Le launchpad de conquête sur Solana</div><h1>UN TOKEN.<br />UN EMPIRE.</h1><p>Lancez votre token. Rassemblez votre communauté.<br /> Faites grandir votre part du monde.</p><div className="hero-actions"><button className="button button-primary" onClick={()=>setCreateOpen(true)}><Plus size={18} />Créer un token</button><a className="button hero-explore" href="#arena"><Compass size={17} />Explorer le territoire</a></div><div className="hero-caption">Votre capitalisation dessine vos frontières.</div></div><div className="art-caption">L’univers Dominion · illustration</div></section> : <div className="page-heading"><div><h1>{page==='ranking'?'LES EMPIRES EN JEU.':'LES RÈGLES DU TERRITOIRE.'}</h1><p>{page==='ranking'?'La conquête se mesure en parts du monde.':'Un monde partagé. Chaque surface a un sens.'}</p></div><button className="button button-primary" onClick={()=>setCreateOpen(true)}><Plus size={18} />Créer un token</button></div>}

        <section className="world-stats" aria-label="Statistiques du monde"><div><span>Capitalisation du monde</span><strong>{compact(total)} <small>{currency}</small></strong></div><div><span>Tokens créés</span><strong>{tokens.length.toString().padStart(2, '0')} <small>dont {activeCount} sur la carte</small></strong></div><div><span>Territoire occupé</span><strong>{total > 0 ? '100' : '0'}<small> % du monde</small></strong></div><div className="world-status"><span className={demo ? 'status-dot demo' : 'status-dot'} /><div><strong>{demo ? 'Simulation locale' : 'Données Solana'}</strong><span>{demo ? 'À vous de jouer' : snapshot.updatedAt ? `Actualisé à ${new Date(snapshot.updatedAt).toLocaleTimeString('fr-FR')}` : 'En attente du réseau'}</span></div></div></section>

        {page === 'map' && <div className="game-grid" id="arena">
          <section className={expanded ? 'map-panel map-expanded' : 'map-panel'} aria-label="Carte des territoires">
            <div className="panel-toolbar"><div className="map-title"><span className="map-cross">⌖</span><strong>La carte des empires</strong><span>{activeCount} territoires</span></div><div className="toolbar-actions"><button title="Actualiser les données" aria-label="Actualiser les données" disabled={loading || busy} onClick={() => void action(platform.refresh)}><RefreshCw size={16} className={loading ? 'spinning' : ''} /></button><button title={expanded ? 'Réduire la carte' : 'Agrandir la carte'} aria-label={expanded ? 'Réduire la carte' : 'Agrandir la carte'} onClick={() => setExpanded(!expanded)}>{expanded ? <X size={18} /> : <Maximize2 size={16} />}</button></div></div>
            <div className="territory-map" ref={mapRef} aria-busy={loading}>
              {territories.map(({ token, x, y, width, height }) => <button key={token.mint} className={`territory ${selected?.mint === token.mint ? 'territory-selected' : ''} ${query && !filtered.some(t => t.mint === token.mint) ? 'territory-muted' : ''}`} onClick={() => select(token)} style={{ left: x, top: y, width, height, backgroundColor: token.color }} aria-label={`${token.name}, ${percent(total > 0 ? token.marketCap / total * 100 : 0)} du territoire, ${compact(token.marketCap)} ${currency}`} title={`${token.name} · ${percent(total > 0 ? token.marketCap / total * 100 : 0)}`}>
                {width > 72 && height > 54 && <span className="territory-content"><span className="territory-symbol" style={{ fontSize: Math.min(36, Math.max(13, width / 7)) }}>{token.symbol}</span>{width > 105 && height > 90 && <span className="territory-name">{token.name}</span>}<span className="territory-share">{percent(total > 0 ? token.marketCap / total * 100 : 0)}</span>{width > 160 && height > 155 && <span className="territory-cap">{compact(token.marketCap)} {currency}</span>}</span>}
                {selected?.mint === token.mint && width > 55 && height > 45 && <span className="territory-selected-mark"><Check size={13} /></span>}
              </button>)}
              {territories.length === 0 && <div className="empty-map"><div className="empty-beacon" aria-hidden="true"><Layers3 size={38} strokeWidth={1.2} /></div><h2>{loading ? 'Le monde se dessine…' : 'Un monde à conquérir.'}</h2><p>{tokens.length ? `${awaitingCount} token${awaitingCount > 1 ? 's' : ''} en attente de cotation. Un prix et une liquidité vérifiables sur un marché externe feront apparaître les territoires.` : 'Créez votre token sur Solana. Son territoire apparaîtra lorsqu’un marché externe fournira un prix et une liquidité vérifiables.'}</p><button className="button button-primary" onClick={() => setCreateOpen(true)}>Créer le premier token</button></div>}
            </div>
            <div className="map-footer"><span><span className="tiny-square" />Surface = part de capitalisation</span><span>{demo ? 'Données fictives' : snapshot.slot ? `Slot ${snapshot.slot.toLocaleString('fr-FR')}` : 'En attente'}<span className="footer-separator">/</span>{total > 0 ? '100 % répartis' : 'Aucun territoire actif'}</span></div>
          </section>

          <aside className="token-panel" aria-label="Token sélectionné">
            {selected ? <><div className="token-heading"><div className="token-avatar" style={{ background: selected.color }}>{selected.symbol.slice(0, 2)}</div><div><h2>{selected.name}</h2><span>${selected.symbol}</span></div><span className="rank-pill"><Crown size={12} />#{tokens.findIndex(t => t.mint === selected.mint) + 1}</span></div>
              <div className="token-territory"><span>Part du territoire</span><strong>{percent(selectedShare)}</strong><div className="territory-progress"><span style={{ width: `${selectedShare}%`, background: selected.color }} /></div></div>
              <dl className="token-facts"><div><dt>Capitalisation</dt><dd>{compact(selected.marketCap)} <span>{currency}</span></dd></div><div><dt>Prix du token</dt><dd>{selected.price > 0 ? new Intl.NumberFormat('fr-FR', { maximumSignificantDigits: 5 }).format(selected.price) : 'Non coté'} {selected.price > 0 && <span>{currency}</span>}</dd></div><div><dt>Offre actuelle</dt><dd>{compact(Number(selected.supply) / 10 ** selected.decimals)}</dd></div></dl>
              <div className="external-market"><span className={selected.marketCap > 0 ? 'listing-status listed' : 'listing-status'}><span />{selected.marketCap > 0 ? 'Prix de marché disponible' : 'En attente de cotation'}</span><h3>{selected.marketCap > 0 ? 'Son marché, ailleurs.' : 'Votre token existe déjà.'}</h3><p>{selected.marketCap > 0 ? 'Le prix et la liquidité proviennent d’un marché externe. Les échanges se font sur ce marché.' : 'La création ne crée pas de pool de liquidité. Sans prix de marché vérifiable, ce token conserve une surface nulle.'}</p>{!demo && <><a className="button button-primary" href={`https://dexscreener.com/solana/${selected.mint}`} target="_blank" rel="noreferrer">Voir le marché externe<ExternalLink size={14} /></a><a className="button button-quiet" href={`https://explorer.solana.com/address/${selected.mint}${explorerSuffix}`} target="_blank" rel="noreferrer">Voir sur Solana Explorer<ExternalLink size={13} /></a><small>Une fiche DexScreener peut être absente si le token n’est pas encore coté.</small></>}{demo && <small>Données fictives : aucun marché réel pour ce token de démonstration.</small>}</div>
              <div className="token-address"><span>Adresse du token</span><button title="Copier l’adresse du token" onClick={() => { void navigator.clipboard.writeText(selected.mint).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => setLocalError('Impossible de copier l’adresse.')); }}>{copied ? 'Copié !' : shortAddress(selected.mint)}{copied ? <Check size={13} /> : <Layers3 size={13} />}</button>{!demo && <a href={`https://explorer.solana.com/address/${selected.mint}${config.mode === 'devnet' ? '?cluster=devnet' : ''}`} target="_blank" rel="noreferrer" aria-label="Voir le token sur Solana Explorer"><ExternalLink size={14} /></a>}</div>
            </> : <div className="empty-token"><div className="empty-token-top"><Crown size={18} /><span>Votre prochain empire</span></div><div className="empire-emblem"><Crown size={52} strokeWidth={1} /></div><h2>La première place<br />est à prendre.</h2><p>Créez un token pour rejoindre le monde. Une fois coté, sa capitalisation lui donne un territoire.</p><button className="button button-primary" onClick={()=>setCreateOpen(true)}><Plus size={16} />Lancer mon token</button><div className="empty-token-cost"><span>Création</span><strong>{creationFee} {config.quoteSymbol}</strong><small>+ frais Solana</small></div></div>}
          </aside>
        </div>}

        {(page === 'map' || page === 'ranking') && <section className="ranking-panel"><div className="ranking-heading"><div><h2>{page === 'map' ? 'Le classement des empires' : 'Le classement du monde'}</h2><span>{tokens.length} tokens dans ce monde</span></div><label className="search-field"><Search size={16} /><input aria-label="Rechercher un token" placeholder="Rechercher un token…" value={query} onChange={e => setQuery(e.target.value)} /></label></div><div className="table-scroll"><table><thead><tr><th>Rang</th><th>Token</th><th>Capitalisation</th><th>Territoire</th><th>Prix</th><th><span className="sr-only">Consulter</span></th></tr></thead><tbody>{filtered.slice(0, page === 'map' ? 5 : undefined).map(token => <tr key={token.mint} className={selected?.mint === token.mint ? 'selected-row' : ''}><td><span className="table-rank">{tokens.findIndex(t => t.mint === token.mint) + 1}</span></td><td><button className="token-table-button" onClick={() => { select(token); setPage('map'); }}><span className="table-avatar" style={{ background: token.color }}>{token.symbol.slice(0, 1)}</span><span><strong>{token.name}</strong><small>${token.symbol}{token.marketCap <= 0 ? ' · En attente de cotation' : ''}</small></span></button></td><td>{compact(token.marketCap)} <small>{currency}</small></td><td><div className="table-share"><span>{percent(total > 0 ? token.marketCap / total * 100 : 0)}</span><div><span style={{ width: `${total > 0 ? token.marketCap / total * 100 : 0}%`, background: token.color }} /></div></div></td><td>{new Intl.NumberFormat('fr-FR', { maximumSignificantDigits: 4 }).format(token.price)} <small>{currency}</small></td><td><button className="row-open" aria-label={`Consulter ${token.name}`} onClick={() => { select(token); setPage('map'); }}><ChevronRight size={16} /></button></td></tr>)}</tbody></table>{filtered.length === 0 && <p className="empty-search">{tokens.length ? 'Aucun token ne correspond à votre recherche.' : 'Le premier token de ce monde sera peut-être le vôtre.'}</p>}</div>{page === 'map' && tokens.length > 5 && <button className="all-tokens" onClick={() => setPage('ranking')}>Voir les {tokens.length} tokens<ChevronRight size={15} /></button>}</section>}

        {page === 'rules' && <section className="rules-panel"><div className="rules-intro"><Globe2 size={54} strokeWidth={1} /><h2>Un token. Une place dans le monde.</h2><p>Chaque rectangle représente un token créé sur Dominion. Sa surface correspond à sa capitalisation en dollars divisée par la capitalisation totale des tokens cotés de la plateforme.</p><div className="formula">Territoire = capitalisation du token ÷ capitalisation du monde</div></div><div className="rules-steps"><article><span>1</span><div><h3>Créez votre token avec Phantom</h3><p>Choisissez un nom et un symbole. La création coûte {creationFee} {config.quoteSymbol}, plus les frais réseau et de création des comptes en SOL. Un milliard de tokens, avec six décimales, est créé et attribué à votre wallet.</p></div></article><article><span>2</span><div><h3>Donnez-lui un marché</h3><p>Le token est enregistré sur la plateforme dès sa création. La création d’un pool de liquidité sur un marché externe est une démarche distincte. Sans prix et liquidité vérifiables, le token reste dans la liste avec une surface nulle.</p></div></article><article><span>3</span><div><h3>Voyez son territoire évoluer</h3><p>Lorsqu’un prix en dollars est disponible sur un marché externe, la capitalisation est calculée à partir de ce prix et de l’offre actuelle du mint. Les surfaces s’ajustent proportionnellement et remplissent le rectangle dès qu’au moins un token est coté.</p></div></article></div><div className="rules-details"><h3>Des règles lisibles</h3><p>Capitalisation = prix en dollars × offre actuelle du mint, après destruction éventuelle de tokens. Le calcul utilise l’offre totale existante, y compris les tokens détenus par le créateur ; il ne déduit pas les portefeuilles inactifs ou les réserves des marchés.</p><p>Une faible liquidité peut gonfler la capitalisation. Le territoire ne mesure ni la solidité ni la valeur réalisable d’un token. Ce n’est ni le montant disponible au retrait ni une garantie de liquidité.</p><p>Les tokens créés n’ont pas d’autorité de gel. L’autorité de création supplémentaire est révoquée après l’émission initiale. Les frais de création sont transférés en {config.quoteSymbol} ; ils ne constituent pas une réserve de marché et ne financent pas un pool de liquidité.</p><p>Les noms et symboles ne sont pas uniques : l’adresse du mint identifie le token. La surface ne donne aucun droit de propriété ni rendement. Une recherche ne change jamais les proportions du monde.</p></div><button className="button button-primary" onClick={() => setPage('map')}><Compass size={17} />Explorer la carte</button></section>}
        <footer className="page-footer"><span>DOMINION</span><span>Créez votre token. Prenez votre place.</span><button onClick={() => setPage('rules')}>Comprendre les règles</button></footer>
      </main>
    </div>
    {createOpen && <CreateModal demo={demo} config={config} busy={busy} enabled={demo || config.creationEnabled} onClose={() => setCreateOpen(false)} onSubmit={async input => { await platform.createToken(input); setCreateOpen(false); setPage('map'); }} />}
  </div>;
}

function CreateModal({ demo, config, busy, enabled, onClose, onSubmit }: { demo: boolean; config: PlatformConfig; busy: boolean; enabled: boolean; onClose: () => void; onSubmit: (input: { name: string; symbol: string; seedAmount?: string }) => Promise<void> }) {
  const ref = useRef<HTMLDivElement>(null);
  const [name, setName] = useState('');
  const [ticker, setTicker] = useState('');
  const creationFee = formatUnits(config.creationFeeAtomic ?? '0', config.quoteDecimals);
  const explorerSuffix = config.mode === 'devnet' ? '?cluster=devnet' : '';
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setAccepted(false); }, [config.creationFeeAtomic, config.quoteMint, config.treasury, config.configVersion]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLInputElement>('input')?.focus();
    const listener = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
      if (e.key === 'Tab') {
        const nodes = [...(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),a[href]') ?? [])];
        const first = nodes[0]; const last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', listener);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', listener); document.body.style.overflow = previousOverflow; previous?.focus(); };
  }, [busy, onClose]);
  async function submit(e: FormEvent) {
    e.preventDefault(); setError(null);
    if (!name.trim() || new TextEncoder().encode(name.trim()).length > 32) { setError('Le nom doit contenir entre 1 et 32 octets (les accents peuvent compter double).'); return; }
    if (!/^[A-Z0-9]{1,10}$/.test(ticker)) { setError('Utilisez 1 à 10 lettres ou chiffres pour le symbole.'); return; }
    try { await onSubmit({ name: name.trim(), symbol: ticker }); } catch (err) { setError(err instanceof Error ? err.message : 'La création a échoué. Réessayez.'); }
  }
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}><div className="create-modal" ref={ref} role="dialog" aria-modal="true" aria-labelledby="create-title"><button className="modal-close" aria-label="Fermer la création" disabled={busy} onClick={onClose}><X size={20} /></button><span className="modal-symbol"><Layers3 size={26} /></span><h2 id="create-title">Un nouveau territoire<br />commence par un token.</h2><p>{demo ? 'Essayez la création avec des fonds fictifs.' : 'Créez votre token Solana et recevez son offre dans votre wallet.'}</p><form onSubmit={e => void submit(e)}><label htmlFor="token-name">Nom du token</label><input id="token-name" value={name} onChange={e => setName(e.target.value)} placeholder="Ex. Moon Garden" maxLength={32} required /><div className="modal-fields creation-symbol-field"><div><label htmlFor="token-symbol">Symbole</label><input id="token-symbol" value={ticker} onChange={e => setTicker(e.target.value.toUpperCase())} placeholder="GARDEN" maxLength={10} pattern="[A-Z0-9]{1,10}" required /></div></div><div className="creation-facts"><span>Offre initiale<strong>1 milliard de tokens</strong></span><span>Attribués à votre wallet<strong>100 % de l’offre</strong></span><span>Décimales<strong>6</strong></span><span>Émission supplémentaire<strong>Révoquée</strong></span><span>Gel des tokens<strong>Aucune autorité</strong></span><span className="creation-fee-row">Frais de création<strong>{creationFee} {config.quoteSymbol}</strong></span></div>{!demo && <div className="fee-disclosure"><p><strong>En plus : des SOL sont nécessaires.</strong> Les frais réseau et de création des comptes Solana sont estimés dans Phantom avant la signature. Les frais en {config.quoteSymbol} ne créent pas de liquidité.</p>{config.quoteMint && <a href={`https://explorer.solana.com/address/${config.quoteMint}${explorerSuffix}`} target="_blank" rel="noreferrer"><span>Token de paiement ({config.quoteSymbol})</span><code>{config.quoteMint}</code><ExternalLink size={12} /></a>}{config.treasury && <a href={`https://explorer.solana.com/address/${config.treasury}${explorerSuffix}`} target="_blank" rel="noreferrer"><span>Destinataire des frais</span><code>{config.treasury}</code><ExternalLink size={12} /></a>}</div>}<label className="check-label"><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} required /><span>{demo ? 'Je comprends que cette création est une simulation sans fonds réels.' : `J’accepte les frais de création de ${creationFee} ${config.quoteSymbol} et les frais en SOL présentés dans Phantom. La cotation et la création de liquidité sont des étapes distinctes.`}</span></label>{!enabled && <p className="modal-network-note">La création est momentanément indisponible. Réessayez après actualisation.</p>}{error && <div className="message message-error" role="alert">{error}</div>}<button className="button button-primary" type="submit" disabled={busy || !accepted || !enabled}>{busy ? 'Création en cours…' : demo ? 'Créer mon token fictif' : `Créer pour ${creationFee} ${config.quoteSymbol}`}<Plus size={17} /></button></form></div></div>;
}
