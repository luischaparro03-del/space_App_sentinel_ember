import { useEffect, useState, type ReactNode } from "react";
import "./App.css";
import "./map-only.css";

const activity = [2,1,4,3,7,9,5,4,8,12,16,11,7,3,2,6,9,14,12,6,4,2,1,5,8,10,13,9,4,3];
type OperationAlert = { id:string; observed_at:string; latitude:number; longitude:number; frp:number; intensity:number; sensors:string; level:string; status:"new"|"acknowledged"|"dispatched"|"resolved"; ideam_notification_status:string; department:string };

export default function App() {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historicYear, setHistoricYear] = useState<"2025" | "2026" | null>(null);
  const [view, setView] = useState<"map"|"alerts"|"response">("map");
  const [alerts, setAlerts] = useState<OperationAlert[]>([]);
  const [loadingAlerts, setLoadingAlerts] = useState(false);
  const mapSource = historicYear ? `/maps/mapa_historico_${historicYear}.html` : "/maps/mapa_interactivo_colombia.html";
  const mapTitle = historicYear ? `Harmonized historical records · ${historicYear}` : "Fire monitoring · Colombia";
  const loadAlerts = async (refresh = false) => { setLoadingAlerts(true); try { const response = await fetch(refresh ? "/api/alerts/refresh" : "/api/alerts", { method: refresh ? "POST" : "GET" }); const payload = await response.json(); if (payload.data) setAlerts(payload.data); } finally { setLoadingAlerts(false); } };
  const setAlertStatus = async (id: string, status: OperationAlert["status"]) => { const response = await fetch(`/api/alerts/${id}/status`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({status}) }); const payload = await response.json(); if (payload.data) setAlerts(current => current.map(alert => alert.id === id ? payload.data : alert)); };
  useEffect(() => { if (view !== "map") void loadAlerts(); }, [view]);
  const styleMapControls = (frame: HTMLIFrameElement) => {
    const doc = frame.contentDocument;
    if (!doc || doc.getElementById("sentinel-map-controls")) return;
    const style = doc.createElement("style");
    style.id = "sentinel-map-controls";
    style.textContent = `
      .updatemenu-button rect { fill: #151b27 !important; stroke: #6d8196 !important; }
      .updatemenu-button text { fill: #ffffff !important; }
      .updatemenu-button.active rect { fill: #79ccef !important; stroke: #c9f1ff !important; }
      .updatemenu-button.active text { fill: #102133 !important; font-weight: 700 !important; }
      .updatemenu-container { display: none !important; }
      #sentinel-layer-controls { position: absolute; z-index: 10000; top: 54px; left: 14px; display: flex; gap: 4px; }
      #sentinel-layer-controls button { border: 1px solid #6d8196; border-radius: 3px; background: #151b27; color: #ffffff; padding: 8px 11px; font: 600 12px Verdana, Geneva, sans-serif; cursor: pointer; }
      #sentinel-layer-controls button.selected { background: #79ccef; border-color: #c9f1ff; color: #102133; }
    `;
    doc.head.appendChild(style);
    const translateMap = () => {
      const translations: Array<[string, string]> = [
        ["Sentinel Ember: Focos Armonizados por Huella Física (MODIS + VIIRS)", "Sentinel Ember: Harmonized Fire Hotspots by Physical Footprint (MODIS + VIIRS)"],
        ["Combinada Armonizada", "Combined harmonized"],
        ["Solo VIIRS", "VIIRS only"],
        ["Solo MODIS", "MODIS only"],
        ["Capa Activa", "Active layer"],
        ["Crítica (Validada)", "Critical (validated)"],
        ["Moderada (Foco Incipiente)", "Moderate (emerging hotspot)"],
        ["Vigilancia", "Monitoring"]
      ];
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
      const nodes: Text[] = [];
      while (walker.nextNode()) nodes.push(walker.currentNode as Text);
      nodes.forEach((node) => translations.forEach(([from, to]) => {
        if (node.nodeValue?.includes(from)) node.nodeValue = node.nodeValue.replace(from, to);
      }));
    };
    const paintActiveLayer = () => {
      const activeMenu = doc.querySelector("[updatemenu-active-index]");
      const activeIndex = Number(activeMenu?.getAttribute("updatemenu-active-index") ?? 0);
      doc.querySelectorAll<SVGGElement>("g.updatemenu-button").forEach((button, index) => {
        const active = index === activeIndex;
        button.querySelectorAll<SVGRectElement>("rect").forEach((rect) => {
          rect.style.fill = active ? "#79ccef" : "#151b27";
          rect.style.stroke = active ? "#c9f1ff" : "#6d8196";
        });
        button.querySelectorAll<SVGTextElement>("text").forEach((text) => {
          text.style.fill = active ? "#102133" : "#ffffff";
          text.style.fontWeight = active ? "700" : "400";
        });
      });
    };
    const observer = new MutationObserver(() => requestAnimationFrame(() => {
      paintActiveLayer();
      translateMap();
    }));
    observer.observe(doc.body, { subtree: true, childList: true, attributes: true });
    requestAnimationFrame(paintActiveLayer);
    translateMap();
    const addLayerControls = () => {
      if (doc.getElementById("sentinel-layer-controls")) return;
      const graph = doc.querySelector<HTMLElement>(".js-plotly-plot") as (HTMLElement & { data?: Array<{ name?: string }> }) | null;
      const plotly = (frame.contentWindow as (Window & { Plotly?: { restyle: (graph: HTMLElement, update: { visible: boolean[] }) => void } }) | null)?.Plotly;
      if (!graph || !plotly) return;
      const controls = doc.createElement("div");
      controls.id = "sentinel-layer-controls";
      ([ ["harmonized", "Harmonized"], ["viirs", "VIIRS only"], ["modis", "MODIS only"] ] as const).forEach(([layer, label]) => {
        const button = doc.createElement("button");
        button.type = "button"; button.textContent = label; button.dataset.layer = layer;
        if (layer === "harmonized") button.classList.add("selected");
        button.onclick = () => {
          const visible = (graph.data ?? []).map((trace) => {
            const name = trace.name ?? "";
            return layer === "viirs" ? name.includes("VIIRS") : layer === "modis" ? name.includes("MODIS") : !name.includes("VIIRS") && !name.includes("MODIS");
          });
          plotly.restyle(graph, { visible });
          controls.querySelectorAll("button").forEach((item) => item.classList.toggle("selected", item === button));
        };
        controls.appendChild(button);
      });
      doc.body.appendChild(controls);
    };
    requestAnimationFrame(addLayerControls);
  };

  return <main className="app-shell">
    <aside className="sidebar">
      <div className="brand"><b>◒</b> Fuego<span>.geo</span></div>
      <nav aria-label="Acciones operativas">
        <a href="#alerts" className={view === "alerts" ? "active" : ""} onClick={(event) => { event.preventDefault(); setView("alerts"); }}><b><img src="/icons/advertencia.png" alt="" /></b><span>Alerts</span></a>
        <a href="#response" className={view === "response" ? "active" : ""} onClick={(event) => { event.preventDefault(); setView("response"); }}><b><img src="/icons/pregunta-y-respuesta.png" alt="" /></b><span>Emergency response</span></a>
        <button className={`history-trigger ${historyOpen ? "active" : ""}`} type="button" onClick={() => setHistoryOpen((open) => !open)} aria-expanded={historyOpen}>
          <b><img src="/icons/historia.png" alt="" /></b><span>Historical records</span><i>{historyOpen ? "−" : "+"}</i>
        </button>
        {historyOpen && <div className="history-years" aria-label="Select historical year">
          {(["2025", "2026"] as const).map((year) => <button type="button" className={historicYear === year ? "selected" : ""} key={year} onClick={() => setHistoricYear(year)}>{year}</button>)}
          <button type="button" className={historicYear === null ? "selected" : ""} onClick={() => setHistoricYear(null)}>All</button>
        </div>}
        <a href="#map" className={view === "map" ? "active" : ""} onClick={(event) => { event.preventDefault(); setView("map"); }}><b className="map-icon">◉</b><span>View map</span></a>
      </nav>
      <div className="side-bottom"><p><em /> NASA FIRMS conectado</p><button><strong>LC</strong><span>Luis Chaparro<small>Administrador</small></span>⌄</button></div>
    </aside>
    <section className="workspace" id="resumen">
      <header><div><p className="eyebrow">FIRE MONITORING · COLOMBIA</p><h1>Activity center</h1></div><div className="actions"><button className="outline">⇩ Export</button><button className="primary">+ New area</button></div></header>
      <section className="grid">
        {view === "map" ? <article className="card map-card" id="mapa"><CardHead title={mapTitle.toUpperCase()} subtitle={historicYear ? `Harmonized points from ${historicYear}. Select a date inside the map.` : "Harmonized, VIIRS and MODIS layers"} />
          <iframe key={mapSource} onLoad={(event) => styleMapControls(event.currentTarget)} className="analysis-map" title={mapTitle} src={mapSource} />
        </article> : <OperationsPanel view={view} alerts={alerts} loading={loadingAlerts} onRefresh={() => void loadAlerts(true)} onStatus={setAlertStatus} />}
        <article className="card alerts" id="alertas"><CardHead title="Alertas prioritarias" subtitle="Áreas con actividad anómala" right={<button className="link">Ver todas →</button>} /><div className="alert-list"><Alert tone="critical" title="Actividad elevada en Meta" desc="18 puntos en las últimas 3 horas" ago="Hace 12 min" /><Alert tone="warning" title="Nuevo foco en Vichada" desc="FRP superior a 25 MW" ago="Hace 31 min" /><Alert tone="warning" title="Actividad persistente en Cesar" desc="Detecciones en 3 días consecutivos" ago="Hace 1 h" /></div><button className="rule">+ Crear regla de alerta</button></article>
        <article className="card chart" id="calendario"><CardHead title="Calendario de actividad" subtitle="Detecciones diarias · Últimos 30 días" right={<button className="link">Ver detalle →</button>} /><div className="bars">{activity.map((n,i)=><div key={i}><b style={{height:`${Math.max(8,n*5)}%`}} /><span>{i%5===0?i+1:""}</span></div>)}</div><p className="scale"><span>0</span><span>Actividad alta</span></p></article>
        <article className="card sources" id="areas"><CardHead title="Fuentes de datos" subtitle="Estado de la sincronización" /><Source tag="V" name="VIIRS · Suomi NPP / NOAA-20" info="Alta resolución · 375 m" /><Source tag="M" name="MODIS · Terra / Aqua" info="Cobertura histórica · 1 km" /><p className="sync">↻ <span>La maqueta usa datos simulados hasta configurar NASA FIRMS.</span></p></article>
      </section><footer><span>Datos base: NASA FIRMS · MODIS y VIIRS</span><span>Maqueta v0.1</span></footer>
    </section>
  </main>;
}
function OperationsPanel({view, alerts, loading, onRefresh, onStatus}:{view:"alerts"|"response";alerts:OperationAlert[];loading:boolean;onRefresh:()=>void;onStatus:(id:string,status:OperationAlert["status"])=>void}) {
  const response = view === "response";
  const title = response ? "Emergency response" : "Alert intelligence";
  const subtitle = response ? "Dispatch coordination and incident lifecycle" : "Satellite-derived wildfire risk overview";
  const total = alerts.length, critical = alerts.filter(a => a.level === "critical").length, moderate = alerts.filter(a => a.level === "moderate").length;
  const active = alerts.filter(a => a.status !== "resolved").length, dispatched = alerts.filter(a => a.status === "dispatched").length, resolved = alerts.filter(a => a.status === "resolved").length;
  const byDepartment = Object.entries(alerts.reduce<Record<string, number>>((out, a) => ({...out,[a.department]:(out[a.department] ?? 0)+1}),{})).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const maxDept = Math.max(1,...byDepartment.map(([,count])=>count));
  const peak = alerts.reduce((max, a) => Math.max(max, a.intensity), 0);
  return <article className="operations-panel"><header><div><p className="eyebrow">SENTINEL EMBER / COMMAND CENTER</p><h2>{title}</h2><p>{subtitle}</p></div><div className="dashboard-actions"><span className="live-dot">FIRMS LIVE</span><button className="refresh-alerts" onClick={onRefresh} disabled={loading}>{loading ? "Syncing FIRMS…" : "Refresh data"}</button></div></header>
    <section className="command-kpis"><Kpi label={response ? "Open incidents" : "Detected alerts"} value={response ? active : total} note={response ? `${dispatched} dispatched` : `${critical} critical`} tone="blue"/><Kpi label="Critical risk" value={critical} note={`${moderate} moderate`} tone="red"/><Kpi label="Peak intensity" value={`${peak.toFixed(1)}`} note="MW / km²" tone="orange"/><Kpi label={response ? "Resolved" : "IDEAM delivery"} value={response ? resolved : alerts.filter(a=>a.ideam_notification_status === "sent").length} note={response ? "closed incidents" : "critical notices sent"} tone="green"/></section>
    <section className="command-grid"><article className="command-card severity-card"><div className="card-title"><div><small>Risk distribution</small><h3>Alert severity</h3></div><span>{total} total</span></div><div className="severity-layout"><div className="donut" style={{background:`conic-gradient(#ff4d4f 0 ${(critical/Math.max(total,1))*360}deg,#ffad42 ${(critical/Math.max(total,1))*360}deg ${((critical+moderate)/Math.max(total,1))*360}deg,#36516d ${((critical+moderate)/Math.max(total,1))*360}deg 360deg)`}}><b>{total}</b><small>alerts</small></div><div className="legend-lines"><p><i className="critical-dot"/>Critical <b>{critical}</b></p><p><i className="moderate-dot"/>Moderate <b>{moderate}</b></p><p><i className="watch-dot"/>Other <b>{Math.max(0,total-critical-moderate)}</b></p></div></div></article>
      <article className="command-card department-chart"><div className="card-title"><div><small>Geographic concentration</small><h3>Priority departments</h3></div><span>Top 5</span></div>{byDepartment.length ? <div className="bar-list">{byDepartment.map(([name,count])=><div key={name}><p><span>{name}</span><b>{count}</b></p><em><i style={{width:`${(count/maxDept)*100}%`}}/></em></div>)}</div> : <EmptyChart text="No alerts yet"/>}</article>
      <article className="command-card workflow-card"><div className="card-title"><div><small>{response ? "Response workflow" : "Delivery workflow"}</small><h3>{response ? "Incident status" : "IDEAM notification"}</h3></div></div><div className="workflow"><div><b>{alerts.filter(a=>a.status === "new").length}</b><span>New</span></div><div><b>{alerts.filter(a=>a.status === "acknowledged").length}</b><span>Acknowledged</span></div><div><b>{dispatched}</b><span>Dispatched</span></div><div><b>{resolved}</b><span>Resolved</span></div></div><p className="workflow-note">{response ? "Update each incident after field confirmation." : "Only critical alerts are eligible for automatic IDEAM delivery."}</p></article></section>
    <section className="incident-section"><div className="section-heading"><div><small>{response ? "Field queue" : "Detection queue"}</small><h3>{response ? "Incident management" : "Recent satellite alerts"}</h3></div><span>{total} records</span></div>{alerts.length === 0 ? <div className="empty-alerts"><h3>No recorded operational alerts</h3><p>Refresh to retrieve the latest harmonized MODIS + VIIRS detections.</p></div> : <div className="incident-table"><div className="incident-head"><span>Department / location</span><span>Severity</span><span>Detection</span><span>Telemetry</span><span>Action</span></div>{alerts.map(alert=><article key={alert.id} className="incident-row"><div><b>{alert.department}</b><small>{alert.latitude.toFixed(4)}, {alert.longitude.toFixed(4)}</small></div><span className={`severity-pill ${alert.level}`}>{alert.level}</span><div><b>{new Date(alert.observed_at).toLocaleDateString()}</b><small>{new Date(alert.observed_at).toLocaleTimeString()}</small></div><div><b>{alert.frp.toFixed(1)} MW</b><small>{alert.sensors} · {alert.intensity.toFixed(1)} MW/km²</small></div><div className="row-actions">{response ? <><button onClick={()=>onStatus(alert.id,"dispatched")}>Dispatch</button><button className="secondary" onClick={()=>onStatus(alert.id,"resolved")}>Close</button></> : <><small>IDEAM: {alert.level === "critical" ? alert.ideam_notification_status.replaceAll("_"," ") : "not required"}</small><button onClick={()=>onStatus(alert.id,"acknowledged")}>Acknowledge</button></>}</div></article>)}</div>}</section></article>;
}
function Kpi({label,value,note,tone}:{label:string;value:string|number;note:string;tone:string}) { return <article className={`kpi ${tone}`}><small>{label}</small><strong>{value}</strong><span>{note}</span></article>; }
function EmptyChart({text}:{text:string}) { return <div className="empty-chart">{text}</div>; }
function CardHead({title,subtitle,right}:{title:string;subtitle:string;right?:ReactNode}) { return <div className="head"><div><h2>{title}</h2><p>{subtitle}</p></div>{right}</div>; }
function Alert({tone,title,desc,ago}:{tone:string;title:string;desc:string;ago:string}) { return <button className={`alert-row ${tone}`}><b>!</b><span><strong>{title}</strong><small>{desc}</small><em>{ago}</em></span><i>›</i></button>; }
function Source({tag,name,info}:{tag:string;name:string;info:string}) { return <div className="source"><b className={tag==="V"?"viirs":"modis"}>{tag}</b><span><strong>{name}</strong><small>{info}</small></span><em>● Conectado</em></div>; }
