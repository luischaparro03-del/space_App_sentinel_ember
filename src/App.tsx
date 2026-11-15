import { useState, type ReactNode } from "react";
import "./App.css";
import "./map-only.css";

const activity = [2,1,4,3,7,9,5,4,8,12,16,11,7,3,2,6,9,14,12,6,4,2,1,5,8,10,13,9,4,3];

export default function App() {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historicYear, setHistoricYear] = useState<"2025" | "2026" | null>(null);
  const mapSource = historicYear ? `/maps/mapa_historico_${historicYear}.html` : "/maps/mapa_interactivo_colombia.html";
  const mapTitle = historicYear ? `Registro histórico armonizado · ${historicYear}` : "Monitoreo de incendios · Colombia";

  return <main className="app-shell">
    <aside className="sidebar">
      <div className="brand"><b>◒</b> Fuego<span>.geo</span></div>
      <nav aria-label="Acciones operativas">
        <a href="#alertas"><b><img src="/icons/advertencia.png" alt="" /></b><span>Alertas</span></a>
        <a href="#emergencias"><b><img src="/icons/pregunta-y-respuesta.png" alt="" /></b><span>Respuesta ante emergencias</span></a>
        <button className="history-trigger" type="button" onClick={() => setHistoryOpen((open) => !open)} aria-expanded={historyOpen}>
          <b><img src="/icons/historia.png" alt="" /></b><span>Registro histórico</span><i>{historyOpen ? "−" : "+"}</i>
        </button>
        {historyOpen && <div className="history-years" aria-label="Seleccionar año histórico">
          {(["2025", "2026"] as const).map((year) => <button type="button" className={historicYear === year ? "selected" : ""} key={year} onClick={() => setHistoricYear(year)}>{year}</button>)}
        </div>}
      </nav>
      <div className="side-bottom"><p><em /> NASA FIRMS conectado</p><button><strong>LC</strong><span>Luis Chaparro<small>Administrador</small></span>⌄</button></div>
    </aside>
    <section className="workspace" id="resumen">
      <header><div><p className="eyebrow">MONITOREO DE INCENDIOS · COLOMBIA</p><h1>Centro de actividad</h1></div><div className="actions"><button className="outline">⇩ Exportar</button><button className="primary">+ Nueva área</button></div></header>
      <section className="grid">
        <article className="card map-card" id="mapa"><CardHead title={mapTitle.toUpperCase()} subtitle={historicYear ? `Puntos armonizados del ${historicYear}. Selecciona una fecha dentro del mapa.` : "Capas armonizada, VIIRS y MODIS"} />
          <iframe key={mapSource} className="analysis-map" title={mapTitle} src={mapSource} />
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
