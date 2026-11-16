import os, io, requests, zipfile, time
import pandas as pd
import numpy as np
import geopandas as gpd
from datetime import date, timedelta

# --- 1. CONFIGURACIÓN Y VERIFICACIÓN DE LA API ---
BASE = "./sentinel_data"
os.makedirs(BASE, exist_ok=True)

MAP_KEY = "167ddb15fa8f6253932f51acd348aeac"
BBOX = "-82,-4.3,-66.8,16.0"
API = "https://firms.modaps.eosdis.nasa.gov/api"

print("1. Verificando estado de la MAP_KEY...")
status_url = f"https://firms.modaps.eosdis.nasa.gov/mapserver/mapkey_status/?MAP_KEY={MAP_KEY}"
print("   Estado:", requests.get(status_url, timeout=30).text.strip())

print("\n2. Consultando disponibilidad de catálogos en NASA FIRMS...")
disp = pd.read_csv(f"{API}/data_availability/csv/{MAP_KEY}/ALL")
fuentes_interes = ["MODIS_SP", "VIIRS_SNPP_SP", "MODIS_NRT", "VIIRS_SNPP_NRT", "VIIRS_NOAA20_NRT"]
disp_col = disp[disp["data_id"].isin(fuentes_interes)].copy()
print(disp_col[["data_id", "min_date", "max_date"]].to_string(index=False))

# Convertir fechas de disponibilidad a objetos date para validar rangos automáticamente
disp_col["min_date"] = pd.to_datetime(disp_col["min_date"]).dt.date
disp_col["max_date"] = pd.to_datetime(disp_col["max_date"]).dt.date
limites = disp_col.set_index("data_id")[["min_date", "max_date"]].to_dict("index")

# --- 2. CARGA DEL MAPA DE COLOMBIA (GADM) ---
def obtener_mapa(nivel):
    ruta = f"{BASE}/gadm41_COL_{nivel}.json"
    if not os.path.exists(ruta):
        print(f"\nDescargando mapa de Colombia (Nivel {nivel})...")
        url = f"https://geodata.ucdavis.edu/gadm/gadm4.1/json/gadm41_COL_{nivel}.json.zip"
        r = requests.get(url, timeout=120)
        with zipfile.ZipFile(io.BytesIO(r.content)) as z:
            z.extract(f"gadm41_COL_{nivel}.json", BASE)
    return gpd.read_file(ruta)

deptos = obtener_mapa(1)

# --- 3. FUNCIÓN DE EXTRACCIÓN INTELIGENTE (RESPETA LÍMITES DE LA API) ---
def extraer_firms_seguro(source, start, end):
    if source not in limites:
        print(f"Fuente {source} no disponible.")
        return pd.DataFrame()
    
    # Ajustar automáticamente a las fechas reales disponibles en el servidor
    min_disp, max_disp = limites[source]["min_date"], limites[source]["max_date"]
    d_ini = max(start, min_disp)
    d_fin = min(end, max_disp)
    
    if d_ini > d_fin:
        print(f"   [{source}] Sin cobertura para {start} -> {end} (Disponible: {min_disp} a {max_disp})")
        return pd.DataFrame()

    print(f"   Extrayendo {source} desde {d_ini} hasta {d_fin}...")
    out, d = [], d_ini
    
    while d <= d_fin:
        # Calcular cuántos días pedir en este bloque (máximo 5 para mayor estabilidad)
        dias_bloque = min(5, (d_fin - d).days + 1)
        url = f"{API}/area/csv/{MAP_KEY}/{source}/{BBOX}/{dias_bloque}/{d.strftime('%Y-%m-%d')}"
        
        try:
            r = requests.get(url, timeout=120)
            if r.ok and "latitude" in r.text:
                df_chunk = pd.read_csv(io.StringIO(r.text))
                if not df_chunk.empty:
                    out.append(df_chunk)
            elif "Transaction limit" in r.text:
                print("   Límite de transacciones alcanzado. Pausando 60s...")
                time.sleep(60)
                continue # Reintentar el mismo bloque
            else:
                print(f"   Aviso en {d}: {r.text.strip()[:120]}")
        except Exception as e:
            print(f"   Error de red en {d}: {e}")
            
        d += timedelta(days=dias_bloque)
        time.sleep(0.4)
        
    if out:
        df = pd.concat(out, ignore_index=True)
        df["sensor"] = "MODIS" if "MODIS" in source else "VIIRS"
        df["coleccion"] = source
        return df
    return pd.DataFrame()

# --- 4. DESCARGA HISTÓRICA (_SP) + TIEMPO CASI REAL (_NRT) ---
print("\n3. Descargando datos de incendios...")

# Rango deseado (puedes ampliarlo a todo el año, ej. date(2024, 1, 1) a date(2024, 12, 31))
FECHA_INI_HIST = date(2025, 1, 1)
FECHA_FIN_HIST = date(2026, 1, 31)

# 4.1 Datos históricos procesados (Standard Processing)
mod_sp = extraer_firms_seguro("MODIS_SP", FECHA_INI_HIST, FECHA_FIN_HIST)
vii_sp = extraer_firms_seguro("VIIRS_SNPP_SP", FECHA_INI_HIST, FECHA_FIN_HIST)

# 4.2 Datos en vivo (Near Real-Time) de los últimos 7 días para el Sistema de Alertas
hoy = date.today()
hace_7d = hoy - timedelta(days=7)
mod_nrt = extraer_firms_seguro("MODIS_NRT", hace_7d, hoy)
vii_nrt = extraer_firms_seguro("VIIRS_SNPP_NRT", hace_7d, hoy)

# Unir todo lo recolectado
mod = pd.concat([mod_sp, mod_nrt], ignore_index=True)
vii = pd.concat([vii_sp, vii_nrt], ignore_index=True)

print(f"\nResumen de descarga -> MODIS: {len(mod):,} registros | VIIRS: {len(vii):,} registros")

# --- 5. RECORTE GEOGRÁFICO Y ARMONIZACIÓN (SENTINEL EMBER) ---
# --- 5. ARMONIZACIÓN FÍSICA POR SOLAPAMIENTO DE HUELLAS (SENTINEL EMBER) ---
from shapely.ops import unary_union
import json
import plotly.express as px

df_total = pd.concat([mod, vii], ignore_index=True)

if not df_total.empty:
    print("\n4. Ejecutando armonización por intersección de huellas satelitales...")

    # 5.1 Homologar confianza a escala 0-100%
    mapa_conf = {"l": 30, "n": 65, "h": 90, "low": 30, "nominal": 65, "high": 90}
    df_total["confidence"] = (
        df_total["confidence"].astype(str).str.lower().map(mapa_conf)
        .fillna(pd.to_numeric(df_total["confidence"], errors="coerce"))
        .fillna(50)
    )

    # 5.2 Dimensiones reales del píxel (scan y track en km) según ángulo de barrido
    df_total["scan"] = pd.to_numeric(df_total.get("scan", 1.0), errors="coerce").fillna(1.0)
    df_total["track"] = pd.to_numeric(df_total.get("track", 1.0), errors="coerce").fillna(1.0)
    df_total["area_pixel_km2"] = df_total["scan"] * df_total["track"]
    df_total["radio_efectivo_km"] = 0.5 * np.sqrt(df_total["scan"]**2 + df_total["track"]**2)

    # 5.3 Recorte espacial exacto a los departamentos de Colombia
    gdf_fuegos = gpd.GeoDataFrame(
        df_total,
        geometry=gpd.points_from_xy(df_total.longitude, df_total.latitude),
        crs="EPSG:4326"
    )

    gdf_col = gpd.sjoin(
        gdf_fuegos,
        deptos[["NAME_1", "geometry"]],
        how="inner",
        predicate="within"
    ).drop(columns=["index_right"]).rename(columns={"NAME_1": "departamento"}).reset_index(drop=True)

    # 5.4 Agrupamiento físico en EPSG:9377 (unir huellas de MODIS y VIIRS que se tocan)
    gdf_col_m = gdf_col.to_crs(9377)
    clusters = []
    cluster_id_actual = 0

    for fecha, grupo in gdf_col_m.groupby("acq_date"):
        # Radio físico de búsqueda en metros: radio efectivo del sensor + 600 m de tolerancia de borde
        radios_m = 1000.0 * (grupo["radio_efectivo_km"] + 0.6)
        huellas = grupo.geometry.buffer(radios_m)

        # Fusionar todas las huellas que se solapan físicamente ese día
        union_geom = unary_union(huellas.values)
        poligonos = [union_geom] if union_geom.geom_type == "Polygon" else list(union_geom.geoms)

        gdf_polys = gpd.GeoDataFrame(
            {"id_evento": range(cluster_id_actual, cluster_id_actual + len(poligonos))},
            geometry=poligonos,
            crs=9377
        )
        cluster_id_actual += len(poligonos)

        asignados = gpd.sjoin(grupo, gdf_polys, how="left", predicate="intersects").drop(columns=["index_right"])
        asignados = asignados[~asignados.index.duplicated(keep="first")]
        clusters.append(asignados)

    gdf_clustered = pd.concat(clusters, ignore_index=True)

    # Blindar FRP y Confianza contra NaNs y ceros antes de ponderar
    gdf_clustered["frp"] = pd.to_numeric(gdf_clustered["frp"], errors="coerce").fillna(1.0).clip(lower=0.5)
    gdf_clustered["confidence"] = pd.to_numeric(gdf_clustered["confidence"], errors="coerce").fillna(50.0).clip(lower=10.0)

    # 5.5 Ecuación de pesos espaciales: w_i = (FRP * Confianza) / Area^2
    # El término 1/Area^2 hace que el centroide combinado se ancle a la alta resolución de VIIRS (0.14 km²)
    gdf_clustered["peso_w"] = (
        (gdf_clustered["frp"].clip(lower=0.5) * gdf_clustered["confidence"]) /
        (gdf_clustered["area_pixel_km2"].clip(lower=0.1) ** 2)
    )
    gdf_clustered["lat_w"] = gdf_clustered["latitude"] * gdf_clustered["peso_w"]
    gdf_clustered["lon_w"] = gdf_clustered["longitude"] * gdf_clustered["peso_w"]
# ETAPA 1: Integración Intra-Sensor dentro de cada evento físico
    intra_sensor = (
        gdf_clustered.groupby(["id_evento", "acq_date", "sensor"], as_index=False)
        .agg(
            departamento=("departamento", "first"), # Asigna el foco al departamento principal si cruza una frontera
            lat_w_sum=("lat_w", "sum"),
            lon_w_sum=("lon_w", "sum"),
            peso_w_sum=("peso_w", "sum"),
            frp_total_sensor=("frp", "sum"),
            area_total_sensor=("area_pixel_km2", "sum"),
            confianza_sensor=("confidence", "max"),
            n_pixeles_sensor=("frp", "count"),
            incertidumbre_m=("radio_efectivo_km", lambda r: float(np.mean(r) * 1000))
        )
    )
    intra_sensor["frp_pond_conf"] = intra_sensor["frp_total_sensor"] * intra_sensor["confianza_sensor"]

    # Contar cuántos píxeles aportó cada sensor (Usando pivot_table para sumar sin errores de duplicados)
    pivote_pix = intra_sensor.pivot_table(
        index="id_evento", 
        columns="sensor", 
        values="n_pixeles_sensor", 
        aggfunc="sum"
    ).fillna(0)
    
    for col_s in ["MODIS", "VIIRS"]:
        if col_s not in pivote_pix.columns:
            pivote_pix[col_s] = 0
    pivote_pix = pivote_pix.rename(columns={"MODIS": "pixeles_MODIS", "VIIRS": "pixeles_VIIRS"}).reset_index()

    # ETAPA 2: Fusión Inter-Sensor en un único Punto Ponderado por evento
    eventos_armonizados = (
        intra_sensor.groupby(["id_evento", "acq_date"], as_index=False)
        .agg(
            departamento=("departamento", "first"), # Mantiene un solo departamento por clúster
            lat_w_total=("lat_w_sum", "sum"),
            lon_w_total=("lon_w_sum", "sum"),
            peso_w_total=("peso_w_sum", "sum"),
            frp_conf_sum=("frp_pond_conf", "sum"),
            conf_sum=("confianza_sensor", "sum"),
            area_evaluada_km2=("area_total_sensor", "min"),
            confianza_max=("confianza_sensor", "max"),
            n_pixeles_totales=("n_pixeles_sensor", "sum"),
            radio_incertidumbre_m=("incertidumbre_m", "min"),
            sensores_activos=("sensor", lambda s: "+".join(sorted(set(s))))
        )
    )
    # Resolver coordenadas ponderadas y FRP combinado
    eventos_armonizados["latitude"] = eventos_armonizados["lat_w_total"] / eventos_armonizados["peso_w_total"]
    eventos_armonizados["longitude"] = eventos_armonizados["lon_w_total"] / eventos_armonizados["peso_w_total"]
    eventos_armonizados["frp_combinado_mw"] = (eventos_armonizados["frp_conf_sum"] / eventos_armonizados["conf_sum"]).round(2)
    eventos_armonizados["intensidad_mw_km2"] = (
        eventos_armonizados["frp_combinado_mw"] / eventos_armonizados["area_evaluada_km2"].clip(lower=0.14)
    ).round(2)

    eventos_armonizados = eventos_armonizados.merge(pivote_pix, on="id_evento", how="left")

    # Etiqueta descriptiva del método de combinación aplicado al punto
    eventos_armonizados["tipo_armonia"] = np.where(
        eventos_armonizados["sensores_activos"] == "MODIS+VIIRS",
        "Fusión Inter-Sensor (MODIS + VIIRS)",
        np.where(
            eventos_armonizados["n_pixeles_totales"] > 1,
            "Clúster Multi-Píxel Ponderado (" + eventos_armonizados["sensores_activos"] + ")",
            "Foco Puntual (" + eventos_armonizados["sensores_activos"] + ")"
        )
    )

    eventos_armonizados["nivel_alerta"] = np.where(
        (eventos_armonizados["sensores_activos"] == "MODIS+VIIRS") | (eventos_armonizados["intensidad_mw_km2"] >= 80),
        "Crítica (Validada)",
        np.where(eventos_armonizados["confianza_max"] >= 65, "Moderada (Foco Incipiente)", "Vigilancia")
    )

    ruta_parquet = f"{BASE}/colombia_fuegos_armonizados.parquet"
    eventos_armonizados.to_parquet(ruta_parquet, index=False)
    # Guardar puntos crudos recortados a Colombia para comparar en el mapa
    # Guardar solo las columnas necesarias y tipadas para comparar en el mapa
    cols_crudos = ["latitude", "longitude", "frp", "confidence", "acq_date", "scan", "track", "sensor", "departamento"]
    gdf_col[cols_crudos].to_parquet(f"{BASE}/colombia_fuegos_crudos.parquet", index=False)
    print(f"   De {len(gdf_col):,} detecciones crudas -> {len(eventos_armonizados):,} puntos ponderados únicos.")
    print(f"   Eventos con fusión directa MODIS+VIIRS: {(eventos_armonizados['sensores_activos'] == 'MODIS+VIIRS').sum():,}")

# --- 6. MAPA INTERACTIVO DEL PUNTO PONDERADO (PLOTLY 6.0+) ---
# --- 6. MAPA INTERACTIVO CON SELECTOR DE CAPAS (COMBINADA / VIIRS / MODIS) ---
import json
import plotly.express as px

ruta_parquet = f"{BASE}/colombia_fuegos_armonizados.parquet"
ruta_crudos = f"{BASE}/colombia_fuegos_crudos.parquet"
ruta_deptos = f"{BASE}/gadm41_COL_1.json"

if os.path.exists(ruta_parquet):
    # 1. Cargar y limpiar datos armonizados (Vista Combinada)
    eventos_armonizados = pd.read_parquet(ruta_parquet)
    eventos_armonizados = eventos_armonizados.dropna(subset=["latitude", "longitude"]).copy()
    eventos_armonizados["frp_combinado_mw"] = pd.to_numeric(eventos_armonizados["frp_combinado_mw"], errors="coerce").fillna(5.0)
    eventos_armonizados["intensidad_mw_km2"] = pd.to_numeric(eventos_armonizados["intensidad_mw_km2"], errors="coerce").fillna(5.0)
    eventos_armonizados["tamano_punto"] = eventos_armonizados["frp_combinado_mw"].clip(lower=3.0, upper=150.0).fillna(5.0)

    # 2. Preparar datos para las vistas individuales (VIIRS y MODIS)
    if os.path.exists(ruta_crudos):
        df_ind = pd.read_parquet(ruta_crudos).dropna(subset=["latitude", "longitude"]).copy()
        df_ind["frp"] = pd.to_numeric(df_ind["frp"], errors="coerce").fillna(5.0)
        df_ind["tamano_punto"] = df_ind["frp"].clip(lower=3.0, upper=150.0).fillna(5.0)
        df_viirs = df_ind[df_ind["sensor"] == "VIIRS"].copy()
        df_modis = df_ind[df_ind["sensor"] == "MODIS"].copy()
        cols_hover_ind = {"acq_date": True, "frp": ":.1f", "confidence": True, "scan": True, "track": True, "tamano_punto": False}
    else:
        # Si no se ha guardado el archivo de crudos, filtra directamente del parquet armonizado
        df_viirs = eventos_armonizados[eventos_armonizados["pixeles_VIIRS"] > 0].copy()
        df_modis = eventos_armonizados[eventos_armonizados["pixeles_MODIS"] > 0].copy()
        cols_hover_ind = {"acq_date": True, "frp_combinado_mw": ":.1f", "pixeles_VIIRS": True, "pixeles_MODIS": True, "tamano_punto": False}

    # 3. Construir figura base con la vista COMBINADA (Armonizada)
    mapa_alertas_en = {
        "Crítica (Validada)": "Critical (Cross-Validated)",
        "Moderada (Foco Incipiente)": "Moderate (Incipient Focus)",
        "Vigilancia": "Watch (Low Confidence)"
    }
    eventos_armonizados["alert_level"] = (
        eventos_armonizados["nivel_alerta"].map(mapa_alertas_en).fillna(eventos_armonizados["nivel_alerta"])
    )

    eventos_armonizados["harmony_type"] = (
        eventos_armonizados["tipo_armonia"]
        .str.replace("Fusión Inter-Sensor", "Inter-Sensor Fusion", regex=False)
        .str.replace("Clúster Multi-Píxel Ponderado", "Weighted Multi-Pixel Cluster", regex=False)
        .str.replace("Foco Puntual", "Single-Pixel Focus", regex=False)
    )

    # Construir figura base con la vista COMBINADA (Harmonized)
    fig = px.scatter_map(
        eventos_armonizados,
        lat="latitude",
        lon="longitude",
        color="alert_level",
        size="tamano_punto",
        size_max=17,
        opacity=0.85,
        color_discrete_map={
            "Critical (Cross-Validated)": "#ff3b30",
            "Moderate (Incipient Focus)": "#ff9500",
            "Watch (Low Confidence)": "#ffcc00"
        },
        category_orders={
            "alert_level": [
                "Critical (Cross-Validated)",
                "Moderate (Incipient Focus)",
                "Watch (Low Confidence)"
            ]
        },
        custom_data=[
            "departamento", "alert_level", "acq_date", "harmony_type",
            "n_pixeles_totales", "pixeles_VIIRS", "pixeles_MODIS",
            "frp_combinado_mw", "intensidad_mw_km2", "area_evaluada_km2",
            "radio_incertidumbre_m", "latitude", "longitude"
        ],
        zoom=5.0,
        center={"lat": 4.5709, "lon": -74.2973},
        map_style="carto-darkmatter"
    )

    # Tarjeta emergente (Tooltip) limpia en inglés para la capa armonizada
    fig.update_traces(
        hovertemplate=(
            "<b>📍 %{customdata[0]} Department</b><br>"
            "<b>Alert Level:</b> %{customdata[1]}<br>"
            "<b>Date:</b> %{customdata[2]} | <b>Coords:</b> %{customdata[11]:.4f}, %{customdata[12]:.4f}<br>"
            "<b>Method:</b> %{customdata[3]}<br>"
            "<b>Merged Pixels:</b> %{customdata[4]} (VIIRS: %{customdata[5]} | MODIS: %{customdata[6]})<br>"
            "<b>Combined FRP:</b> %{customdata[7]:.1f} MW<br>"
            "<b>Radiative Intensity:</b> %{customdata[8]:.1f} MW/km²<br>"
            "<b>Evaluated Footprint:</b> %{customdata[9]:.2f} km² (±%{customdata[10]:.0f} m)"
            "<extra></extra>"
        )
    )
    n_comb = len(fig.data)

    # 4. Crear capa SOLO VIIRS (375 m) y agregarla oculta por defecto
    col_frp_ind = "frp" if "frp" in df_viirs.columns else "frp_combinado_mw"
    fig_viirs = px.scatter_map(
        df_viirs,
        lat="latitude",
        lon="longitude",
        size="tamano_punto",
        size_max=13,
        opacity=0.82,
        color_discrete_sequence=["#00e5ff"],
        custom_data=["departamento", "acq_date", col_frp_ind, "latitude", "longitude"]
    )
    for trace in fig_viirs.data:
        trace.name = f"VIIRS 375m Only ({len(df_viirs):,})"
        trace.showlegend = True
        trace.visible = False
        trace.hovertemplate = (
            "<b>📍 %{customdata[0]} Department</b><br>"
            "<b>Sensor:</b> VIIRS (375 m Nadir Resolution)<br>"
            "<b>Date:</b> %{customdata[1]}<br>"
            "<b>Radiative Power (FRP):</b> %{customdata[2]:.1f} MW<br>"
            "<b>Coords:</b> %{customdata[3]:.4f}, %{customdata[4]:.4f}"
            "<extra></extra>"
        )
        fig.add_trace(trace)
    n_viirs = len(fig_viirs.data)

    # 5. Crear capa SOLO MODIS (1 km) y agregarla oculta por defecto
    fig_modis = px.scatter_map(
        df_modis,
        lat="latitude",
        lon="longitude",
        size="tamano_punto",
        size_max=15,
        opacity=0.82,
        color_discrete_sequence=["#ff2a85"],
        custom_data=["departamento", "acq_date", col_frp_ind, "latitude", "longitude"]
    )
    for trace in fig_modis.data:
        trace.name = f"MODIS 1km Only ({len(df_modis):,})"
        trace.showlegend = True
        trace.visible = False
        trace.hovertemplate = (
            "<b>📍 %{customdata[0]} Department</b><br>"
            "<b>Sensor:</b> MODIS (1 km Nadir Resolution)<br>"
            "<b>Date:</b> %{customdata[1]}<br>"
            "<b>Radiative Power (FRP):</b> %{customdata[2]:.1f} MW<br>"
            "<b>Coords:</b> %{customdata[3]:.4f}, %{customdata[4]:.4f}"
            "<extra></extra>"
        )
        fig.add_trace(trace)
    n_modis = len(fig_modis.data)

    # 6. Configurar máscaras de visibilidad y diseño visual oscuro (Dark UI)
    vis_comb  = [True] * n_comb  + [False] * n_viirs + [False] * n_modis
    vis_viirs = [False] * n_comb + [True] * n_viirs  + [False] * n_modis
    vis_modis = [False] * n_comb + [False] * n_viirs + [True] * n_modis

    fig.update_layout(
        title={
            "text": "<b>SENTINEL EMBER</b>  |  Physics-Based Harmonized Wildfire Monitoring (MODIS + VIIRS)",
            "x": 0.015,
            "y": 0.975,
            "xanchor": "left",
            "yanchor": "top",
            "font": {"color": "#f0f4f8", "size": 17, "family": "Segoe UI, Roboto, Helvetica, sans-serif"}
        },
        paper_bgcolor="#0d1117",
        plot_bgcolor="#0d1117",
        font={"family": "Segoe UI, Roboto, Helvetica, sans-serif", "color": "#e6edf3"},
        hoverlabel={
            "bgcolor": "rgba(15, 20, 28, 0.94)",
            "bordercolor": "#30363d",
            "font": {"color": "#f0f6fc", "size": 12.5, "family": "Segoe UI, Roboto, sans-serif"}
        },
        legend={
            "title": {"text": "<b>Active Layer / Severity</b>", "font": {"size": 12, "color": "#8b949e"}},
            "x": 0.985,
            "y": 0.91,
            "xanchor": "right",
            "yanchor": "top",
            "bgcolor": "rgba(13, 17, 23, 0.88)",
            "bordercolor": "#30363d",
            "borderwidth": 1,
            "font": {"size": 12, "color": "#e6edf3"},
            "itemsizing": "constant"
        },
        updatemenus=[{
            "type": "buttons",
            "direction": "right",
            "active": 0,
            "x": 0.015,
            "y": 0.91,
            "xanchor": "left",
            "yanchor": "top",
            "bgcolor": "#161b22",
            "bordercolor": "#30363d",
            "borderwidth": 1,
            "pad": {"r": 8, "t": 6, "b": 6, "l": 8},
            "font": {"color": "#58a6ff", "size": 12},
            "buttons": [
                {
                    "label": f"🔥 Harmonized Fusion ({len(eventos_armonizados):,})",
                    "method": "update",
                    "args": [
                        {"visible": vis_comb},
                        {"title.text": "<b>SENTINEL EMBER</b>  |  Physics-Based Harmonized Wildfire Monitoring (MODIS + VIIRS)"}
                    ]
                },
                {
                    "label": f"🛰️ VIIRS 375m Only ({len(df_viirs):,})",
                    "method": "update",
                    "args": [
                        {"visible": vis_viirs},
                        {"title.text": "<b>SENTINEL EMBER</b>  |  Raw VIIRS Sensor Detections (375 m Nadir Resolution)"}
                    ]
                },
                {
                    "label": f"🛰️ MODIS 1km Only ({len(df_modis):,})",
                    "method": "update",
                    "args": [
                        {"visible": vis_modis},
                        {"title.text": "<b>SENTINEL EMBER</b>  |  Raw MODIS Sensor Detections (1 km Nadir Resolution)"}
                    ]
                }
            ]
        }],
        margin={"r": 0, "t": 52, "l": 0, "b": 0}
    )

    # 7. Superponer límites departamentales de Colombia
    if os.path.exists(ruta_deptos):
        with open(ruta_deptos, "r", encoding="utf-8") as f:
            geojson_col = json.load(f)
        fig.update_layout(
            map_layers=[{
                "sourcetype": "geojson",
                "source": geojson_col,
                "type": "line",
                "color": "rgba(255, 255, 255, 0.25)",
                "line": {"width": 1}
            }]
        )

    ruta_html = f"{BASE}/mapa_interactivo_colombia.html"
    fig.write_html(ruta_html)
    print(f"Mapa interactivo con selector guardado en: {ruta_html}")
    fig.show()
else:
    print("No existe el archivo parquet para graficar.")
