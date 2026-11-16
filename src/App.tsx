import { useState, type ReactNode } from "react";
import "./App.css";
import "./map-only.css";

const activity = [2,1,4,3,7,9,5,4,8,12,16,11,7,3,2,6,9,14,12,6,4,2,1,5,8,10,13,9,4,3];

export default function App() {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historicYear, setHistoricYear] = useState<"2025" | "2026" | null>(null);
  const mapSource = historicYear ? `/maps/mapa_historico_${historicYear}.html` : "/maps/mapa_interactivo_colombia.html";
  const mapTitle = historicYear ? `Harmonized historical records · ${historicYear}` : "Fire monitoring · Colombia";
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
        <a href="#alertas"><b><img src="/icons/advertencia.png" alt="" /></b><span>Alerts</span></a>
        <a href="#emergencias"><b><img src="/icons/pregunta-y-respuesta.png" alt="" /></b><span>Emergency response</span></a>
        <button className="history-trigger" type="button" onClick={() => setHistoryOpen((open) => !open)} aria-expanded={historyOpen}>
          <b><img src="/icons/historia.png" alt="" /></b><span>Historical records</span><i>{historyOpen ? "−" : "+"}</i>
        </button>
        {historyOpen && <div className="history-years" aria-label="Select historical year">
          {(["2025", "2026"] as const).map((year) => <button type="button" className={historicYear === year ? "selected" : ""} key={year} onClick={() => setHistoricYear(year)}>{year}</button>)}
          <button type="button" className={historicYear === null ? "selected" : ""} onClick={() => setHistoricYear(null)}>All</button>
        </div>}
      </nav>
      <div className="side-bottom"><p><em /> NASA FIRMS conectado</p><button><strong>LC</strong><span>Luis Chaparro<small>Administrador</small></span>⌄</button></div>
    </aside>
    <section className="workspace" id="resumen">
      <header><div><p className="eyebrow">FIRE MONITORING · COLOMBIA</p><h1>Activity center</h1></div><div className="actions"><button className="outline">⇩ Export</button><button className="primary">+ New area</button></div></header>
      <section className="grid">
        <article className="card map-card" id="mapa"><CardHead title={mapTitle.toUpperCase()} subtitle={historicYear ? `Harmonized points from ${historicYear}. Select a date inside the map.` : "Harmonized, VIIRS and MODIS layers"} />
          <iframe key={mapSource} onLoad={(event) => styleMapControls(event.currentTarget)} className="analysis-map" title={mapTitle} src={mapSource} />
        </article>
        <article className="card alerts" id="alertas"><CardHead title="Alertas prioritarias" subtitle="Áreas con actividad anómala" right={<button className="link">Ver todas →</button>} /><div className="alert-list"><Alert tone="critical" title="Actividad elevada en Meta" desc="18 puntos en las últimas 3 horas" ago="Hace 12 min" /><Alert tone="warning" title="Nuevo foco en Vichada" desc="FRP superior a 25 MW" ago="Hace 31 min" /><Alert tone="warning" title="Actividad persistente en Cesar" desc="Detecciones en 3 días consecutivos" ago="Hace 1 h" /></div><button className="rule">+ Crear regla de alerta</button></article>
        <article className="card chart" id="calendario"><CardHead title="Calendario de actividad" subtitle="Detecciones diarias · Últimos 30 días" right={<button className="link">Ver detalle →</button>} /><div className="bars">{activity.map((n,i)=><div key={i}><b style={{height:`${Math.max(8,n*5)}%`}} /><span>{i%5===0?i+1:""}</span></div>)}</div><p className="scale"><span>0</span><span>Actividad alta</span></p></article>
        <article className="card sources" id="areas"><CardHead title="Fuentes de datos" subtitle="Estado de la sincronización" /><Source tag="V" name="VIIRS · Suomi NPP / NOAA-20" info="Alta resolución · 375 m" /><Source tag="M" name="MODIS · Terra / Aqua" info="Cobertura histórica · 1 km" /><p className="sync">↻ <span>La maqueta usa datos simulados hasta configurar NASA FIRMS.</span></p></article>
      </section><footer><span>Datos base: NASA FIRMS · MODIS y VIIRS</span><span>Maqueta v0.1</span></footer>
    </section>
  </main>;
}
function CardHead({title,subtitle,right}:{title:string;subtitle:string;right?:ReactNode}) { return <div className="head"><div><h2>{title}</h2><p>{subtitle}</p></div>{right}</div>; }
function Alert({tone,title,desc,ago}:{tone:string;title:string;desc:string;ago:string}) { return <button className={`alert-row ${tone}`}><b>!</b><span><strong>{title}</strong><small>{desc}</small><em>{ago}</em></span><i>›</i></button>; }
function Source({tag,name,info}:{tag:string;name:string;info:string}) { return <div className="source"><b className={tag==="V"?"viirs":"modis"}>{tag}</b><span><strong>{name}</strong><small>{info}</small></span><em>● Conectado</em></div>; }
